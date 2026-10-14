# HR Dashboard — API Contract

Everything the HR dashboard needs is already served by the recruiter dashboard
APIs documented here. **No new UI is required on the interview side**; Vamshi's
dashboard is a consumer of these endpoints. All examples verified against the
live API (commit `7bdc15b` or later, `redesign/v2-Aditya` branch).

## 1. Authentication

The dashboard APIs accept the same session as the recruiter app.

| Item | Value |
| --- | --- |
| Login | `POST /api/auth/login` — JSON `{ "username": "<login id>", "password": "<password>" }` |
| Session | HTTP-only cookie `intervia_session`, HMAC-signed, **12 h TTL** |
| Env vars | `ADMIN_USERNAME` (login ID, default `admin`), `RECRUITER_PASSWORD` (password), `SESSION_SECRET` (HMAC key) |
| Auth modes | `password` (both vars set — local/staging), `locked` (no password set in prod → login disabled), `open` (dev fallback, no cookie needed) |
| Wrong credentials | `401` with `{ "error": { "message": "Incorrect login ID or password." } }` |
| Rate limit | 8 failed logins per IP → **15-minute lock** (`429`) |
| Logout | `POST /api/auth/logout` (invalidates the cookie) |
| Every dashboard call | Send the cookie; missing/invalid → **`401`** |

Error bodies everywhere follow `{ "error": { "code": "<CODE>", "message": "<human text>" } }`.

## 2. Endpoints

### `GET /api/dashboard/interviews` — list

Query params (all optional):

| Param | Meaning |
| --- | --- |
| `email` | Case-insensitive substring match on the candidate email |
| `status` | One or more of `scheduled,waiting,active,completed,expired,cancelled` (comma-separated), e.g. `status=scheduled,active` |
| `limit` | Page size (default: all) |
| `offset` | Page offset |

Response `200`:

```json
{ "interviews": [ { "room": { ...InterviewRoom summary... }, "scorecard": { ...ScorecardSummary... } | null } ] }
```

`room` summary fields (heavy blobs — plan/JD/resume **text** — and the secret
`uploadToken` are stripped):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque room id (used in links) |
| `title`, `roleTitle` | string | Display name / role |
| `candidateName`, `candidateEmail`, `recruiterName` | string \| null | PII — the dashboard is recruiter-only |
| `status` | `scheduled \| waiting \| active \| completed \| expired \| cancelled` | Display status (raw status may be `waiting` while the UI shows "scheduled" until the candidate opens the link) |
| `createdAt`, `expiresAt` | ISO 8601 UTC | Link validity window |
| `scheduledAt` | ISO 8601 UTC \| null | When the interview is scheduled; `null` = candidate may start any time before `expiresAt` |
| `reminderSentAt` | ISO 8601 UTC \| null | 30-minute reminder email sent at |
| `uploadUsedAt` | ISO 8601 UTC \| null | Set once the candidate uploaded a resume through the one-time link |
| `resume` | `{ fileName }` \| null | **Resume received** marker (fileName only; the extracted text is only in the detail endpoint) |
| `difficulty` | `easy \| medium \| hard \| extra-hard` | |
| `durationMinutes`, `voiceMode` | number, `standard \| rolling` | |
| `consent`, `completedAt`, `outcome`, `decision` | object \| null | `decision` = recruiter's accept/reject record |

`scorecard` summary (null until the scorecard exists):

```json
{ "overallScore": 78.5, "suggestion": "strong_hire", "needsHumanReview": false,
  "overall": { "answers": 80, "resume": 75, "authenticity": 85, "video": 90 } }
```

(`suggestion`: `strong_hire | hire | maybe | no_hire` enum; `overall` factors
are `null` when that factor had no data.)

### `GET /api/dashboard/interviews/[roomId]` — full detail

Response `200`: `{ session, turns, events, scorecard, reason, peers, hasRecording, recordingStartedAt }`

| Field | Notes |
| --- | --- |
| `session` | Full `InterviewRoom` (includes `resume: { fileName, text, unreadable? }` — `resumeReceived` = `resume !== null`; `jobDescription`, full `plan` with competencies) |
| `turns` | Ordered transcript: `{ seq, speaker: interviewer\|candidate, text, startedAt, endedAt, responseLatencyMs, interrupted, phase, competencyId }` |
| `events` | Timeline: `{ seq, type, at, data }` — includes `resume_uploaded`, `interview_started`, `client_tab_hidden`, … |
| `scorecard` | Full scorecard: summary, per-competency `{ name, score 1-5, quotes, secondScore?, judgesAgree? }`, authenticity + integrity signals, per-answer gaze, `gazePattern`, moments |
| `reason` | Free-text explanation when `scorecard` is null (e.g. "The candidate gave 2 answers; at least 4 are needed for a scorecard.") |
| `peers` | Same-role candidates for side-by-side: `{ roomId, candidateName, overall, decision }` |
| `hasRecording`, `recordingStartedAt` | Playback availability (see recording endpoint below) |

### `POST /api/dashboard/interviews/[roomId]/decision`

Body: `{ "decision": "accepted" | "rejected", "note"?: string }` → `200` `{ ok: true }`.
This is how the HR/recruiter verdict is recorded on the room.

### `GET /api/dashboard/interviews/[roomId]/recording`

Candidate interview recording (WebM). Supports **HTTP Range** requests for
seekable playback; returns `404` when no recording exists. Recruiter-only.

### `POST /api/dashboard/interviews/[roomId]/regenerate`

Re-runs scorecard generation. Use sparingly (it re-bills the grader).

### `POST /api/interviews` — create (recruiter, not Vamshi's UI)

Multipart form; see the recruiter form. Returns `{ room, candidateUrl,
uploadUrl, inviteEmail: { status: sent\|failed\|not_configured } }` (`201`) or
`409` with the existing room when an identical schedule already exists.

### Candidate-facing endpoints (for reference, NOT for the dashboard)

- `GET /interview/[roomId]` page + `POST /api/interviews/[roomId]/verify` — email gate issues the LiveKit token.
- `GET /upload/[token]` + `POST /api/upload/[token]` — one-time resume upload (PDF/DOC/DOCX, ≤ 10 MB, expires, single use).

## 3. Status model

```
scheduled ──(candidate opens link)──▶ waiting ──(joins)──▶ active ──(agent ends)──▶ completed
    │                                     │
    └──(link expiresAt passes)──▶ expired └──(candidate leaves pre-start)──▶ cancelled
```

Dashboard groupings: **Upcoming** = `scheduled, waiting`, **Ongoing** =
`active`, **Finished** = `completed, expired, cancelled`.

## 4. Time zones

- Every timestamp is **ISO 8601 UTC**; the dashboard renders it in the
  viewer's locale (`new Date(iso).toLocaleString()`).
- Interview duration is fixed at creation (`durationMinutes`); the agent
  enforces it.
- Emails render their times in `EMAIL_TIMEZONE` (server-side, default IST) —
  irrelevant to the dashboard.

## 5. Integration notes

- **Polling**: the list is cheap; poll every 15–30 s or refetch on focus.
  Live "ongoing" state changes as the agent posts events; there is no
  websocket for the dashboard (yet).
- **Auth in one browser**: the cookie is shared with `/recruiter` and
  `/dashboard` pages of the existing app; a separate origin (Vamshi's app)
  needs either same-site deployment behind the same domain or a token-based
  variant of `requireRecruiter` (ask before building).
- **CORS**: same-origin only. If the dashboard lives on another origin, proxy
  through a backend or extend the proxy config (coordinate first).
- **PII**: candidate name/email/recording are inside the cookie-protected
  surface; do not log them.
- **`uploadToken` is a credential**: never render it; summaries already strip it.

## 6. Quick smoke script

```bash
BASE=http://localhost:3000
curl -c jar -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}'
curl -b jar "$BASE/api/dashboard/interviews?status=scheduled,active&limit=10"
curl -b jar "$BASE/api/dashboard/interviews/<roomId>"
```