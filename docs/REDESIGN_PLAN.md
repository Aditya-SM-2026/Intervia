# Intervia v2 — redesign plan

Status: v2 built and tested locally with a simulated candidate (see section 11). Branch: `redesign/live-interview-v2`. Date: 2026-10-11.

Goal: a live spoken interview that feels like talking to a real interviewer, and
that captures enough structured evidence for a dashboard to analyse answers
later. The plan is driven by how real interview systems work, not by what the
current code happens to do.

## 1. Where the current build falls short

| # | Gap | What the candidate or recruiter experiences |
| --- | --- | --- |
| 1 | The AI never hears the candidate. Speech is transcribed by the browser's Web Speech API and sent as text. | Chrome/Edge only, wrong microphone picked silently, no tone or hesitation, accents and technical terms mis-transcribed. |
| 2 | Each reply waits for a 3 s hold, a non-streaming LLM call, then per-sentence TTS. | Roughly 6–9 s of dead air per turn (worker estimate; the 3 s hold is confirmed in code). A real interviewer answers in under a second. |
| 3 | Interruption and echo are handled by word-count and word-overlap heuristics. | "Hold on" does not stop the AI; real answers that reuse the question's words can be dropped as echo. |
| 4 | The interviewer is one system prompt with a 20-message memory. | No question plan, no tracking of what was covered, no consistent questions between candidates, abrupt hard stop when the timer fires. |
| 5 | Only text turns are stored. No audio or video recording. | Nothing to replay, nothing to re-score, no audit trail. Answer latency is measured wrongly (it includes the AI's own speaking time and the 3 s hold). |
| 6 | The report is one LLM pass that produces strengths, weaknesses and an "AI probability" score. | No per-competency scores, no rubric, and the integrity score is a guess from text alone. |
| 7 | Recruiter page, dashboard and their APIs have no login. | Anyone with the URL can read every candidate's resume, email and transcript. |
| 8 | The Gemini Live path exists only in `/lab`: fixed prompt, no JD or resume, nothing saved. | The realistic voice is not part of the product. |
| 9 | Agent finds rooms by polling every 4 s on one small VM; no tests; console logs only. | 10–20 s before the AI says hello; one crash drops every live interview. |
| 10 | Interviews are capped at 5–10 minutes. | Too short to assess more than one or two competencies. |

## 2. What the research says

Sources are listed in section 8. Items marked (unverified) came from secondary
sources and must be checked against first-party docs before we build on them.

**Voice.** Speech-to-speech models (Gemini Live, OpenAI Realtime) take audio in
and produce audio out. They give sub-second replies, native interruption, and
they hear hesitation and tone. A cascaded pipeline (streaming STT, text LLM,
streaming TTS) is slower but gives full control over the words before they are
spoken and is cheaper. Gemini Live also supports function calling mid-session,
input and output transcription, session resumption, context compression and
ephemeral tokens.

**Gemini Live constraints that shape the design.**
- A session is capped at about 15 minutes audio-only and about 2 minutes with
  video unless context-window compression is on; session resumption handles
  let one interview span several connections.
- The transcript the model emits is not guaranteed to match the audio exactly,
  so scoring should run on a separate high-accuracy transcription of the
  recording.
- Model and price, confirmed on Google's pricing page (2026-10-11):
  `gemini-3.8-live` at $0.005/min audio in and $0.018/min audio out, about
  $0.75 per interview hour (mic streaming throughout, AI speaking about 25
  minutes), ceiling $1.38/hr. `gemini-3.8-live-extended-thinking` and
  `gemini-3.1-flash-live-preview` share that price list. The repo default
  `gemini-2.5-flash-native-audio-latest` is outdated and is replaced.
- Avatars are feasible through LiveKit's avatar plugins (Anam about
  $0.11–0.16/min, Tavus about $0.26–0.35/min) but cost roughly ten times the
  voice. Out of scope for now.

**Orchestration.** LiveKit Agents is the standard framework for this: it takes
the candidate's WebRTC audio track on the server (echo-cancelled, any browser),
bridges it to a realtime model, provides turn detection, explicit agent
dispatch instead of polling, and egress recording to cloud storage. We already
use LiveKit for the room, so this replaces the hand-rolled worker rather than
adding a vendor. The Node plugin for Gemini Live is marked experimental in
LiveKit's docs; Python is the more mature SDK.

**How real products run interviews.** Mercor, micro1, Apriora, Ribbon and
Braintrust AIR run 20–40 minute live conversations with adaptive follow-ups,
then score against a rubric with transcript citations. Karat-style structured
rubrics are the benchmark for technical roles.

**Interview science.** Structured interviews are the best single predictor of
job performance (Sackett et al. 2022: about .42, against .19 for unstructured).
"Structured" means: competencies derived from the job, the same core questions
for every candidate for a role, bounded follow-up probing (STAR: situation,
task, action, result), and behaviourally anchored 1–5 rating scales. An LLM
that improvises questions from a prompt is an unstructured interview.

**Analysis.** Score after the interview, never during it. Use several passes:
accurate transcription with word timestamps, evidence extraction per
competency, rubric scoring where every score cites a quote and a timestamp,
then a second-judge check. Do not score emotion, facial expression or voice
pitch: it is scientifically weak and legally exposed.

**Integrity.** Reliable signals are deep follow-up probing on the candidate's
own answer, tab/focus events, and a second voice on the audio. Gaze tracking
and raw answer-latency clocks produce false positives and should not drive a
score.

**Compliance.** Hiring AI is high-risk under the EU AI Act; NYC Local Law 144
requires bias audits and notice; Illinois requires consent and deletion on
request. Practical requirements for us: explicit consent before recording, a
retention and deletion policy, a human makes the final decision, and every
score is traceable to evidence.

## 3. Target architecture

```
Recruiter (logged in)
  └─ creates Role ─► Interview Plan generated from JD (competencies, core
                     questions, rubric anchors) ─► recruiter reviews/edits
  └─ invites Candidate ─► plan personalised with resume probes

Candidate browser ──WebRTC audio/video──► LiveKit room
                                             │
                    ┌────────────────────────┼─────────────────────┐
                    ▼                        ▼                     ▼
          Interview agent            Egress recording        Client events
          (LiveKit Agents)           (audio, optional        (tab focus,
            │                         video) ► GCS            device changes)
            ├─ Realtime voice model (Gemini Live)
            ├─ Interview controller (code, not prompt):
            │    plan state, time budget per section,
            │    probe limits, wrap-up
            └─ Tools the model calls: next_question,
               record_observation, request_wrap_up

After the interview (async job)
  recording ► accurate STT with word timestamps ► evidence extraction
  ► rubric scoring with citations ► second-judge check ► scorecard

Dashboard
  per-competency scores, each linked to the audio moment; candidate
  comparison per role; human override and final decision
```

Design rules:

1. **The model talks; the code steers.** The realtime model owns the voice and
   the natural back-and-forth. A controller in code owns the plan: which
   competency is active, how many probes are left, how much time remains. The
   model moves through the plan by calling tools, so coverage and timing are
   guaranteed and logged.
2. **Audio goes through LiveKit, not browser-to-Google.** The agent subscribes
   to the candidate's track on the server. This fixes browser support, echo
   and microphone selection in one move, and lets us record.
3. **Live and scoring are separate systems.** The live agent only gathers
   evidence. Scores come from the recording afterwards and can be re-run when
   the rubric or the model changes.
4. **Voice engine behind an interface.** Gemini Live is the default; a
   cascaded engine can be swapped in for cost, for regions, or if the realtime
   model misbehaves.
5. **Everything is an event with a timestamp.** Turn start/end, interruptions,
   tool calls, plan transitions and client events go to one event log, so true
   response latency, talk ratio and coverage are computed, not guessed.

## 4. Data model (replaces the current three tables)

- `organizations`, `users` — tenancy and recruiter login.
- `roles` — title, JD, competencies.
- `interview_plans` — versioned: sections, core questions, probe policy,
  rubric anchors per competency.
- `interviews` — candidate, role, plan version, status, consent record,
  schedule, retention deadline.
- `interview_events` — append-only log (turns, tool calls, plan transitions,
  interruptions, client events) with millisecond timestamps.
- `recordings` — storage URIs, duration, tracks.
- `transcripts` — post-hoc, word-level, diarised.
- `scorecards` — per competency: score, anchor matched, quotes with
  timestamps, judge agreement; plus human overrides and final decision.

## 5. Phases

| Phase | Outcome | Main work |
| --- | --- | --- |
| 0. Spike (2–3 days) | We know which realtime model and SDK language actually work for us. | Minimal LiveKit Agents worker with Gemini Live in a room; measure reply latency, interruption, transcript quality with Indian-English and technical vocabulary; confirm current model ID, session limits and price from Google's own docs. |
| 1. Voice core | A candidate can hold a natural, interruptible conversation in any modern browser. | Replace `src/agent/*` and the browser speech code with the agent framework; explicit dispatch; session resumption and context compression; reconnect handling. |
| 2. Interview brain | Every interview follows a plan and finishes on time. | Plan generator from JD and resume; controller state machine; tool calls; probe policy; time budgeting; graceful wrap-up. |
| 3. Capture | Every interview is replayable and auditable. | Egress recording to GCS; event log; consent screen and retention; client focus events. |
| 4. Analysis | Recruiters get evidence-backed scorecards. | Post-interview pipeline; rubric scoring with citations; second-judge check; re-score job. |
| 5. Dashboard and access | Recruiters log in, compare candidates and decide. | Auth and organisations; scorecard UI with audio jump links; comparison view; human override. |
| 6. Hardening | Safe to run with real candidates. | Tests (unit, plus scripted simulated-candidate interviews), tracing and latency metrics, autoscaled workers, bias and consistency checks. |

Phase 0 gates everything else. Phases 3 and 5 can run in parallel with 2.

## 6. What is kept and what is dropped

Kept: the Next.js app shell, LiveKit room and token code, candidate email gate,
PDF text extraction, the repository pattern, GCP deployment.

Dropped: browser speech recognition and browser TTS, audio-over-data-channel
and the sentence assembler, the 3 s hold and echo heuristics, room polling,
the single-prompt interviewer, the single-pass report.

## 7. Open questions

Answered ones are recorded in section 9.

1. Interview format: which roles, how long, and is live coding or screen
   share in scope?
2. Voice engine: Gemini Live, cascaded, or both? Does Ominibot have to stay in
   the live loop?
3. Recording scope: audio only, or audio and video? Which integrity signals?
4. Markets: where are candidates and customers? This sets consent,
   retention and audit work.
5. Agent language: Python (mature SDK, second language in the repo) or Node
   (one language, plugin marked experimental)?
6. LiveKit Cloud or self-hosted?
7. Languages other than English?
8. Does the candidate see an avatar, or audio with a simple visual?
9. Is the existing production data worth migrating?

## 8. Sources

Research and repository scan executed by Google Gemini 3.8 Flash worker
subagents (audit log: `.mux/workers/latest_google.json`), with spot checks.

- Gemini Live, first-party: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-live-api
- Gemini Live API guide: https://ai.google.dev/gemini-api/docs/live-api
- Session management: https://ai.google.dev/gemini-api/docs/live-api/session-management
- Ephemeral tokens: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Gemini 3.8 Live (third-party, unverified): https://www.datacamp.com/blog/gemini-3-8-live , https://zentor.ai/blog/gemini-3-8-live-pricing
- LiveKit Gemini plugin: https://docs.livekit.io/agents/models/realtime/plugins/gemini/
- LiveKit turn detection: https://docs.livekit.io/agents/build/turns
- LiveKit recording: https://docs.livekit.io/agents/build/record
- Sackett et al. 2022, Journal of Applied Psychology (structured interview validity)
- EU AI Act: https://artificialintelligenceact.eu/

Not independently verified: Gemini 3.8 Live model IDs and pricing, the latency
and cost ranges quoted for each pipeline type, competitor feature details, and
the EU AI Act enforcement date.

## 9. Decisions

Decided 2026-10-11:

- **Format:** conversational interview only for now. No coding or screen
  share; those come later. Length is not fixed yet; the plan assumes a
  configurable 15–30 minutes (assumption, to confirm).
- **Voice engine:** Gemini Live as the default, behind a swappable interface.
  Ominibot moves out of the live loop to plan generation and scoring.
- **Capture:** record audio and video. Integrity from follow-up probing,
  tab/focus events and second-voice detection. No gaze or emotion scoring.
- **Markets:** India and the United States. Baseline: explicit consent before
  recording, deletion on request, retention deadline per interview, human
  final decision, evidence-linked scores. US-specific items (NYC bias audit
  and notice, Illinois consent wording) are tracked for Phase 6.

- **Model:** `gemini-3.8-live`. Cost is accepted; billing through AI Studio
  or Vertex AI on the existing GCP project.
- **Avatar:** none. Voice only, with a simple visual for the interviewer.
- **Length:** recruiter picks 10–45 minutes per interview; the plan scales
  the number of competencies to the time. Anything over about 15 minutes
  relies on context compression and session resumption, so both are tested
  in Phase 0.
- **Agent language:** Python (LiveKit Agents). It lives in its own directory
  (`agent/`) with its own Dockerfile; the Next.js app stays TypeScript.

Still open: questions 6, 7 and 9 in section 7. Defaults assumed until told
otherwise: LiveKit Cloud, English only, no data migration.

## 10. Phase 0 spike checklist

1. Python LiveKit Agents worker joins a room by explicit dispatch and talks
   through `gemini-3.8-live`.
2. Measure: time from end of candidate speech to first AI audio; interruption
   response; behaviour during a long thinking pause.
3. Run a 45-minute session to prove compression and resumption hold context.
4. Tool calls mid-conversation (`next_question`, `record_observation`) without
   an audible stall.
5. Transcript quality on Indian-English accents and technical vocabulary.
6. Egress recording of audio and video to GCS.
7. Actual billed cost of a 30-minute session against the $0.40 estimate.

Exit: a go/no-go on Gemini Live as the default engine, with numbers.

## 11. Build status (2026-10-11)

Built and verified locally with `agent/scripts/simulate_candidate.py` (real
audio into the room) on in-memory and Postgres storage: plan generation, the
live interview on `gemini-3.8-live`, topic pacing and time-up wrap-up,
candidate-left handling, transcript and event capture, scorecards with
verified quotes and a second grading, recruiter sign-in, dashboard, decision.

Measured:
- Reply delay: about 1.3 s typical (1.2-1.8 s) from the candidate's last word
  to the interviewer's first, measured with the simulated candidate. Gemini
  Live on its own takes 1.0-1.3 s on spoken input, so the pipeline adds little.
  An earlier 2.3-3.1 s figure was wrong: the simulator's audio queue made it
  report the end of speech about a second early. Settings that helped:
  500 ms end-of-turn silence, no model "thinking" before speaking, 20 ms
  input frames, and a spoken acknowledgement before fetching the next topic.
  Ending turns with a local VAD clipped the interviewer and was dropped.
- Token usage reported by the session grows with every turn because the
  context is re-read: a 10.6-minute run reported 318k input tokens. At list
  prices that would be about $0.75 for that run. The account's actual spend
  was $0.54 for roughly 40 minutes of test interviews in total, which fits
  per-minute billing (about $0.80/hour), not per-turn re-billing. To be
  rechecked after billing settles. The live context is capped at about 32k
  tokens either way.

Not verified: the candidate page in a real browser with a microphone,
recording (needs LiveKit Cloud or an egress service), deployment to GCP.
Not built: see "Not built yet" in the README.

## 12. Cost (2026-10-12)

Decided: stay on Gemini Live, with a ceiling of $2.50 per interview hour and no
loss of interview quality.

What was learned: Gemini Live bills every token in the session's remembered
context again on each reply, and it remembers raw audio. About 60 minutes of
short test interviews cost about $2.73 in total. As first built, a 30-minute
interview would have cost roughly $5-9.

Built, not yet run against the API (testing is paused):
- A fresh model session at each topic change (`INTERVIA_TOPIC_RESET`). Earlier
  topics are carried as a few lines of text: the interviewer's own one-line
  summaries plus the last four things said.
- The current topic lives in the standing instructions, so it is never lost
  when old audio is dropped.
- Within a topic, only recent audio is kept (`GEMINI_CONTEXT_TRIGGER_TOKENS`
  9000, `GEMINI_CONTEXT_TARGET_TOKENS` 5000; previously 32000 / 16000).
- Each interview's page shows an estimated voice cost and hourly rate from its
  recorded token usage.

Estimate after these changes: about $2.00 per hour at roughly 120 replies per
hour. It rises with the number of replies, so a very chatty interview could
exceed $2.50. To be confirmed with one short simulated interview.

Transcription: Google's documentation does not state a separate charge for the
live captions, and the recorded usage shows no text output tokens. It stays on;
the transcript is what the scorecard is built from.

If the ceiling cannot be held, the fallback is a cascaded pipeline
(speech-to-text, text model, text-to-speech), estimated at $0.40-0.90 per hour.

## 13. Parked: voice cost (pick up after the dashboard and scoring are done)

Decision on 2026-10-12: the interviewer works well as it is, so cost work
waits until the dashboard, scoring and analysis are finished and tested.

State when parked:
- The approved behaviour is unchanged and is the default: one model session
  per interview, 32k/16k context window.
- The per-topic fresh session and the tighter window are written and
  unit-tested offline, but have never run against the API. They are off by
  default: `INTERVIA_TOPIC_RESET=1`, `GEMINI_CONTEXT_TRIGGER_TOKENS=9000`,
  `GEMINI_CONTEXT_TARGET_TOKENS=5000` switch them on.
- Ceiling agreed: $2.50 per interview hour, with no loss of quality.

Plan when resumed, in order:
1. One short simulated interview with the per-topic session on; read the real
   cost from the interview page's cost line; fix whatever the first run shows.
2. Finer swap: a fresh session every minute or two, opened in the background
   while the interviewer is speaking so no words are lost, carrying the
   transcript as text. Estimated $1.00-1.30 per hour.
3. Carry how the candidate came across as a short text note for the
   interviewer only, plus the measured timing signals. Never into the score.
4. If the ceiling still cannot be held: cascaded pipeline (speech-to-text,
   text model such as Ominibot, text-to-speech), estimated $0.40-0.90 per hour.
5. Voice choice: 13 audition clips are in `voice-samples/`; apply the chosen
   voice with the more conversational speaking style.

## 14. Scoring and dashboard (2026-10-12)

Built; arithmetic tested offline; nothing below has been run against a model
or a real recording yet (API testing is paused).

The overall score, 0-100, is a weighted average of four factors. A factor that
cannot be scored for an interview is left out and the others carry the total.

| Factor | Weight | What it measures | How |
| --- | --- | --- | --- |
| Answer quality | 45 | How well each planned question was answered | Existing 1-5 rubric scores with verified quotes, averaged by plan time |
| Resume match | 20 | Whether the candidate's spoken account backs up the resume | Model lists resume claims and a verdict each; verdicts must cite candidate turns; claims never discussed do not count |
| Own answers | 20 | Signs answers were read out or prompted by an AI tool | Model flags transcript patterns, citing turns; measured timing signals are added in code; starts at 100 and loses points per signal |
| On-camera behaviour | 15 | Looking away, reading, another person, second device | Video model lists moments with timestamps from the candidate-only recording; score computed in code |

Weights are set with `SCORE_WEIGHTS`. All score arithmetic is in
`src/lib/interviews/scoring.ts` (tests: `npm test`). Models supply
observations; every number shown is computed in code.

Recording: the agent now records the candidate only (camera and microphone,
640x360) with LiveKit participant egress. It needs LiveKit Cloud or an egress
service and a Cloud Storage bucket; without them the video factor is left out.
The recording plays in the dashboard through an access-checked route, and
transcript turns and flagged moments seek the player.

Dashboard: interview list shows the overall score with four factor bars; the
interview page shows the overall score, each factor with its evidence, the
recording, a table of candidates for the same role, the decision form and the
transcript. `/dashboard/preview` shows an example with made-up data.

Cautions kept in the design: own-answer and on-camera findings are worded as
things to check, each links to its evidence, and no factor rejects a candidate
automatically. Video analysis describes what is visible only; it does not
judge emotion, appearance or identity. Using gaze in a hiring score carries
legal risk in some places (see section 2); review before production use.

To verify when testing resumes: one interview scored end to end (three extra
model calls), then recording plus video analysis once egress and a bucket
exist.

## 15. Update 2026-10-12 (later): both voice modes, Ominibot analysis, recording

Built and run end to end in short simulated interviews.

Voice modes (chosen per interview on the form; section 13 step 2 is now done):

| Mode | 3-minute test | Notes |
| --- | --- | --- |
| Standard, one session | about $1.81/hour (42.5k input tokens) | rate keeps rising with length |
| Lower cost, renew every 90 s and per topic | about $1.09/hour (29.5k input tokens) | rate stays roughly flat |
| Lower cost, renew every 20 s (test setting) | about $0.96/hour | used to exercise mid-topic renewal |

Reply delay was the same in both modes (median 1.4-1.5 s). A mid-topic
renewal lost no words: the candidate's audio is held while the session is
swapped and then passed on in order. Fixed along the way: a second goodbye
after the time-up goodbye, and a doubled "thanks" at topic changes. The
goodbye fix has not been re-run live (test budget of 5 minutes per mode was
used up).

Still open from section 13: tone note for the interviewer (step 3), cascaded
pipeline (step 4), voice choice (step 5).

Analysis now runs on Ominibot (OpenAI-compatible, model "ominibot"; verified
to accept JSON mode, images and base64 video). Gemini is the fallback.

Recording: the candidate's browser records camera and microphone and uploads
in pieces to the web server's disk. LiveKit egress is not needed locally.

Video analysis follows the product owner's idea: not "looked away", but
"kept returning to the same spot off the screen while answering, and not
while listening". Per-answer gaze observations come from the model; the
pattern and the score are computed in `scoring.ts`.

### Parked: cautions on video analysis (to discuss, not yet acted on)

- Looking away is normal when thinking; the same-spot pattern reduces false
  alarms but does not remove them (notes on a desk, a second monitor used
  legitimately, a habit of looking down). Findings must stay "clips to watch".
- A general video model reading gaze from two frames a second is unproven;
  accuracy needs checking on real interviews, including with glasses, poor
  light and different camera positions.
- Law: using gaze or face analysis in hiring carries legal risk in places
  such as Illinois (AI Video Interview Act, BIPA), New York City (Local Law
  144), and the EU (AI Act treats hiring tools as high-risk and restricts
  emotion inference at work). Review before using on real candidates.
- Fairness: gaze behaviour differs with neurodivergence, disability, culture
  and screen readers. Consider keeping the on-camera result as a separate
  flag (weight 0 via `SCORE_WEIGHTS`) instead of part of the total.
- Consent and retention: candidates consent to recording at the email gate;
  how long recordings are kept and who can see them is not yet defined.
