# Voice engine: cost and quality review (Nov 8, 2026)

## How it works today
- **Model:** Gemini Live (`gemini-3.8-live`), speech in and speech out, through LiveKit Agents (`agent/intervia_agent/worker.py`). Gemini decides when the candidate has finished. Local voice detection only stops the interviewer when the candidate cuts in.
- **Session modes (Settings):**
  - **standard:** one session for the whole interview. It keeps up to 32k tokens of recent conversation and trims to 16k.
  - **rolling:** a fresh session at each topic change and every 90 s, with the earlier conversation carried as text.
- **No cascaded pipeline** (speech-to-text → text model → text-to-speech) exists. The `NEXT_PUBLIC_VOICE_PROVIDER=cascade` and `AGENT_TTS_PROVIDER=cloud` settings on predev are not read by any code.

## Measured cost: a real 30-minute interview (Gayathri, standard mode)

| Part | Tokens | Rate (USD/M) | Cost |
|---|---|---|---|
| Audio in | 519,961 | 3.00 | $1.56 |
| Text in | about 161,500 | 0.75 | $0.12 |
| Audio out | 5,138 | 12.00 | $0.06 |
| Text out | about 350 | 4.50 | about $0.00 |
| **Total** | | | **about $1.74 (about $3.50 per hour)** |

**Why so high:** 30 minutes of candidate speech is only about 45k audio tokens. Gemini Live re-bills everything it remembers on every reply. About 40 replies × 13k remembered tokens ≈ 520k. **About 90% of the bill is the same audio paid for again and again.** It is above the agreed ceiling of $2.50 per hour.

## Options, cheapest effort first

| # | Change | Expected cost / hour | Effort | Quality risk |
|---|---|---|---|---|
| 1 | **Make "rolling" the default** (already built; measured $1.09/h in a 3-minute test, stays flat with length) | about $1.0–1.3 | Settings switch | Low: no lost words in testing; the model loses the *sound* of earlier answers, keeps their text |
| 2 | **Smaller remembered window in standard mode** (`GEMINI_CONTEXT_TRIGGER_TOKENS=9000`, `TARGET=5000`) | about $1.5–2.0 | Env change | Low to medium: follow-ups on answers from minutes ago rely on the text summary |
| 3 | **Rolling plus the smaller window** | about $0.8–1.0 | Both of the above | Medium; test with one 30-minute call |
| 4 | **Cascaded pipeline:** streaming speech-to-text (e.g. Deepgram / Google STT), text model (Ominibot or Gemini Flash), neural text-to-speech | about $0.4–0.9 | 1–2 weeks | Higher: about +0.3–0.8 s reply delay, interruptions and turn-taking need care, a less natural voice |

**Recommendation:**
1. Switch predev to **rolling** now and run one full 30-minute test, reading the real cost from the report's cost line.
2. If it lands at or under $1.30/h with no quality complaints, make it the default everywhere.
3. Keep the cascaded pipeline as a later option, only if price matters more than voice naturalness.

## Quality gaps seen in the transcript (Gayathri)
1. **The interviewer introduces itself as "the Sreemedhas Interview Agent".** The brand is Medhas Academy (`controller.py`, `opening_instructions`).
2. **Repetitive acknowledgements.** "Thanks, that's clear." / "Got it." / "Thanks for sharing…" appear before almost every question. Vary them, or drop them when moving on.
3. **A question was cut in two:** "Tell me about a" … "a large language model API into…". This is an interruption or turn-end race. The local stop-on-speech fired on a breath or noise. Raise the barge-in threshold slightly, or require about 300 ms of candidate speech before stopping the interviewer.
4. **"I was not able to hear you"** (19:24). The candidate missed an interviewer line. Likely the audio was cut while she spoke over it. Same fix as 3, plus repeating the question when the candidate says they didn't hear.
5. **Speech-to-text mistakes** in the stored transcript ("Wanderlist", "Phantom is" for "front end", "Ja"). They feed the graders. Options:
   - pass the resume's project names and the job's terms as recognition hints;
   - or re-transcribe answers afterwards with faster-whisper, which the video worker already runs, and grade from that.
6. **Long thinking pauses split one answer into two turns** (4:32 then 4:58). The 500 ms end-of-turn silence is short for candidates who think aloud. Try 800 ms on the end-of-turn setting only. Longer replies are a fair trade for not cutting candidates off.
7. **"Do you have questions for me?"** came at 25:55 with 4 minutes left, and the interviewer then asked one more topic question. Fine, but the order feels odd. Keep candidate questions for the last 2 minutes.
8. **Feedback requests** ("tell me how I did") were handled correctly: the interviewer declined.

## Quick wins (no architecture change)
- **Rolling mode as default:** about 60–70% cheaper.
- **Opening line:** "Medhas Academy".
- **Fewer stock acknowledgements:** one instruction line in `prompts.py`.
- **End-of-turn silence 500 → 800 ms, and barge-in only after about 300 ms of candidate speech.**
- **Recognition hints** from the plan (project names, technologies) passed to transcription, where the API accepts them.
