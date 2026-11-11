# Application form links (per role)

A short guide to the feature added to the Roles section: what it does, where the
code lives, and how to check it yourself.

Nothing has been committed, branched or pushed. All of this is sitting in the
working tree of `C:\Users\Siva Sai\Desktop\interview bot\Intervia-verify`.

---

## 1. What it does

Each role gets one public application link. You share it with a college
WhatsApp group. A student opens it, fills their details and uploads a resume
without creating an account. The application then shows up in that role's
existing candidate table as **Waiting**, and you can review it, reject it, or
schedule an interview for them.

- One permanent link per role. You can turn it off and back on, and the same
  link starts working again.
- Fixed questions: full name, phone, email, college roll number, resume.
- Extra questions you add per role: short answer, long answer, number,
  dropdown, yes/no. Any of them can be required, reordered or deleted.
- Resume is stored in the same recordings bucket as interview resumes, under
  `resumes/<applicationId>/`.
- A candidate who sent the wrong file can replace it from the private link on
  their confirmation screen, or by opening the form again and sending with the
  same email and phone. See `docs/RESUME-REPLACE.md`.
- The candidate table keeps exactly the same seven columns. Only the Stage
  values grow: **Waiting** and **Rejected** now sit alongside Completed, Not
  started and the rest.

## 2. The two sides

**Recruiter**

1. Roles page → the role card's ⋯ menu → *Copy application form link*.
2. Or open the role and use the *Application form* panel: copy the link, share
   on WhatsApp, edit the extra questions, turn the link off or back on.
3. In the candidate table, a form applicant has Score "—", Evaluation
   "Application" and Last interview "Applied <date>".
4. Click *Review application* to expand the row: phone, roll number, all custom
   answers, *Open resume*, *Schedule interview*, *Reject application*.

**Applicant**

1. Opens `/apply/<token>`.
2. Fills the fixed fields, answers the extra questions, attaches a PDF, DOC or
   DOCX up to 10 MB, ticks consent, sends.
3. Sees a confirmation. One application per email address per role.

## 3. Stages

| Situation | Stage shown |
|---|---|
| Applied through the form, no interview yet | Waiting |
| Recruiter clicked Reject application | Rejected |
| Interview booked and completed | Completed (from the interview itself) |
| Interview booked, not finished | Not started / In progress |

Once an interview exists for that email, the row switches to being a normal
interview row and follows the normal stage rules. The application data stays
attached to the row (phone, roll number, answers are still there).

Bulk select deliberately skips application rows: they are rejected one at a
time, after review, because the table needs to keep working the same way for
interviewed candidates.

## 4. Where the data lives

Two new Postgres tables, created automatically the first time the feature is
used (no manual migration step):

**`role_form_links`** — one row per role

| Column | Meaning |
|---|---|
| `role_id` | Primary key, references `roles(id)`, deleted with the role |
| `token` | Long random URL-safe token; this is the credential |
| `fields` | JSONB array of the extra questions |
| `created_at`, `revoked_at` | When it was made, and when it was turned off |

**`role_applications`** — one row per submitted application

| Column | Meaning |
|---|---|
| `id` | `app_...` id |
| `role_id` | Which role |
| `name`, `phone`, `email`, `college_id` | Fixed fields |
| `answers` | JSONB of the extra answers, keyed by question id |
| `resume_file_name`, `resume_text`, `resume_object_path` | Resume details |
| `status` | `new`, `scheduled` or `rejected` |
| `interview_id` | Set when an interview is booked from it |
| `created_at` | When it was sent |

A unique index on `(role_id, lower(email))` is what blocks duplicate
applications. The resume itself goes to storage, not the database:

- Locally: `UPLOADS_DIR` (default `.data/uploads/<applicationId>/`).
- On Cloud Run: the recordings bucket from `RECORDINGS_GCS_BUCKET`, at
  `resumes/<applicationId>/<timestamp>-<filename>`.

## 5. API endpoints

| Method and path | Access | What it does |
|---|---|---|
| `GET /api/apply/<token>` | public | Role title, description and questions |
| `POST /api/apply/<token>` | public | Submit the form (multipart) |
| `GET /api/roles/<roleId>/form-link` | recruiter | Current questions, without creating a link |
| `POST /api/roles/<roleId>/form-link` | recruiter | Get or create the link; `{ fields }` saves questions |
| `DELETE /api/roles/<roleId>/form-link` | recruiter | Turn the link off |
| `GET /api/roles/<roleId>/applications` | recruiter | All applications for the role |
| `PATCH /api/roles/<roleId>/applications/<id>` | recruiter | `{ action: "reject" \| "restore" \| "scheduled" }` |
| `GET /api/roles/<roleId>/applications/<id>/resume` | recruiter | Original file, or the extracted text |
| `GET /api/apply/resume/<resumeToken>` | public | State of a candidate's private replace-resume link |
| `POST /api/apply/resume/<resumeToken>` | public | Swap the resume on an existing application |

## 6. Files

Added:

| File | Purpose |
|---|---|
| `src/lib/roles/application.types.ts` | Shared types and the field-id helper |
| `src/lib/roles/application.validation.ts` | Rules for fields, identity and answers |
| `src/lib/roles/application.validation.test.ts` | Unit tests for those rules |
| `src/lib/roles/application.service.ts` | Link creation, public submission, storage, decisions |
| `src/app/apply/[token]/page.tsx` | Public page |
| `src/components/apply/ApplicationForm.tsx` | Public form UI |
| `src/components/roles/ApplicationFormSettings.tsx` | Link sharing and question editor |
| `src/app/api/apply/[token]/route.ts` | Public GET and POST |
| `src/app/api/roles/[roleId]/form-link/route.ts` | Link GET, POST, DELETE |
| `src/app/api/roles/[roleId]/applications/route.ts` | List applications |
| `src/app/api/roles/[roleId]/applications/[applicationId]/route.ts` | Reject / restore |
| `src/app/api/roles/[roleId]/applications/[applicationId]/resume/route.ts` | Resume download |

Changed:

| File | Change |
|---|---|
| `src/server/repositories/roles-repository.ts` | Two tables, new methods, in-memory equivalents, and the candidate query that unions in application rows |
| `src/lib/roles/role.types.ts` | Optional application fields on a candidate summary |
| `src/lib/roles/candidate-aggregation.ts` | Same optional fields on the aggregated row |
| `src/lib/roles/hire-stage.ts` | New `waiting` stage and `deriveApplicationStage` |
| `src/lib/roles/role.service.ts` | Passes the application fields through |
| `src/components/roles/RolesView.tsx` | Two new menu items, Waiting/Rejected stages, "Review application" action |
| `src/components/roles/RoleDetailView.tsx` | Application form panel, review row, reject/restore |
| `src/components/recruiter/CreateInterviewPanel.tsx` | Optional name and email prefill |
| `src/app/recruiter/page.tsx` | Reads `candidateName` and `candidateEmail` from the URL |

## 7. Check it yourself

1. `npm run dev` in `Intervia`.
2. Create a role, open it, and in the *Application form* panel click *Copy link*.
3. Open that link in a private window and submit with a real PDF.
4. Back on the role page the applicant appears as **Waiting**.
5. *Review application* → check the answers and *Open resume*.
6. *Reject application* → the badge becomes **Rejected**; *Move back to
   Waiting* undoes it.
7. *Schedule interview* opens the normal new-interview form with the name,
   email and role already filled in.

Commands used to verify: `npx tsc --noEmit`, `npm run lint` (no errors),
`npm test` (69 passing), `npm run build` (succeeds).

## 8. Deliberately not included

- Automatic resume-versus-skills matching. Rejection is your call.
- A reason field when rejecting.
- QR code for the link (WhatsApp share and copy link are there).
- Bulk reject for applications.
- The role header still counts only interviewed candidates, so it can say
  "0 candidates" while applications are listed below.

Each of those is a small addition on top of this, whenever you want it.
