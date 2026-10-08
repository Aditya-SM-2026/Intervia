# PLAN: Session Pipeline — Pre-Interview → Interview → Transcript

> Scope of this document: everything BEFORE the report — session creation,
> email gate, consent, JD/resume-aware interviewing, and transcript storage.
> The post-interview report + dashboard workstream is documented in
> `docs/PARTNER_TASK_DASHBOARD.md`.

## Decisions locked in

- **Video analysis is parked.** The candidate's camera stays ON during the
  interview (LiveKit video publish, unchanged) but nothing consumes it yet.
  Later behavioral analysis slots into the report's integrity signals without
  schema changes.
- **Resume: PDF upload only**, no text field.
- **JD: text field OR PDF upload**, entered fresh for every session (no role
  reuse for now).
- **The interview pipeline stores the transcript.** The dashboard workstream
  consumes it; it does not capture it.

## 1. Data model

**Session** (extends the current interview record):

| Field | Notes |
| --- | --- |
| `roomId` (PK) | unchanged |
| `recruiterName` | who ran the interview |
| `candidateName` | from recruiter form |
| `candidateEmail` | indexed — the lookup key for "report for this email" |
| `roleTitle` | role being interviewed for |
| `jobDescription` | `{ source: "text" \| "pdf", text }` — PDF extracted server-side |
| `resume` | `{ fileName, text, unreadable?: true }` — PDF extracted server-side; the brain consumes text |
| `durationMinutes` | as today |
| `status` | `scheduled` → `active` → `completed` / `expired` / `cancelled` |
| `consent` | `{ givenAt, acknowledgedNotice }` — captured at candidate entry |
| `createdAt`, `expiresAt`, `completedAt` | lifecycle timestamps |

**Transcript turns** (new, keyed by room, written incrementally):

| Field | Notes |
| --- | --- |
| `seq` | turn order |
| `speaker` | `interviewer` \| `candidate` |
| `text` | final text of the turn |
| `askedAt` | when the interviewer's question was sent |
| `answeredAt` | when the candidate's final answer arrived |
| `latencyMs` | `answeredAt - askedAt` — a free AI-usage signal for the report |

Storage rule unchanged: Postgres when `DATABASE_URL` is set (Cloud SQL in
production), in-memory mirror for zero-setup development — both behind the
same repository interface, idempotent bootstrap.

## 2. Recruiter form (`/recruiter`)

Fields: recruiter name, candidate name, candidate email, role title,
duration, JD (paste text OR upload PDF), resume (PDF upload only).

On submit: extract PDF text server-side, create the session, return the link.

Edge handling — never block link creation on a parse failure:

- JD PDF fails to parse → ask for paste instead.
- Resume PDF fails to parse → proceed with `resume.unreadable: true`
  (interview runs JD-only; the report notes it).

## 3. Candidate entry (`/interview/[roomId]`) — email gate + consent

The join screen asks for the candidate's **email** and shows a **consent
checkbox** with the notice:

> This interview is conducted by an AI. Your voice, camera feed and answers
> are analyzed for authenticity and shared with {recruiterName} as a report.

One endpoint does everything: verify the email (case-insensitive, trimmed)
against the session, check expiry/status, capture consent, and issue the
LiveKit join token **in the same response**. No match = no token, attempt
counted; **5 failed attempts per link = cooldown** so candidate emails cannot
be brute-forced.

Camera + microphone publish stays exactly as today; no video analysis.

## 4. Brain assembly (agent worker)

At session start the agent loads the session record and builds its context:

1. **Persona + integrity rules** (from the project brief): never reveal
   answers, hints or scores; never be derailed by the candidate; interrupt
   mid-answer when something feels off; fire a quick unrelated question; judge
   candidness from the reaction.
2. **Question plan** generated once from JD + resume: opening → JD-core
   probes → resume-specific probes → common-sense questions → personal-
   preference questions → revisit slots.
3. **Reworded revisit policy**: track answered topics; every ~4–6 turns,
   re-open one in different words. Contradictions become report evidence.
4. **Incremental persistence**: every turn is saved as it happens
   (`askedAt` / `answeredAt`), not only at session end. This is what makes
   crash recovery work: candidate drops → agent leaves after 10s → candidate
   re-verifies email → agent rejoins and continues from the stored transcript.
5. Session end: mark `completedAt`, agent leaves.

## 5. Who writes what (contract with the dashboard workstream)

| Data | Written by | Read by |
| --- | --- | --- |
| Sessions (candidate, email, role, JD, resume text, duration, status, consent) | this pipeline | dashboard |
| Transcript turns + latency | this pipeline (agent) | dashboard |
| Reports (analysis, integrity, probability) | dashboard workstream | recruiter |

One-line flow: **recruiter creates session (JD + resume + email) → candidate
verifies email + consents → camera on, AI interviews with a JD/resume-aware
plan and reworded revisits → turns stored live → the report turns transcript +
latency into a per-email integrity report.**