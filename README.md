# Intervia

AI-powered conversations for better hiring.

A recruiter creates an interview from a job description and a resume. The
candidate opens a link, verifies their email, gives consent, and has a live
spoken interview with an AI interviewer. When it ends, the recruiter gets a
scorecard: a 1–5 score per competency, each backed by the candidate's own
words, plus the full transcript.

This is the v2 rebuild (see `docs/REDESIGN_PLAN.md` for the research and the
decisions behind it).

## How it works

```
Recruiter (signed in)
  └─ POST /api/interviews ─► interview plan generated from JD + resume
                             (competencies, core questions, rating anchors)

Candidate browser ──WebRTC mic + camera──► LiveKit room
                                              │  agent dispatched by the join token
                                              ▼
                              Interviewer agent (agent/, Python)
                                ├─ Gemini Live: hears the audio track, speaks back
                                ├─ Controller: plan, time budget, wrap-up
                                └─ writes turns + events ─► /api/agent/*

Interview ends ─► scorecard: two independent gradings of the transcript,
                  quotes verified against the stored turns
Recruiter ─► /dashboard: scorecard, evidence, transcript, decision
```

Three ideas carry the design:

- **The model talks; the code steers.** Gemini Live owns the voice and the
  natural back-and-forth. The controller (`agent/intervia_agent/controller.py`)
  owns which competency is being discussed and how much time is left. The model
  moves through the plan by calling the `start_next_topic` tool; if a topic or
  the interview overruns, the controller moves it on.
- **Audio goes through LiveKit.** The agent hears the candidate's WebRTC audio
  track on the server. Nothing is recognized or synthesized in the browser, so
  it works in any WebRTC browser with the browser's echo cancellation.
- **Scoring is separate from the interview.** The live agent never sees the
  rating scale. Scores are produced afterwards from the stored transcript and
  can be regenerated.

## Run locally

Requirements: Node 22+, [uv](https://docs.astral.sh/uv/), Docker (for a local
LiveKit server), a Gemini API key.

```bash
cp .env.example .env          # fill in GEMINI_API_KEY, AGENT_API_SECRET, RECRUITER_PASSWORD
npm install

# 1. LiveKit dev server (API key "devkey", secret "secret")
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1

# 2. Web app
npm run dev                   # http://localhost:3000

# 3. Interviewer agent
npm run agent                 # = cd agent && uv run main.py dev
```

Then: sign in at `/login`, create an interview at `/recruiter`, open the
candidate link, and afterwards open `/dashboard`.

Without `DATABASE_URL` everything is kept in the web app's memory (lost on
restart); the agent reads and writes through the web app's API, so no database
is needed to try it.

Checks:

```bash
npm run typecheck && npm run lint && npm run build
npm run agent:test            # controller unit tests
```

### Simulated candidate

`agent/scripts/simulate_candidate.py` joins an interview room and speaks
scripted answers as real audio (macOS `say`), so the whole voice path can be
tested without a browser or a person:

```bash
cd agent
uv run scripts/simulate_candidate.py --interview-id <id> --answers answers.txt --stay
```

It prints the conversation and how long the interviewer took to start each
reply.

## Layout

```
agent/                          # Python interviewer agent (LiveKit Agents + Gemini Live)
  intervia_agent/
    worker.py                   #   job entrypoint, session, capture, shutdown
    controller.py               #   plan state machine and time budgets (pure, tested)
    prompts.py                  #   interviewer instructions
    plan.py                     #   interview context from the web API
    backend.py                  #   buffered writes to /api/agent/*
  scripts/simulate_candidate.py
  tests/
src/
  app/
    recruiter/, dashboard/, login/        # recruiter pages (sign-in required)
    interview/[roomId]/                   # candidate page
    api/interviews/                       # create (recruiter), email gate + join token (candidate)
    api/agent/interviews/[roomId]/        # context, events, complete (agent secret)
    api/dashboard/interviews/             # list, detail + scorecard, regenerate, decision
    api/auth/                             # login, logout
  proxy.ts                                # redirects signed-out visitors to /login
  components/interview/InterviewRoom.tsx  # LiveKit room, captions, tab-focus events
  components/dashboard/                   # list and scorecard views
  lib/interviews/
    plan.service.ts                       # plan generation (Gemini text model)
    scorecard.service.ts                  # grading, evidence verification, integrity signals
    interview.service.ts                  # sessions, outcome, decision
  lib/auth/                               # session cookie, route guards
  lib/ai/structured.ts                    # JSON generation, schema-validated
  server/repositories/                    # Postgres and in-memory stores
```

## Data

`InterviewRepository` (`src/lib/interviews/interview.types.ts`) has a Postgres
and an in-memory implementation. Postgres bootstraps its schema on first use:

- `interviews` — session, plan, outcome (end reason, coverage, model usage), decision
- `interview_turns` — every spoken turn with start/end time, the competency
  under discussion, and for candidate turns the pause before answering
- `interview_events` — append-only log: topic changes, controller directives,
  speech state changes, tab/window focus, disconnects, recording
- `scorecards` — the generated scorecard

## Access

- **Recruiters**: one shared password (`RECRUITER_PASSWORD`) and a signed
  session cookie. `/recruiter`, `/dashboard` and their APIs require it. In
  production, access is refused until the password is set.
- **Candidates**: the link only issues a join token for the invited email
  address, after consent; five wrong attempts lock it for 15 minutes.
- **Agent**: `/api/agent/*` requires `AGENT_API_SECRET`.

## Scoring

The overall score (0-100) is a weighted average of four factors, each shown
with its evidence on the interview page:

- **Answer quality** — 1-5 per planned question against the role's rating
  scale, with verified quotes.
- **Resume match** — whether the candidate's own account backs up the resume.
- **Own answers** — signs that answers were read out or prompted by an AI tool.
- **On-camera behaviour** — moments in the candidate's recording worth watching.

Models supply observations; the numbers are computed in
`src/lib/interviews/scoring.ts` (`npm test`). Weights: `SCORE_WEIGHTS`. A
factor that cannot be scored is left out of the total.

## Recording and on-camera analysis

The candidate's browser records their own camera and microphone and uploads
the file a few seconds at a time (`src/lib/recordings/`); only the candidate
is recorded. Files are kept under `RECORDINGS_DIR` (default `.data/recordings`)
and play back only through the recruiter-only route.

After the interview the recording is cut into short clips (bundled ffmpeg) and
a video model reports, for each answer, where the candidate looked while
listening and while answering. Code then looks for one pattern: returning to
the same spot off the screen answer after answer. A single look away counts
for nothing. Findings are clips to watch, never a verdict. Legal review of
using this in a hiring score is parked: see section 15 of
`docs/REDESIGN_PLAN.md`.

## Voice modes

Chosen per interview on the New interview form:

- **Standard**: one Gemini Live session for the whole interview.
- **Lower cost**: a fresh session at each topic change and every
  `INTERVIA_ROLLING_SECONDS` (default 90), carrying the conversation as text.
  The candidate's audio is held for the fraction of a second the swap takes,
  so no words are lost.

Each interview's dashboard page shows its mode, session count and estimated
voice cost.

## Analysis provider

Plans, scorecards, resume match, own-answer signals and video analysis run on
Ominibot when `OMINIBOT_API_KEY` is set, with Gemini as the fallback
(`ANALYSIS_PROVIDER=gemini` reverses the order).

## Integrity

Measured, not guessed: time spent outside the interview tab, window blurs,
connection drops, and the pause before each answer. The grader may add notes
(for example, an answer that contradicts an earlier one), each tied to
transcript turns. There is no "cheating probability"; voice and facial
expression are not analysed.

## Deployment

v2 runs in the `court-siva-nikhil` project beside the earlier deployment and
shares only the Cloud SQL instance, the LiveKit project and the agent VM:

```bash
scripts/deploy-v2-secrets.sh   # once: intervia-v2-* secrets and database user
scripts/deploy-v2.sh           # build, web, agent (or name the steps to run)
```

- **Web**: Cloud Run service `intervia-v2-web` (`Dockerfile.web`, image
  `meetingbot/web-v2`), database `intervia_v2`. One instance, CPU always on,
  because scoring runs after the agent's request has returned.
- **Agent**: container `intervia-v2-agent` on `meetingbot-agent-vm`
  (`agent/Dockerfile`, image `meetingbot/agent-v2`). It needs outbound UDP for
  WebRTC, so it cannot run on Cloud Run. It needs `LIVEKIT_*`,
  `GEMINI_API_KEY`, `AGENT_API_SECRET` and `INTERVIA_WEB_URL`.
- **Recordings**: a private bucket mounted on the web service at
  `RECORDINGS_DIR`.
- **Rooms**: `MEETINGBOT_ROOM_PREFIX=v2-interview-`. The earlier agent joins
  every `interview-` room in the shared LiveKit project, so v2 rooms must not
  start with that.

## Not built yet / not yet verified

- Video analysis has run end to end on a sample clip, but not yet on a real
  candidate at a laptop; how reliably a model reads gaze direction is unproven.
- Recordings are stored on the web server's disk; production needs shared
  storage (the agent-side egress-to-bucket path exists but is untested).
- Individual recruiter accounts and organisations (one shared password today).
- Re-transcribing the recording for scoring (scorecards use the live transcript).
- Editing the generated plan before sending the link.
- Languages other than English.
- Automated browser tests of the candidate page.
- Further voice cost reduction (cascaded pipeline): section 13 of `docs/REDESIGN_PLAN.md`.
