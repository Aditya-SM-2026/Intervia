# Resume screening for a role

Every application to a role can be scored against that role, in five separate parts, so a recruiter opening the candidate list sees how well each resume matches before reading anything. The score is **advice only**: nothing is rejected automatically, and a recruiter always makes the decision.

## 1. What the recruiter sees

- A **Resume screening** card on the role page, under the application form bar.
  - **Score Generator**: scores applications collected before screening was switched on, in batches of 10, after telling you how many there are and the rough bill.
  - **Weights**: the five section weights, three ready-made presets, and an on/off switch for new applications. The switch is **off** for every new role; turn it on when you want applications scored as they arrive.
- A **Match** column in the candidate table, between Stage and Score. It is the resume total, 0-100. Interview score stays in its own Score column: one is what the resume claims, the other is what the interview showed.
- Opening a candidate row shows **Resume screening** in the review sheet: the total, "scored on N of M sections", a short summary, the skills found and not found by name, each section with its score, one-line reason and the quoted lines from the resume, plus **Score again**.

## 2. The five sections and their weights

Defaults, editable per role:

| Section | Default weight |
|---|---|
| Profile summary | 20 |
| Technical skills | 20 |
| Experience | 25 |
| Projects | 25 |
| Certifications | 10 |

The editor blocks saving unless the five weights add up to exactly 100.

**Education is not scored.** The recruiter wanted the score to describe fit for the work, and a degree line tells a fresher nothing a project does not. Roles saved before this change had a sixth weight for Education; those stored weights are scaled back up to 100 the first time they are read, so nothing is lost and no role has to be re-saved.

**Missing sections are left out, not scored zero.** A fresher with no certifications is scored on the four sections that exist, and the certification weight is shared by the rest. Setting a section to 0% removes it for everyone.

**Changing a weight is free.** The total is recomputed from the stored section scores the moment the list is read, so no resume is read again. Only a new application, a replaced resume or **Score again** calls the model.

## 3. How a resume is read

One model call per resume through the existing `generateStructured` helper (Ominibot provider, Gemini fallback), asking for all five sections plus a summary. The model must quote the resume for every section it scores.

**Quotes are checked in code.** Each quoted line is looked up in the extracted resume text (case, spacing, curly apostrophes normalised). A line that is not there is dropped; a section that loses all its lines is downgraded to *insufficient evidence* with no score, so an invented quote cannot prop a number up.

**Keywords are free and always shown.** The role's skills are matched against the resume text with alias groups (AWS = Amazon Web Services, K8s = Kubernetes, Postgres = PostgreSQL), word-boundary safe (React does not match *reactive*, Java does not match *JavaScript*). They never filter anybody out; they are a second, free opinion beside the model's.

## 4. What is not screened

- **No readable text**: a scanned PDF or a Word file has no text stored, so the application is marked *not screened* with the reason shown, and keeps its keyword chips.
- **No model key**: the application is marked *failed* with "not configured on this deployment", again keeping the chips. Once the key is present, **Score again** fixes individual rows and **Score waiting** fixes them in bulk.
- **Re-screening the same input is skipped**, because the role description, skills and resume text are hashed: an unchanged resume is not paid for twice. **Score again** forces a fresh call.

## 5. Where it lives

| File | Role |
|---|---|
| `src/lib/screening/types.ts` | Section ids, labels, weights, snapshot shape |
| `src/lib/screening/score.ts` | Weighted total, weight sanitising, coverage line |
| `src/lib/screening/evidence.ts` | Quote checking and section downgrade |
| `src/lib/screening/keywords.ts` | Alias groups and word-boundary matching |
| `src/lib/screening/prompt.ts` | Prompt and reply schema |
| `src/lib/screening/screening.service.ts` | Settings, one resume, batches, estimate |
| `src/lib/screening/invited.ts` | Scores the interview resume of invited candidates |
| `src/lib/screening/screening.test.ts` | 14 tests on the maths, evidence and keywords |
| `src/lib/roles/shortlist.ts` | Cutoff rules, shortlist status, CGPA filter |
| `src/components/roles/ScreeningSettings.tsx` | Role page card, weights, shortlist cutoff |
| `src/components/roles/ShortlistCell.tsx` | Shortlist chip and manual tick |
| `src/components/roles/ApplicationScreening.tsx` | Review sheet block |
| `src/app/api/roles/[roleId]/screening/route.ts` | GET/PATCH settings |
| `src/app/api/roles/[roleId]/screening/backfill/route.ts` | POST estimate or batch |
| `src/app/api/roles/[roleId]/shortlist/route.ts` | GET/PATCH cutoff, PATCH one candidate's tick |
| `src/app/api/roles/[roleId]/applications/[applicationId]/screening/route.ts` | GET one result, POST re-run |

Nothing in the interview scoring or video-analysis code was changed. The additions to shared files are additive: new columns in the roles repository, optional fields on `Role` and `RoleCandidateSummary`, a screening hook after an application is saved, and the Match column.

## 6. Data

Added automatically on the first request, no manual migration:

- `roles`: `screening_enabled` (default true), `screening_weights` (JSONB, null means defaults).
- `role_applications`: `screening_status`, `screening_score`, `screening_sections`, `screening_keywords`, `screening_summary`, `screening_model`, `screening_cost_usd`, `screening_at`, `screening_input_hash`.
- Index on `(role_id, screening_status)` for the pending list.

Replacing a resume clears that application's screening so the new file is read next time.

Candidates who never filled the form (invited straight to an interview) are scored from the resume uploaded for the interview, stored in `role_candidate_screenings` keyed by role and lowercased email. The **Score Generator** picks them up with the applications, and their Match score appears in the same column.

The application form now captures **Education qualification** (a dropdown, so values stay filterable) and **CGPA or percentage**. Both are shown in one Education column beside Match, and the candidate toolbar has a minimum CGPA filter. Neither field is required, so an applicant without a CGPA is not blocked.

### Shortlisting

- The role page holds one **cutoff**: a Match score at or above which a candidate counts as shortlisted. 0 turns it off.
- Each candidate's **Shortlist** chip can be clicked to override the cutoff by hand, cycling no decision → Shortlisted → Not shortlisted → no decision. A manual decision wins both ways, so HR can lift someone the cutoff dropped or hold someone it passed.
- The toolbar has a **Shortlisted** filter.
- Nothing is rejected automatically: the chip and the filter only describe, they never act.

## 7. Cost

One call per resume, roughly $0.0025 with a short resume and a few hundred tokens of role text. 1,000 applications is around $2.50. Changing weights, viewing results, and keyword chips cost nothing. The **Score waiting** button shows the pending count and this estimate before it runs.
