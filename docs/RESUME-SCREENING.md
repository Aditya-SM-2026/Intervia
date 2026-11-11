# Resume screening for a role

Every application to a role can be scored against that role, in six separate parts, so a recruiter opening the candidate list sees how well each resume matches before reading anything. The score is **advice only**: nothing is rejected automatically, and a recruiter always makes the decision.

## 1. What the recruiter sees

- A **Resume screening** card on the role page, under the application form bar.
  - **Score waiting**: scores applications collected before screening was switched on, in batches of 10, after telling you how many there are and the rough bill.
  - **Weights**: the six section weights, three ready-made presets, and an on/off switch for new applications.
- A **Match** column in the candidate table, between Stage and Score. It is the resume total, 0-100. Interview score stays in its own Score column: one is what the resume claims, the other is what the interview showed.
- Opening a candidate row shows **Resume screening** in the review sheet: the total, "scored on N of M sections", a short summary, the skills found and not found by name, each section with its score, one-line reason and the quoted lines from the resume, plus **Score again**.

## 2. The six sections and their weights

Defaults, editable per role:

| Section | Default weight |
|---|---|
| Profile summary | 20 |
| Technical skills | 20 |
| Experience | 20 |
| Projects | 20 |
| Education | 10 |
| Certifications | 10 |

The editor blocks saving unless the six weights add up to exactly 100.

**Missing sections are left out, not scored zero.** A fresher with no certifications is scored on the five sections that exist, and the certification weight is shared by the rest. Setting a section to 0% removes it for everyone.

**Changing a weight is free.** The total is recomputed from the stored section scores the moment the list is read, so no resume is read again. Only a new application, a replaced resume or **Score again** calls the model.

## 3. How a resume is read

One model call per resume through the existing `generateStructured` helper (Ominibot provider, Gemini fallback), asking for all six sections plus a summary. The model must quote the resume for every section it scores.

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
| `src/lib/screening/screening.test.ts` | 14 tests on the maths, evidence and keywords |
| `src/components/roles/ScreeningSettings.tsx` | Role page card and weight editor |
| `src/components/roles/ApplicationScreening.tsx` | Review sheet block |
| `src/app/api/roles/[roleId]/screening/route.ts` | GET/PATCH settings |
| `src/app/api/roles/[roleId]/screening/backfill/route.ts` | POST estimate or batch |
| `src/app/api/roles/[roleId]/applications/[applicationId]/screening/route.ts` | GET one result, POST re-run |

Nothing in the interview scoring or video-analysis code was changed. The additions to shared files are additive: new columns in the roles repository, optional fields on `Role` and `RoleCandidateSummary`, a screening hook after an application is saved, and the Match column.

## 6. Data

Added automatically on the first request, no manual migration:

- `roles`: `screening_enabled` (default true), `screening_weights` (JSONB, null means defaults).
- `role_applications`: `screening_status`, `screening_score`, `screening_sections`, `screening_keywords`, `screening_summary`, `screening_model`, `screening_cost_usd`, `screening_at`, `screening_input_hash`.
- Index on `(role_id, screening_status)` for the pending list.

Replacing a resume clears that application's screening so the new file is read next time.

## 7. Cost

One call per resume, roughly $0.0025 with a short resume and a few hundred tokens of role text. 1,000 applications is around $2.50. Changing weights, viewing results, and keyword chips cost nothing. The **Score waiting** button shows the pending count and this estimate before it runs.
