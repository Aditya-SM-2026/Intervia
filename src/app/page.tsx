import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { HeroFilm } from "@/components/marketing/HeroFilm";
import { SESSION_COOKIE, isRecruiterSession } from "@/lib/auth/session";

const OUTCOMES = [
  { figure: "Every", label: "applicant gets a real, spoken interview" },
  { figure: "1 page", label: "per candidate, every score quoted" },
  { figure: "You", label: "decide who moves forward" },
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
        <ul className="grid gap-12 sm:grid-cols-3 sm:gap-8">
          {OUTCOMES.map((item) => (
            <li key={item.figure}>
              <p className="text-4xl font-semibold tracking-[-0.03em] text-accent">{item.figure}</p>
              <p className="mt-2 max-w-[16rem] text-lg leading-snug text-foreground/80">{item.label}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-6 text-sm text-muted sm:px-8">
          <p>© {new Date().getFullYear()} Medhas Academy</p>
          <Link href={primary.href} className="font-medium text-accent hover:underline">
            {primary.label}
          </Link>
        </div>
      </footer>
    </div>
  );
}
