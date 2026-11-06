# Competitor features → Intervia backlog

Purpose: a discussion list for the team. Part 1 is what the market ships today.
Part 2 is what we already have. Part 3 is the proposed feature list, with how it
would fit this codebase. Part 4 is what we should deliberately not build.

Sources are each vendor's own product pages and 2026 comparison write-ups
(HireVue, Paradox, Sapia, HeyMilo, Talview, BarRaiser, Willo, Karat/CodeSignal,
Metaview/BrightHire). Feature sets vary by plan — treat this as a map, not a
contract.

---

## 1. What the market actually sells

### A. Live AI interviewer (our category)
| Capability | Who has it | Notes |
| --- | --- | --- |
| Structured, same questions for every candidate | HireVue, Sapia, HeyMilo, Paradox | The core fairness claim; audited rubrics |
| Adaptive follow-ups driven by the answer | HireVue AI Interviewer, HeyMilo | Depth control, not free chat |
| 20+ languages, auto-detected | HeyMilo | Language per candidate, not per tenant |
| Branded candidate flow (logo, colours, copy, sender domain) | HireVue, HeyMilo, Talview | White-label is an enterprise checkbox |
| Candidate can ask about the company/culture | HireVue | Small feature, high candidate NPS |
| Voice, video, phone (SIP), SMS, WhatsApp | HeyMilo, Talview, Paradox | Omnichannel: meet the candidate where they are |
| Async one-way video + AI scoring | HireVue, Willo, VidCruiter | Cheaper than live voice, worse signal |
| Text-only structured chat interview | Sapia | Mobile-first, no face/voice, easiest to defend legally |
| AI opt-out / accommodation path | HireVue | Required for enterprise + accessibility reviews |

### B. Screening before the interview
- Resume auto-score and shortlist, eligibility knockouts (HeyMilo).
- SMS/form pre-qualification 24/7 (HeyMilo, Paradox).
- Scenario / "works with AI" assessments (HeyMilo).
- Coding + skills tests: HackerRank, CodeSignal, Karat, iMocha.
- Scheduling bot that books the slot right after the screen (Paradox, HeyMilo).

### C. Scheduling and logistics
- Self-serve slot picking, calendar sync (Google/Outlook), timezone handling,
  reschedule/cancel links, buffers, interviewer availability.
- Automated reminder cadence + no-show recovery (SMS/WhatsApp).
- Candidate status portal and rejection communication.

### D. Integrity and proctoring
- Identity verification / liveness at join (Talview Verity, Persona/Onfido).
- Candidate fraud detection, deepfake detection, duplicate-person detection.
- Real-time proctoring signals: second screen, second voice, screen share,
  virtual camera, LLM copilot use.
- Tab/focus and paste detection, attempt limits, device fingerprint.
- HireVue moved away from facial-expression scoring after criticism — the
  defensible line is *measured behaviour*, not inferred character.

### E. Interview intelligence (human interviews)
- Notetaker + auto-structured scorecard from a human panel (Metaview, BrightHire).
- Live copilot: question bank, coverage nudges, real-time rating capture, bias
  alerts (BarRaiser).
- Recording + transcript + highlights, synchronized playback.
- Debrief workspace and decision log.

### F. Assessment quality and governance
- Validated competency libraries and 1–5 anchored rubrics.
- Rubric versioning, reviewer overrides with reason, calibration.
- Adverse-impact / bias audit reports (NYC LL144, EEOC, OFCCP).
- Model card, explainability doc, human-oversight workflow.
- EU AI Act / NIST AI RMF / ISO 42001 alignment statements (HireVue).
- Data residency, retention policy, DPA, SOC 2 / ISO 27001.

### G. Platform / enterprise
- Individual accounts, orgs, roles and permissions, SSO/SCIM.
- ATS two-way sync: Greenhouse, Lever, Ashby, Workable, Zoho, Naukri.
- Write-back of scorecard + transcript link onto the candidate record.
- Public API + webhooks, audit log, per-org usage and cost reporting.

### H. Analytics
- Funnel by stage, time-to-hire, source quality, score distributions.
- Per-question item analysis (which questions actually discriminate).
- Drop-off by step of the candidate flow.
- Cost per interview / per hire.

---

## 2. What Intervia already has

Live voice interview with controller-steered topics and time budget · plan from
JD + resume · 1–5 competency scoring with verified quotes · resume match ·
own-answer signals · on-camera clip analysis · two voice modes with cost
estimate · candidate email gate + consent + one-time resume upload · scheduling
field + 30-minute reminder email · reconnect + watchdog · tab/focus integrity
events · roles → candidate pipeline with stages · reports dashboard with
analytics, CSV export, HTML report download · recording playback (recruiter
only) · regenerate scorecard · decision record.

Gaps that block a paid pilot today: **no per-user accounts/orgs, no calendar
booking, no ATS integration, English only, no branding, no identity check, one
shared password.**

---

## 3. Proposed feature list

Priority: **P0** = needed to sell/pilot, **P1** = differentiator, **P2** = later.
Effort: S ≈ ≤3 days, M ≈ 1–2 weeks, L ≈ 3+ weeks (one dev).

### P0 — unblock a real customer

**1. Accounts, orgs, roles (RBAC)** — no competitor sells a shared password.
- `users`, `organisations`, `memberships(role)` tables; session carries
  `userId + orgId + role`.
- Replace `requireRecruiter()` in `src/lib/auth/guards.ts` with
  `requireRole("recruiter" | "hiring_manager" | "admin" | "interviewer")`.
- Every repository query gains `org_id`; add a migration + backfill.
- Effort **M**. Dependency for almost everything below.

**2. ATS integration (start with one)** — the #1 enterprise objection.
- `integrations` table (provider, encrypted creds, cursor), `external_links`
  mapping role↔job and candidate email↔candidate id.
- Provider interface mirroring `src/lib/ai/llm-provider.ts`:
  `AtsProvider { pushScorecard, pushStage, pullCandidates }`.
- Outbound only at first: on scorecard completion, POST score + link.
  Idempotency key = roomId. Retry queue table; never block the request.
- Pick Greenhouse (widest API) or Zoho Recruit/Naukri if India-first.
- Effort **M–L**.

**3. Self-serve scheduling + calendar** — removes recruiter ping-pong.
- `availability` windows per org; `GET /api/schedule/slots?roleId=&days=`.
- Tokenized reschedule/cancel links; slot booking writes `scheduledAt`.
- Google/Outlook OAuth (connectors) → create event with ICS fallback.
- Reuse `reminder-scheduler.ts` for a T-24h / T-1h cadence.
- Effort **M**.

**4. Branding / white-label** — cheap, visible in every demo.
- `org_settings`: logo, primary colour, sender name/domain, email copy,
  custom domain.
- CSS variables already exist in the app theme; email templates in
  `src/lib/emails/email.service.ts` take a theme object.
- Custom domain later: host→org in middleware + managed cert.
- Effort **S–M**.

**5. Identity + integrity pack** — the thing Indian enterprise buyers ask first.
- Join-time selfie capture, face-match against the same candidate's earlier
  attempt (start with a perceptual hash, not biometrics storage).
- Detect second voice / loopback audio from the LiveKit tracks (cheap DSP +
  speaker-count heuristic).
- Virtual-camera and screen-share detection; one-attempt-per-candidate policy.
- Surface as **signals with evidence** in the report, never a verdict —
  same stance as the existing on-camera analysis.
- Effort **M** (selfie + duplicate) / **L** (deepfake-grade).

**6. Multi-language interviews**
- `language` on interview + plan; prompts get a "conduct in X" instruction and
  a language-aware rubric; `GEMINI_TRANSCRIPTION_LANGUAGES` per interview.
- Report shown in recruiter language with quotes kept in the original.
- Start with English + Hindi + Telugu (your market), then expand.
- Effort **M**; mostly prompt + UI, low infra risk.

### P1 — differentiators worth demoing

**7. Adaptive follow-ups with depth control**
- Controller tracks evidence per competency; model may call
  `request_followup(reason)`, limited to N per topic and only when the answer
  is thin. Add to `agent/intervia_agent/controller.py` + unit tests.
- Effort **M**, highest signal-per-effort item in the list.

**8. Question bank + rubric library + plan approval**
- `question_bank`, `competency_library` (versioned), org-level templates.
- Plan edit screen (draft → approved → link unlocks), diff between versions,
  and the approved version stamped on the scorecard.
- Effort **M**.

**9. Technical round (code + explain)**
- New room mode: Monaco editor in the candidate page, LiveKit data channel for
  code state, sandbox execution (Piston/Judge0), agent asks the candidate to
  walk through their solution.
- Scorecard gains a `code` factor; report shows diffs + final code.
- Effort **L**. Big market pull, big build. Only take it if roles are technical.

**10. Human-interview copilot (sell to teams not ready for full AI)**
- A notetaker-only agent joins a human panel room: transcript → structured
  scorecard using the same grading service; live panel UI with rubric coverage
  and suggested probes.
- Reuses `interview_turns`, `scorecard.service.ts`, and the report page.
- Effort **L** but opens a second product line; Metaview/BrightHire/BarRaiser
  prove the demand.

**11. Candidate experience upgrades**
- 60-second mic/camera warm-up with an example question (cuts drop-off and
  failed recordings).
- Audio-only mode for low bandwidth; phone dial-in via LiveKit SIP.
- Mobile layout pass; PWA install.
- Effort **S–M**, measurable on completion rate.

**12. Omnichannel reminders (India-first)**
- WhatsApp Cloud API + SMS for invite, T-24h, T-1h, no-show recovery.
- `notifications` service with channel adapters; `message_log` for audit.
- Effort **M**; template approval with Meta is the long pole.

**13. Pre-screen step**
- Knockout questions + resume auto-score before an interview is offered
  (`pre_score` on the role → auto-invite or auto-reject with reason).
- Effort **M**; needs the org model first.

**14. Analytics that hiring managers ask for**
- Stage funnel, score distribution, per-question discrimination, drop-off by
  step, cost per interview/hire, time-to-hire.
- Extend `getDashboardAnalytics`; one new page under `/dashboard/analytics`.
- Effort **M**.

### P2 — enterprise readiness

**15. Compliance pack** — retention policy per org (auto-delete recordings
after N days), erasure endpoint, consent versioning, audit log, DPA, data
residency in `asia-south1`, EU AI Act / NIST AI RMF mapping doc. **M**
**16. Fairness reporting** — rubric + prompt + model version stamped per
scorecard; override-with-reason; adverse-impact export where group data is
lawfully collected. **M**
**17. Public API + webhooks** per org. **M**
**18. SSO (Google Workspace / SAML) + SCIM.** **M**
**19. Cost guardrails** — per-org budget, auto rolling mode, spend alert. **S**
**20. Custom voice + tone** (friendly / neutral / strict, speed, accent). **S**

---

## 4. What not to copy

- **Facial-expression or emotion scoring.** HireVue retreated from it and it is
  the fastest route to a bias complaint. Keep behaviour as clips to watch.
- **A "cheating probability" number.** Defensible product = logged signals,
  human decides. Talview can afford real proctoring because it is the product;
  for us it is a side feature with legal downside.
- **Auto-reject without human review.** Every serious vendor keeps a human
  approval step. Ours should too — it is also the story that closes deals.

---

## 5. Questions for the team

1. Who is the first paying customer — an Indian staffing firm, an in-house TA
   team, or a US/EU buyer? That decides ATS order (Zoho/Naukri vs Greenhouse)
   and whether compliance or price is the pitch.
2. Do we sell the technical round, or stay non-technical? It doubles scope.
3. Is human-interview copilot a second product or a distraction? It is the
   fastest path to revenue with teams that will not let an AI interview alone.
4. One shared password today is the biggest credibility gap — do we take
   P0-1 before anything else?
5. Which three P1 items go in the next two sprints? My vote: adaptive
   follow-ups, branding, candidate warm-up — all small, all demo-visible.
