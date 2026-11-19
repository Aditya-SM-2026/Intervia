"""Every Gemini usage report is counted, including thinking and tool tokens,
and including reports the LiveKit plugin itself drops."""

from types import SimpleNamespace

from google.genai import types as genai_types

from intervia_agent import usage_ledger


def _usage(prompt_audio=0, prompt_text=0, out_audio=0, out_text=0, thoughts=0, tool=0):
    return genai_types.UsageMetadata(
        prompt_token_count=prompt_audio + prompt_text,
        response_token_count=out_audio + out_text,
        thoughts_token_count=thoughts,
        tool_use_prompt_token_count=tool,
        total_token_count=prompt_audio + prompt_text + out_audio + out_text + thoughts + tool,
        prompt_tokens_details=[
            genai_types.ModalityTokenCount(modality=genai_types.MediaModality.AUDIO, token_count=prompt_audio),
            genai_types.ModalityTokenCount(modality=genai_types.MediaModality.TEXT, token_count=prompt_text),
        ],
        response_tokens_details=[
            genai_types.ModalityTokenCount(modality=genai_types.MediaModality.AUDIO, token_count=out_audio),
            genai_types.ModalityTokenCount(modality=genai_types.MediaModality.TEXT, token_count=out_text),
        ],
    )


def test_ledger_adds_every_part():
    ledger = usage_ledger.UsageLedger("gemini-3.8-live")
    ledger.add(_usage(prompt_audio=100, prompt_text=900, out_audio=50, out_text=5, thoughts=40, tool=7))
    ledger.add(_usage(prompt_audio=200, prompt_text=1000, out_audio=60, thoughts=10))
    entry = ledger.entry()
    assert entry["type"] == usage_ledger.ENTRY_TYPE
    assert entry["reports"] == 2
    assert entry["input_audio_tokens"] == 300
    assert entry["input_text_tokens"] == 1900
    assert entry["output_audio_tokens"] == 110
    assert entry["output_text_tokens"] == 5
    assert entry["thoughts_tokens"] == 50
    assert entry["tool_use_prompt_tokens"] == 7
    assert entry["total_tokens"] == 300 + 1900 + 110 + 5 + 50 + 7


def test_hook_counts_reports_the_plugin_drops():
    from livekit.plugins.google.realtime import realtime_api

    ledger = usage_ledger.start("gemini-3.8-live")
    # A session with no reply in progress: the plugin logs and drops this report.
    fake = SimpleNamespace(_current_generation=None, _rejected_tool_calls=False)
    realtime_api.RealtimeSession._handle_usage_metadata(fake, _usage(prompt_text=500, thoughts=20))
    assert ledger.reports == 1
    assert ledger.prompt_text == 500
    assert ledger.thoughts == 20
    # Starting again does not wrap the handler twice.
    usage_ledger.start("gemini-3.8-live")
    assert realtime_api.RealtimeSession._intervia_usage_hooked is True
