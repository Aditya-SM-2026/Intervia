"""Environment configuration for the agent worker.

The worker shares one env file with the web app: the repository-root `.env`
is loaded when present, so LiveKit and Gemini credentials are set once.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]

# Name the web app dispatches to (token room configuration). Must match
# AGENT_NAME in src/lib/livekit/token.ts.
AGENT_NAME = "intervia-interviewer"

# Text-stream topic the candidate page uses for browser events (tab focus).
CLIENT_EVENT_TOPIC = "intervia.client"


def load_env() -> None:
    for name in (".env.local", ".env"):
        path = REPO_ROOT / name
        if path.exists():
            load_dotenv(path, override=False)
    # The Google plugin reads GOOGLE_API_KEY; the web app uses GEMINI_API_KEY.
    if not os.environ.get("GOOGLE_API_KEY") and os.environ.get("GEMINI_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


def _optional_int(value: str) -> int | None:
    try:
        return int(value)
    except ValueError:
        return None


@dataclass(frozen=True)
class AgentConfig:
    web_url: str
    agent_api_secret: str
    live_model: str
    live_voice: str
    turn_silence_ms: int
    transcription_languages: tuple[str, ...]
    thinking_budget: int | None
    topic_reset: bool
    rolling_seconds: float
    context_trigger_tokens: int
    context_target_tokens: int
    recording_bucket: str | None
    recording_credentials_json: str | None

    @staticmethod
    def from_env() -> AgentConfig:
        return AgentConfig(
            web_url=os.environ.get("INTERVIA_WEB_URL", "http://localhost:3000").rstrip("/"),
            agent_api_secret=os.environ.get("AGENT_API_SECRET", ""),
            live_model=os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.8-live"),
            live_voice=os.environ.get("GEMINI_LIVE_VOICE", "Charon"),
            # Silence that ends the candidate's turn. Lower feels snappier but
            # cuts in on thinking pauses.
            turn_silence_ms=int(os.environ.get("GEMINI_TURN_SILENCE_MS", "500")),
            # Tokens the live model may spend reasoning before it speaks. 0 gives
            # the fastest replies; unset the variable's value ("default") to let
            # the model decide.
            thinking_budget=_optional_int(os.environ.get("GEMINI_THINKING_BUDGET", "0")),
            # Cost controls. Gemini Live bills the whole remembered conversation
            # again on every reply. The recruiter picks the voice mode per
            # interview: "rolling" starts a fresh session at each topic change
            # and once a session is this many seconds old, carrying the earlier
            # conversation as text. INTERVIA_TOPIC_RESET=1 forces the per-topic
            # part on for every interview; the two token settings limit how
            # much recent audio is kept within one session.
            topic_reset=os.environ.get("INTERVIA_TOPIC_RESET", "0") == "1",
            rolling_seconds=float(os.environ.get("INTERVIA_ROLLING_SECONDS", "90")),
            context_trigger_tokens=int(os.environ.get("GEMINI_CONTEXT_TRIGGER_TOKENS", "32000")),
            context_target_tokens=int(os.environ.get("GEMINI_CONTEXT_TARGET_TOKENS", "16000")),
            # Pins the candidate's captions to these languages so stray noise is
            # not transcribed as another language. Empty = automatic.
            transcription_languages=tuple(
                code.strip()
                for code in os.environ.get("GEMINI_TRANSCRIPTION_LANGUAGES", "en-US").split(",")
                if code.strip()
            ),
            recording_bucket=os.environ.get("RECORDING_GCS_BUCKET") or None,
            recording_credentials_json=os.environ.get("RECORDING_GCS_CREDENTIALS_JSON") or None,
        )
