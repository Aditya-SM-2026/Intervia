"""Fixes from the simulated-interview evaluation (Nov 15)."""

from livekit.agents import llm

from intervia_agent.prompts import SYSTEM_NOTE_PREFIX, spoken_name
from intervia_agent.worker import continuation_note


def test_names_are_said_as_a_normal_first_name() -> None:
    assert spoken_name("SHAMBHAVI SINGH") == "Shambhavi"
    assert spoken_name("priya sharma") == "Priya"
    assert spoken_name("K. Ravi Kumar") == "Ravi"
    assert spoken_name("McDonald") == "McDonald"
    assert spoken_name("") == ""
    assert spoken_name(None) == ""


def test_a_fresh_session_knows_not_to_start_over() -> None:
    ctx = llm.ChatContext.empty()
    ctx.add_message(role="assistant", content="Hey Ravi, I am the Medhas Academy interviewer.")
    ctx.add_message(role="user", content="Hi, I'm Ravi.")
    ctx.add_message(role="assistant", content="How would you make the refund flow safe to retry?")
    ctx.add_message(role="user", content=f"{SYSTEM_NOTE_PREFIX} internal note")
    note = continuation_note(ctx)
    assert "never greet them" in note
    assert "How would you make the refund flow safe to retry?" in note
    assert "internal note" not in note
    assert "do not repeat or re-ask" in note


def test_a_session_with_nothing_said_yet_still_forbids_a_second_greeting() -> None:
    note = continuation_note(llm.ChatContext.empty())
    assert "never greet them" in note
    assert "The last thing you said" not in note


def test_a_topic_change_session_asks_the_new_question_instead_of_waiting() -> None:
    ctx = llm.ChatContext.empty()
    ctx.add_message(role="assistant", content="Could you introduce yourself?")
    ctx.add_message(role="user", content="I'm Ravi, a backend developer.")
    note = continuation_note(ctx, answered=True)
    assert "never greet them" in note
    assert "Ask the opening question of the current step now" in note
    assert "The candidate is answering that now" not in note


def test_start_next_topic_is_refused_until_the_new_step_is_answered() -> None:
    import time

    from intervia_agent.worker import InterviewRuntime

    runtime = InterviewRuntime.__new__(InterviewRuntime)
    runtime._step_opened_at = 0.0
    runtime._last_candidate_turn_at = 0.0
    assert not runtime.step_unanswered()  # no topic change yet: the intro step
    runtime._step_opened_at = time.monotonic()
    assert runtime.step_unanswered()
    runtime._last_candidate_turn_at = time.monotonic() + 0.001
    assert not runtime.step_unanswered()
    runtime._last_candidate_turn_at = 0.0
    runtime._step_opened_at = time.monotonic() - 60
    assert not runtime.step_unanswered()  # never stuck for good


def test_model_markers_are_removed_from_speech_text() -> None:
    from intervia_agent.worker import strip_model_markers

    assert strip_model_markers("<no speech>{pause}") == ""
    assert strip_model_markers("Okay. {pause} How would you retry it?") == "Okay. How would you retry it?"
    assert strip_model_markers("Use a WHERE x < 5 filter") == "Use a WHERE x < 5 filter"


def test_captions_drop_markers_split_across_pieces() -> None:
    import asyncio

    from intervia_agent.worker import InterviewerAgent

    async def pieces():
        for piece in ["Got it. ", "<no sp", "eech>", "{pau", "se}", " Next question?"]:
            yield piece

    async def run() -> str:
        agent = InterviewerAgent.__new__(InterviewerAgent)
        return "".join([p async for p in agent.transcription_node(pieces(), None)])

    assert asyncio.run(run()) == "Got it.  Next question?"


def _recovery_runtime():  # type: ignore[no-untyped-def]
    from intervia_agent.worker import InterviewRuntime

    runtime = InterviewRuntime.__new__(InterviewRuntime)
    runtime.controller = object()  # type: ignore[assignment]
    runtime._started_at_iso = "2026-11-25T13:26:33Z"
    runtime._finished = False
    runtime.closing = False
    runtime._model_stopped = False
    runtime._candidate_gone = False
    runtime._recoveries = 0
    return runtime


def _model_error(recoverable: bool) -> llm.RealtimeModelError:
    return llm.RealtimeModelError(
        timestamp=0.0,
        label="livekit.plugins.google.realtime.realtime_api.RealtimeModel",
        error=Exception("1008 BidiGenerateContent session is already connected to an existing client"),
        recoverable=recoverable,
    )


def test_a_dead_model_connection_mid_interview_is_replaced_not_the_end() -> None:
    runtime = _recovery_runtime()
    assert runtime.should_recover(_model_error(recoverable=False))
    # A recoverable error is left to the plugin's own reconnect.
    assert not runtime.should_recover(_model_error(recoverable=True))


def test_no_recovery_before_the_start_after_the_end_or_past_the_limit() -> None:
    from intervia_agent.worker import MAX_SESSION_RECOVERIES

    error = _model_error(recoverable=False)
    for field, value in (
        ("_started_at_iso", None),
        ("_finished", True),
        ("closing", True),
        ("_model_stopped", True),
        ("_candidate_gone", True),
        ("_recoveries", MAX_SESSION_RECOVERIES),
    ):
        runtime = _recovery_runtime()
        setattr(runtime, field, value)
        assert not runtime.should_recover(error), field
