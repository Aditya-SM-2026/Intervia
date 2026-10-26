"""Interview controller: owns the plan, the clock and the coverage record.

The realtime model owns the voice and the natural back-and-forth; this class
owns what gets covered and when. The model moves through the plan by calling
the `start_next_topic` tool, and the controller steps in with a directive when
a topic or the whole interview runs over its time budget.

Pure logic with an injectable clock so it can be unit-tested without a room.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Literal

from .plan import Competency, InterviewContext

# Follow-up questions allowed per topic, by interviewer style.
PROBE_LIMITS = {"easy": 1, "medium": 2, "hard": 3, "extra-hard": 4}

# A topic that would get less than this is dropped rather than rushed.
MIN_TOPIC_SECONDS = 90.0
# How far past its budget a topic may run before the controller moves on.
TOPIC_OVERRUN_GRACE_SECONDS = 25.0
INTRO_OVERRUN_GRACE_SECONDS = 30.0
# After the time-up goodbye has been requested, how long until a forced stop.
# Kept small so the session never runs meaningfully past its scheduled end.
HARD_STOP_GRACE_SECONDS = 1.0
# The wrap-up directive fires this long before the limit, so the spoken
# thank-you + goodbye lands right at the scheduled end time.
WRAP_UP_LEAD_SECONDS = 8.0
# The goodbye may be spoken (and end_interview called) only inside the
# closing window: the last stretch before the limit, when the
# "almost out of time" note has already gone out.
CLOSING_WINDOW_SECONDS = 30.0
# The goodbye must start this long before the time limit, for every duration
# (user spec: greeting 8 seconds before the end, end exactly at the limit):
# the silent wrap-up note is placed this far ahead, and the spoken wrap-up
# (thank-you + goodbye) lands right at GOODBYE_LEAD_SECONDS before the end.
GOODBYE_LEAD_SECONDS = 8.0
# The silent note needs a little runway before the goodbye itself.
GOODBYE_NOTE_LEAD_SECONDS = GOODBYE_LEAD_SECONDS + 8.0
# The interviewer may not leave a topic before this share of its time budget
# is used: it is asked to probe deeper instead (at most MAX_HOLDS times).
FORCE_AFTER_NOTE_SECONDS = 60.0
MIN_TOPIC_SHARE = 0.5
MAX_HOLDS = 2

EVIDENCE_LEVELS = ("none", "weak", "adequate", "strong")


class Phase(str, Enum):
    INTRO = "intro"
    TOPIC = "topic"
    CANDIDATE_QUESTIONS = "candidate_questions"
    CLOSING = "closing"
    ENDED = "ended"


@dataclass
class TopicRecord:
    competency: Competency
    status: Literal["pending", "active", "covered", "skipped"] = "pending"
    started_at: float | None = None
    ended_at: float | None = None
    budget_seconds: float | None = None
    summary: str | None = None
    evidence: str | None = None
    advanced_by: Literal["interviewer", "controller"] | None = None
    holds: int = 0
    # Told that its time is up: may leave without being held, must not linger.
    nudged: bool = False


@dataclass(frozen=True)
class Directive:
    """An instruction from the controller to the interviewer.

    "note" is silent: it is placed in the conversation for the interviewer to
    act on at its next natural turn, so it never talks over the candidate or
    answers its own question. The other kinds make the interviewer speak now
    and are used only when a note was not acted on, or time has run out.
    """

    kind: Literal["note", "advance", "candidate_questions", "wrap_up", "hard_stop"]
    instructions: str


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class InterviewController:
    def __init__(
        self, context: InterviewContext, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.context = context
        self._clock = clock
        self._started_at: float | None = None
        self.phase = Phase.INTRO
        self.topics = [TopicRecord(competency=c) for c in context.competencies]
        self._active_index: int | None = None
        self._wrap_up_sent = False
        self._hard_stop_sent = False
        self._intro_nudged = False
        # Set once the closing phase is due: the next topic request ends the topics.
        self._closing_due = False

        self.total_seconds = context.duration_minutes * 60.0
        # Capped at a fifth of the interview so very short (test) interviews
        # still leave most of their time for the topics.
        self.intro_seconds = min(_clamp(self.total_seconds * 0.1, 60.0, 150.0), self.total_seconds * 0.2)
        # Closing is not a fixed slice of the interview any more: the goodbye
        # must start GOODBYE_LEAD_SECONDS before the limit, whatever the
        # duration. The closing "phase" only exists to place the silent note
        # (GOODBYE_NOTE_LEAD_SECONDS ahead) and the wrap-up directive.
        self.closing_seconds = min(GOODBYE_NOTE_LEAD_SECONDS, self.total_seconds * 0.2)
        self.min_topic_seconds = min(MIN_TOPIC_SECONDS, self.total_seconds * 0.25)
        # How long a silent note may go unanswered before the controller speaks up.
        # Clamped so the wrap-up lands at GOODBYE_LEAD_SECONDS before the limit.
        self.force_after_seconds = min(FORCE_AFTER_NOTE_SECONDS, self.total_seconds * 0.15, self.closing_seconds - GOODBYE_LEAD_SECONDS)
        self.probe_limit = PROBE_LIMITS.get(context.difficulty, 2)

    # --- clock -----------------------------------------------------------

    def begin(self) -> None:
        """Starts the interview clock (call when the candidate is present)."""
        if self._started_at is None:
            self._started_at = self._clock()

    @property
    def started(self) -> bool:
        return self._started_at is not None

    def elapsed(self) -> float:
        return 0.0 if self._started_at is None else self._clock() - self._started_at

    def remaining(self) -> float:
        return self.total_seconds - self.elapsed()

    def _topics_deadline(self) -> float:
        """Elapsed time at which the closing phase must begin."""
        return self.total_seconds - self.closing_seconds

    # --- plan movement ---------------------------------------------------

    @property
    def active_topic(self) -> TopicRecord | None:
        return None if self._active_index is None else self.topics[self._active_index]

    def _pending(self) -> list[int]:
        return [i for i, topic in enumerate(self.topics) if topic.status == "pending"]

    def _close_active(self, summary: str | None, evidence: str | None, by: str | None) -> None:
        topic = self.active_topic
        if topic is None or topic.status != "active":
            return
        topic.status = "covered"
        topic.ended_at = self.elapsed()
        topic.summary = (summary or "").strip() or None
        topic.evidence = evidence if evidence in EVIDENCE_LEVELS else None
        topic.advanced_by = by if by in ("interviewer", "controller") else None

    def _open_next(self) -> TopicRecord | None:
        """Activates the next topic that still fits, dropping ones that do not."""
        time_left = self._topics_deadline() - self.elapsed()
        pending = self._pending()
        # Plans are ordered by priority, so drop from the end when time is short.
        while len(pending) > 1 and time_left / len(pending) < self.min_topic_seconds:
            self.topics[pending.pop()].status = "skipped"
        if not pending or time_left < self.min_topic_seconds / 2:
            for index in pending:
                self.topics[index].status = "skipped"
            self._active_index = None
            return None

        index = pending[0]
        weights = sum(self.topics[i].competency.minutes for i in pending)
        topic = self.topics[index]
        topic.status = "active"
        topic.started_at = self.elapsed()
        topic.budget_seconds = time_left * topic.competency.minutes / weights
        self._active_index = index
        self.phase = Phase.TOPIC
        return topic

    def _enter_candidate_questions(self) -> None:
        for index in self._pending():
            self.topics[index].status = "skipped"
        self._active_index = None
        self.phase = Phase.CANDIDATE_QUESTIONS

    def next_topic(
        self, summary: str | None = None, evidence: str | None = None, by: str = "interviewer"
    ) -> str:
        """Closes the current step and returns the briefing for the next one.

        This is the result of the `start_next_topic` tool, so it is written as
        instructions to the interviewer.
        """
        if self.phase in (Phase.CLOSING, Phase.ENDED):
            remaining = self.total_seconds - self.elapsed()
            if remaining > WRAP_UP_LEAD_SECONDS + 2:
                # The plan ended early but the clock has not: keep talking.
                self.phase = Phase.CANDIDATE_QUESTIONS
                return self._candidate_questions_briefing()
            return "The interview is closing. Say goodbye and call end_interview."
        if self.phase == Phase.CANDIDATE_QUESTIONS:
            return self._candidate_questions_briefing()

        if self._closing_due:
            self._close_active(summary, evidence, by)
            self._enter_candidate_questions()
            return self._candidate_questions_briefing()

        hold = self._hold_briefing(evidence) if by == "interviewer" else None
        if hold is not None:
            return hold

        self._close_active(summary, evidence, by)
        topic = self._open_next()
        if topic is None:
            self._enter_candidate_questions()
            return self._candidate_questions_briefing()
        return self._topic_briefing(topic)

    def _hold_briefing(self, evidence: str | None) -> str | None:
        """Keeps the interviewer on a topic it is trying to leave too early.

        A recruiter who books 30 minutes expects 30 minutes of evidence, and
        depth on a competency is what makes its score trustworthy.
        """
        topic = self.active_topic
        if (
            self.phase != Phase.TOPIC
            or topic is None
            or topic.started_at is None
            or topic.budget_seconds is None
            or topic.holds >= MAX_HOLDS
            or topic.nudged
        ):
            return None
        used = self.elapsed() - topic.started_at
        if used >= topic.budget_seconds * MIN_TOPIC_SHARE:
            return None
        # A candidate with nothing to say on the topic is not pressed twice.
        if evidence == "none" and topic.holds >= 1:
            return None
        topic.holds += 1
        minutes_left = max(1, round((topic.budget_seconds - used) / 60))
        lines = [
            (f"Stay on this topic: about {minutes_left} more minute"
            f"{'s' if minutes_left != 1 else ''} are planned for it. Do not move on yet."),
            ("Ask one more question that goes deeper into what the candidate just said: the "
            "specific situation, what they personally did, why they chose that approach over "
            "the alternatives, what went wrong, or how they measured the result."),
        ]
        if topic.competency.look_for:
            lines.append(
                "If you have not heard these yet, probe for them: "
                + "; ".join(topic.competency.look_for)
                + "."
            )
        lines.append("Call start_next_topic again after the candidate has answered.")
        return "\n".join(lines)

    # --- briefings -------------------------------------------------------

    def _topic_briefing(self, topic: TopicRecord) -> str:
        competency = topic.competency
        position = self.topics.index(topic) + 1
        minutes = max(1, round((topic.budget_seconds or 0) / 60))
        lines = [
            f"Topic {position} of {len(self.topics)}: {competency.name}.",
        ]
        if competency.description:
            lines.append(f"What you are assessing: {competency.description}")
        lines.append(
            "First ask this core question, in your own natural spoken words but keeping its "
            f'meaning (every candidate for this role is asked it): "{competency.question}"'
        )
        if competency.resume_probe:
            lines.append(
                "A follow-up specific to this candidate, for after they have answered the core "
                f"question: {competency.resume_probe}"
            )
        if competency.look_for:
            lines.append("Listen for: " + "; ".join(competency.look_for) + ".")
        if competency.follow_ups:
            lines.append(
                "Possible follow-ups, only where they fit what the candidate actually said: "
                + " | ".join(competency.follow_ups)
            )
        lines.append(
            f"You have about {minutes} minute{'s' if minutes != 1 else ''} for this topic: use them. "
            f"Ask at least {self.probe_limit} follow-up question{'s' if self.probe_limit != 1 else ''}, "
            "each one building on the candidate's last answer, and keep going deeper while time "
            "remains. Call start_next_topic when the time is nearly used, or when the candidate "
            "clearly has nothing more to add. Do not announce topic numbers."
        )
        return "\n".join(lines)

    def _candidate_questions_briefing(self) -> str:
        """Briefing for after the planned topics.

        Time-aware: the goodbye belongs to the final seconds only. When the
        plan runs out early the interview keeps going with job-description and
        resume material, so a 5-minute interview fills 5 minutes and still
        feels like one continuous conversation.
        """
        remaining = self.total_seconds - self.elapsed()
        if remaining <= CLOSING_WINDOW_SECONDS:
            return (
                "All planned topics are done and the interview is nearly out of time. Ask the "
                "candidate whether they have any questions. Answer briefly from the job "
                "description only; for anything you do not know, say the recruiter will follow "
                "up. Then thank them, say the recruiter will be in touch with next steps, say "
                "goodbye, and call end_interview."
            )
        minutes = max(1, int(remaining // 60))
        return (
            "All planned topics are done, but interview time remains — the interview is NOT "
            f"ending yet. First ask whether the candidate has any questions for you, and answer "
            "briefly from the job description only (for anything else, say the recruiter will "
            f"follow up). Then keep the interview going for the remaining {minutes} minute"
            f"{'s' if minutes != 1 else ''}: return to the candidate's earlier answers and go "
            "deeper, or ask new questions drawn from the job description and the candidate's "
            "resume — areas the plan has not covered yet (specific projects, tools, past "
            "challenges, how they work with a team). One question at a time, building on what "
            "they say, exactly like the earlier topics. Do NOT say goodbye and do NOT call "
            "end_interview: a system message will tell you when the time is up."
        )

    def opening_instructions(self) -> str:
        context = self.context
        name = context.candidate_name or "the candidate"
        role = f"the {context.role_title} role" if context.role_title else "this role"
        return (
            f"The candidate has just joined. Open with exactly this, short and plain: "
            f"\"Hey {name}, I am the Sreemedhas Interview Agent, I am going to take your "
            f"interview for {role}.\" Say nothing else first: no small talk, no mention of "
            "recording, length or next steps. Then go straight into your first question."
        )

    # --- time enforcement ------------------------------------------------

    def tick(self) -> Directive | None:
        """Checks the clock; returns at most one directive per call."""
        if not self.started or self.phase == Phase.ENDED:
            return None
        elapsed = self.elapsed()

        if self._wrap_up_sent and not self._hard_stop_sent:
            if elapsed >= self.total_seconds + HARD_STOP_GRACE_SECONDS:
                self._hard_stop_sent = True
                return Directive("hard_stop", "")
            return None

        if elapsed >= self.total_seconds - WRAP_UP_LEAD_SECONDS and not self._wrap_up_sent:
            self._wrap_up_sent = True
            if self.phase == Phase.CLOSING:
                # The interviewer is already saying goodbye; do not ask twice.
                return None
            self._close_active(None, None, "controller")
            self._enter_candidate_questions()
            self.phase = Phase.CLOSING
            return Directive(
                "wrap_up",
                "The scheduled time is up. In two sentences: thank the candidate, say the recruiter "
                "will be in touch with next steps, and say goodbye. Do not ask anything else.",
            )

        # Running over is handled in two steps: first a silent note that the
        # interviewer acts on after the candidate's current answer, and only if
        # that goes unanswered does the controller make it speak.
        if self.phase in (Phase.INTRO, Phase.TOPIC) and elapsed >= self._topics_deadline():
            if not self._closing_due:
                self._closing_due = True
                return Directive(
                    "note",
                    "The interview is almost out of time. Do not ask any more interview questions. "
                    "When the candidate finishes their current answer, acknowledge it briefly and "
                    "call start_next_topic.",
                )
            if elapsed >= self._topics_deadline() + min(self.force_after_seconds, self.closing_seconds / 2):
                self._close_active(None, None, "controller")
                self._enter_candidate_questions()
                return Directive(
                    "candidate_questions",
                    "We are almost out of time. Briefly acknowledge the candidate's last answer, "
                    "then: " + self._candidate_questions_briefing(),
                )
            return None

        if self.phase == Phase.INTRO:
            overrun = elapsed - self.intro_seconds - INTRO_OVERRUN_GRACE_SECONDS
            if overrun > 0 and not self._intro_nudged:
                self._intro_nudged = True
                return Directive(
                    "note",
                    "The introduction has taken long enough. When the candidate finishes "
                    "speaking, acknowledge briefly and call start_next_topic.",
                )
            if overrun > self.force_after_seconds:
                return self._controller_advance()
            return None

        topic = self.active_topic
        if (
            self.phase == Phase.TOPIC
            and topic is not None
            and topic.started_at is not None
            and topic.budget_seconds is not None
            and self._pending()
        ):
            overrun = elapsed - topic.started_at - topic.budget_seconds - TOPIC_OVERRUN_GRACE_SECONDS
            if overrun > 0 and not topic.nudged:
                topic.nudged = True
                return Directive(
                    "note",
                    "Time for this topic is up. Do not ask another follow-up on it. When the "
                    "candidate finishes their current answer, acknowledge it briefly and call "
                    "start_next_topic.",
                )
            if overrun > self.force_after_seconds:
                return self._controller_advance()

        return None

    def _controller_advance(self) -> Directive | None:
        briefing = self.next_topic(by="controller")
        if self.phase == Phase.CANDIDATE_QUESTIONS:
            return Directive("candidate_questions", briefing)
        return Directive(
            "advance",
            "Time for the current topic is up. Briefly acknowledge the candidate's last answer in "
            "a few words, then move on.\n" + briefing,
        )

    def begin_closing(self) -> None:
        if self.phase != Phase.ENDED:
            self.phase = Phase.CLOSING

    def end(self) -> None:
        # The topic in progress when the interview ends was not moved on by anyone.
        self._close_active(None, None, None)
        self.phase = Phase.ENDED

    # --- reporting -------------------------------------------------------

    def step_key(self) -> tuple[str, int | None]:
        """Identifies the current step; changes when the interview moves on."""
        return (self.phase.value, self._active_index)

    def step_instructions(self) -> str:
        """The current step, written for the interviewer's standing instructions.

        Kept there rather than in the conversation so that it is never pushed
        out when old audio is dropped from the model's memory.
        """
        topic = self.active_topic
        if self.phase == Phase.TOPIC and topic is not None:
            return self._topic_briefing(topic)
        if self.phase in (Phase.CANDIDATE_QUESTIONS, Phase.CLOSING):
            return self._candidate_questions_briefing()
        return ""

    def summary_so_far(self) -> str:
        """One line per finished topic, from the interviewer's own notes."""
        lines = []
        for topic in self.topics:
            if topic.status != "covered" or topic is self.active_topic:
                continue
            note = topic.summary or "discussed"
            evidence = f" (evidence: {topic.evidence})" if topic.evidence else ""
            lines.append(f"- {topic.competency.name}: {note}{evidence}")
        return "\n".join(lines)

    def state_snapshot(self) -> dict:
        topic = self.active_topic
        return {
            "phase": self.phase.value,
            "competencyId": topic.competency.id if topic and self.phase == Phase.TOPIC else None,
            "elapsedSeconds": round(self.elapsed(), 1),
        }

    def coverage(self) -> list[dict]:
        return [
            {
                "competencyId": topic.competency.id,
                "name": topic.competency.name,
                "status": "covered" if topic.status == "active" else topic.status,
                "startedAtSeconds": None if topic.started_at is None else round(topic.started_at, 1),
                "endedAtSeconds": None if topic.ended_at is None else round(topic.ended_at, 1),
                "budgetSeconds": None if topic.budget_seconds is None else round(topic.budget_seconds, 1),
                "interviewerSummary": topic.summary,
                "interviewerEvidence": topic.evidence,
                "advancedBy": topic.advanced_by,
                "holds": topic.holds,
            }
            for topic in self.topics
        ]
