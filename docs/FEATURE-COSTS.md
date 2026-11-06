# Features we can build for free

Everything below needs only our own code, the database we already run, and
services we already pay for (Gemini, Cloud Run, Cloud SQL, Cloud Storage, the
agent VM). No new vendor, no new licence, no per-use bill.

"Free" means no money to an outside company. Each item still costs developer
time — that is the real budget line.

---

## Accounts and access

| Feature | What it means | What it needs |
| --- | --- | --- |
| Separate login for each recruiter | Every person has their own account instead of one shared password | New `users` / `organisations` tables, session carries user + company |
| Company data separation | One company never sees another company's candidates | Company id on every record |
| Roles and permissions | Admin, recruiter, hiring manager, interviewer see and do different things | Role check in `src/lib/auth/guards.ts` |
| Single sign-on | Staff log in with their company Google or Microsoft account | Open-source OIDC/SAML library |

## Interview quality

| Feature | What it means | What it needs |
| --- | --- | --- |
| Follow-up on a thin answer | If an answer is vague, the bot asks one "tell me more" question before moving on, with a cap per topic | One extra tool in `agent/intervia_agent/controller.py` |
| Reusable question and plan library | Save a plan once per job, reuse it for every candidate | New tables; the plan is already stored per interview |
| Plan approval before sending | A manager reviews and approves the questions before the invite goes out | A status on the interview plus a review screen |
| More languages | Interview in Hindi, Telugu, Tamil — prompts change, nothing else | Language field on the interview, language in the prompts |
| Rubric versioning | The exact questions and scoring scale used are stamped on each report | Store the plan version with the scorecard |

## Candidate experience

| Feature | What it means | What it needs |
| --- | --- | --- |
| Mic and camera check before starting | A 60-second test with an example question, so nobody fails at minute one | Browser APIs, one extra screen |
| Audio-only mode | Works on a weak connection by dropping video | A flag on the session, LiveKit already supports it |
| Resume on reconnect | Continue where the interview left off after a dropout | The reconnect path already exists; extend it to the agent |
| Clear progress and timing | The candidate sees how long is left | Already tracked on the agent; surface it in the page |

## Recruiter tools

| Feature | What it means | What it needs |
| --- | --- | --- |
| Manager analytics | Candidates per stage, score spread, which questions separate good from weak, time to fill | SQL over data we already store |
| Compare candidates side by side | View several candidates for one job on one screen | One new page using existing endpoints |
| Notes and tags | Free-text notes and labels on a candidate, searchable | Two columns and a filter |
| Bulk actions | Shortlist, reject or re-invite many candidates at once | Extend the existing bulk-delete route |
| Calendar-free self-scheduling | The candidate picks any free slot inside a window, no calendar integration | Availability stored per company, tokenised reschedule link |
| Report templates per company | Choose which sections appear in the downloaded report | Template option on the existing HTML report |

## Integrity, without new vendors

| Feature | What it means | What it needs |
| --- | --- | --- |
| Duplicate-candidate detection | Same person applying twice for the same job under a different email | Compare stored name/phone/CV text |
| Photo reused across attempts | Flag when the same face appears on two applications | Open-source face embeddings, stored locally |
| Second voice in the room | Flag when more than one speaker is heard on the candidate track | Open-source speaker-count model on the existing VM |
| Virtual camera / screen-share detection | Flag when the camera feed looks synthetic | Browser device checks, no vendor |
| Integrity summary in the report | All signals in one place with the evidence behind each | One report section over the existing events log |

## Platform and operations

| Feature | What it means | What it needs |
| --- | --- | --- |
| Auto-delete old recordings | Keep recordings for N days, then remove them | Cloud Storage lifecycle rule |
| Delete a candidate on request | Remove their interviews, recordings and reports | One admin action plus storage deletes |
| Audit log | Who viewed, changed or downloaded what | Append-only table |
| Public API and webhooks | A customer's own tools can create interviews and receive results | API-key auth plus three endpoints |
| Spending guardrails | Cap voice cost per company, switch to the cheaper voice mode automatically | The cost estimate already exists |
| Delivery retry and health | Automatic retry when an email or upload fails, with a status page | Queue table plus a small page |

---

## Deliberately left out of this list

Anything that needs an outside company to charge us per use or per year:
WhatsApp and SMS messages, phone-call interviews, paid identity verification
with liveness detection, third-party security audits, and app-store accounts.
Those are a separate decision with a separate budget.
