# UI handoff (features/predev, Nov 2026)

A short record of the UI redesign, so it can be picked up again later.

Predev: https://intervia-predev-web-199504026920.asia-south1.run.app (pushing to `features/predev` deploys it).

## Ground rules the user set
- Visual, outcome-first. No walls of text, no redundant controls, no UI bugs.
- Medhas Academy logo and name everywhere (not "Sreemedhas Agent"). No serif type.
- Short copy, sentence case, explain at the outcome level.

## Look and feel
- **Public and candidate pages:** deep navy `#08123a` with a blue glow from above, white type and white pill buttons.
- **Recruiter app:** light (dark mode supported), using Tailwind tokens: `accent`, `surface`, `border`, `muted`.
- **Score colours:** emerald for 70 and above, amber for 50 and above, rose below 50.
- **Shared pieces:**
  - `ui/ScoreRing`: animated score ring.
  - `roles/RoleIcon`: picks an icon by keywords in the role title.
  - `ui/Sheet`: side panel.
  - `dashboard/ConfirmDialog`: confirmation pop-up, rendered above sheets.

## What each page is now
| Page | File(s) | State |
|---|---|---|
| Home `/` | `app/page.tsx`, `marketing/HeroFilm.tsx` | Navy hero with a looping animation (ask, answer, report), three outcome cards, navy closing band with footer |
| Sign in `/login` | `app/login/page.tsx` | Form on the left, the same animation on the right |
| Interviews `/dashboard` | `DashboardView`, `ReportsTable` | Activity chart and stats, a filterable table, top search filters it (`?q=`) |
| Report `/dashboard/[id]` | `InterviewDetailView.tsx` | Overview rings → takeaways → answers → resume match → originality → recording → on camera → decision → comparison |
| Resume viewer | inside `InterviewDetailView` (`ResumeModal`) | Full-height PDF without the browser toolbar. Older interviews have text only: shown in sections with a note |
| On camera | `VideoSection` in the report | Four tiles, two 3×3 gaze grids, a "Worth a look" list, per-answer table folded away |
| Roles `/dashboard/roles` | `RolesView.tsx` | Active / Closed tabs. Card: icon, score ring, one bar, a summary line, Form link + Invite (closed: Make active) |
| Role `/dashboard/roles/[id]` | `RoleDetailView.tsx`, `ApplicationFormSettings.tsx` | Form bar (switch, Edit form, Copy link). Stage tiles act as filters. One table, 25 per page. Job description tab |
| New interview `/recruiter` | `CreateInterviewForm.tsx` | Four steps: who → role and job description → what to focus on (5-level skill weights) → how it runs. No name field |
| Settings | `app/dashboard/settings/*` | Sentence-case labels, no duplicate heading |
| Candidate join and call `/interview/[id]` | `interview/CandidateScreens.tsx`, `LiveRoom.tsx`, `JoinInterviewForm.tsx`, `CandidateShell.tsx` | Navy join page with two steps (confirm email, then camera and mic). Call: orb, voice bars, question, time-left pill, icon dock. Done / left / error screens |
| Link errors, upload, 404 | `JoinError.tsx`, `app/upload/[token]`, `app/not-found.tsx` | Branded, no technical codes shown |
| Apply form `/apply/[token]` | `components/apply/*` | Unchanged; checked |

## Behaviour changes made alongside the UI
- **Creator name:** comes from the signed-in account through `accountDisplayName()` (`ADMIN_DISPLAY_NAME`, otherwise "Admin"). `GET /api/auth/me` feeds the top bar.
- **Predev link address:** `APP_BASE_URL` in `.github/workflows/deploy-predev.yml` now points at the main predev URL.
- **Form auto-close:** set with a date and time picker, stored as whole hours from the round start.
- **Removed:**
  - the WhatsApp share (hidden for now);
  - the "Score at least" filter;
  - duplicate open and copy-link buttons;
  - `CustomScoringDialog`;
  - `MediaControls` and `Specimens`.

## How to check UI work
- **Before pushing:** `npx tsc --noEmit -p .` (ignore the existing `edit/page` errors) and `npx eslint <files>`. The repo has no Prettier, so don't reformat whole files.
- **Candidate screens without a real call:** run `npx next dev -p 3100`, then open `/interview-preview`. It has a stage switcher and returns 404 in production.
- **Phone layout:** load pages in 375px-wide same-origin iframes and check that `document.documentElement.scrollWidth` is 375. Two traps:
  - grid children need `grid-cols-[minmax(0,1fr)]`;
  - table scroll boxes need `relative`.

## Open items (not UI layout)
- **Agent deploys:** the agent build fails because the `meetingbot-agent-vm` disk is full. Fix with `docker image prune -af && docker builder prune -af` on that VM.
- **Scoring contradictions:** one report shows "0% at the screen" with an on-camera score of 100, and another shows "Hire" next to an answer-quality score of 40. Backend scoring needs a look.
- **Old interviews:**
  - creator shows "Sreemedhas Agent / Bot";
  - only resume text is kept, no original file.
- **Orphaned page:** `/dashboard/roles/[roleId]/candidates/[candidateId]` is no longer linked from anywhere.
- **Not exercised:** a real end-to-end interview, submitting an application, creating an interview to its plan preview, PDF and CSV export.
