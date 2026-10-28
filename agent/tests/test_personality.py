"""The recruiter's personality overrides, and the built-ins they fall back to."""

from __future__ import annotations

from intervia_agent.plan import parse_context
from intervia_agent.prompts import CONDUCT, PERSONA, STYLES, build_instructions

BASE = {
    "interview": {
        "roleTitle": "Backend Engineer",
        "durationMinutes": 15,
        "difficulty": "medium",
    },
    "plan": {"roleSummary": "Builds APIs."},
}


def test_without_overrides_the_built_in_instructions_are_used() -> None:
    context = parse_context("room-1", BASE)
    text = build_instructions(context)

    assert PERSONA in text
    assert CONDUCT in text
    assert STYLES["medium"] in text


def test_overrides_replace_only_the_parts_that_are_set() -> None:
    payload = {
        **BASE,
        "personality": {
            "persona": "You are a calm, warm interviewer who speaks slowly.",
            "conduct": "",
            "styles": {"medium": "Interviewer style: gentle and encouraging."},
        },
    }
    context = parse_context("room-2", payload)
    text = build_instructions(context)

    assert "calm, warm interviewer" in text
    assert "gentle and encouraging" in text
    # Untouched parts keep the built-in text.
    assert CONDUCT in text
    assert PERSONA not in text


def test_personality_for_another_mode_does_not_override_this_one():
    payload = {
        **payload_base(),
        "interview": {**BASE["interview"], "difficulty": "hard"},
        "personality": {"styles": {"easy": "Interviewer style: very relaxed."}},
    }
    text = build_instructions(parse_context("room-3", payload))

    assert "very relaxed" not in text
    assert STYLES["hard"] in text


def payload_base() -> dict:
    return {key: value for key, value in BASE.items()}
