"""Counts every token Gemini Live reports for an interview, for cost tracking.

The LiveKit plugin turns Gemini's usage reports into its own metrics, but it
leaves out thinking and tool-use tokens, and it drops a report that arrives
while no reply is in progress (after an interruption, or between replies).
Google bills all of them. This wraps the plugin's handler so each report is
added up here first, then passed on unchanged.

One interview runs per process (the agent is a one-shot Cloud Run job), so a
single module-level ledger is enough.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("intervia.usage")

# Field names follow the usage entries LiveKit writes, so the web app's cost
# code reads both the same way.
ENTRY_TYPE = "gemini_live_usage"


class UsageLedger:
    """Running totals of every Gemini Live usage report for one interview."""

    def __init__(self, model: str) -> None:
        self.model = model
        self.reports = 0
        self.prompt = 0
        self.prompt_audio = 0
        self.prompt_text = 0
        self.response = 0
        self.response_audio = 0
        self.response_text = 0
        self.thoughts = 0
        self.tool_use_prompt = 0
        self.cached = 0
        self.total = 0

    def add(self, usage: Any) -> None:
        self.reports += 1
        self.prompt += usage.prompt_token_count or 0
        self.response += usage.response_token_count or 0
        self.thoughts += usage.thoughts_token_count or 0
        self.tool_use_prompt += usage.tool_use_prompt_token_count or 0
        self.cached += usage.cached_content_token_count or 0
        self.total += usage.total_token_count or 0
        audio, text = _by_modality(usage.prompt_tokens_details)
        self.prompt_audio += audio
        self.prompt_text += text
        audio, text = _by_modality(usage.response_tokens_details)
        self.response_audio += audio
        self.response_text += text

    def entry(self) -> dict[str, Any]:
        """The totals as one usage entry for the interview outcome."""
        return {
            "type": ENTRY_TYPE,
            "model": self.model,
            "reports": self.reports,
            "input_tokens": self.prompt,
            "input_audio_tokens": self.prompt_audio,
            "input_text_tokens": self.prompt_text,
            "output_tokens": self.response,
            "output_audio_tokens": self.response_audio,
            "output_text_tokens": self.response_text,
            "thoughts_tokens": self.thoughts,
            "tool_use_prompt_tokens": self.tool_use_prompt,
            "input_cached_tokens": self.cached,
            "total_tokens": self.total,
        }


def _by_modality(details: Any) -> tuple[int, int]:
    """Audio and text token counts from a list of per-modality counts."""
    audio = text = 0
    for item in details or []:
        modality = str(getattr(item, "modality", "") or "").upper()
        count = getattr(item, "token_count", 0) or 0
        if "AUDIO" in modality:
            audio += count
        elif "TEXT" in modality:
            text += count
    return audio, text


_ledger: UsageLedger | None = None


def start(model: str) -> UsageLedger:
    """Begins counting for this process's interview, and hooks the plugin once."""
    global _ledger
    _install()
    _ledger = UsageLedger(model)
    return _ledger


def _install() -> None:
    from livekit.plugins.google.realtime import realtime_api

    session_class = realtime_api.RealtimeSession
    if getattr(session_class, "_intervia_usage_hooked", False):
        return
    original = session_class._handle_usage_metadata

    def handle_usage_metadata(self: Any, usage_metadata: Any) -> None:
        if _ledger is not None:
            try:
                _ledger.add(usage_metadata)
            except Exception:  # counting must never break the call
                logger.exception("could not count a usage report")
        original(self, usage_metadata)

    session_class._handle_usage_metadata = handle_usage_metadata
    session_class._intervia_usage_hooked = True
