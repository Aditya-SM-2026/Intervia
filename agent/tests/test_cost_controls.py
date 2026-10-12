"""Offline tests for the cost controls: nothing here contacts a model."""

import os

os.environ.setdefault("GOOGLE_API_KEY", "test-key-not-used")

from livekit.agents import llm

from intervia_agent.controller import InterviewController
from intervia_agent.plan import Competency, InterviewContext
from intervia_agent.prompts import SYSTEM_NOTE_PREFIX
from intervia_agent.worker import CARRY_OVER_TURNS, carry_over_context


def make_controller() -> InterviewController:
    context = InterviewContext(
        interview_id="t",
        role_title="Backend Engineer",
        candidate_name="Asha",
        recruiter_name=None,
        duration_minutes=20,
        difficulty="medium",
        role_summary="",
        candidate_summary="",
        competencies=tuple(
            Competency(id=f"c{i}", name=f"Topic {i}", description="", question=f"Question {i}?")
            for i in (1, 2, 3)
        ),
    )
    clock = [0.0]
    controller = InterviewController(context, clock=lambda: clock[0])
    controller.begin()
    controller._test_clock = clock  # type: ignore[attr-defined]
    return controller


def advance(controller: InterviewController, seconds: float) -> None:
    controller._test_clock[0] += seconds  # type: ignore[attr-defined]


def test_step_instructions_follow_the_current_step():
    controller = make_controller()
    assert controller.step_instructions() == ""  # introduction: nothing extra
    advance(controller, 60)
    controller.next_topic("intro", "adequate")
    assert "Question 1?" in controller.step_instructions()
    advance(controller, 400)
    controller.next_topic("answer one", "strong")
    assert "Question 2?" in controller.step_instructions()
    assert "Question 1?" not in controller.step_instructions()


def test_step_key_changes_only_when_the_interview_moves_on():
    controller = make_controller()
    advance(controller, 60)
    start = controller.step_key()
    controller.next_topic("intro", "adequate")
    first = controller.step_key()
    assert first != start
    advance(controller, 20)
    controller.next_topic("too early", "weak")  # held on the topic
    assert controller.step_key() == first


def test_summary_lists_finished_topics_only():
    controller = make_controller()
    advance(controller, 60)
    controller.next_topic("intro", "adequate")
    assert controller.summary_so_far() == ""
    advance(controller, 400)
    controller.next_topic("Rebuilt the ledger as an event log.", "strong")
    summary = controller.summary_so_far()
    assert "Topic 1: Rebuilt the ledger as an event log. (evidence: strong)" in summary
    assert "Topic 2" not in summary


def test_carry_over_is_short_text_without_system_notes():
    previous = llm.ChatContext.empty()
    previous.add_message(role="user", content=f"{SYSTEM_NOTE_PREFIX} greet the candidate")
    for index in range(10):
        previous.add_message(role="assistant", content=f"question {index}")
        previous.add_message(role="user", content=f"answer {index}")

    carried = carry_over_context(previous, "- Topic 1: did well")
    texts = [item.text_content for item in carried.items]
    assert texts[0].startswith(SYSTEM_NOTE_PREFIX) and "Topic 1: did well" in texts[0]
    assert texts[1:] == ["question 8", "answer 8", "question 9", "answer 9"]
    assert len(texts) == 1 + CARRY_OVER_TURNS


def test_carry_over_without_a_summary_has_no_note():
    previous = llm.ChatContext.empty()
    previous.add_message(role="assistant", content="hello")
    carried = carry_over_context(previous, "")
    assert [item.text_content for item in carried.items] == ["hello"]


def test_voice_mode_comes_from_the_interview_and_defaults_to_standard():
    from intervia_agent.plan import parse_context

    assert parse_context("x", {"interview": {"voiceMode": "rolling"}}).voice_mode == "rolling"
    assert parse_context("x", {"interview": {"voiceMode": "nonsense"}}).voice_mode == "standard"
    assert parse_context("x", None).voice_mode == "standard"


def test_a_mid_topic_renewal_carries_more_of_the_conversation():
    from intervia_agent.worker import ROLLING_CARRY_OVER_TURNS

    previous = llm.ChatContext.empty()
    for index in range(20):
        previous.add_message(role="user" if index % 2 else "assistant", content=f"line {index}")
    carried = carry_over_context(previous, "", turns=ROLLING_CARRY_OVER_TURNS)
    texts = [item.text_content for item in carried.items]
    assert len(texts) == ROLLING_CARRY_OVER_TURNS
    assert texts[-1] == "line 19"


def test_the_audio_gate_holds_frames_and_releases_them_in_order():
    import asyncio

    from livekit.agents.voice import io

    from intervia_agent.worker import GatedAudioInput

    class Source(io.AudioInput):
        def __init__(self) -> None:
            super().__init__(label="test")
            self.count = 0

        async def __anext__(self):
            self.count += 1
            return self.count

    async def scenario() -> list[int]:
        gate = GatedAudioInput(Source())
        seen = [await gate.__anext__()]
        gate.hold()
        pending = asyncio.create_task(gate.__anext__())
        await asyncio.sleep(0.05)
        assert not pending.done()
        gate.release()
        seen.append(await pending)
        seen.append(await gate.__anext__())
        return seen

    assert asyncio.run(scenario()) == [1, 2, 3]
