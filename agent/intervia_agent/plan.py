"""Interview context as served by the web app.

Mirrors the JSON of GET /api/agent/interviews/:id (see
src/lib/interviews/plan.types.ts). Parsing is defensive: a missing or partial
plan must never stop an interview from running.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

DIFFICULTIES = ("easy", "medium", "hard", "extra-hard")
VOICE_MODES = ("standard", "rolling")


@dataclass(frozen=True)
class Competency:
    id: str
    name: str
    description: str
    question: str
    follow_ups: tuple[str, ...] = ()
    look_for: tuple[str, ...] = ()
    resume_probe: str | None = None
    minutes: float = 4.0


@dataclass(frozen=True)
class InterviewContext:
    interview_id: str
    role_title: str
    candidate_name: str | None
    recruiter_name: str | None
    duration_minutes: int
    difficulty: str
    role_summary: str
    candidate_summary: str
    competencies: tuple[Competency, ...] = field(default_factory=tuple)
    # "standard": one model session per interview. "rolling": a fresh session
    # at each topic change and every minute or two (see worker.py).
    voice_mode: str = "standard"


FALLBACK_COMPETENCIES: tuple[Competency, ...] = (
    Competency(
        id="experience",
        name="Relevant experience",
        description="Depth and relevance of the candidate's recent work for this role.",
        question="Walk me through the most relevant project you have worked on recently, and your part in it.",
        follow_ups=(
            "What was the hardest problem in that project, and how did you solve it?",
            "What would you do differently if you did it again?",
        ),
        look_for=("specific personal contribution", "concrete outcome"),
    ),
    Competency(
        id="problem-solving",
        name="Problem solving",
        description="How the candidate breaks down and resolves an unfamiliar or difficult problem.",
        question="Tell me about a time you were stuck on a difficult problem at work. How did you get unstuck?",
        follow_ups=(
            "What options did you consider, and why did you pick that one?",
            "How did you know your solution worked?",
        ),
        look_for=("structured approach", "alternatives weighed", "measured result"),
    ),
    Competency(
        id="collaboration",
        name="Collaboration",
        description="Working with others, handling disagreement and communicating clearly.",
        question="Tell me about a time you disagreed with a teammate or a stakeholder. What happened?",
        follow_ups=("What did you do to resolve it?", "What was the outcome?"),
        look_for=("listens to the other side", "clear resolution"),
    ),
)


def _text(value: Any, default: str = "") -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item.strip() for item in value if isinstance(item, str) and item.strip())


def _competency(raw: Any, index: int) -> Competency | None:
    if not isinstance(raw, dict):
        return None
    question = _text(raw.get("question"))
    name = _text(raw.get("name"))
    if not question or not name:
        return None
    minutes = raw.get("minutes")
    return Competency(
        id=_text(raw.get("id"), f"competency-{index + 1}"),
        name=name,
        description=_text(raw.get("description")),
        question=question,
        follow_ups=_strings(raw.get("followUps")),
        look_for=_strings(raw.get("lookFor")),
        resume_probe=_text(raw.get("resumeProbe")) or None,
        minutes=float(minutes) if isinstance(minutes, (int, float)) and minutes > 0 else 4.0,
    )


def parse_context(interview_id: str, payload: Any) -> InterviewContext:
    """Builds the interview context from the web API payload (or a fallback)."""
    data = payload if isinstance(payload, dict) else {}
    interview = data.get("interview") if isinstance(data.get("interview"), dict) else {}
    plan = data.get("plan") if isinstance(data.get("plan"), dict) else {}

    competencies = tuple(
        parsed
        for index, raw in enumerate(plan.get("competencies") or [])
        if (parsed := _competency(raw, index)) is not None
    )

    duration = interview.get("durationMinutes")
    difficulty = _text(interview.get("difficulty"), "medium")
    voice_mode = _text(interview.get("voiceMode"), "standard")

    return InterviewContext(
        interview_id=interview_id,
        role_title=_text(interview.get("roleTitle")),
        candidate_name=_text(interview.get("candidateName")) or None,
        recruiter_name=_text(interview.get("recruiterName")) or None,
        duration_minutes=int(duration) if isinstance(duration, (int, float)) and duration > 0 else 15,
        difficulty=difficulty if difficulty in DIFFICULTIES else "medium",
        role_summary=_text(plan.get("roleSummary")),
        candidate_summary=_text(plan.get("candidateSummary")),
        competencies=competencies or FALLBACK_COMPETENCIES,
        voice_mode=voice_mode if voice_mode in VOICE_MODES else "standard",
    )
