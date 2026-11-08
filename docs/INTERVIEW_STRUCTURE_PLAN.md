# Plan of execution: full-coverage interviews (Nov 8, 2026)

## What changes for the recruiter
Every interview has two parts:
1. **Their projects, in depth** (about half the time).
2. **What our job needs** (the other half).

Each part gets its own score in the report, so you can see whether the candidate is strong on their own work, on our requirements, or both.

## Today
- **The plan is a flat list of about 5 topics** made from the job description, each with a hook into the resume.
  - In practice every question becomes "tell me about your project that did X", so a candidate can prepare their whole interview from their own resume.
  - Nothing guarantees that the job's own technologies are tested directly.
- **Follow-ups dig for "your actions, your reasoning, the result".** They don't push down to the fundamentals when an answer stays on the surface.
- **Skill weights (for example Python: high)** shape the plan, topic time and the interviewer's instructions *when you change them*. Left at "normal", the role's skills are not sent at all, so they neither steer the questions nor get scored. No predev interview has had weights set, so this has never run for real.

## Target

### Part 1: projects, about 50% (configurable)
- Pick the **one or two resume projects most relevant to the job description**, not just the latest or the flashiest. The plan records why each was picked.
- For each project, a **depth ladder**:
  1. **What:** what it does and who uses it.
  2. **Your part:** what you personally built or decided.
  3. **How:** walk through the request or data flow; the main components.
  4. **Why:** a choice you made, and the alternative you rejected.
  5. **Fundamentals:** the concept underneath, for example how the model gets context or how auth tokens work.
  6. **Failure:** what broke and how you found it.
- The interviewer climbs a rung only when the answer stays shallow, and stops climbing once the answer is solid. Shallow answers are where "prepared" answers fall apart.
- **A bridge question** at the end of the part: "how would you apply what you did there to [a need from our job description]?"

### Part 2: requirements, about 50%
- **Topics are the job description's core technologies and duties.** The recruiter's skill weights decide how many questions each one gets and how much time.
- **Questions are scenario-based for our context,** not about the candidate's resume ("we need X; how would you build it?"), so preparing only one's own resume doesn't help.
- **The same depth ladder applies,** from the scenario down to the fundamentals.
- **No made-up technologies,** ever.

### Skill weights
- The role's skills are always sent, at "normal" by default, so they always steer Part 2 and are always scored.
- Raising one (Python: high) gives it more Part 2 time and more follow-ups.
- **Check after each interview:** the report shows the planned and actual minutes per skill, so you can see the weight was honoured.

### Report
- **Two sub-scores:** Projects (depth of their own work) and Requirements (fit to our job). Each is shown with its share of the time.
- **The overall answer score** is the time-weighted mix of the two.
- **"Resume depth" folds into Projects,** since it measures the same thing.

## Work, in order
1. **Plan generation** (`plan.service.ts`, `plan.types.ts`):
   - add `part: "projects" | "requirements"`, plus `project` (name, why chosen) and a `depthLadder` per competency;
   - split the time 50/50, configurable per interview;
   - always send the role's skills.
2. **Live interviewer** (`agent/…/controller.py`, `prompts.py`):
   - run the two parts in order with their time budgets;
   - the "go a rung deeper" instruction when an answer is shallow;
   - the bridge question;
   - never invent technologies.
3. **Interview creation form:**
   - a "projects / requirements" split slider, default 50/50;
   - skills always included.
4. **Scoring and report:**
   - per-part sub-scores;
   - planned vs actual minutes per skill;
   - Projects absorbs resume depth.
5. **Test:**
   - a few 2-minute calls for flow;
   - one full 30-minute call to check the split and the depth ladder;
   - one interview with Python set high, to check it gets more time.

## Integrity, also needed (from the Gayathri review)
- **Done:** the fixed-spot rule now catches a separate place the candidate goes to while answering, even when it is on the screen.
- **Proposed:** hide the full question text once the candidate starts answering (keep a short topic label and a "show question" tap). Honest reading on screen then stops, and reading-while-answering becomes a strong sign.
