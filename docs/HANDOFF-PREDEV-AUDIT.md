# Handoff: predev audit, fixes and end-to-end testing (Nov 15, 2026)

Branch `predev`. Every change below is pushed. A push deploys web, video worker and agent to predev through `.github/workflows/deploy-predev.yml` (about 4 to 5 minutes).

The older handoff, `docs/HANDOFF.md` (Nov 8), covers scoring, the video analyser and the report redesign. This document picks up after it.

---

## 1. Where things stand

| Area | State |
|---|---|
| Non-voice features (security, team, roles, applications, screening, invitations, interviews, reports, settings, pages) | Tested end to end on predev. 112 of 113 checks pass. The one failure is the Settings voice sample, which needs Gemini credits. |
| Email delivery | Confirmed by the owner: invitation, HR invitation, change notice and reminder all reached a real Gmail inbox. |
| Video analysis | Tested on 6 real candidate recordings on predev. 4 bugs found, fixed and confirmed live. |
| Voice interviewer (Gemini Live) | Tested over 5 rounds of 5 simulated candidates. Most fixes are confirmed. The last 2 fixes (commit `34eae49`) are deployed but not yet confirmed in a live run, because the Gemini credits ran out. |
| Whole audit | About 97% complete. |

### Only two things are open, and both wait on the owner

1. **Gemini credits are depleted.** Since 2026-11-15 19:51 UTC, every Gemini Live session fails with `1011 ... prepayment credits are depleted`. The same key (`meetingbot-gemini-api-key`) is also used by the old deployment (`meetingbot-web` plus the VM `meetingbot-agent-vm`), so its interviews fail too. The owner must top up in AI Studio. After that, run one confirmation round (section 6), which costs about $0.40 of Live credit.
2. **Decision needed: the failed-start fix (not built).** When the AI cannot connect, the interview is still marked `completed` with reason `session_closed` and 0 answers. The candidate sees "Your interview is complete", and their one-time link is used up. The proposed fix: treat a session that dies before the interviewer speaks as a failed start. Keep the interview usable and show "We couldn't start your interview, please try again". Build it only after the owner says yes.

---

## 2. Rules from the owner (keep these)

- **Branches and deployments:**
  - Work only in **predev** (branch `predev`).
  - Do not touch **dev** (branch `dev`, Cloud Run `meetingbot-web`) until the owner says so.
  - The old deployment must stay untouched.
- **Infrastructure:** don't add infrastructure or raise costs without asking.
- **Voice:**
  - Stay on **Gemini 3.8 Live**. Never use 2.5 Flash.
  - Voice-cost changes are parked for the owner.
- **Test data:**
  - Test interviews run about 5 minutes. That's the shortest that still gives at least 3 answers, the minimum for a report.
  - Dummy candidates use **`example.com`** emails and names starting with **`AUDIT`**.
  - Delete all dummy data after testing.
- **Copy:**
  - No em or en dashes as punctuation in product copy.
  - No subtitles under headings. Put explanations in an **(i)** tip (`src/components/ui/InfoTip.tsx`).
- **Recordkeeping:**
  - Every new API route must call `logActivity()`.
  - The creator of anything is the signed-in actor (`getActor()`).
- **Communication:** explain results at the output level first ("with this, you can now…"). Go into files and lines only when asked.

---

## 3. Predev environment (GCP project `siva-nikhil`, region `asia-south1`)

| Piece | Name |
|---|---|
| Web (Next.js) | Cloud Run service `intervia-predev-web`, URL `https://intervia-predev-web-199504026920.asia-south1.run.app` |
| Interviewer | One Cloud Run **job** per interview: `intervia-predev-agent`. The web app starts it at the candidate's email gate. There is no backup VM (`meetingbot-agent-predev-2` was deleted). |
| Video worker | Cloud Run service `intervia-predev-video-worker` (Python, max 4 instances, concurrency 1, 1800 s timeout). It analyses video and builds the mixed recording. |
| Video queue | Cloud Tasks `intervia-predev-video-analysis`. **Now:** at most 4 at once, 10 attempts, 60 to 600 s backoff. It must match the worker's max instances. |
| Web job queue | Cloud Tasks `intervia-predev-jobs` (screening, scoring, mixing, uploads, file cleanup). |
| Clock | Cloud Scheduler `intervia-predev-sweep`, every minute, calls `POST /api/cron/sweep`. |
| Recordings | GCS `siva-nikhil-intervia-predev-recordings`. |
| LLM for text (plans, screening, reports, Ask AI, video vision) | **Ominibot**, with Gemini as the fallback. These keep working without Gemini credit. |
| Voice | Gemini Live (`gemini-3.8-live`) through LiveKit Cloud. The Settings voice sample uses Gemini TTS. |
| Secrets | `predev-recruiter-password` (admin login, user `admin`), `meetingbot-gemini-api-key`. |
| Data | Predev holds a copy of production candidate data. Treat it as private. |

---

## 4. What was done, in order

### 4.1 Infrastructure (before this session's audit)
- `83348a5`, `7badc68`, `aa09253`: one Cloud Run job per interview. The backup VM was removed.
- `6b4b2af`, `e7fa9c1`: background work runs through the job queue and the every-minute sweep.
- `689c393`: video mixing moved to the video worker (`worker/mix.py`, `/api/internal/mix-result`). One shared DB pool, `src/server/db/pool.ts`, with `DB_POOL_MAX` defaulting to 3.

### 4.2 Security and function audit
- **`34ca032`:** removed the public `GET /api/interviews/[roomId]`, which leaked the email, plan, resume and HR token.
- **`a710f3b`, the security and function gaps:**
  - Security headers in `next.config.ts`.
  - A PDF content check (`resumeBytesMatch`).
  - Consent is required on the server (`consent_at`).
  - Files are deleted with their interview, plus an hourly `file-cleanup`.
  - A closed role closes its form and stops auto-invite.
  - "Too short for a report" replaces an endless wait.
  - The sweep respects `screening_enabled`.
  - The agent token gets `can_update_own_metadata`.
  - Hydration error #418 in TopNav is fixed.
- **`17e72c0`, the UI gaps:**
  - apply form, phone cards
  - `HeaderSearch`
  - rebuilt `CandidateDetailView`
  - `StatusScreen` for every status page
  - report tabs, settings InfoTips
- **`9c86476`, team accounts:**
  - The owner is the env admin. Members are managed in Settings > Team.
  - Sessions are stored in the DB (`app_sessions`).
  - Login lockout uses the `login_attempts` table.
  - `logActivity()` runs in every route, and Activity is an admin-only page.
- Audit report artifact: https://claude.ai/artifact/WBe4rSzYsgVqoAXSdu66AP

### 4.3 Voice interviewer evaluation and fixes

The evaluation used simulated candidates in 5 personas (strong, vague, evasive, injection, thinker) running as Cloud Run jobs, plus one real browser run.

| Commit | Fix |
|---|---|
| `8c4f139` | No re-greeting or repeated question after the ~90 s rolling session swap (`continuation_note()`). Ban on praise words. "Any questions?" fires at 80 s left (`QUESTIONS_INVITE_SECONDS`). The opening asks for an introduction. `spoken_name()` says "Shambhavi", not "SHAMBHAVI SINGH". The report verdict follows the final score (`suggestionFor`). |
| `b9d4c3a` | After a topic change, the new session is told the last answer is finished (`continuation_note(..., answered=True)`), so it asks the new question instead of stalling. A second `start_next_topic` call is refused until the new step is answered (`step_unanswered()`, 25 s grace). Stricter no-praise wording. |
| `174e3b0` | Model markers like `<no speech>{pause}` are stripped from the candidate's captions (`transcription_node`) and from the saved transcript (`strip_model_markers`). |
| `5066861` | Reports, video analysis and Ask AI refer to the candidate by name or "they", never "he" or "she". Confirmed live. |
| `34eae49` | No dead air after the candidate says they have no questions. The first words after a topic change are the question, with no doubled "Got it". **Not yet confirmed live (credits).** |

The interviewer code is in `agent/intervia_agent/` (`worker.py`, `controller.py`, `prompts.py`). Tests live in `agent/tests/`; run them with `PYTHONPATH=. uv run pytest -q` from `agent/`. There are 51 tests.

**Results by round, after the fixes (5-minute interviews):**

| Persona | Score | Verdict |
|---|---|---|
| strong | 76 to 79 | positive |
| vague | 8 to 20 | weak |
| evasive | 36 to 37 | weak |
| injection | 29 to 56 | weak or mixed |
| thinker | 29 to 38 | weak |

- Simulated answers are AI-written, so they get the "read out" penalty (`ORIGINALITY_FACTOR` likely_read = 0.5). The report shows that as "Sounds read out".
- **Behaviour that held across rounds:**
  - refuses to give the rubric or a score
  - steers away from cricket
  - won't end early
  - keeps pressing vague answers
- **Known minor issue:** "That makes sense" still slips through sometimes, despite the ban.
- **By design, not a bug:** the final goodbye can cut off the interviewer's own sentence ("I'm sorry to stop you there").

**Gemini Live cost of all this testing** (summed from recorded token usage at list prices): **$1.75** over 28 interviews. Unrecorded early runs add at most $0.95.

### 4.4 Non-voice end-to-end pass, with fixes

| Commit | Fix |
|---|---|
| `4323a8e` | **Settings:** long explanations moved into (i) tips (the main page went from 219 to 91 words). The web copy of the interviewer's built-in **Conduct** text was stale, so "Load the built-in text" and Save would have undone newer rules. It's now synced, and `src/lib/agent/personality.types.test.ts` fails if `DEFAULT_PERSONA`, `DEFAULT_CONDUCT` or `DEFAULT_STYLES` drift from `agent/intervia_agent/prompts.py`. **When you change `prompts.py`, update `src/lib/agent/personality.types.ts` too.** |
| `235491e` | The Team page threw React error #418 because dates rendered differently in the server and browser time zones (`suppressHydrationWarning` on the dates). |
| `19475c4` | (i) tips would not open on click or tap: focus opened them and the click toggled them shut. |
| `3f339a1` | Editing an interview recreated a role under its old name after the role was renamed. Now `ensureRoleForTitle` runs on edit only when the role name changed. |

### 4.5 Video analysis on real recordings, with fixes

| Commit | Fix |
|---|---|
| `2967254` | Jobs got lost under load. The queue sent 20 at once to a worker with 4 instances, retried 3 times in under a second, and dropped the job, so the report said "Video analysis is running" forever. The queue settings are now matched (see section 3; also recorded in `worker/README.md`). The sweep re-sends any analysis stuck on `queued` for over 45 minutes, for up to 6 hours (`listStuckVideoAnalyses`, `requestVideoAnalysis(id, { retryStuck: true })`). Confirmed: the sweep re-sent a stuck job at 23:06 and it finished. |
| `7ec539e` | Analysis read the **mixed** playback recording, which includes the interviewer's voice. That skewed lip sync, words per answer and the same-voice check. One real candidate's lip-sync flag disappeared (score 76 went to 100). Analysis now reads the candidate's own recording (`storedRecordingForAnalysis` in `src/lib/interviews/recording-refs.ts`, with tests). Confirmed: the flag came back at 76. |
| `40367ca` | After a rejoin, analysis read the **last** recording, a 41-second clip, measured 0 answers and called it clean. It now reads the **longest** candidate recording, by `recording_finished` bytes, and an unmeasured video says "Only X of Y answers could be measured on camera, too few to judge". Confirmed: that interview went from "0 answers, nothing stood out" to 12 of 17 answers measured, score 76, "Eyes held on one spot to the right of the screen in 5 of 12 answers". |

Four other real recordings gave identical results on re-run, so the analyser is consistent.

Predev's reports for these 6 real interviews now hold the re-run video results. The interview IDs are `flAkDb10xfgFa9cCdRI-Ow`, `fLwxRRIf-jQb7slYSH3ERA`, `kVAzoSjSsWHzO6xclKqKVw`, `Zj4EyqFN0areN3JvQdEtrA`, `8HpkFSUKcpf8EnlZwowo8w` and `0JZgUCjf54sB1esuLRMvaA`.

**Worth doing later:** other reports created before `7ec539e` may have been analysed from the mixed copy. Re-running "Analyse video" on them gives the corrected result.

---

## 5. Test results by area

| Area | Checks passed | Coverage |
|---|---|---|
| Security and access (headers, signed-out refusals, internal secrets) | 14/14 | 100% |
| Team accounts and activity log | 18/18 | 100% |
| Roles (create, edit, rename, close, reopen, form link, CSV export) | 13/13 | 100% |
| Applications and screening (form checks, Match score, backfill, shortlist, auto-filter, replace resume) | 22/22 | 100% |
| Invitations (manual, bulk, automatic, no duplicates, real inbox) | 10/10 | 100% |
| Interview setup (create, edit, delete, bulk delete, search, export, email gate, consent, resume upload link, HR page) | 20/20 | 95% |
| Reports (score, recording, download, Re-score, decision, Ask AI) | 10/10 | 100% |
| Video analysis on real recordings | 6/6 after fixes | 100% |
| Stats, activity log, settings | 4/5 | 90% (voice sample needs credits) |
| Pages (13 pages, desktop 1440 px and phone 390 px) | 4/4 | 100%, with 0 JS errors and no sideways scroll |
| Voice interviewer | Most fixes confirmed | About 88% (2 fixes not yet confirmed live) |

The test suites pass: web `npm test` (206), agent `pytest` (51), and `npx tsc --noEmit` is clean. `tsc` may complain about stale `.next/` types for the removed route; deleting `.next` clears that.

---

## 6. How to re-run the tests

The tools are in **`scripts/predev-audit/`**. They use Node with Playwright; the browser path in `lib.js` points at a local Mac Playwright Chromium.

```bash
cd scripts/predev-audit
export AUDIT_PW=$(gcloud secrets versions access latest --secret predev-recruiter-password --project siva-nikhil)
node e2e.js     # 89 checks: security, team, roles, applications, interviews, reports, settings, pages
node e2e2.js    # 24 checks: replace resume, backfill, auto-filter, bulk and auto invites, upload link, HR page, email
```

- **`DONE_ID`** names a finished interview with a report, and **`VIDEO_ID`** one with a real camera recording. Set both if the default dummy interviews were deleted.
- **Cleanup:** both scripts record what they create in `e2e-state.json` and `e2e2-state.json`. To clean up, delete those interview IDs, then the role IDs (`DELETE /api/dashboard/interviews/:id`, `DELETE /api/roles/:id`).
- **Search caution:** search matches **any single word**, so "AUDIT E2E2" also finds "AUDIT Eval …". Never clean up by search results alone.

### Voice confirmation round (after the credits are topped up)

```bash
# 5 dummy interviews on the eval role, writes setup-r10.json
ROLE=role_LDB3iDSiGvLDjGrv8Rp1tQ TAG=r10 node setup.js strong,vague,evasive,injection,thinker 5
BASE=https://intervia-predev-web-199504026920.asia-south1.run.app
node -e 'for (const i of require("./setup-r10.json").interviews) console.log(i.persona, i.id, i.email)' |
while read p id em; do t=1; [ $p = thinker ] && t=6
  gcloud run jobs execute intervia-predev-candidate-sim --project siva-nikhil --region asia-south1 --async \
    --args="--base=$BASE,--interview-id=$id,--email=$em,--persona=$p,--minutes=5,--think=$t"; done
```

- **Read each run's transcript:**
  ```bash
  gcloud logging read 'resource.type="cloud_run_job" AND labels."run.googleapis.com/execution_name"="<execution>" AND textPayload:"RUN_RESULT"'
  ```
- **Read scores and the timeline:** `node factors.js <id>` and `node timeline.js <id>`.
- **Measure Live cost:** `node usage.js`.
- **Check for:**
  - no dead air after "no questions"
  - no doubled acknowledgement after a topic change
  - no greeting again mid-interview
  - no praise
  - no `<no speech>` text in captions
- **The simulated candidate:**
  - Script: `agent/scripts/llm_candidate.py`.
  - Job image: `scripts/predev-audit/simjob/Dockerfile`, image `asia-south1-docker.pkg.dev/siva-nikhil/meetingbot/candidate-sim:predev`.
  - It joins through the real `/verify` endpoint and speaks Gemini TTS audio into the room.
- **The browser candidate** (camera and recording path):
  - Job: `scripts/predev-audit/browserjob/` (`intervia-predev-browser-candidate`).
  - `browser-mic.wav` is not committed. Make it with `say -o browser-mic.wav --data-format=LEI16@48000 "<answer text>"`.
  - The fake camera shows a test pattern, so the video result is always "No face could be seen".

---

## 7. Leftovers to clean up (after the confirmation round)

- **Eval role:** `role_LDB3iDSiGvLDjGrv8Rp1tQ` ("AUDIT AI Eval Backend Developer"). It holds about 23 dummy "AUDIT Eval …" interviews (rounds 2 to 8 plus one browser run). Delete those interviews, then the role.
- **Team members:** two turned-off accounts, "AUDIT Member f4ha" and "AUDIT Member rpkw". The app has no delete for members, so remove them from the database (the members table) or leave them off.
- **Test jobs:** the Cloud Run jobs `intervia-predev-candidate-sim` and `intervia-predev-browser-candidate`, and their images `candidate-sim:predev` and `browser-candidate:predev` in `asia-south1-docker.pkg.dev/siva-nikhil/meetingbot/`. Optional.
- **Untracked local files** to keep out of commits: `.mux/` folders, `UI_UX_AUDIT_PLAN.md`, `docs/HANDOFF.md`.

---

## 8. Noted, not changed

- **Search** matches any word rather than all words.
- **Agent environment warning:** the agent warns that both `GOOGLE_API_KEY` and `GEMINI_API_KEY` are set (`config.py` copies the same key). It's harmless.
- **Start-up delay:** from email verify to the interviewer's greeting takes 35 to 55 s (cold job start), hidden by the camera check.
- **Dev environment:** the dev interviewer's thinking-budget fix (`GEMINI_THINKING_BUDGET` empty) and the dev migration both wait for the owner.
- **Production queue:** `intervia-video-analysis` (old deployment) still has the old settings (1000 concurrent, 3 attempts). Apply the same fix only when the owner moves to dev or production.
