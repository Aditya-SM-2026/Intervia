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
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-border bg-surface p-8 leading-relaxed">
        <h1 className="mb-3 text-3xl font-semibold">AI Video Interview Platform</h1>
        <p className="mb-4">
          Recruiters create a shareable interview link. Candidates join from their
          browser with camera and microphone and talk with an AI interviewer in a
          real-time LiveKit room.
        </p>
        <ul className="mb-4 grid list-disc gap-2 pl-5">
          {steps.map(({ actor, action }) => (
            <li key={actor}>
              <strong>{actor}</strong> {action}
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
        <p className="mt-4 text-sm text-muted">
          Phases 1–3 complete: link creation, join flow and the live
          camera/microphone room. The AI voice conversation arrives next.
        </p>
      </div>
    </main>
  );
}