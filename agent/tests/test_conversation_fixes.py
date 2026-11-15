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
