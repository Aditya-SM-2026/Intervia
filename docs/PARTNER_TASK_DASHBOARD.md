# TASK BRIEF: Post-Interview Reports Dashboard (Intervia)

> Handoff document for the dashboard workstream. Written to be pasted directly
> into a coding agent. Do not implement the other workstream (recruiter-side
> job descriptions and scheduling) — that is handled separately.

## Why this exists

Intervia is an AI video-interview platform (already live: recruiter creates a
link at `/recruiter`, candidate joins at `/interview/<roomId>`, an AI
interviewer conducts the conversation by voice in a LiveKit room). The next
phase is cheating-resistant interviews: after each interview, recruiters must
see what the candidate answered, how they performed, and **the probability the
candidate was using AI, with evidence**. That report and the dashboard to view
it — that's this task.

## Read first

`README.md` and `AGENTS.md`. Stack: Next.js 16 App Router, React 19,
TypeScript strict, Tailwind v4, route handlers under `src/app/api/**` as the
backend, Zod for validation. Storage goes through the `InterviewRepository`
interface (`src/lib/interviews/interview.types.ts`): **Postgres when
`DATABASE_URL` is set (Cloud SQL in production), in-memory otherwise — every
new persistence must implement both paths**, following the existing
idempotent-bootstrap pattern in
`src/server/repositories/postgres-interview-repository.ts`. LLM calls go
through the existing provider factory (`src/lib/ai/llm-provider.ts`,
`createLlmProvider()`).

**Out of scope — do not touch:** the live voice pipeline's runtime behavior
(`src/agent/*` except the one additive hook below), Dockerfiles, cloudbuild
configs, GCP infrastructure, `.env` secrets. The interview experience during
this work must behave exactly as before.

## Deliverable 1 — Report data model

New domain types under `src/lib/interviews/`: an `InterviewReport` bound to
the room id, containing:

- the raw transcript (`speaker: interviewer | candidate`, text, timestamp),
- an analysis section (per-topic answer summaries, strengths/weaknesses),
- an **integrity block**: AI-usage probability 0–100, level (low/medium/high),
  and a list of typed signals — each with a description, the transcript
  evidence it came from, and a weight. Keep signals an open typed list;
  video/behavioral analysis will be added later as additional signal types.

Schema sketch:

```
report: {
  roomId, generatedAt,
  transcript: Turn[],
  analysis: { ... },
  integrity: {
    probability: number,   // 0-100
    level: "low" | "medium" | "high",
    signals: [{ type, description, evidence, weight }]
  }
}
```

Persist via new repository methods (e.g. `saveReport`/`getReport`), both
implementations. Reports are **never shown to the candidate** — recruiter
only.

## Deliverable 2 — Transcript capture (the one agent change)

The agent worker currently holds the conversation only in memory
(`src/agent/interview-agent-session.ts`). Add one **additive,
end-of-session** hook: when the session ends (`onEnded`), persist the full
transcript against the room. Fire-and-forget with an error log — a
persistence failure must never break or delay the room lifecycle. This is the
only change permitted in `src/agent/`.

## Deliverable 3 — Report generation

After the interview completes, an analysis pass converts the transcript into
the report: call the LLM through `createLlmProvider()` with a prompt that
outputs **schema-validated JSON** (Zod): answer summaries,
strengths/weaknesses, and integrity signals — e.g. templated/identical-
structure phrasing across answers, suspiciously uniform timing, copy-like
prose, contradictions with reworded repeats. Output an overall AI-probability
with the evidence list.

Rules:

- generate **after** the interview only (never during);
- cache the result (generate once on first view or right after session end —
  pick one and document it);
- an interviewer that crashed mid-session still gets a report from whatever
  transcript exists;
- if the transcript is too short/empty, produce a `null` report with a clear
  reason string instead of a hallucinated one.

## Deliverable 4 — Dashboard UI

- `/dashboard` — list of all interviews: title, candidate name, created time,
  status (`scheduled`/`active`/`completed`/`expired`), and an AI-probability
  badge where a report exists. Live interviews show their current state.
- `/dashboard/[roomId]` — full report: transcript thread (interviewer vs
  candidate), analysis sections, integrity panel (probability + evidence),
  and a collapsed raw-JSON toggle for debugging.
- Graceful empty states: interviews created before this feature exist in the
  DB without transcripts — show a clear "no report available" state, never a
  crash.
- Match the visual language of the existing pages (Tailwind tokens in
  `src/app/globals.css`).

## Deliverable 5 — API

- `GET /api/dashboard/interviews` — list with summary fields (paginate if
  trivial).
- `GET /api/dashboard/interviews/[roomId]/report` — `{ report }` or
  `{ report: null, reason }`.
- Optional: `POST .../report/regenerate`.
- Validate room access like the existing routes; never leak secrets.

## Acceptance criteria

1. Run a real local interview (`npm run dev` + `npm run agent`, join in
   Chrome, speak) → transcript persisted → interview appears on `/dashboard`
   → report renders with probability + evidence.
2. Pre-feature interviews render an empty state, not an error.
3. `npm run typecheck` and `npm run lint` pass.
4. Both storage paths verified (once without `DATABASE_URL`, once with Cloud
   SQL Auth Proxy).
5. Voice behavior unchanged: an interview run during this work must be
   identical to before (same voice, same single-agent guarantee).

## Parallel work happening in the same repo

Another developer is extending the recruiter side (job descriptions,
scheduling). Interview records may gain fields (e.g. `jobDescription`,
`scheduledFor`). Read fields defensively and never overwrite unknown fields
on save. Don't build anything recruiter-side and don't block on that work —
the dashboard reads whatever exists.

## Suggested order

data model → transcript capture → report generation → API → dashboard UI →
empty states.