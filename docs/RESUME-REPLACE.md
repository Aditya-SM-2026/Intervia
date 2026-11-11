# Replacing a resume after applying

A candidate who uploads the wrong file can fix it themselves, without filling the form again and without the recruiter deleting and recreating the application.

## 1. What the candidate sees

1. After sending the application, the confirmation screen shows a small panel: *Uploaded the wrong file?* with a **Replace my resume** link.
2. The link opens a private page for that one application: role name, the file currently on record, and a file picker.
3. Choosing the corrected PDF, DOC or DOCX and pressing **Save new resume** replaces the file. A confirmation says the new file name and that nothing else changed.

Everything else stays exactly as sent: name, phone, email, college roll number, answers to the extra questions, the application status and any interview already booked. The recruiter's candidate row simply shows the new file name.

## 2. The second route: the same form, sent again

A candidate who closed the link can simply open the application form again, fill the same details and send. There is no dead end:

1. The server matches the email, case-insensitively, against the applications for that role.
2. It requires the phone number to match too, ignoring spaces, dashes and the country code (so `+91 98765 43210` equals `9876543210`).
3. If both match, the existing application is updated in place: the resume is replaced, and the name, college ID and answers are refreshed. Status, interview and creation date stay untouched.
4. The confirmation reads **Application updated** and says which file was replaced.
5. If the phone does not match, nothing changes and the form says so. A stranger who only knows an email cannot touch someone's resume.
6. A rejected application is refused with "This application is closed, so its resume can no longer be changed."

## 3. The rules

- **The link is the credential.** It holds 24 random bytes, so it cannot be guessed. Anyone with the link can change the file, which is why the confirmation screen tells the candidate to keep it to themselves.
- **It works for 7 days**, counted from the last upload. Replacing the file restarts that window.
- **A rejected application is closed.** Replacement is refused with "This application is closed, so its resume can no longer be changed."
- **Only the newest file is used.** The previous upload is left in storage rather than deleted (there is no delete helper in the GCS layer yet).
- **Only applications created after this change have a link.** Older rows have no token, so no link can be issued for them retroactively.

## 4. Data

Two columns on `role_applications`, added automatically on the first request (no manual migration):

| Column | Meaning |
|---|---|
| `resume_update_token` | The private token; unique index, null for older rows |
| `resume_updated_at` | When the resume was last replaced; null until the first replacement |

## 5. API

| Method and path | Access | What it does |
|---|---|---|
| `POST /api/apply/<formToken>` | public | Creates an application, or refreshes one when the email and phone already match. Returns `resumeToken`, plus `updated`, `previousFileName` and `fileName` |
| `GET /api/apply/resume/<resumeToken>` | public | Role title, candidate name, file on record, expiry, whether replacement is open |
| `POST /api/apply/resume/<resumeToken>` | public | Multipart `resume` field; swaps the file. 404 unknown token, 410 expired or rejected, 400 bad file |

Both public endpoints are rate limited per IP, per instance (same best-effort limiter as the application form).

## 6. Files

Added:

| File | Purpose |
|---|---|
| `src/lib/roles/resume-update.ts` | Pure token pattern, 7-day window, expiry helpers |
| `src/lib/roles/resume-update.test.ts` | Tests for the token shape and the window |
| `src/app/api/apply/resume/[updateToken]/route.ts` | Public GET and POST for the replace link |
| `src/app/apply/resume/[updateToken]/page.tsx` | The private replace page |
| `src/components/apply/ReplaceResumeForm.tsx` | File picker, validation, save, success state |
| `src/lib/http/public-rate-limit.ts` | Shared per-instance limiter for public endpoints |

Changed:

| File | Change |
|---|---|
| `src/server/repositories/roles-repository.ts` | Two columns, token on insert, `getApplicationByResumeToken`, `getApplicationByEmail`, `refreshApplication`, `replaceApplicationResume`, in-memory equivalents |
| `src/lib/roles/application.service.ts` | Issues the token on submit, refreshes an existing application on a matching resubmit, resolves the link, validates and stores the replacement |
| `src/lib/roles/application.types.ts` | `resumeUpdatedAt` on an application, `PublicResumeUpdateState` |
| `src/app/api/apply/[token]/route.ts` | Returns `resumeToken` and the update flags on success |
| `src/components/apply/ApplicationForm.tsx` | Confirmation panel with the private link, and an "Application updated" variant when a resubmit replaced the resume |

## 7. How to test

1. `npm run dev` (no `DATABASE_URL`, so data lives in memory for the session).
2. Create a role, open its application form link in a private window.
3. Submit with any PDF. The confirmation offers **Replace my resume**.
4. Open the link: the page names the file you just sent.
5. Choose a different PDF and save: "New resume saved", and the role page's application row shows the new file name.
6. Reopen the same form link, fill the same email and phone, upload a different PDF, send: the confirmation reads **Application updated** and names the file it replaced.
7. Reopen again with the same email but a different phone: it refuses and nothing changes.
8. Reject the application from the role page, reload the replace link: the page says the application is closed, and a resubmit is refused too.

Checked on this machine: type check clean, 123 tests pass, production build compiles, the page renders at 390, 768 and 1440 px with no horizontal overflow, and the API returns 200 on a good replacement, 200 with `updated: true` on a matching resubmit, 409 on a wrong phone, 410 on a rejected application and 404 on an unknown token.

## 8. Not included

- Emailing the link when the candidate has already closed the confirmation tab. Email sending exists for invitations but is not wired here.
- A recruiter-side "replace resume" action on the review drawer.
- Deleting the superseded file from storage.
- A replacement link for applications created before this change.
