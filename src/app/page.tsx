import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight, Eye, Quote, Scale, UserCheck } from "lucide-react";
import { BrandEmblem, BrandMark } from "@/components/brand/BrandMark";
import {
  ConversationSpecimen,
  DecisionSpecimen,
  FocusSpecimen,
  ReportSpecimen,
} from "@/components/marketing/Specimens";
import { SESSION_COOKIE, isRecruiterSession } from "@/lib/auth/session";

const STEPS = [
  { title: "Add the role", caption: "Pick the skills that matter most.", Picture: FocusSpecimen },
  { title: "The candidate talks it through", caption: "A spoken interview in the browser, with follow-ups.", Picture: ConversationSpecimen },
  { title: "Read the report and decide", caption: "One page per candidate. You make the call.", Picture: DecisionSpecimen },
];

const PROMISES = [
  { icon: Scale, title: "Same interview for everyone", body: "Same questions, same scale.", tint: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  { icon: Quote, title: "Quotes behind every score", body: "Each score links to their words.", tint: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { icon: Eye, title: "On-camera checks", body: "Gaze and tab switches, flagged.", tint: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { icon: UserCheck, title: "A person decides", body: "Advance, hold or reject is yours.", tint: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
];

export default async function Home() {
  // Signed-in recruiters go straight to the dashboard instead of signing in.
  const signedIn = await isRecruiterSession((await cookies()).get(SESSION_COOKIE)?.value);
  const primary = signedIn
    ? { href: "/recruiter", label: "Create an interview" }
    : { href: "/login", label: "Sign in to start" };

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <BrandMark />
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold transition hover:border-accent"
          >
            {signedIn ? "Open dashboard" : "Sign in"}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className="relative py-14 lg:py-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_40%,var(--accent-soft),transparent_70%)]"
          />
          <div className="relative grid items-center gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
            <div>
              <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
                Every candidate interviewed. One page to decide.
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
                A spoken interview built from your job description, and a report where every score is backed by what
                they said.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={primary.href}
                  className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  {primary.label}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center rounded-full px-5 py-3 text-sm font-semibold text-muted transition hover:text-foreground"
                >
                  How it works
                </a>
              </div>
            </div>
            <div className="mx-auto w-full max-w-lg lg:mx-0 lg:justify-self-end">
              <ReportSpecimen />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-24 py-12 lg:py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map(({ title, caption, Picture }, index) => (
              <li key={title} className="flex flex-col rounded-3xl bg-foreground/[0.03] p-5 sm:p-6">
                <div className="flex-1">
                  <Picture />
                </div>
                <div className="mt-6 flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-0.5 text-sm text-muted">{caption}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-12 lg:py-16">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PROMISES.map(({ icon: Icon, title, body, tint }) => (
              <li key={title} className="rounded-2xl border border-border bg-surface p-5">
                <span className={`grid size-10 place-items-center rounded-xl ${tint}`}>
                  <Icon className="size-5" />
                </span>
                <p className="mt-4 font-semibold">{title}</p>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="pb-16 pt-4 lg:pb-24">
          <div className="flex flex-col items-start gap-6 rounded-3xl bg-accent px-7 py-10 text-white sm:flex-row sm:items-center sm:px-10">
            <BrandEmblem className="size-14" onDark />
            <div className="flex-1">
              <h2 className="text-2xl font-semibold tracking-tight">Run your first interview today.</h2>
              <p className="mt-1 text-white/75">Add a role, send the link, read the report.</p>
            </div>
            <Link
              href={primary.href}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-accent transition hover:bg-white/90"
            >
              {primary.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-6 text-sm text-muted sm:px-8">
          <p>© {new Date().getFullYear()} Medhas Academy</p>
          <Link href={signedIn ? "/dashboard" : "/login"} className="hover:text-foreground">
            {signedIn ? "Dashboard" : "Sign in"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
