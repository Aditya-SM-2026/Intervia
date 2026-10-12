# Phase 0 — Scoring-model benchmark results

Date: 2026-10-12. Harness: `fixtures.mjs` (13 synthetic interviews with planted
ground truth) + `rubric.mjs` (five-score prompt) + `run.mjs` (metrics runner).

## Metrics explained

- **shape-valid** — replies that parsed to the required JSON scores shape (out of 13 fixtures; +1 for the easy/hard pair re-call = 14 max).
- **MAE** — mean absolute error vs planted ground truth, 0–100 scale (lower is better).
- **planted checks** — assertions hidden in fixtures: AI-cheating fixture must score aiRisk ≥ 75; honest fixture aiRisk ≤ 20; one-word answers communication ≤ 20; identical transcript on easy vs hard difficulty must differ ≥ 10 overall points.
- **latency p50/p95** — per call. **est cost** — approximate USD for all calls in the run.

## Results — direct Gemini API (`GEMINI_API_KEY` in `.env`)

| Model | Shape-valid | MAE | Planted | Latency p50/p95 | Verdict |
|---|---|---|---|---|---|
| **gemini-3.5-flash-lite** | **14/14** | **3.1** | **3/4** | **2.4s / 7.9s** | **WINNER — used in production** |
| gemini-3.1-flash-lite | 11/13 (+3× 503) | 4.1 | 4/4 | 13.9s / 37s | Runner-up, fallback model |
| gemini-3.7-flash | 4/13 (9× 503) | 9.3 | 2/3 | 18s / 276s | Overloaded (free tier) |
| gemini-3.8-flash | 4/13 (9× 503) | 8.3 | 0/1 | 221s | Overloaded (free tier) |
| gemini-2.5-flash-lite | 404 — retired for new projects | | | | Unavailable |
| gemini-2.5-flash | 404 — retired for new projects | | | | Unavailable |
| gemini-3.1-pro-preview | 429 — free-tier daily cap | | | | Quota-gated |

Notes:
- 3.5-flash-lite's single planted miss: scored one-word answers slightly above
  the 20 communication boundary — fixable with a rubric anchor tweak.
- The 503 "high demand" errors are an availability signal for Google's free
  tier; production mitigates via the automatic 3.1-flash-lite fallback.
- Total benchmark cost ≈ $0.03 (~150 calls), all inside free-tier quotas.

## OpenRouter comparison — NOT RUN

No OpenRouter results exist yet: `OPENROUTER_API_KEY` has not been created, so
the planned cross-provider comparison (GPT-5 Nano, Qwen, Claude Sonnet 5, free
variants) never executed. The harness already supports it:

```powershell
# after putting OPENROUTER_API_KEY in .env
node tools/score-benchmark/run.mjs --backend=openrouter --models=openai/gpt-5-nano,qwen/qwen3-32b,anthropic/claude-sonnet-5
```

## Production decision

`src/lib/ai/gemini-provider.ts` uses **gemini-3.5-flash-lite** (override with
`GEMINI_SCORER_MODEL`), falling back to **gemini-3.1-flash-lite** on 429/500/503.
Scores pass verified live: demo report regenerated in 69s with all four
non-video scores grounded in transcript turns.

## Key provenance

The `GEMINI_API_KEY` in `.env` is `AQ.Ab8R…` — a **Google Cloud Console API key**
(the newer AQ. format), not an AI Studio key (`AIza…`) as the `.env` comment
claims. It is almost certainly issued from the `court-siva-nikhil` GCP project;
exact account/project visibility is in Google Cloud Console → APIs & Services →
Credentials. Usage may bill against that project's Gemini API quota/billing.