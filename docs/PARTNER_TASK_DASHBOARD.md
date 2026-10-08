# TASK BRIEF: Post-Interview Reports Dashboard (Intervia)

> Handoff document for the dashboard workstream. Written to be pasted directly
> into a coding agent. Do not implement the pre-interview pipeline (session
> creation, email gate, resume/JD intake) — that is handled separately and is
> documented in `docs/PRE_INTERVIEW_PLAN.md`.

## Why this exists

Intervia is an AI video-interview platform (already live: recruiter creates a
link at `/recruiter`, candidate joins at `/interview/<roomId>`, an AI
interviewer conducts the conversation by voice in a LiveKit room). The next
phase is cheating-resistant interviews: after each interview, recruiters must
see what the candidate answered, how they performed, and **the probability the
candidate was using AI, with evidence**. That report and the dashboard to view
it — that's this task.

## Read first

`README.md`, `AGENTS.md`, and **`docs/PRE_INTERVIEW_PLAN.md`** (the data this
workstream consumes lives there). Stack: Next.js 16 App Router, React 19,
TypeScript strict, Tailwind v4, route handlers under `src/app/api/**` as the
backend, Zod for validation. Storage goes through the `InterviewRepository`
interface (`src/lib/interviews/interview.types.ts`): **Postgres when
`DATABASE_URL` is set (Cloud SQL in production), in-memory otherwise — every
new persistence must implement both paths**, following the existing
idempotent-bootstrap pattern in
`src/server/repositories/postgres-interview-repository.ts`. LLM calls go
through the existing provider factory (`src/lib/ai/llm-provider.ts`,
`createLlmProvider()`).

**Out of scope — do not touch:** the live interview pipeline's runtime
behavior (`src/agent/*` entirely — transcript capture is owned by that
pipeline now), session creation and the email gate, Dockerfiles, cloudbuild
configs, GCP infrastructure, `.env` secrets. The interview experience during
this work must behave exactly as before.

## The data you consume (written by the interview pipeline — read-only for you)

| Data | Fields |
| --- | --- |
| **Sessions** | `roomId` (PK), `candidateName`, `candidateEmail` (indexed), `recruiterName`, `roleTitle`, `jobDescription.text`, `resume.text` (+ `resume.unreadable`), `durationMinutes`, `status` (`scheduled`/`active`/`completed`/`expired`/`cancelled`), `consent { givenAt }`, `createdAt`, `expiresAt`, `completedAt` |
| **Transcript turns** | `roomId`, `seq` (order), `speaker` (`interviewer`/`candidate`), `text`, `askedAt`, `answeredAt`, `latencyMs` (per-turn — an AI-usage signal) |

You never write these. If a field you need is missing, raise it — do not
start writing session/turn data from the dashboard side.

## Deliverable 1 — Report data model

You own exactly one table: **`reports`** (keyed by `roomId`):

```
report: {
  roomId, generatedAt,
  analysis: {
    topics: [{ topic, summary }],
    strengths: string[], weaknesses: string[],
    jdCoverage: [{ skill, probed: boolean, evidenceTurnSeq }]
  },
  integrity: {
    probability: number,        // 0-100
    level: "low" | "medium" | "high",
    signals: [{ type, description, evidenceTurnSeq[], weight }]
  },
  engineMeta: { model, generatedAt }
}
```

- Signals are an **open typed list** — video/behavioral analysis will be
  added later as additional signal types without a schema change.
- Every signal cites `evidenceTurnSeq` references so each claim is traceable
  to a transcript line.
- Reports are **never shown to the candidate** — recruiter only.

## Deliverable 2 — Report generation

Trigger: session `status = completed`. For MVP, generate **on first dashboard
view and cache**, with a regenerate button; a background pass after
completion can come later — pick one, document it, keep the other easy to add.

LLM input = JD text + resume text + all turns (with latencies), via
`createLlmProvider()`. Output = **Zod-validated JSON**:

- Analysis: per-topic answer summaries, strengths/weaknesses, JD coverage
  (which required skills were probed vs skipped).
- Integrity signals, each with transcript evidence:
  - instant, polished answers on hard questions (latency evidence),
  - templated / identical-structure phrasing across answers,
  - contradictions with the interviewer's reworded revisits,
  - refusal-to-elaborate when asked to go deeper,
  - resume-vs-answer mismatch.

Guard rails:

- fewer than ~5 candidate turns → `{ report: null, reason }` (e.g.
  "insufficient interview content") — never a hallucinated report;
- no consent recorded on the session → note it in the report;
- `resume.unreadable` → noted; assess JD-only and say so;
- generate **after** the interview only (never during); a crashed interview
  still gets a report from whatever turns exist.

## Deliverable 3 — Dashboard UI

- `/dashboard` — sessions list: candidate name, **email search/filter**,
  role title, recruiter, duration, status, created time, and an
  AI-probability badge (or "pending"). Live sessions show their current
  state.
- `/dashboard/[roomId]` — full report: transcript thread (interviewer vs
  candidate, turn numbers), analysis sections, JD-coverage summary,
  integrity panel (probability + signals linking back to turn seqs), and a
  collapsed raw-JSON toggle for debugging.
- Empty states: `scheduled`/`active` → live state; zero turns → "candidate
  never joined / never verified"; short interviews → the insufficient-content
  reason. Never a crash.
- Match the visual language of the existing pages (Tailwind tokens in
  `src/app/globals.css`).

## Deliverable 4 — API

- `GET /api/dashboard/interviews` — list with summary fields (paginate if
  trivial; support the email filter).
- `GET /api/dashboard/interviews/[roomId]/report` — `{ session, turns,
  report | null, reason }`.
- Optional: `POST .../report/regenerate`.
- Validate access like the existing routes; never leak secrets.

## Acceptance criteria

1. Run a real local interview (`npm run dev` + `npm run agent`, join in
   Chrome, speak) → the pipeline persists the transcript → the interview
   appears on `/dashboard` → the report renders with probability + evidence
   linked to turns.
2. Pre-feature sessions (no turns) render an empty state, not an error.
3. `npm run typecheck` and `npm run lint` pass.
4. Both storage paths verified (once without `DATABASE_URL`, once with Cloud
   SQL Auth Proxy).
5. Interview behavior unchanged: an interview run during this work must be
   identical to before (same voice, same single-agent guarantee).

## Parallel work happening in the same repo

The pre-interview pipeline (see `docs/PRE_INTERVIEW_PLAN.md`) adds the
session fields and transcript turns described above and owns all writes to
them. Build defensively: read fields that may be absent on older sessions,
never overwrite session/turn data from the dashboard side, and don't block on
that work — the dashboard reads whatever exists.

## Suggested order

reports data model → report generation → API → dashboard UI → empty states.