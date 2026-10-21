import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight, Clock, Eye, Mic, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { SESSION_COOKIE, isRecruiterSession } from "@/lib/auth/session";

const steps = [
  {
    icon: Sparkles,
    title: "Add the role and the resume",
    body: "Intervia turns the job description into an interview plan: the competencies that matter, one core question for each, and what a strong answer looks like.",
  },
  {
    icon: Mic,
    title: "The candidate talks to the interviewer",
    body: "A live spoken conversation in the browser. The interviewer follows the plan, asks follow-ups on what the candidate actually said, and keeps to time.",
  },
  {
    icon: Scale,
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
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <BrandMark />
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            {signedIn ? "Open dashboard" : "Recruiter sign-in"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* Hero */}
        <section className="relative overflow-hidden py-14 lg:py-24">
          {/* one quiet wash of the product's blue, behind the hero only */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-40 h-[480px] bg-[radial-gradient(60%_60%_at_50%_20%,var(--accent-soft),transparent_70%)]"
          />
          <div className="relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div>
              <h1 className="text-[2.6rem] font-semibold leading-[1.06] sm:text-6xl lg:text-[4.2rem]">
                A real interviews done . 
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Intervia interviews each candidate out loud, to a plan built from your job
                description, and gives you a scorecard where every score points to what the
                candidate said.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/recruiter"
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  Create an interview
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-3 text-sm font-semibold transition hover:border-accent"
                >
                  See how it works
                </a>
              </div>
              <p className="mt-6 flex items-center gap-2 text-sm text-muted">
                <ShieldCheck className="h-4 w-4 text-candidate" />
                Every score links to the candidate&apos;s own words.
              </p>
            </div>

            {/* A specimen of the product: one exchange and the score it produced. */}
            <figure className="relative rounded-2xl border border-border bg-surface p-6 shadow-[0_24px_60px_-30px_rgba(16,24,40,0.35)] sm:p-7">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  Live interview
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted tabular-nums">
                  <Clock className="h-3.5 w-3.5" />
                  18:24 / 30:00
                </span>
              </div>
              <div className="mt-5 flex h-12 items-center gap-1" aria-hidden="true">
                {SPECIMEN_BARS.map((height, index) => (
                  <span
                    key={index}
                    className={`w-1.5 rounded-full ${index < 8 ? "bg-accent" : "bg-candidate"}`}
                    style={{ height: `${height * 2.4}px` }}
                  />
                ))}
              </div>
              <dl className="mt-5 grid gap-4 text-[15px] leading-relaxed">
                <div className="rounded-xl border border-border/70 bg-background/60 p-3.5">
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                    <Mic className="h-3.5 w-3.5" />
                    Interviewer
                  </dt>
                  <dd className="mt-1.5">
                    How did you check that no balances drifted during the cutover?
                  </dd>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/60 p-3.5">
                  <dt className="text-xs font-semibold text-candidate">Candidate</dt>
                  <dd className="mt-1.5">
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
          </div>
        </section>

        {/* How it works: a real sequence, so the numbered line is earned. */}
        <section id="how-it-works" className="scroll-mt-24 border-t border-border py-16 lg:py-20">
          <h2 className="text-2xl font-semibold sm:text-3xl">How it works</h2>
          <ol className="relative mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            {/* the connecting line across the three steps */}
            <span
              aria-hidden="true"
              className="absolute left-0 right-0 top-6 hidden h-px bg-border md:block"
            />
            {steps.map((step, index) => (
              <li key={step.title} className="relative">
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface">
                  <step.icon className="h-5 w-5 text-accent" />
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                    {index + 1}
                  </span>
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Fairness and trust */}
        <section className="grid gap-10 border-t border-border py-16 lg:py-20 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">
              The same interview for every candidate
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-muted">
              Everyone applying for a role is asked the same core questions and graded on the
              same scale, so two scorecards can be compared.
            </p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { icon: Eye, label: "Evidence-linked" },
                { icon: ShieldCheck, label: "Measured integrity" },
                { icon: Scale, label: "Human decision" },
              ].map((chip) => (
                <li
                  key={chip.label}
                  className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium"
                >
                  <chip.icon className="h-4 w-4 text-accent" />
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface px-5 text-[15px] leading-relaxed">
            <li className="py-5">
              <span className="font-semibold">Scores you can check.</span>{" "}
              <span className="text-muted">
                A score is only shown when its quotes are found in the transcript.
              </span>
            </li>
            <li className="py-5">
              <span className="font-semibold">Integrity signals that are measured.</span>{" "}
              <span className="text-muted">
                Time away from the interview tab and connection drops are counted. Voice, face
                and gaze are not analysed.
              </span>
            </li>
            <li className="py-5">
              <span className="font-semibold">A person decides.</span>{" "}
              <span className="text-muted">
                The scorecard advises. Advance, hold or reject is recorded by the recruiter.
              </span>
            </li>
          </ul>
        </section>

        {/* Closing call to action */}
        <section className="pb-16 lg:pb-24">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-accent-soft px-6 py-12 text-center sm:px-12">
            <h2 className="text-2xl font-semibold sm:text-3xl">Hear your next hire before you meet them.</h2>
            <p className="mx-auto mt-3 max-w-lg text-muted">
              Set up a role in minutes. The first interview can run today.
            </p>
            <Link
              href="/recruiter"
              className="group mt-7 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              Create an interview
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-5 py-6 text-sm text-muted sm:flex-row sm:items-center sm:px-8">
          <p>© {new Date().getFullYear()} Intervia</p>
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-candidate" />
            Scores backed by the transcript. Decisions by people.
          </p>
        </div>
      </footer>
    </div>
  );
}