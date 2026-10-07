# Intervia

AI-powered conversations for better hiring.

Intervia is an AI video-interview platform: a recruiter creates a shareable
interview link, the candidate opens it and grants camera + microphone access,
and then talks with Intervia AI in a real-time LiveKit room.

Built in four phases — **all four are complete and deployed to GCP**: foundation;
recruiter link creation and the candidate join screen; the live LiveKit
camera/microphone room; and the AI agent voice conversation. On top of the
base product there are three switchable voice pipelines (below) and a
production deployment (Cloud Run web, Cloud SQL Postgres, and the AI agent
worker on a Compute Engine VM).

## Voice pipelines

The candidate-facing voice is one env switch (`NEXT_PUBLIC_VOICE_PROVIDER`),
no code changes:

| Provider | Candidate hears | How |
| --- | --- | --- |
| `agent` (default) | Browser's built-in speech synthesis | Agent replies as text over the data channel; the browser speaks them |
| `cascade` (production) | Google Cloud TTS (Chirp 3 HD) | The agent worker synthesizes each sentence of its Ominibot-written reply and streams MP3 chunks over the data channel (`ai-audio-chunk` / `ai-audio-end`); the browser only decodes and plays, never speaking itself (`ai-message` carries `spoken: true` so the two voices can never overlap) |
| `gemini-live` | Gemini Live native audio | The browser streams the microphone straight to the Gemini Live API with a server-minted ephemeral token (`/api/ai/live-token`); try it at `/lab` |

All three share the same conversation flow: browser speech recognition →
transcript on the LiveKit data channel → agent worker → reply voice.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS v4 for styling (theme tokens in `src/app/globals.css`)
- Route handlers as the backend (Node.js runtime; secrets stay server-side)
- LiveKit (`livekit-client`, `livekit-server-sdk`, `@livekit/components-react`) for real-time audio/video
- Zod for input validation
- Storage: Postgres (Cloud SQL in production) when `DATABASE_URL` is set, in-memory otherwise — both behind the same `InterviewRepository` interface
- Speech: Web Speech API (recognition), Cloud TTS (`@google-cloud/text-to-speech`), Gemini Live (`@google/genai`)

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run agent      # AI agent worker (joins interview rooms and talks with candidates)
```

With `DATABASE_URL` pointed at Cloud SQL, local testing also needs
[Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy)
(listening on `127.0.0.1:5432`) so the dev server and the worker can reach the
database. Without `DATABASE_URL` everything runs in-memory with zero setup.
`/lab` is the Gemini Live playground (needs `GEMINI_API_KEY`).

Other commands:

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build
```

## Environment variables

Copy `.env.example` to `.env` and fill in values. `.env` is gitignored; nothing
secret is ever exposed to the browser (the only `NEXT_PUBLIC_` variable is the
non-secret voice-provider switch).

| Variable | Required | Purpose |
| --- | --- | --- |
| `OMINIBOT_API_KEY` | For Ominibot provider | API key for the Ominibot LLM service (server-only) |
| `OMINIBOT_API_BASE_URL` | No (defaults to `https://api.ominibot.com/v1`) | LLM API base URL |
| `OMINIBOT_MODEL` | No (defaults to `ominibot`) | Model used for text generation |
| `OMINIBOT_PROVIDER` | No | `mock` forces the mock provider; `ominibot` forces Ominibot; empty = Ominibot if a key is set, otherwise mock |
| `LIVEKIT_URL` | For the interview room | LiveKit server URL (e.g. `ws://localhost:7880` in dev) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | For the interview room | LiveKit credentials for server-side token generation |
| `DATABASE_URL` | No | Postgres connection string; when set, interview rooms persist in Postgres (Cloud SQL in production) and the agent worker takes exclusive claims through it. Without it: in-memory |
| `NEXT_PUBLIC_VOICE_PROVIDER` | No (`agent`) | `agent`, `cascade`, or `gemini-live` — see Voice pipelines |
| `AGENT_TTS_PROVIDER` | No | `cloud` makes the agent worker speak replies through Google Cloud TTS and stream the audio to the room (cascade pipeline) |
| `CLOUD_TTS_VOICE` | No (`en-US-Chirp3-HD-Charon`) | Cloud TTS voice name (30 Chirp 3 HD voices available) |
| `AGENT_ENABLED` | No | `false` keeps the worker process alive (health endpoint) but never joins rooms — used when Gemini Live replaces the room agent |
| `GEMINI_API_KEY` | For gemini-live | Google AI Studio key, used server-side only to mint short-lived ephemeral Live tokens |
| `GEMINI_BACKEND` | No (`studio`) | `studio` (AI Studio key) or `vertex` (Google Cloud Vertex AI) |
| `GEMINI_LIVE_MODEL` | No (`gemini-2.5-flash-native-audio-latest`) | Live model used by the `/lab` pipeline |

## Architecture

```
src/
  app/
    page.tsx                # landing page
    recruiter/page.tsx      # create an interview link (Phase 2)
    interview/[roomId]/page.tsx   # candidate join screen with validation (Phase 2)
    lab/page.tsx            # Gemini Live playground (voice-pipeline A/B)
    api/
      interviews/route.ts         # POST — create an interview room
      interviews/[roomId]/route.ts# GET  — room lookup / access validation
      livekit/token/route.ts      # POST — candidate join credentials
      ai/live-token/route.ts      # POST — ephemeral Gemini Live token (lab)
  components/
    recruiter/              # CreateInterviewPanel, CreateInterviewForm, InterviewLinkResult
    interview/              # InterviewRoom, JoinInterviewForm, CandidateVideo,
                            # MediaControls, ConnectionStatus, AiStatus, JoinError
  lib/
    ai/                     # LLM provider layer
      ai.types.ts           #   AiMessage, ProviderResponse, LlmProvider interface
      llm-provider.ts       #   createLlmProvider() — single factory
      llm-error.ts          #   LlmError with safe (non-secret) messages
      ominibot-provider.ts  #   Ominibot adapter (OpenAI-compatible Chat Completions)
      mock-provider.ts      #   deterministic mock for local development
      agent-protocol.ts     #   data-channel message contract (ai-message with
                            #   spoken flag, ai-status, ai-audio-chunk, ai-audio-end)
    ai-live/                # Gemini Live: interviewer persona + connect constraints
    interviews/             # interview.types.ts, interview.validation.ts,
                            # interview.service.ts (create/get/validate room access)
    livekit/
      config.ts             # LiveKit env config (server-only)
      token.ts              # generateLiveKitToken() — short-lived server-side JWTs
      room.ts               # interview room id → LiveKit room name
      client.ts             # shared client/server join contract (no secrets)
    speech/                 # browser-edge voice:
      browser-speech.ts     #   Web Speech API recognition (Chrome/Edge)
      browser-tts.ts        #   speechSynthesis playback (agent pipeline)
      agent-audio-player.ts #   Web Audio playback of streamed cascade chunks
      gemini-live.ts        #   Gemini Live browser client (lab)
    config/env.ts           # Ominibot + Gemini Live env config (server-only)
  agent/                   # AI agent worker (separate Node process, Phase 4)
    main.ts                #   worker entry: discovery, claims, sessions, health endpoint
    room-discovery.ts      #   LiveKit server API polling for active rooms
    interview-agent-session.ts  # one room: greeting, transcript handling, replies
    tts.ts                 #   Cloud TTS engine: sentence splitting + synthesis (cascade)
  server/repositories/      # index.ts (DATABASE_URL selector),
                            # postgres-interview-repository.ts (Cloud SQL),
                            # in-memory-interview-repository.ts (zero-setup dev)
  types/                    # shared type re-exports
```

Key boundaries:

- **Route handlers / services → `LlmProvider` interface only.** Providers are
  created by `createLlmProvider()` (src/lib/ai/llm-provider.ts); switching
  providers never touches call sites.
- **Storage → `InterviewRepository` interface** (src/lib/interviews/interview.types.ts),
  implemented by the Postgres store (Cloud SQL) and the in-memory store, with
  exclusive agent claims (`claimForAgent`/`releaseAgentClaim`) so two workers
  (deployed VM + a local dev worker polling the same database) can never both
  join one interview.
- **Secrets** (`OMINIBOT_API_KEY`, LiveKit keys, `GEMINI_API_KEY`,
  `DATABASE_URL`) are read only by `server-only` modules (src/lib/config/env.ts,
  src/lib/livekit/config.ts). The client receives tokens and room URLs from
  the backend, never env values — even Gemini Live gets an ephemeral token,
  not the API key.

## Interview API (Phase 2)

- `POST /api/interviews` — body `{ title, candidateName?, durationMinutes? }`
  → `201 { room, candidateUrl }`. Room ID is a 22-character URL-safe random
  value generated with `node:crypto`.
- `GET /api/interviews/:roomId` — returns `{ room }` or an error body
  `{ error: { code, message } }`: `400 INVALID_INPUT` (bad ID format),
  `404 ROOM_NOT_FOUND`, `410 ROOM_EXPIRED`, `409 ROOM_UNAVAILABLE`.
- Rooms are created `scheduled`; if a duration is set, the link expires after
  it (expiry applied lazily on read). Issuing join credentials marks the room
  `active`. Statuses: scheduled, waiting, active, completed, expired,
  cancelled (`waiting`, `completed`, `cancelled` have no transitions yet).

## LiveKit room (Phase 3)

- `POST /api/livekit/token` — body `{ roomId }` → `{ token, url, identity }`.
  Validates room access, generates the participant identity server-side
  (client values are never trusted for identity), issues a short-lived
  (120 min) join token, and marks the room `active`.
- The candidate flow: grant camera + microphone → local preview →
  `Join interview` → connects to the LiveKit room and publishes both tracks.
- The candidate video is rendered client-side from the acquired tracks; mute,
  camera on/off and leave are handled in the browser with clear error states
  for permission denial, missing devices, token failure and disconnection.
- `AiStatus` shows the live conversation state: connecting, listening,
  processing, speaking, error, disconnected.

## AI voice conversation (Phase 4)

Because the LLM API returns **text only**, speech lives at the edges:

```
browser mic ──Web Speech API STT──▶ transcript ──LiveKit data channel──▶
agent worker ──▶ Ominibot LLM ──▶ reply ──voice pipeline──▶ candidate
```

- **Agent worker** (`npm run agent`) is a separate Node process built on
  `@livekit/rtc-node`. It polls the LiveKit server API for active interview
  rooms, takes an exclusive claim on each interview before joining (so two
  workers never double-join; claims expire after 120s and renew every 45s so a
  crashed worker's room is recoverable), joins as the `ai-interviewer`
  participant, greets the candidate (LLM-generated, with a static fallback),
  handles candidate transcripts sent over the data channel (see
  `src/lib/ai/agent-protocol.ts`), maintains a capped conversation history,
  and leaves when the room is empty. It shares the provider layer with the
  Next.js server and is launched with the `react-server` conditions flag
  because it imports `server-only` modules.
- **Cascade pipeline** (`AGENT_TTS_PROVIDER=cloud`): the worker splits its
  reply into sentences, synthesizes each with Cloud TTS (MP3, 24kHz), and
  streams ≤12KB base64 chunks on the data channel terminated by `ai-audio-end`.
  The browser decodes and schedules them back-to-back with the Web Audio API
  (`src/lib/speech/agent-audio-player.ts`) — speech starts before later
  sentences finish synthesizing. If the worker can't speak, the browser voice
  takes over deterministically (never both).
- **Candidate browser**: speech recognition (Web Speech API — Chrome/Edge;
  it uses the OS **default** microphone, so a silent default input device
  means the interviewer will never hear the candidate), recognition paused
  while the agent is processing or speaking (prevents the agent reacting to
  its own voice), transcript panel + provider-specific playback.
- The agent only accepts transcripts from `candidate-*` identities and sends
  replies addressed to those identities; messages are reliable data-channel
  publishes on the `interview-ai` topic.

## Deployment (GCP)

Production runs in project `court-siva-nikhil` (asia-south1):

- **`meetingbot-web`** — Cloud Run (standalone Next build, `Dockerfile.web`
  built by `cloudbuild-web.yaml`; `NEXT_PUBLIC_VOICE_PROVIDER` is a build
  arg baked into the client bundle). Runtime secrets are injected from
  Secret Manager.
- **`meetingbot-db`** — Cloud SQL Postgres 16 (public IP, `requireSsl=false`,
  allowlisted to the agent VM's static address only; Cloud Run reaches it via
  the socket path).
- **`meetingbot-agent-vm`** — Compute Engine VM (e2-small, COS) running the
  agent container from Artifact Registry
  (`asia-south1-docker.pkg.dev/court-siva-nikhil/meetingbot/agent:latest`,
  built by `cloudbuild-agent.yaml`). A metadata startup-script fetches the
  five secrets from Secret Manager, rewrites the socket-form database URL to
  the allowlisted TCP address, and starts the container with
  `--restart=always` plus the cascade TTS env. The VM has a **static external
  IP** (34.14.222.222) because the database allowlist depends on it.
- **Secrets** (Secret Manager): `meetingbot-ominibot-api-key`,
  `meetingbot-livekit-url/-api-key/-api-secret`, `meetingbot-database-url`,
  all granted to the `meetingbot-runtime` service account.

The VM is why the agent is not on Cloud Run: Cloud Run sandboxes have no
outbound UDP, which WebRTC requires. Rebuilding either image is one command:
`gcloud builds submit --config cloudbuild-agent.yaml` (then restart the VM
container) or `gcloud builds submit --config cloudbuild-web.yaml` (then
`gcloud run deploy`).

## Ominibot integration status

Verified with a real key:

- OpenAI-compatible Chat Completions at `https://api.ominibot.com/v1`, Bearer
  auth (`omk_` key); unauthenticated requests return `401`.
- The model ID is `ominibot` (no org prefix needed).
- The API returns **text only** — `/audio/speech` and `/audio/transcriptions`
  return 404 — hence the browser-edge speech pipeline above.
- It is a reasoning model: `choices[0].message.content` can be `null` if
  `max_tokens` is set too low (reasoning consumes the budget); the provider
  therefore does not set `max_tokens`.

## Phase status

- [x] **Phase 1** — foundation: scaffold, env validation, types, provider layer, docs
- [x] **Phase 2** — recruiter link + room creation (join screen)
- [x] **Phase 3** — LiveKit camera/microphone room (tokens, media controls, errors)
- [x] **Phase 4** — AI agent voice conversation (STT/TTS, agent worker, live transcript)
- [x] **Deployed** — Cloud Run web, Cloud SQL storage, agent VM with cascade voice
- [x] **Voice pipelines** — agent / cascade / gemini-live behind one env switch

## Current limitations

- Rooms without a duration never expire, and `waiting`/`completed`/
  `cancelled` transitions have no UI yet.
- Tokens are valid 120 minutes; a session that outlives the token needs a
  page reload (re-issued token). No mid-session token refresh yet.
- Speech recognition uses the Web Speech API: Chrome/Edge only, `en-US`
  locale, no barge-in (the candidate cannot interrupt the AI mid-reply), and
  it always captures the OS **default microphone** — a silent default input
  device is indistinguishable from a quiet candidate.
- The first interviewer reply after a candidate joins takes ~10–20s (the
  worker discovers rooms on a 4-second poll); subsequent replies are ~2–4s.
- No video intelligence, recording, scoring, resume parsing or analytics —
  post-interview behavioral reports (via LiveKit Egress + a vision pass) are
  the planned next step.
