# Intervia — features in plain words

For the team discussion. No technical terms.

## What the bot does today

**For the recruiter**
1. You write the job description and upload the CV. The bot prepares an
   interview plan: the skills to check and the questions to ask.
2. You send the candidate a link. You can set a date and time for the interview.
3. When the interview ends, you get a report card: a score out of 100, and a
   score out of 5 for each skill, each with the candidate's own words as proof.
4. You can watch the recording, read the full conversation, download the report,
   and mark the candidate as accepted or rejected.
5. You can group candidates by job opening and see who is at which stage.

**For the candidate**
1. Clicks the link, confirms their email, and agrees to take the interview.
2. Talks to the bot like a video call. The bot listens, speaks back, and asks
   the next question. Captions appear on screen.
3. After finishing, uploads an updated CV if asked.

**What the report shows**
- How well each answer matched the job's expectations, with quotes.
- Whether the CV claims match what the candidate actually said.
- Signs that answers were read from a script or an AI tool.
- Moments in the video worth a second look.
- Whether they left the interview tab, lost connection, or paused a lot
  before answering.

**Already built but small:** cost estimate per interview, two voice modes
(cheaper mode for long interviews), reminder email 30 minutes before,
automatic cleanup if a candidate disappears mid-interview.

---

## What other companies offer that we don't

### Needed before a company will pay us

**1. Separate login for each recruiter**
Today one password for everybody. Companies need each person to have their own
login, and to see only their own company's candidates. Managers may need
different rights from recruiters.
*Small build. Nothing else can be sold safely without it.*

**2. Connection to the hiring software they already use**
Companies track candidates in tools like Zoho Recruit, Naukri, Greenhouse or
Lever. They want the candidate to arrive from there, and the final score to go
back there automatically, so nobody copies results by hand.
*Medium build. Pick one tool first.*

**3. Candidate picks their own time slot**
Instead of emailing back and forth, the candidate opens a page, sees free
times, and books one. The time appears in the recruiter's normal calendar
(Google or Outlook). They can also reschedule or cancel.
*Medium build.*

**4. Their logo and colours, not ours**
The candidate should feel they are interviewing with that company: its logo,
its colours, its name on the email, ideally its own web address.
*Small build, very visible in every demo.*

**5. Checking the person is really the person**
A photo taken at the start, compared with the same candidate's earlier attempt.
Flags if a second voice is heard in the room, or if the camera looks virtual.
Reports it as "something to check", not as a decision.
*Medium build. Usually the first question Indian buyers ask.*

**6. Interviews in other languages**
The bot speaks and understands Hindi, Telugu and other languages, not only
English. The report can stay in English for the recruiter, with the candidate's
words kept in the original language.
*Medium build, mostly prompt work.*

### Makes us different from the crowd

**7. The bot asks a follow-up when the answer is thin**
Right now it moves to the next question. Better: if an answer is vague, it asks
one "tell me more about…" question before moving on, with a limit so it never
gets stuck.
*Medium build, likely the biggest quality jump for the effort.*

**8. A library of questions and ready-made interview plans**
Not starting from a blank page every time: save a plan, reuse it for the next
candidate for the same job, and let a manager approve the plan before the link
goes out.
*Medium build.*

**9. A round with real code**
For technical jobs: the candidate writes code in the browser, it runs and gets
tested, and the bot asks them to explain their solution. The report shows the
code and how it changed over time.
*Large build. Only if our customers hire engineers.*

**10. Help for human interviews too**
A quiet assistant joins a normal human interview, listens, writes the notes,
fills the report card, and suggests what was not covered. Sells to companies
that are not ready to let an AI interview alone.
*Large build, but opens a second product.*

**11. A better candidate experience**
A 60-second "test your mic and camera" step before starting, an option to
continue with audio only on slow internet, and a phone-call option for people
without a good connection.
*Small build. Directly reduces candidates who drop out.*

**12. Reminders on WhatsApp and SMS**
Interview reminders and "you missed your slot, book again" messages on
WhatsApp, which is how most candidates actually read messages here.
*Medium build.*

**12b. Quick screening before the interview**
A few yes/no questions and a CV check first, so only suitable people get an
interview link.
*Medium build.*

**13. Reports for managers, not just per candidate**
How many candidates at each stage, how scores are spread, which questions
actually separate good candidates from weak ones, how much each interview
costs, how long hiring takes.
*Medium build.*

### Later, for big companies

- Keeping recordings only for a fixed number of days, then deleting them.
- Deleting all data about one candidate on request.
- Proving the system is fair: version of the questions, the model used, who
  overrode a score and why.
- Single sign-on with the company's own login system.
- Public API and webhooks for their own tools.
- Spending limits per company.

---

## Things we should not copy

- **Judging feelings or personality from the face.** HireVue was criticised for
  this and pulled back. It invites bias complaints.
- **A "cheating probability" number.** Better to show what was observed and let
  a human decide.
- **Rejecting a candidate automatically.** Every serious vendor keeps a human
  in the loop. It is also what buyers trust.


