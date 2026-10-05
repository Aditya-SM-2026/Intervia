import Link from "next/link";

const steps = [
  {
    actor: "Recruiter",
    action: "creates an interview link and shares it with the candidate.",
  },
  {
    actor: "Candidate",
    action: "opens the link and grants camera + microphone access.",
  },
  {
    actor: "AI agent",
    action: "joins the LiveKit room and holds a voice conversation.",
  },
];

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface/40 p-6">
      <div className="w-full max-w-3xl rounded-3xl border border-border bg-background p-8 leading-relaxed shadow-sm sm:p-12">
        <Link href="/" className="mb-12 inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-sm text-white">I</span>
          Intervia
        </Link>
        <p className="mb-3 text-sm font-medium text-accent">AI-powered conversations for better hiring.</p>
        <h1 className="mb-4 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Better interviews start with a better conversation.
        </h1>
        <p className="mb-8 max-w-2xl text-muted">
          Create a shareable interview link and let candidates meet your AI
          interviewer in a live video conversation.
        </p>
        <ul className="mb-8 grid gap-3 sm:grid-cols-3">
          {steps.map(({ actor, action }) => (
            <li key={actor} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <strong className="mb-1 block">{actor}</strong>
              <span className="text-muted">{action}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/recruiter"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Create an interview
          </Link>
        </div>
      </div>
    </main>
  );
}