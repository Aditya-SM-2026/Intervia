import Link from "next/link";

const steps = [
  {
    actor: "Recruiter",
    action: "Create an interview and add the role details.",
  },
  {
    actor: "Candidate",
    action: "Join through a secure shareable link.",
  },
  {
    actor: "Intervia",
    action: "Conduct a structured AI-led video interview.",
  },
];

export default function Home() {
  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            {/* <span className="grid size-8 place-items-center rounded-lg bg-accent text-sm text-white"> */}
              {/* I */}
            {/* </span> */}
            Intervia
          </Link>

          <Link
            href="/recruiter"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-4 text-sm font-medium text-accent">
            AI-powered interviews for modern hiring
          </p>

          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Run better interviews with AI
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-muted">
            Create a shareable interview link and let candidates speak with your
            AI interviewer in a live video conversation.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/recruiter"
              className="w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 sm:w-auto"
            >
              Create an interview
            </Link>

            <Link
              href="/how-it-works"
              className="w-full rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-surface sm:w-auto"
            >
              How it works
            </Link>
          </div>
        </div>

        {/* Steps */}
        <section className="mt-16 sm:mt-20">
          <div className="grid gap-4 sm:grid-cols-3">
            {steps.map(({ actor, action }, index) => (
              <div
                key={actor}
                className="rounded-xl border border-border bg-surface p-5"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Step {index + 1}
                </p>

                <h2 className="mt-2 font-semibold">{actor}</h2>
                <p className="mt-1 text-sm text-muted">{action}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Simple trust section */}
        <section className="mt-16 rounded-xl border border-border bg-surface p-6 sm:mt-20 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <h3 className="font-medium">Consistent interviews</h3>
              <p className="mt-1 text-sm text-muted">
                Every candidate receives the same structured experience.
              </p>
            </div>

            <div>
              <h3 className="font-medium">Faster screening</h3>
              <p className="mt-1 text-sm text-muted">
                Review responses and move strong candidates forward quickly.
              </p>
            </div>

            <div>
              <h3 className="font-medium">Simple workflow</h3>
              <p className="mt-1 text-sm text-muted">
                Create, share, and manage interviews from one place.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} Intervia</p>

          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}