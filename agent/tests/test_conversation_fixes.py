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
