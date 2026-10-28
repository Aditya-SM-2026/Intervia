import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { AgentBehaviourForm } from "@/components/settings/AgentBehaviourForm";
import { getAgentPersonality } from "@/lib/agent/personality.service";

export const metadata: Metadata = {
  title: "Agent behaviour",
};

// Reads the saved personality, so it must render per request, never at build.
export const dynamic = "force-dynamic";

/** The editable interviewer instructions: persona, conduct and per-difficulty style. */
export default async function AgentBehaviourPage() {
  const personality = await getAgentPersonality();

  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <div className="py-10">
          <Link
            href="/dashboard/settings"
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Settings
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight">Modify agent behaviour</h1>
          <p className="mt-2 max-w-2xl text-muted">
            The interviewer&apos;s instructions, editable without a code change. Each part is
            optional: leave it empty to keep the built-in text from the agent&apos;s prompts.
          </p>
        </div>
        <AgentBehaviourForm initial={personality} />
      </main>
    </ThemeProvider>
  );
}
