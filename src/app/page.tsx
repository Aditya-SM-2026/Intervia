import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandEmblem, BrandMark } from "@/components/brand/BrandMark";
import { HeroFilm } from "@/components/marketing/HeroFilm";
import { SESSION_COOKIE, isRecruiterSession } from "@/lib/auth/session";

const AVATARS = [
  { initials: "PR", tint: "bg-violet-500/15 text-violet-700" },
  { initials: "AK", tint: "bg-sky-500/15 text-sky-700" },
  { initials: "SM", tint: "bg-emerald-500/15 text-emerald-700" },
  { initials: "RV", tint: "bg-amber-500/15 text-amber-700" },
  { initials: "NJ", tint: "bg-rose-500/15 text-rose-700" },
];

/** Every applicant: a stack of people, each with a live interview. */
function CrowdPicture() {
  return (
    <div className="flex items-center">
      {AVATARS.map((person, index) => (
        <span
          key={person.initials}
          className={`grid size-11 place-items-center rounded-full border-2 border-surface text-xs font-semibold ${person.tint} ${index > 0 ? "-ml-3" : ""}`}
        >
          {person.initials}
        </span>
      ))}
      <span className="-ml-3 grid size-11 place-items-center rounded-full border-2 border-surface bg-accent text-xs font-semibold text-white">
        +200
      </span>
    </div>
  );
}

/** One page: a tiny report. */
function PagePicture() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-12 place-items-center rounded-full border-[5px] border-emerald-500 text-sm font-semibold tabular-nums">
        82
      </span>
      <span className="grid flex-1 gap-1.5">
        {[84, 70, 58].map((width) => (
          <span key={width} className="h-1.5 rounded-full bg-foreground/[0.07]">
            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${width}%` }} />
          </span>
        ))}
      </span>
    </div>
  );
}

/** Your call: the three decisions, one chosen. */
function DecisionPicture() {
  return (
    <div className="flex gap-1.5 text-xs font-semibold">
      <span className="rounded-lg bg-emerald-600 px-3 py-2 text-white">Advance</span>
      <span className="rounded-lg border border-border px-3 py-2 text-muted">Hold</span>
      <span className="rounded-lg border border-border px-3 py-2 text-muted">Reject</span>
    </div>
  );
}

const OUTCOMES = [
  { figure: "Every applicant", label: "gets a real, spoken interview.", Picture: CrowdPicture },
  { figure: "One page", label: "per candidate, every score quoted.", Picture: PagePicture },
  { figure: "Your call", label: "on who moves forward.", Picture: DecisionPicture },
];

export default async function Home() {
  // Signed-in recruiters go straight to work instead of signing in.
  const signedIn = await isRecruiterSession((await cookies()).get(SESSION_COOKIE)?.value);
  const primary = signedIn
    ? { href: "/recruiter", label: "Create an interview" }
    : { href: "/login", label: "Sign in to start" };

  return (
    <div className="min-h-dvh overflow-x-clip bg-background">
      <section className="relative isolate overflow-hidden bg-[#08123a] text-white">
        {/* Light from above, and a faint grid that fades out: the room the film plays in. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_0%,rgba(74,114,245,0.55),transparent_70%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-[0.08] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(60%_50%_at_50%_30%,black,transparent)]"
        />

        <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <BrandMark onDark />
          <Link
            href={signedIn ? "/dashboard" : "/login"}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            {signedIn ? "Open dashboard" : "Sign in"}
          </Link>
        </header>

        <div className="mx-auto max-w-4xl px-5 pb-24 pt-14 text-center sm:px-8 lg:pt-20">
          <h1 className="text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl">
            Interview everyone.
            <br />
            Hire on evidence.
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-white/70">
            A spoken interview for every applicant, and a one-page report you can trust.
          </p>
          <div className="mt-9 flex justify-center">
            <Link
              href={primary.href}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#08123a] transition hover:bg-white/90"
            >
              {primary.label}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="mx-auto mt-16 max-w-3xl text-left">
            <HeroFilm />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <ul className="grid gap-5 md:grid-cols-3">
          {OUTCOMES.map(({ figure, label, Picture }) => (
            <li key={figure} className="flex flex-col rounded-3xl border border-border bg-surface p-7">
              <div className="flex h-14 items-center">
                <Picture />
              </div>
              <p className="mt-8 text-2xl font-semibold tracking-[-0.02em]">{figure}</p>
              <p className="mt-1 text-muted">{label}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative isolate overflow-hidden bg-[#08123a] text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_100%,rgba(74,114,245,0.45),transparent_70%)]"
        />
        <div className="mx-auto max-w-6xl px-5 pb-10 pt-20 text-center sm:px-8 lg:pt-24">
          <BrandEmblem className="mx-auto size-14" onDark />
          <h2 className="mx-auto mt-6 max-w-xl text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
            Your next hire is one link away.
          </h2>
          <Link
            href={primary.href}
            className="group mt-9 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#08123a] transition hover:bg-white/90"
          >
            {primary.label}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <footer className="mt-20 flex items-center justify-between gap-3 border-t border-white/10 pt-6 text-sm text-white/50">
            <p>© {new Date().getFullYear()} Medhas Academy</p>
            <Link href={signedIn ? "/dashboard" : "/login"} className="transition hover:text-white">
              {signedIn ? "Open dashboard" : "Sign in"}
            </Link>
          </footer>
        </div>
      </section>
    </div>
  );
}
