# Testing Log — Intervia (redesign/v2-Aditya)

Findings from the per-task verification runs. Newest last.

## Task 7 — Concurrent interview testing (2026-10-14)

Setup: two interviews driven in parallel through the agent API (different
candidates, roles, job descriptions) against the local dev server
(`tests/concurrent-interviews.test.mts`, 19 checks, all passing).

### Finding 1 — parallel double-submit created two interviews (FIXED)
- **Observed**: firing two identical `POST /api/interviews` requests at the
  same moment returned `201/201` and created **two** rooms. The duplicate
  check ran before the insert, so two concurrent submissions could both pass
  it (classic check-then-act race). Sequential resubmits were already safe
  (409 with the existing room, Task 2).
- **Resolution**: repository gained `insertRoomAtomically(room, duplicateKey)`
  — Postgres wraps the duplicate re-check and the insert in one transaction
  holding `pg_advisory_xact_lock(hashtext(candidate|role|schedule))`, so the
  loser of the race returns the winner's room (`409 DUPLICATE_INTERVIEW`).
  In-memory repo mirrors the check for zero-setup dev. Re-verified: the same
  parallel probe now yields `409/409` and exactly one room.
- **Residual**: the losing request still pays for plan generation before
  hitting the guard. Accepted — the guard runs after generation, which is
  what makes it correct, and the losing submission is rare (double-click is
  also disabled client-side).

### Finding 2 — scorecards need >= 3 candidate answers (BY DESIGN)
- **Observed**: rooms completed with 2 candidate answers correctly refused to
  grade ("The candidate gave 2 answers; at least 3 are needed for a
  scorecard."). The concurrency test now posts 3 answer turns per room so the
  real grader runs.

### Finding 3 — schema migrations need a server restart when cached (RESOLVED)
- **Observed**: after adding the `upload_token`/`upload_used_at` columns, a
  long-lived dev server kept failing with `column "upload_token" does not
  exist` even though `ensureSchema()` runs per call: its schema DDL only
  re-runs when a previous attempt FAILED, so a previously successful
  ensureSchema promise (from before the new `ALTER` lines existed) never
  picks up new columns. The same had already bitten `scheduled_at`.
- **Resolution**: applied the `ALTER`s directly to the DB and restarted the
  dev server. Noted behavior for prod: deploys create a fresh process, so
  `ensureSchema` self-migrates on boot — no action needed there. For local
  sessions: restart `npm run dev` after any new column lands in
  `postgres-interview-repository.ts`.

### Isolation results (all verified)
- Turns: each room holds exactly its own 6 turns, seqs gapless 1..6, zero
  cross-contamination of text in either direction.
- Events: `interview_started` (room-tagged) and `client_tab_hidden` landed
  only in their own rooms' timelines.
- Completion: both rooms completed concurrently with independent outcomes
  (`elapsedSeconds` 600 vs 480 stored per room).
- Scoring: the grader produced separate scorecards — room A graded against
  its own Node/Postgres competencies, room B against its own React/State
  competencies; no rubric or transcript bleed.
- Cleanup: test rooms are deleted from the DB at the start and end of the
  run (emails `*.conc@example.com`).

### Follow-ups (not blockers)
- Duplicate guard key is candidate+role+scheduledAt; two DIFFERENT roles for
  the same candidate at the same moment are (correctly) still allowed.
- `findByUploadToken` scans the room list per request; a token index/lookup
  is worth adding if upload links become high-traffic.