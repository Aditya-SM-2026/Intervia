from intervia_agent.controller import InterviewController, Phase
from intervia_agent.plan import Competency, InterviewContext, parse_context


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_context(minutes: int = 20, topics: int = 4, difficulty: str = "medium") -> InterviewContext:
    return InterviewContext(
        interview_id="test",
        role_title="Backend Engineer",
        candidate_name="Asha",
        recruiter_name=None,
        duration_minutes=minutes,
        difficulty=difficulty,
        role_summary="",
        candidate_summary="",
        competencies=tuple(
            Competency(id=f"c{i}", name=f"Topic {i}", description="", question=f"Question {i}?")
            for i in range(1, topics + 1)
        ),
    )


def make_controller(**kwargs) -> tuple[InterviewController, FakeClock]:
    clock = FakeClock()
    controller = InterviewController(make_context(**kwargs), clock=clock)
    controller.begin()
    return controller, clock


def statuses(controller: InterviewController) -> list[str]:
    return [topic.status for topic in controller.topics]


def test_walks_every_topic_then_candidate_questions():
    controller, clock = make_controller(minutes=20, topics=3)
    clock.advance(60)
    for index in range(1, 4):
        briefing = controller.next_topic("summary", "adequate")
        assert f"Question {index}?" in briefing
        assert controller.phase == Phase.TOPIC
        clock.advance(controller.active_topic.budget_seconds * 0.7)
    closing = controller.next_topic("summary", "strong")
    assert controller.phase == Phase.CANDIDATE_QUESTIONS
    assert "end_interview" in closing
    assert statuses(controller) == ["covered", "covered", "covered"]
    assert controller.topics[0].evidence == "adequate"
    assert controller.topics[0].advanced_by == "interviewer"


def test_budgets_share_the_time_left_before_closing():
    controller, clock = make_controller(minutes=20, topics=4)
    clock.advance(100)
    controller.next_topic()
    # 20 min, closing reserve 16s: 1200 - 16 - 100 = 1084s over 4 equal topics.
    assert round(controller.topics[0].budget_seconds) == 271


def test_drops_lowest_priority_topics_when_time_is_short():
    controller, clock = make_controller(minutes=10, topics=5)
    clock.advance(240)  # a long introduction leaves 300s for topics
    controller.next_topic()
    assert statuses(controller) == ["active", "pending", "pending", "skipped", "skipped"]


def test_overrunning_topic_gets_a_silent_note_first_then_is_forced():
    controller, clock = make_controller(minutes=20, topics=3)
    clock.advance(60)
    controller.next_topic()
    budget = controller.topics[0].budget_seconds
    clock.advance(budget + 10)
    assert controller.tick() is None  # inside the grace period
    clock.advance(30)

    note = controller.tick()
    assert note is not None and note.kind == "note"
    # A note changes nothing by itself: the interviewer moves on with the tool.
    assert controller.topics[0].status == "active"
    advance = controller.tick()
    assert controller.tick() is None

    # After a note, leaving is never held back.
    assert "Question 2?" in controller.next_topic("done", "adequate")
    assert controller.topics[0].advanced_by == "interviewer"


def test_ignored_note_leads_to_a_spoken_advance():
    controller, clock = make_controller(minutes=20, topics=3)
    clock.advance(60)
    controller.next_topic()
    clock.advance(controller.topics[0].budget_seconds + 40)
    assert controller.tick().kind == "note"
    clock.advance(controller.force_after_seconds + 1)
    directive = controller.tick()
    assert directive is not None and directive.kind == "advance"
    assert "Question 2?" in directive.instructions
    assert controller.topics[0].advanced_by == "controller"
    assert controller.topics[1].status == "active"


def test_long_introduction_is_noted_then_moved_on():
    controller, clock = make_controller(minutes=20, topics=2)
    clock.advance(controller.intro_seconds + 31)
    assert controller.tick().kind == "note"
    assert controller.phase == Phase.INTRO
    clock.advance(controller.force_after_seconds + 1)
    directive = controller.tick()
    assert directive is not None and directive.kind == "advance"
    assert controller.phase == Phase.TOPIC


def test_closing_note_makes_the_next_topic_request_end_the_topics():
    controller, clock = make_controller(minutes=10, topics=3)
    clock.advance(60)
    controller.next_topic()
    clock.advance(600 - 60 - controller.closing_seconds)
    assert controller.tick().kind == "note"
    assert controller.phase == Phase.TOPIC
    closing = controller.next_topic("answer", "adequate")
    assert controller.phase == Phase.CANDIDATE_QUESTIONS and "end_interview" in closing
    assert statuses(controller) == ["covered", "skipped", "skipped"]


def test_closing_then_wrap_up_then_hard_stop():
    controller, clock = make_controller(minutes=10, topics=2)
    clock.advance(60)
    controller.next_topic()
    clock.advance(600 - 60 - controller.closing_seconds)
    assert controller.tick().kind == "note"

    # The wrap-up fires 8 s before the limit so the goodbye lands on time.
    clock.advance(9)
    directive = controller.tick()
    assert directive is not None and directive.kind == "wrap_up"
    assert controller.phase == Phase.CLOSING
    assert statuses(controller) == ["covered", "skipped"]
    assert controller.tick() is None

    clock.advance(10)  # 1 s past the limit: forced stop (exact end)
    directive = controller.tick()
    assert directive is not None and directive.kind == "hard_stop"
    assert controller.tick() is None


def test_interviewer_is_held_on_a_topic_it_leaves_too_early():
    controller, clock = make_controller(minutes=20, topics=2)
    clock.advance(60)
    controller.next_topic()
    clock.advance(40)  # far less than half of the topic's budget

    first = controller.next_topic("short answer", "weak")
    second = controller.next_topic("still short", "weak")
    assert "Stay on this topic" in first and "Stay on this topic" in second
    assert controller.topics[0].status == "active" and controller.topics[0].holds == 2

    third = controller.next_topic("done", "adequate")  # holds are used up
    assert "Question 2?" in third and controller.topics[0].status == "covered"


def test_no_hold_when_enough_time_was_spent_or_candidate_has_nothing():
    controller, clock = make_controller(minutes=20, topics=3)
    clock.advance(60)
    controller.next_topic()
    clock.advance(controller.active_topic.budget_seconds * 0.6)
    assert "Question 2?" in controller.next_topic("good", "strong")

    clock.advance(20)
    assert "Stay on this topic" in controller.next_topic("nothing", "none")
    assert "Question 3?" in controller.next_topic("nothing", "none")


def test_short_test_interview_still_reaches_a_topic():
    controller, clock = make_controller(minutes=2, topics=1)
    assert controller.intro_seconds == 24 and controller.closing_seconds == 16
    clock.advance(20)
    assert "Question 1?" in controller.next_topic()
    assert round(controller.topics[0].budget_seconds) == 84


def test_no_second_goodbye_when_already_closing_at_time_up():
    controller, clock = make_controller(minutes=10, topics=1)
    clock.advance(595)
    controller.begin_closing()  # the interviewer called end_interview
    clock.advance(10)
    assert controller.tick() is None
    clock.advance(46)
    assert controller.tick().kind == "hard_stop"  # still forced if it never leaves


def test_probe_limit_follows_difficulty():
    easy, _ = make_controller(difficulty="easy")
    hard, _ = make_controller(difficulty="extra-hard")
    assert easy.probe_limit == 1 and hard.probe_limit == 4


def test_coverage_report_after_end():
    controller, clock = make_controller(minutes=20, topics=2)
    clock.advance(60)
    controller.next_topic()
    clock.advance(120)
    controller.end()
    coverage = controller.coverage()
    assert coverage[0]["status"] == "covered" and coverage[0]["endedAtSeconds"] == 180.0
    assert coverage[1]["status"] == "pending"


def test_parse_context_falls_back_without_a_plan():
    context = parse_context("abc", None)
    assert context.interview_id == "abc"
    assert len(context.competencies) == 3
    assert context.duration_minutes == 15
    assert "this role" in InterviewController(context).opening_instructions()


def test_parse_context_reads_the_web_payload():
    context = parse_context(
        "abc",
        {
            "interview": {"roleTitle": "Data Engineer", "durationMinutes": 30, "difficulty": "hard"},
            "plan": {
                "roleSummary": "Pipelines",
                "competencies": [
                    {"id": "sql", "name": "SQL", "question": "How do you tune a slow query?", "followUps": ["Why?"], "minutes": 6},
                    {"name": "missing question"},
                ],
            },
        },
    )
    assert context.role_title == "Data Engineer" and context.difficulty == "hard"
    assert [c.id for c in context.competencies] == ["sql"]
    assert context.competencies[0].follow_ups == ("Why?",) and context.competencies[0].minutes == 6
