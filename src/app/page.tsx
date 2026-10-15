import { cookies } from "next/headers";
import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { SESSION_COOKIE, isRecruiterSession } from "@/lib/auth/session";

const steps = [
  {
    title: "Add the role and the resume",
    body: "Intervia turns the job description into an interview plan: the competencies that matter, one core question for each, and what a strong answer looks like.",
  },
  {
    title: "The candidate talks to the interviewer",
    body: "A live spoken conversation in the browser. The interviewer follows the plan, asks follow-ups on what the candidate actually said, and keeps to time.",
  },
  {
    title: "You read the scorecard and decide",
    body: "Each competency is scored 1 to 5 and backed by the candidate's own words, linked to the transcript. The decision stays with you.",
  },
];

const SPECIMEN_BARS = [3, 6, 10, 15, 9, 13, 18, 12, 7, 14, 9, 5, 11, 6, 3];

export default async function Home() {
  // Signed-in recruiters get a direct dashboard link instead of a sign-in button.
  const signedIn = await isRecruiterSession((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <BrandMark />
        <Link
          href="/dashboard"
          className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:border-accent"
        >
          {signedIn ? "Open dashboard" : "Recruiter sign-in"}
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] sm:text-6xl">
              A real interview, held by voice, scored on evidence.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Intervia interviews each candidate out loud, to a plan built from your job
              description, and gives you a scorecard where every score points to what the
              candidate said.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/recruiter"
                className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Create an interview
              </Link>
              <a
                href="#how-it-works"
                className="rounded-md border border-border bg-surface px-5 py-3 text-sm font-semibold transition hover:border-accent"
              >
                See how it works
              </a>
            </div>
          </div>

          {/* A specimen of the product: one exchange and the score it produced. */}
          <figure className="rounded-2xl border border-border bg-surface p-6 sm:p-7">
            <div className="flex h-12 items-center gap-1" aria-hidden="true">
              {SPECIMEN_BARS.map((height, index) => (
                <span
                  key={index}
                  className={`w-1.5 rounded-full ${index < 8 ? "bg-accent" : "bg-candidate"}`}
                  style={{ height: `${height * 2.4}px` }}
                />
              ))}
            </div>
            <dl className="mt-5 grid gap-4 text-[15px] leading-relaxed">
              <div>
                <dt className="text-sm font-medium text-accent">Interviewer</dt>
                <dd>How did you check that no balances drifted during the cutover?</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-candidate">Candidate</dt>
                <dd>
                  We ran both systems side by side for two weeks and only switched once the
                  mismatch rate had been zero for five days.
                </dd>
              </div>
            </dl>
            <figcaption className="mt-6 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">Zero-downtime migrations</span>
                <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                  <span className="flex gap-1" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((step) => (
                      <span
                        key={step}
                        className={`h-2 w-5 rounded-sm ${step <= 4 ? "bg-accent" : "bg-border"}`}
                      />
                    ))}
                  </span>
                  4 of 5
                </span>
              </div>
              <p className="mt-2 border-l-2 border-candidate pl-3 text-sm text-muted">
                “only switched once the mismatch rate had been zero for five days”
              </p>
            </figcaption>
          </figure>
        </section>

        <section id="how-it-works" className="scroll-mt-8 border-t border-border py-14">
          <h2 className="text-2xl font-semibold sm:text-3xl">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="font-display text-3xl font-semibold text-accent">{index + 1}</span>
                <h3 className="mt-2 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-8 border-t border-border py-14 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">The same interview for every candidate</h2>
            <p className="mt-3 max-w-md leading-relaxed text-muted">
              Everyone applying for a role is asked the same core questions and graded on the
              same scale, so two scorecards can be compared.
            </p>
          </div>
          <ul className="divide-y divide-border border-y border-border text-[15px] leading-relaxed">
            <li className="py-4">
              <span className="font-semibold">Scores you can check.</span>{" "}
              <span className="text-muted">
                A score is only shown when its quotes are found in the transcript.
              </span>
            </li>
            <li className="py-4">
              <span className="font-semibold">Integrity signals that are measured.</span>{" "}
              <span className="text-muted">
                Time away from the interview tab and connection drops are counted. Voice, face
                and gaze are not analysed.
              </span>
            </li>
            <li className="py-4">
              <span className="font-semibold">A person decides.</span>{" "}
              <span className="text-muted">
                The scorecard advises. Advance, hold or reject is recorded by the recruiter.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-6 text-sm text-muted sm:px-8">
          © {new Date().getFullYear()} Intervia
        </p>
      </footer>
    </div>
  );
}
