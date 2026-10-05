# Intervia

AI-powered conversations for better hiring.

Intervia is an AI video-interview platform: a recruiter creates a shareable
interview link, the candidate opens it and grants camera + microphone access,
and then talks with Intervia AI in a real-time LiveKit room.

Built in four phases — **all four are complete**: foundation; recruiter link
creation and the candidate join screen; the live LiveKit camera/microphone
room; and the AI agent voice conversation (speech-to-text in the browser, a
LiveKit agent worker, and spoken replies).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS v4 for styling (theme tokens in `src/app/globals.css`)
- Route handlers as the backend (Node.js runtime; secrets stay server-side)
- LiveKit (`livekit-client`, `livekit-server-sdk`, `@livekit/components-react`) for real-time audio/video
- Zod for input validation
- Storage: in-memory repository behind a service interface until a database is configured

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run agent      # AI agent worker (joins interview rooms and talks with candidates)
```

Other commands:

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # production build
```

## Environment variables

Copy `.env.example` to `.env` and fill in values. `.env` is gitignored; nothing
secret is ever exposed to the browser (no `NEXT_PUBLIC_` secrets).

| Variable | Required | Purpose |
| --- | --- | --- |
| `OMINIBOT_API_KEY` | For Ominibot provider | API key for the Ominibot LLM service (server-only) |
| `OMINIBOT_API_BASE_URL` | No (defaults to `https://api.ominibot.com/v1`) | LLM API base URL |
| `OMINIBOT_MODEL` | No (defaults to `ominibot`) | Model used for text generation |
| `OMINIBOT_PROVIDER` | No | `mock` forces the mock provider; `ominibot` forces Ominibot; empty = Ominibot if a key is set, otherwise mock |
| `LIVEKIT_URL` | For the interview room | LiveKit server URL (e.g. `ws://localhost:7880` in dev) |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | For the interview room | LiveKit credentials for server-side token generation |

## Architecture

```
src/
  app/
    page.tsx                # landing page
    recruiter/page.tsx      # create an interview link (Phase 2)
    interview/[roomId]/page.tsx   # candidate join screen with validation (Phase 2)
    api/
      interviews/route.ts         # POST — create an interview room
      interviews/[roomId]/route.ts# GET  — room lookup / access validation
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
    interviews/             # interview.types.ts, interview.validation.ts,
                            # interview.service.ts (create/get/validate room access)
    livekit/
      config.ts             # LiveKit env config (server-only)
      token.ts              # generateLiveKitToken() — short-lived server-side JWTs
      room.ts               # interview room id → LiveKit room name
      client.ts             # shared client/server join contract (no secrets)
    config/env.ts           # Ominibot env config (server-only)
  agent/                   # AI agent worker (separate Node process, Phase 4)
    main.ts                #   worker entry: discovers interview rooms, runs sessions
    room-discovery.ts      #   LiveKit server API polling for active rooms
    interview-agent-session.ts  # one room: greeting, transcript handling, replies
  server/repositories/      # in-memory-interview-repository.ts (HMR-safe singleton)
  types/                    # shared type re-exports
```

Key boundaries:

- **Route handlers / services → `LlmProvider` interface only.** Providers are
  created by `createLlmProvider()` (src/lib/ai/llm-provider.ts); switching
  providers never touches call sites.
- **Storage → `InterviewRepository` interface** (src/lib/interviews/interview.types.ts),
  implemented by the in-memory store (src/server/repositories/). A database can
  replace it without changing routes or services.
- **Secrets** (`OMINIBOT_API_KEY`, LiveKit keys) are read only by
  `server-only` modules (src/lib/config/env.ts, src/lib/livekit/config.ts).
  The client receives tokens and room URLs from the backend, never env values.

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
agent worker ──▶ Ominibot LLM ──▶ reply + status ──data channel──▶
browser (transcript panel + speech synthesis playback)
```

- **Agent worker** (`npm run agent`) is a separate Node process built on
  `@livekit/rtc-node`. It polls the LiveKit server API for active interview
  rooms, joins each as the `ai-interviewer` participant, greets the candidate
  (LLM-generated, with a static fallback), handles candidate transcripts sent
  over the data channel (see `src/lib/ai/agent-protocol.ts`), maintains a
  capped conversation history, and leaves when the room is empty. It shares
  the provider layer with the Next.js server and is launched with the
  `react-server` conditions flag because it imports `server-only` modules.
- **Candidate browser**: speech recognition (Web Speech API — Chrome/Edge),
  recognition paused while the agent is processing or speaking (prevents the
  agent reacting to its own voice), spoken replies via `speechSynthesis` with
  a duration-estimate fallback timer so a hung TTS can never wedge the
  conversation.
- The agent only accepts transcripts from `candidate-*` identities and sends
  replies addressed to those identities; messages are reliable data-channel
  publishes on the `interview-ai` topic.

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
- [x] **Phase 2** — recruiter link + room creation (in-memory storage, join screen)
- [x] **Phase 3** — LiveKit camera/microphone room (tokens, media controls, errors)
- [x] **Phase 4** — AI agent voice conversation (STT/TTS, agent worker, live transcript)

## Current limitations

- Storage is in-memory only: rooms are lost on dev-server restart and are not
  shared across server processes. Swap-ready via `InterviewRepository`.
- Rooms never expire when no duration is set, and `waiting`/`completed`/
  `cancelled` transitions have no UI yet.
- Tokens are valid 120 minutes; a session that outlives the token needs a
  page reload (re-issued token). No mid-session token refresh yet.
- Speech recognition uses the Web Speech API: Chrome/Edge only, `en-US`
  locale, and no barge-in (the candidate cannot interrupt the AI mid-reply).
- One agent worker process per deployment; the worker and dev server are
  separate processes, so both must be running (`npm run dev` + `npm run agent`).
- No recording, scoring, resume parsing or analytics — out of scope for v1.
