import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { AgentVoiceForm } from "@/components/settings/AgentVoiceForm";
import { readAgentPersonalityForSettings } from "@/lib/agent/personality.service";

export const metadata: Metadata = {
  title: "Agent voice",
};

// Reads the saved voice, so it must render per request, never at build.
export const dynamic = "force-dynamic";

/** The interviewer's voice: five options, each with a sample to hear first. */
export default async function AgentVoicePage() {
  const { personality, available } = await readAgentPersonalityForSettings();

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
          <h1 className="text-4xl font-semibold tracking-tight">Change voice tone</h1>
          <p className="mt-2 max-w-2xl text-muted">
            Pick how the interviewer sounds. Listen to a sample for each voice, then save the one
            you want. Every interview from then on uses it.
          </p>
        </div>
        {!available && (
          <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            The saved voice could not be loaded just now, so the default is shown. Saving will
            overwrite the stored choice, so check it before you save.
          </p>
        )}
        <AgentVoiceForm initial={personality} />
      </main>
    </ThemeProvider>
  );
}
