"""LiveKit agent worker: one job per interview room.

The web app dispatches this agent explicitly through the candidate's join
token (room configuration), so the agent is in the room as the candidate
arrives. The candidate's microphone reaches Gemini Live as a WebRTC audio
track; nothing is transcribed in the browser.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any

from google.genai import types as genai_types
from livekit import api, rtc
from livekit.agents import (
    NOT_GIVEN,
    Agent,
    AgentServer,
    AgentSession,
    InterruptionOptions,
    JobContext,
    JobProcess,
    RunContext,
    TurnHandlingOptions,
    cli,
    function_tool,
    llm,
    room_io,
    vad,
)
from livekit.agents.voice import io
from livekit.plugins import google, silero

from .audio_track import InterviewAudio, InterviewHrAudio
from .backend import Backend, iso_from_epoch, iso_now
from .config import (
    CLIENT_EVENT_TOPIC,
    HR_EVENT_TOPIC,
    AgentConfig,
    agent_name,
    load_env,
)
from .controller import (
    CLOSING_LEAD_SECONDS,
    CLOSING_OVERRUN_SECONDS,
    EVIDENCE_LEVELS,
    Directive,
    InterviewController,
)
from .noise_filter import SAMPLE_RATE as FILTER_SAMPLE_RATE
from .noise_filter import FilteredVAD, noise_filter_enabled
from .plan import InterviewContext, parse_context
from .prompts import SYSTEM_NOTE_PREFIX, build_instructions

logger = logging.getLogger("intervia.agent")

CANDIDATE_IDENTITY_PREFIX = "candidate-"
HR_IDENTITY_PREFIX = "hr-"
ROOM_NAME_PREFIX = "interview-"
WATCHDOG_INTERVAL_SECONDS = 2.0
# How long the interviewer waits for a rejoin after the candidate drops
# (matches the web app's two-minute reconnection window; the session keeps its
# question state, transcript and elapsed clock while the candidate is away).
CANDIDATE_REJOIN_GRACE_SECONDS = 120.0
# How long a paused candidate may take to come back from leaving full screen,
# hiding the tab or pressing Leave, before the interview ends as it stands.
PAUSE_GRACE_SECONDS = 30.0
# A directive waits this long for the candidate to finish a sentence.
MAX_WAIT_FOR_PAUSE_SECONDS = 15.0
# Spoken once, word for word, when the time is up. Short enough to finish
# inside CLOSING_LEAD_SECONDS.
CLOSING_SCRIPT = (
    "I'm sorry to stop you there, but our time is up. Thank you for all the information "
    "you've shared, it will be processed. Goodbye."
)
# Interviews that end this early are not marked completed, so the candidate
# can rejoin with the same link (dropped connection, wrong device).
MIN_COMPLETED_SECONDS = 60.0
CARRY_OVER_TURNS = 4
# A session renewed in the middle of a topic carries more of the conversation,
# so the interviewer still has the whole thread of the current answer.
ROLLING_CARRY_OVER_TURNS = 12
# After the interviewer stops speaking, wait this long before renewing the
# session, in case it is only pausing before a tool call.
ROLLING_SETTLE_SECONDS = 0.25
# The candidate's audio is never held back longer than this during a renewal.
GATE_MAX_HOLD_SECONDS = 4.0


class GatedAudioInput(io.AudioInput):
    """The candidate's audio, with a gate that can hold it back briefly.

    While one model session is being replaced by another, anything the
    candidate says would reach neither. Holding the audio for that fraction of
    a second and then passing it on, in order, means no word is lost.

    It can also mute the candidate for good: frames are replaced with silence,
    so the model can no longer hear, answer or be interrupted by them.
    """

    def __init__(self, source: io.AudioInput) -> None:
        super().__init__(label="Gated", source=source)
        self._open = asyncio.Event()
        self._open.set()
        self._muted = False

    def hold(self) -> None:
        self._open.clear()

    def release(self) -> None:
        self._open.set()

    def mute(self) -> None:
        self._muted = True
        self._open.set()

    def unmute(self) -> None:
        self._muted = False
        self._open.set()

    async def __anext__(self) -> rtc.AudioFrame:
        assert self.source is not None
        frame = await self.source.__anext__()
        if not self._open.is_set():
            try:
                await asyncio.wait_for(self._open.wait(), timeout=GATE_MAX_HOLD_SECONDS)
            except TimeoutError:
                self._open.set()
        if self._muted:
            return rtc.AudioFrame.create(frame.sample_rate, frame.num_channels, frame.samples_per_channel)
        return frame


class InterviewerAgent(Agent):
    """The interviewer for one step of the interview.

    Each step (introduction, each topic, closing) gets its own agent with its
    own model session. A new session starts with an empty memory, so the audio
    of earlier topics is no longer re-read, and re-billed, on every reply; what
    matters from before is carried over as a few lines of text.
    """

    def __init__(
        self,
        runtime: InterviewRuntime,
        instructions: str,
        *,
        chat_ctx: llm.ChatContext | None = None,
        entering_note: str | None = None,
    ) -> None:
        super().__init__(
            instructions=instructions,
            chat_ctx=chat_ctx if chat_ctx is not None else NOT_GIVEN,
            # Its own model instance: the framework would otherwise keep the
            # previous session, and its whole audio history, across the handoff.
            llm=runtime.new_model(),
        )
        self._runtime = runtime
        self._entering_note = entering_note

    async def on_enter(self) -> None:
        self._runtime.on_session_started()
        if self._entering_note and not self._runtime.closing:
            self._runtime.instruct(self._entering_note)

    @function_tool
    async def start_next_topic(
        self,
        context: RunContext,
        summary_of_last_answer: str,
        evidence: str,
    ) -> Agent | str:
        """Finish the current topic and get the next one from the interview plan.

        Call this after the candidate's introduction, and each time you have
        finished a topic.

        Args:
            summary_of_last_answer: One factual sentence on what the candidate said about the topic you are leaving.
            evidence: How much concrete evidence the candidate gave: none, weak, adequate or strong.
        """
        runtime = self._runtime
        assert runtime.controller is not None
        if runtime.closing:
            return "The interview is closing. Say nothing more."
        before = runtime.controller.step_key()
        briefing = runtime.next_topic(summary_of_last_answer, evidence)
        if runtime.fresh_sessions and runtime.controller.step_key() != before:
            # The interview moved on: continue in a fresh session.
            return runtime.agent_for_current_step(self.chat_ctx)
        return briefing

    @function_tool
    async def end_interview(self, context: RunContext) -> str:
        """End the interview. Call this only after you have said goodbye to the candidate."""
        # The system alone ends the interview, on its own timer, with its own
        # goodbye: a model-chosen goodbye came early or twice.
        if self._runtime.closing:
            return "The interview has ended. Do not say anything more."
        controller = self._runtime.controller
        remaining = controller.remaining() if controller else 0.0
        return (
            f"Cannot end the interview: about {max(1, int(remaining))} seconds of the scheduled "
            "time remain. Do not say goodbye. Continue the interview; the system will close it."
        )


class InterviewRuntime:
    """Everything one interview needs: session, controller, capture, shutdown."""

    def __init__(self, ctx: JobContext, config: AgentConfig, interview_id: str) -> None:
        self.ctx = ctx
        self.config = config
        self.interview_id = interview_id
        self.backend = Backend(config.web_url, config.agent_api_secret, interview_id)
        self.context: InterviewContext | None = None
        self.controller: InterviewController | None = None
        self.session: AgentSession | None = None

        self._finished = False
        self._started_at_iso: str | None = None
        self._tasks: set[asyncio.Task[Any]] = set()
        self._rejoin_task: asyncio.Task[None] | None = None
        self._outcome_task: asyncio.Task[None] | None = None
        # True while no candidate is in the room after one had joined.
        self._candidate_gone = False
        # True while the candidate's page says the interview is on hold (they
        # left full screen, hid the tab, or pressed Leave). The interviewer
        # neither hears nor speaks until they are back.
        self._paused = False
        self._pause_task: asyncio.Task[None] | None = None

        # Voice mode (set once the interview context is loaded).
        self.rolling = False
        self.fresh_sessions = config.topic_reset
        self._gate: GatedAudioInput | None = None
        self._session_started_at = time.monotonic()
        self._sessions_opened = 0
        self._renewing = False

        # Speech timing, from session state changes (epoch seconds).
        self._agent_speaking_since: float | None = None
        self._agent_stopped_at: float | None = None
        self._user_speaking_since: float | None = None
        self._user_stopped_at: float | None = None
        self._response_latency: float | None = None
        self._last_interviewer_turn_at: float | None = None
        # Set once the system closing has begun (the last CLOSING_LEAD_SECONDS).
        self.closing = False

        # Two-sided audio recording fields (set when the session starts).
        self._audio: InterviewAudio | None = None
        self._audio_started_at: float | None = None
        self._hr_audio: InterviewHrAudio | None = None
        # When HR speaks the interviewer steps aside until they press Unmute.
        self._hr_muted = False

    # --- lifecycle -------------------------------------------------------

    async def run(self) -> None:
        payload = await self.backend.fetch_context()
        self.context = parse_context(self.interview_id, payload)
        self.controller = InterviewController(self.context)
        self.rolling = self.context.voice_mode == "rolling"
        self.fresh_sessions = self.config.topic_reset or self.rolling
        logger.info(
            "interview %s: %d topics, %d min, %s, voice mode %s%s",
            self.interview_id,
            len(self.context.competencies),
            self.context.duration_minutes,
            self.context.difficulty,
            self.context.voice_mode,
            "" if payload else " (fallback plan: web app context unavailable)",
        )

        # The local VAD does not decide turns (ending turns locally clipped the
        # interviewer's replies in testing). It gives exact speech start/stop
        # times for the event log, which Gemini only reports after the fact,
        # and stops the interviewer's audio the moment the candidate cuts in.
        self.session = AgentSession(
            vad=self._voice_detector(),
            turn_handling=TurnHandlingOptions(
                turn_detection="realtime_llm",
                # A cough, a door or a fan is shorter than this; a candidate
                # who means to cut in keeps talking past it.
                interruption=InterruptionOptions(
                    mode="vad", min_duration=min_interruption_seconds()
                ),
            ),
            user_away_timeout=None,
        )
        self._wire_session_events()
        self._wire_room_events()
        self.backend.start()

        # The agent may arrive before the candidate (or HR may be in the room
        # first). The session must link to the candidate only: HR is present to
        # listen and speak to the candidate, never to feed the model.
        candidate = await self._wait_for_candidate()

        await self.session.start(
            agent=InterviewerAgent(self, self.instructions_for_current_step()),
            room=self.ctx.room,
            room_options=room_io.RoomOptions(
                close_on_disconnect=False,
                participant_identity=candidate.identity,
                # Smaller frames reach the model sooner (default is 50 ms).
                # With the noise filter on, the candidate's audio arrives at
                # the 16 kHz the filter works at (Gemini takes 16 kHz anyway).
                audio_input=room_io.AudioInputOptions(
                    frame_size_ms=20,
                    **({"sample_rate": FILTER_SAMPLE_RATE} if noise_filter_enabled() else {}),
                ),
            ),
        )
        # Always gated: the closing mutes the candidate through it.
        if self.session.input.audio is not None:
            self._gate = GatedAudioInput(self.session.input.audio)
            self.session.input.audio = self._gate
        self.backend.add_event(
            "agent_joined",
            {
                "model": self.config.live_model,
                "voice": self.context.personality.voice or self.config.live_voice,
                "plan": bool(payload),
                "voiceMode": self.context.voice_mode,
            },
        )
        self._spawn(self._start_recording(candidate.identity))
        self.controller.begin()
        self._started_at_iso = iso_now()
        self.backend.add_event("interview_started", {"durationMinutes": self.context.duration_minutes})
        self.instruct(self.controller.opening_instructions())
        self._spawn(self._watchdog())
        self._spawn(self._closing_timer())

        # Records both sides of the conversation to one stereo file: the
        # candidate on the left channel, the interviewer's played voice on the
        # right. The web app mixes it into the candidate's video afterwards.
        self._audio = InterviewAudio(self.session)
        if await self._audio.start():
            self._audio_started_at = self._audio.started_at

        # HR's own microphone, recorded separately and folded into the report
        # recording by the web app.
        self._hr_audio = InterviewHrAudio(self.ctx.room)
        self._hr_audio.start()
        for participant in self.ctx.room.remote_participants.values():
            if participant.identity.startswith(HR_IDENTITY_PREFIX):
                self._hr_audio.attach(participant)

    def instruct(self, text: str, allow_interruptions: bool = True) -> Any:
        """Has the interviewer act on a system instruction now.

        Sent as a marked message in the conversation, which the interviewer's
        instructions tell it to obey and never read aloud. (Gemini Live takes
        "instructions" passed to generate_reply as words it said itself and
        may continue speaking them.)
        """
        assert self.session is not None
        return self.session.generate_reply(
            user_input=f"{SYSTEM_NOTE_PREFIX} {text}", allow_interruptions=allow_interruptions
        )

    async def _wait_for_candidate(self) -> rtc.RemoteParticipant:
        """Waits until the candidate is in the room, ignoring HR.

        The interviewer is dispatched with the candidate's join token, but HR
        may already be waiting in the room, and may even have joined first.
        Linking the session to whichever participant happens to be there would
        make the model hear HR, so the candidate's identity is waited for
        explicitly and pinned on the session.
        """
        room = self.ctx.room
        for participant in room.remote_participants.values():
            if participant.identity.startswith(CANDIDATE_IDENTITY_PREFIX):
                return participant

        loop = asyncio.get_running_loop()
        future: asyncio.Future[rtc.RemoteParticipant] = loop.create_future()

        def _on_join(participant: rtc.RemoteParticipant) -> None:
            if participant.identity.startswith(CANDIDATE_IDENTITY_PREFIX) and not future.done():
                future.set_result(participant)

        room.on("participant_connected", _on_join)
        try:
            return await future
        finally:
            room.off("participant_connected", _on_join)

    def _voice_detector(self) -> vad.VAD:
        """The local voice detector, hearing the candidate through the noise
        filter when it is on, so room noise cannot stop the interviewer."""
        detector = self.ctx.proc.userdata.get("vad") or silero.VAD.load()
        return FilteredVAD(detector) if noise_filter_enabled() else detector

    def new_model(self) -> google.realtime.RealtimeModel:
        """A Gemini Live model instance; each one opens its own session."""
        return google.realtime.RealtimeModel(
            model=self.config.live_model,
            voice=self.context.personality.voice or self.config.live_voice,
            temperature=0.7,
            input_audio_transcription=genai_types.AudioTranscriptionConfig(
                language_codes=list(self.config.transcription_languages) or None
            ),
            # Only sent when a positive budget is configured. Zero means "let
            # the model decide", and some live models reject the field outright
            # with a 1007 that ends the interview after one second.
            **(
                {"thinking_config": genai_types.ThinkingConfig(thinking_budget=self.config.thinking_budget)}
                if self.config.thinking_budget is not None and self.config.thinking_budget > 0
                else {}
            ),
            # Gemini decides when the candidate's turn is over. Low sensitivity
            # keeps it from taking a thinking pause for the end of an answer.
            realtime_input_config=genai_types.RealtimeInputConfig(
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    # GEMINI_START_SENSITIVITY=low makes Gemini slower to take
                    # room noise for the candidate starting to speak; the
                    # default (high) is kept so a quiet voice is never missed.
                    **(
                        {"start_of_speech_sensitivity": genai_types.StartSensitivity.START_SENSITIVITY_LOW}
                        if os.environ.get("GEMINI_START_SENSITIVITY", "").strip().lower() == "low"
                        else {}
                    ),
                    end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_LOW,
                    silence_duration_ms=self.config.turn_silence_ms,
                )
            ),
            # Within a step, only the most recent audio is kept (the standing
            # instructions, which hold the current topic, are never dropped).
            # Every reply re-reads, and is billed for, whatever is kept.
            context_window_compression=genai_types.ContextWindowCompressionConfig(
                trigger_tokens=self.config.context_trigger_tokens,
                sliding_window=genai_types.SlidingWindow(
                    target_tokens=self.config.context_target_tokens
                ),
            ),
        )

    def instructions_for_current_step(self) -> str:
        assert self.context is not None and self.controller is not None
        base = build_instructions(self.context)
        step = self.controller.step_instructions()
        return f"{base}\n\nCurrent step of the interview:\n{step}" if step else base

    def on_session_started(self) -> None:
        """Called as each interviewer agent, and so each model session, begins."""
        self._session_started_at = time.monotonic()
        self._sessions_opened += 1
        if self._gate is not None:
            self._gate.release()

    def _maybe_renew_session(self) -> None:
        """Rolling mode: once the session is old enough, and the interviewer has
        just finished speaking, continue in a fresh one."""
        if not self.rolling or self._renewing or self._finished or self.closing:
            return
        # Never swap the model out from under HR's turn: the new session opens
        # silently, so an interview where HR is talking would go dead.
        if self._hr_muted:
            return
        assert self.controller is not None
        if self.controller.step_key()[0] in ("closing", "ended"):
            return
        if time.monotonic() - self._session_started_at < self.config.rolling_seconds:
            return
        self._renewing = True
        self._spawn(self._renew_session())

    async def _renew_session(self) -> None:
        assert self.session is not None and self.controller is not None
        try:
            await asyncio.sleep(ROLLING_SETTLE_SECONDS)
            # Still the interviewer's pause after a question, not a tool call or
            # the start of another sentence.
            if (
                self._finished
                or self.closing
                or self.session.agent_state != "listening"
                or time.monotonic() - self._session_started_at < self.config.rolling_seconds
            ):
                return
            age = time.monotonic() - self._session_started_at
            previous = self.session.current_agent.chat_ctx
            if self._gate is not None:
                self._gate.hold()
            self.session.update_agent(
                InterviewerAgent(
                    self,
                    self.instructions_for_current_step(),
                    chat_ctx=carry_over_context(
                        previous, self.controller.summary_so_far(), turns=ROLLING_CARRY_OVER_TURNS
                    ),
                )
            )
            # This is the new session's clock: without it the age check would
            # fire again a moment later and swap the model twice in a row.
            self._session_started_at = time.monotonic()
            self.backend.add_event(
                "voice_session_renewed",
                {**self.controller.state_snapshot(), "ageSeconds": round(age, 1), "why": "age"},
            )
        except Exception as error:  # noqa: BLE001
            logger.error("could not renew the model session: %s", error)
            if self._gate is not None:
                self._gate.release()
        finally:
            self._renewing = False

    def agent_for_current_step(self, previous: llm.ChatContext) -> InterviewerAgent:
        """The interviewer for the step the controller has just moved to."""
        assert self.controller is not None
        self._session_started_at = time.monotonic()
        self.backend.add_event(
            "voice_session_renewed",
            {
                **self.controller.state_snapshot(),
                "ageSeconds": round(time.monotonic() - self._session_started_at, 1),
                "why": "topic",
            },
        )
        return InterviewerAgent(
            self,
            self.instructions_for_current_step(),
            chat_ctx=carry_over_context(previous, self.controller.summary_so_far()),
            entering_note=(
                "Continue the interview with the current step now. The candidate's last answer "
                "has already been acknowledged, so do not thank them again: go straight to what "
                "comes next. Do not greet them again and do not mention any change."
            ),
        )

    def _spawn(self, coro: Any) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def finish(self, reason: str) -> None:
        """Ends the interview: record the outcome, close the room, stop the job."""
        if self._finished:
            return
        self._finished = True
        await self._record_outcome(reason)
        current = asyncio.current_task()
        for task in list(self._tasks):
            if task is not current:
                task.cancel()
        try:
            # Removing the room disconnects the candidate, which their page
            # shows as "interview complete".
            await self.ctx.delete_room()
        except Exception as error:  # noqa: BLE001
            logger.warning("could not delete room: %s", error)
        self.ctx.shutdown(reason)

    async def _record_outcome(self, reason: str) -> None:
        """Writes the completion record exactly once, whichever path ends the job."""
        if self._outcome_task is None:
            self._outcome_task = asyncio.create_task(self._write_outcome(reason))
        await asyncio.shield(self._outcome_task)

    async def _write_outcome(self, reason: str) -> None:
        assert self.controller is not None
        elapsed = self.controller.elapsed()
        self.controller.end()
        self.backend.add_event("interview_ended", {"reason": reason, "elapsedSeconds": round(elapsed, 1)})
        logger.info("interview %s finished: %s after %.0fs", self.interview_id, reason, elapsed)
        await self._upload_audio()
        await self.backend.complete(
            {
                "reason": reason,
                "startedAt": self._started_at_iso,
                "endedAt": iso_now(),
                "elapsedSeconds": round(elapsed, 1),
                # A drop in the first minute leaves the link usable for a retry.
                "completed": elapsed >= MIN_COMPLETED_SECONDS or reason != "candidate_left",
                "coverage": self.controller.coverage(),
                "usage": self._usage(),
                "modelSessions": self._sessions_opened,
            }
        )
        await self.backend.aclose()

    async def _upload_audio(self) -> None:
        """Sends the interview's audio files to the web app, before the outcome.

        The web app mixes them into the candidate's video when it scores the
        interview, so the report plays every voice. A failed upload only costs
        that voice in the recording.
        """
        if self._audio is not None:
            started = self._audio_started_at
            path = await self._audio.stop()
            try:
                if path is not None and started is not None:
                    await self.backend.upload_audio(path, iso_from_epoch(started))
            finally:
                self._audio.discard()

        if self._hr_audio is not None:
            hr_path = await self._hr_audio.stop()
            hr_started = self._hr_audio.started_at
            try:
                if hr_path is not None and hr_started is not None:
                    await self.backend.upload_hr_audio(hr_path, iso_from_epoch(hr_started))
            finally:
                self._hr_audio.discard()

    async def on_job_shutdown(self, reason: str = "") -> None:
        """Runs when the job stops for any reason, including the room closing
        underneath us, so an interview is never left without an outcome."""
        if self.controller is None or not self.controller.started:
            return
        self._finished = True
        await self._record_outcome("candidate_left" if self._candidate_gone else "session_closed")

    def _usage(self) -> list[dict[str, Any]]:
        try:
            assert self.session is not None
            return [
                item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(vars(item))
                for item in self.session.usage.model_usage
            ]
        except Exception:  # noqa: BLE001 - usage is informational
            return []

    # --- plan tools ------------------------------------------------------

    def next_topic(self, summary: str, evidence: str) -> str:
        assert self.controller is not None
        level = evidence.strip().lower() if isinstance(evidence, str) else ""
        briefing = self.controller.next_topic(summary, level if level in EVIDENCE_LEVELS else None)
        self.backend.add_event(
            "topic_changed",
            {**self.controller.state_snapshot(), "by": "interviewer", "summary": summary, "evidence": level},
        )
        return briefing

    # --- time enforcement ------------------------------------------------

    async def _watchdog(self) -> None:
        assert self.controller is not None
        while not self._finished:
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            # While the candidate is away the interview is on hold: no nudges,
            # no notes, no moving the plan on into an empty room.
            if self._paused:
                continue
            directive = self.controller.tick()
            if directive is not None:
                await self._apply(directive)

    async def _apply(self, directive: Directive) -> None:
        assert self.controller is not None and self.session is not None
        self.backend.add_event(
            "controller_directive", {**self.controller.state_snapshot(), "kind": directive.kind}
        )
        if directive.kind == "note":
            await self._note(directive.instructions)
            return

        # Spoken directives wait for a gap: never over the candidate, and never
        # on top of the interviewer's own sentence.
        await self._wait_for_quiet(MAX_WAIT_FOR_PAUSE_SECONDS)
        if self.closing or self._finished:
            return
        try:
            if self.fresh_sessions:
                # The controller has already moved to the next step; continue
                # there in a fresh session, as a normal topic change does.
                self.session.update_agent(
                    self.agent_for_current_step(self.session.current_agent.chat_ctx)
                )
            else:
                self.instruct(directive.instructions)
        except Exception as error:  # noqa: BLE001
            logger.error("could not apply directive %s: %s", directive.kind, error)

    async def _wait_for_quiet(self, max_seconds: float, candidate: bool = True) -> None:
        assert self.session is not None
        waited = 0.0
        while waited < max_seconds and (
            self.session.agent_state in ("speaking", "thinking")
            or (candidate and self.session.user_state == "speaking")
        ):
            await asyncio.sleep(0.2)
            waited += 0.2

    async def _note(self, text: str) -> None:
        """Places a system note in the conversation without making the
        interviewer speak. It acts on the note at its next turn, which is
        after the candidate has answered whatever was last asked."""
        assert self.session is not None
        # Adding to the conversation while the interviewer is mid-sentence
        # would cut that sentence off; the candidate speaking is fine.
        await self._wait_for_quiet(MAX_WAIT_FOR_PAUSE_SECONDS, candidate=False)
        if self.closing or self._finished:
            return
        try:
            agent = self.session.current_agent
            chat_ctx = agent.chat_ctx.copy()
            chat_ctx.add_message(role="user", content=f"{SYSTEM_NOTE_PREFIX} {text}")
            await agent.update_chat_ctx(chat_ctx)
        except Exception as error:  # noqa: BLE001
            logger.error("could not deliver system note: %s", error)

    async def _closing_timer(self) -> None:
        """Starts the closing exactly CLOSING_LEAD_SECONDS before the limit.

        Its own timer rather than the watchdog's tick, which can be up to a
        tick late and can be busy waiting for a pause.
        """
        assert self.controller is not None
        await asyncio.sleep(max(0.0, self.controller.remaining() - CLOSING_LEAD_SECONDS))
        await self._close_interview()

    async def _close_interview(self) -> None:
        """Time is up: a fixed goodbye nothing can interrupt, then the call ends
        at the limit.

        Whatever the candidate is doing, even mid-sentence, the interviewer
        stops listening first: their audio is replaced with silence, so the
        model can neither be cut off by them nor answer them afterwards.
        """
        assert self.controller is not None and self.session is not None
        if self._finished or self.closing:
            return
        self.closing = True
        self.controller.start_closing()
        self.backend.add_event("closing_started", self.controller.state_snapshot())
        limit = time.monotonic() + max(0.0, self.controller.remaining())
        if self._gate is not None:
            self._gate.mute()
        # Anything the interviewer is saying stops now.
        self._interrupt_speech()
        # Let the model close the candidate's (now silent) turn, so it does not
        # answer that turn after the goodbye.
        await asyncio.sleep(self.config.turn_silence_ms / 1000 + 0.3)
        self._interrupt_speech()
        self._clear_output_buffer()
        try:
            handle = self.instruct(
                f'The interview time is up. Say exactly this, and nothing else: "{CLOSING_SCRIPT}"',
                allow_interruptions=False,
            )
            await asyncio.wait_for(
                handle.wait_for_playout(),
                timeout=max(0.5, limit + CLOSING_OVERRUN_SECONDS - time.monotonic()),
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("closing goodbye was not completed cleanly: %s", error)
        # Nothing after the goodbye reaches the candidate.
        if self.session.output.audio is not None:
            self.session.output.set_audio_enabled(False)
        # The call ends at the booked limit, not before.
        await asyncio.sleep(max(0.0, limit - time.monotonic()))
        await self.finish("time_up")

    def _interrupt_speech(self) -> None:
        assert self.session is not None
        try:
            self.session.interrupt(force=True)
        except Exception as error:  # noqa: BLE001 - nothing playing is fine
            logger.debug("nothing to interrupt: %s", error)

    # --- capture ---------------------------------------------------------

    def _wire_session_events(self) -> None:
        assert self.session is not None
        session = self.session

        @session.on("agent_state_changed")
        def _agent_state(event: Any) -> None:
            if event.new_state == "speaking":
                self._agent_speaking_since = event.created_at
                self._agent_stopped_at = None
            elif event.old_state == "speaking":
                self._agent_stopped_at = event.created_at
                if event.new_state == "listening":
                    self._maybe_renew_session()
            self.backend.add_event(
                "agent_state", {"state": event.new_state}, at=iso_from_epoch(event.created_at)
            )

        @session.on("user_state_changed")
        def _user_state(event: Any) -> None:
            if event.new_state == "speaking":
                if self._user_speaking_since is None:
                    self._user_speaking_since = event.created_at
                    if self._agent_stopped_at is not None:
                        # True response latency: interviewer stops, candidate starts.
                        self._response_latency = max(0.0, event.created_at - self._agent_stopped_at)
            elif event.old_state == "speaking":
                self._user_stopped_at = event.created_at
            self.backend.add_event(
                "candidate_state", {"state": event.new_state}, at=iso_from_epoch(event.created_at)
            )

        @session.on("conversation_item_added")
        def _item_added(event: Any) -> None:
            self._record_turn(event.item, event.created_at)

        @session.on("function_tools_executed")
        def _tools(event: Any) -> None:
            for call in event.function_calls:
                self.backend.add_event(
                    "tool_call", {"name": call.name}, at=iso_from_epoch(event.created_at)
                )

        @session.on("error")
        def _error(event: Any) -> None:
            logger.error("session error: %s", event.error)
            self.backend.add_event("agent_error", {"error": str(event.error)[:500]})

        @session.on("close")
        def _close(event: Any) -> None:
            if not self._finished:
                self._spawn(
                    self.finish("candidate_left" if self._candidate_gone else "session_closed")
                )

    def _record_turn(self, item: Any, created_at: float) -> None:
        assert self.controller is not None
        if getattr(item, "type", None) != "message" or item.role not in ("user", "assistant"):
            return
        text = (item.text_content or "").strip()
        # System notes travel as conversation messages but are not speech.
        if not text or text.startswith(SYSTEM_NOTE_PREFIX):
            return

        snapshot = self.controller.state_snapshot()
        turn: dict[str, Any] = {
            "text": text,
            "interrupted": bool(getattr(item, "interrupted", False)),
            "phase": snapshot["phase"],
            "competencyId": snapshot["competencyId"],
        }
        if item.role == "user":
            started = self._user_speaking_since or created_at
            ended = self._user_stopped_at or created_at
            turn.update(
                speaker="candidate",
                startedAt=iso_from_epoch(started),
                endedAt=iso_from_epoch(max(started, ended)),
                responseLatencyMs=(
                    None if self._response_latency is None else round(self._response_latency * 1000)
                ),
            )
            self._user_speaking_since = None
            self._user_stopped_at = None
            self._response_latency = None
        else:
            started = self._agent_speaking_since or created_at
            self._last_interviewer_turn_at = time.time()
            turn.update(
                speaker="interviewer",
                startedAt=iso_from_epoch(min(started, created_at)),
                endedAt=iso_from_epoch(created_at),
                responseLatencyMs=None,
            )
        self.backend.add_turn(turn)

    def _wire_room_events(self) -> None:
        room = self.ctx.room

        def _candidates() -> list[rtc.RemoteParticipant]:
            return [
                participant
                for participant in room.remote_participants.values()
                if participant.identity.startswith(CANDIDATE_IDENTITY_PREFIX)
            ]

        @room.on("participant_disconnected")
        def _left(participant: rtc.RemoteParticipant) -> None:
            if participant.identity.startswith(HR_IDENTITY_PREFIX):
                self.backend.add_event("hr_left")
                # Nobody is left for HR to help: let the interviewer continue.
                if self._hr_muted:
                    self._unmute_after_hr()
                return
            if not participant.identity.startswith(CANDIDATE_IDENTITY_PREFIX):
                return
            if _candidates():
                return
            self._candidate_gone = True
            self.backend.add_event("candidate_disconnected")
            if self._rejoin_task is None and not self._finished:
                self._rejoin_task = self._spawn(self._wait_for_rejoin())

        @room.on("participant_connected")
        def _joined(participant: rtc.RemoteParticipant) -> None:
            if participant.identity.startswith(HR_IDENTITY_PREFIX):
                self.backend.add_event("hr_present")
                if self._hr_audio is not None:
                    self._hr_audio.attach(participant)
                return
            if not participant.identity.startswith(CANDIDATE_IDENTITY_PREFIX):
                return
            # A rejoining candidate has a new identity. The session was pinned
            # to the old one, so it must be re-linked or the model hears nothing.
            if self.session is not None:
                try:
                    self.session.room_io.set_participant(participant.identity)
                except Exception as error:  # noqa: BLE001
                    logger.warning("could not re-link the session to the candidate: %s", error)
            was_gone = self._candidate_gone
            self._candidate_gone = False
            if self._rejoin_task is not None:
                self._rejoin_task.cancel()
                self._rejoin_task = None
                self.backend.add_event("candidate_reconnected")
            # A page that was paused and then reloaded is back without ever
            # saying "resume": the hold ends with the candidate in the room.
            if self._paused:
                self._paused = False
                if self._pause_task is not None:
                    self._pause_task.cancel()
                    self._pause_task = None
                if self._gate is not None and not self._hr_muted and not self.closing:
                    self._gate.unmute()
            if was_gone and not self.closing:
                # A returning candidate resumes the same session: the clock,
                # plan and transcript were never reset. Instruct the
                # interviewer to continue seamlessly instead of greeting.
                self.instruct(
                    "The candidate just rejoined after a brief connection drop. Continue the "
                    "interview exactly where you left off. Do not greet them again and do not "
                    "repeat anything you already said; carry on with the current question.",
                    allow_interruptions=False,
                )

        @room.on("track_subscribed")
        def _track_subscribed(
            track: rtc.Track,
            publication: rtc.RemoteTrackPublication,
            participant: rtc.RemoteParticipant,
        ) -> None:
            # HR's microphone usually arrives after they join, so subscribe to
            # the track itself rather than only looking at join time.
            if (
                participant.identity.startswith(HR_IDENTITY_PREFIX)
                and publication.kind == rtc.TrackKind.KIND_AUDIO
                and self._hr_audio is not None
            ):
                self._hr_audio.attach_track(track)

        def _client_event(reader: rtc.TextStreamReader, participant_identity: str) -> None:
            if participant_identity.startswith(CANDIDATE_IDENTITY_PREFIX):
                self._spawn(self._record_client_event(reader))

        def _hr_event(reader: rtc.TextStreamReader, participant_identity: str) -> None:
            if participant_identity.startswith(HR_IDENTITY_PREFIX):
                self._spawn(self._record_hr_event(reader))

        room.register_text_stream_handler(CLIENT_EVENT_TOPIC, _client_event)
        room.register_text_stream_handler(HR_EVENT_TOPIC, _hr_event)

    async def _wait_for_rejoin(self) -> None:
        await asyncio.sleep(CANDIDATE_REJOIN_GRACE_SECONDS)
        if self._finished:
            return
        # The candidate did not come back inside the window. The interview
        # ends here, with everything they answered kept and scored.
        await self.finish("candidate_left")

    def _pause(self) -> None:
        """The candidate left the interview: stop hearing and speaking at once.

        The page mutes its own microphone too, but this is the authoritative
        side: silence replaces their audio for the model, so nothing said to
        somebody in the room reaches the interviewer, and the controller stops
        nudging a candidate who is not there.
        """
        if self._paused or self._finished or self.closing:
            return
        self._paused = True
        if self._gate is not None:
            self._gate.mute()
        self._interrupt_speech()
        if self._pause_task is None or self._pause_task.done():
            self._pause_task = self._spawn(self._pause_timeout())

    async def _pause_timeout(self) -> None:
        """The pause budget passed without a return: end the interview."""
        await asyncio.sleep(PAUSE_GRACE_SECONDS)
        if self._finished or not self._paused:
            return
        await self.finish("pause_timeout")

    def _resume(self) -> None:
        """The candidate is back: hear them, and carry on with the same question."""
        if not self._paused:
            return
        self._paused = False
        if self._pause_task is not None:
            self._pause_task.cancel()
            self._pause_task = None
        if self._gate is not None and not self._hr_muted and not self.closing:
            self._gate.unmute()
        if not self.closing and not self._finished:
            self.instruct(
                "The candidate is back after leaving full screen. Continue the interview "
                "exactly where you left off: same question, no greeting, nothing repeated.",
                allow_interruptions=False,
            )

    async def _record_client_event(self, reader: rtc.TextStreamReader) -> None:
        """Browser-side signals (tab hidden, window blurred) sent by the page."""
        try:
            payload = json.loads(await reader.read_all())
        except Exception:  # noqa: BLE001 - malformed client input is ignored
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
            return
        event_type = payload["type"][:40]
        if event_type == "interview_paused":
            self._pause()
            return
        if event_type == "interview_resumed":
            self._resume()
            return
        if event_type == "interview_left":
            # The candidate pressed Leave: they chose to end the interview,
            # so it ends now and the report says they exited.
            if not self._finished:
                await self.finish("candidate_exited")
            return
        if event_type not in ("tab_hidden", "tab_visible", "window_blur", "window_focus"):
            return
        self.backend.add_event(f"client_{event_type}")

    async def _record_hr_event(self, reader: rtc.TextStreamReader) -> None:
        """Signals from the HR page: their speech, the unmute button, captions."""
        try:
            payload = json.loads(await reader.read_all())
        except Exception:  # noqa: BLE001 - malformed client input is ignored
            return
        if not isinstance(payload, dict):
            return
        event_type = payload.get("type")
        if event_type == "hr_speaking_start":
            self._mute_for_hr()
        elif event_type == "hr_speaking_end":
            self.backend.add_event("hr_speech_ended")
        elif event_type == "hr_unmute":
            self._unmute_after_hr()
        elif event_type == "hr_turn":
            # Captions come from the browser's own microphone recognition, which
            # keeps hearing HR even while their LiveKit track is muted. Only a
            # turn spoken with the floor open belongs in the transcript.
            if not self._hr_muted:
                return
            text = payload.get("text")
            if isinstance(text, str) and text.strip():
                self.backend.add_event(
                    "hr_speech",
                    {"text": text.strip()[:4000], "saidAt": payload.get("at")},
                )

    def _mute_for_hr(self) -> None:
        """The interviewer goes quiet while HR speaks.

        The model never hears HR: its audio pipeline only carries the
        candidate. What changes is that the model's output is silenced and its
        input is muted too, so it cannot talk over HR or answer on the
        candidate's behalf until HR hands the conversation back.
        """
        if self._finished or self.closing or self._hr_muted:
            return
        self._hr_muted = True
        self.backend.add_event(
            "agent_muted_by_hr",
            {"agentState": self.session.agent_state if self.session is not None else None},
        )
        self._interrupt_speech()
        # Silence is not enough: the model can start a turn a moment after the
        # interrupt, and its frames pile up in the output while audio is off.
        # Enabling audio later then plays that stale backlog at once, which is
        # the broken, stuttering voice heard after HR hands the floor back.
        self._clear_output_buffer()
        if self.session is not None and self.session.output.audio is not None:
            self.session.output.set_audio_enabled(False)
        if self._gate is not None:
            self._gate.mute()
        self._spawn(self._hold_agent_quiet())

    def _clear_output_buffer(self) -> None:
        """Drops anything already generated but not yet played."""
        if self.session is None:
            return
        audio = self.session.output.audio
        if audio is None:
            return
        try:
            audio.clear_buffer()
        except Exception as error:  # noqa: BLE001 - nothing buffered is fine
            logger.debug("could not clear the audio buffer: %s", error)

    async def _hold_agent_quiet(self) -> None:
        """Keeps the interviewer silent for as long as HR holds the floor.

        The interrupt can land just before a turn starts, so the model keeps
        generating after the mute. Clearing the buffer on a short loop means at
        most half a second of stale audio ever exists, and the session is idle
        again by the time HR hands back the floor.
        """
        while self._hr_muted and not self._finished and not self.closing:
            await asyncio.sleep(0.5)
            if self.session is None:
                return
            self._clear_output_buffer()
            if self.session.agent_state in ("speaking", "thinking"):
                self._interrupt_speech()

    def _unmute_after_hr(self) -> None:
        """HR pressed Unmute agent: the interviewer takes over again."""
        if not self._hr_muted:
            return
        self._hr_muted = False
        if self._finished or self.closing:
            return
        self.backend.add_event("agent_resumed_after_hr")
        # Nothing from the paused turn may leak into the resumed one.
        self._interrupt_speech()
        self._clear_output_buffer()
        if self.session is not None and self.session.output.audio is not None:
            self.session.output.set_audio_enabled(True)
        if self._gate is not None:
            self._gate.unmute()
        try:
            self.instruct(
                "The HR colleague has finished speaking. Continue the interview with the "
                "candidate from where it stopped. Do not mention the pause.",
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("could not resume the interviewer after HR: %s", error)

    async def _start_recording(self, candidate_identity: str) -> None:
        """Records the candidate, and only the candidate, to GCS.

        Their camera and microphone go into one small video file: it is what
        the recruiter replays and what the on-camera analysis reads. The
        interviewer's side is not recorded; its words are in the transcript.

        Needs LiveKit Cloud or a self-hosted egress service; a local dev
        server has neither, so failures are recorded, never raised.
        """
        bucket = self.config.recording_bucket
        if not bucket:
            return
        path = f"interviews/{self.interview_id}/{int(time.time())}.mp4"
        try:
            info = await self.ctx.api.egress.start_participant_egress(
                api.ParticipantEgressRequest(
                    room_name=self.ctx.room.name,
                    identity=candidate_identity,
                    # Small on purpose: enough to see where someone is looking,
                    # cheap to store and to analyse.
                    advanced=api.EncodingOptions(
                        width=640,
                        height=360,
                        framerate=15,
                        video_bitrate=450,
                        audio_bitrate=48,
                    ),
                    file_outputs=[
                        api.EncodedFileOutput(
                            file_type=api.EncodedFileType.MP4,
                            filepath=path,
                            gcp=api.GCPUpload(
                                bucket=bucket,
                                credentials=self.config.recording_credentials_json or "",
                            ),
                        )
                    ],
                )
            )
            self.backend.add_event(
                "recording_started",
                {"egressId": info.egress_id, "bucket": bucket, "path": path, "scope": "candidate"},
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("recording not started: %s", error)
            self.backend.add_event("recording_failed", {"error": str(error)[:300]})


def carry_over_context(
    previous: llm.ChatContext, summary: str, turns: int = CARRY_OVER_TURNS
) -> llm.ChatContext:
    """What a fresh session is told about the interview so far, as text.

    A short summary of finished topics plus the last few things that were
    said. Text costs a small fraction of the audio it replaces.
    """
    carried = llm.ChatContext.empty()
    if summary:
        carried.add_message(
            role="user",
            content=f"{SYSTEM_NOTE_PREFIX} Earlier in this interview:\n{summary}",
        )
    spoken = [
        item
        for item in previous.items
        if getattr(item, "type", None) == "message"
        and item.role in ("user", "assistant")
        and (item.text_content or "").strip()
        and not (item.text_content or "").startswith(SYSTEM_NOTE_PREFIX)
    ]
    for item in spoken[-turns:]:
        carried.add_message(role=item.role, content=(item.text_content or "").strip())
    return carried


def interview_id_for(ctx: JobContext) -> str:
    """The interview id from the dispatch metadata, else from the room name."""
    try:
        metadata = json.loads(ctx.job.metadata or "{}")
        if isinstance(metadata, dict) and isinstance(metadata.get("interviewId"), str):
            return metadata["interviewId"]
    except ValueError:
        pass
    name = ctx.room.name
    return name.removeprefix(ROOM_NAME_PREFIX)


def min_interruption_seconds() -> float:
    """Seconds of candidate speech before the interviewer stops talking."""
    try:
        return min(2.0, max(0.2, float(os.environ.get("AGENT_MIN_INTERRUPTION_S", "0.8"))))
    except ValueError:
        return 0.8


def prewarm(proc: JobProcess) -> None:
    """Loads the VAD model once per worker process, before any interview."""
    proc.userdata["vad"] = silero.VAD.load()


load_env()
server = AgentServer(setup_fnc=prewarm)


@server.rtc_session(agent_name=agent_name())
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    runtime = InterviewRuntime(ctx, AgentConfig.from_env(), interview_id_for(ctx))
    ctx.add_shutdown_callback(runtime.on_job_shutdown)
    await runtime.run()


def main() -> None:
    cli.run_app(server)
