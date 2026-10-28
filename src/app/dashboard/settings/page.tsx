import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Bot, ChevronRight, Database, SlidersHorizontal } from "lucide-react";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
import { getAgentPersonality } from "@/lib/agent/personality.service";
import { isDefaultPersonality } from "@/lib/agent/personality.types";

export const metadata: Metadata = {
  title: "Settings",
};

// Reads the saved personality, so it must render per request, never at build.
export const dynamic = "force-dynamic";

/** Product and agent settings, in the shape of a usual app settings page. */
export default async function SettingsPage() {
  const personality = await getAgentPersonality();
  const basic = isDefaultPersonality(personality);

  return (
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <div className="py-10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">Settings</p>
          <h1 className="text-4xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 max-w-2xl text-muted">
            What this workspace runs on, and how the interview agent behaves.
          </p>
        </div>

        <div className="grid gap-6">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid h-14 w-44 place-items-center rounded-xl bg-white px-3 py-2">
                <Image
                  src="/company_logo_sreemedhas.png"
                  alt="Sreemedhas Software Technologies"
                  width={176}
                  height={46}
                  className="h-full w-auto object-contain"
                />
              </span>
              <div className="min-w-0">
                <p className="text-lg font-semibold tracking-tight">Sreemedhas Agent</p>
                <p className="text-sm text-muted">
                  Sreemedhas Software Technologies Pvt Ltd · AI interview agent
                </p>
              </div>
            </div>
          </section>

          <Link
            href="/dashboard/settings/agent"
            className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5 transition hover:border-accent/50"
          >
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
                <Bot className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold tracking-tight">Modify agent behaviour</p>
                <p className="mt-1 max-w-xl text-sm text-muted">
                  Change how the interviewer speaks and runs the interview. Blank fields keep the
                  built-in behaviour.
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted">
                  <SlidersHorizontal className="size-3.5" aria-hidden />
                  {basic ? "Basic personality in use" : "Custom behaviour in use"}
                </p>
              </div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted transition group-hover:text-foreground" aria-hidden />
          </Link>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold tracking-tight">Interview agent</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Voice conversation" value="Gemini Live, audio only" />
              <Row label="Voice" value="Charon (set per environment)" />
              <Row label="Language" value="English (plus the languages the candidate uses)" />
              <Row label="Join window" value="The agent waits up to 5 minutes for the candidate" />
              <Row label="Recording" value="Kept on the report and playable" />
              <Row label="Interview length" value="Fixed to the booked time; the agent cannot end it early" />
            </dl>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold tracking-tight">Report analysis</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Report model" value="Ominibot, Gemini 3.8 Flash as the fallback" />
              <Row label="Score weights" value="Answers 45 · Resume 20 · Authenticity 20 · Video 15" />
              <Row label="Cost gate" value="Below 50/100 on the transcript, the paid analyses are skipped" />
              <Row label="Video analysis" value="Local gaze scoring, plus a vision pass on key frames" />
            </dl>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-muted">
                <Database className="size-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold tracking-tight">Data</p>
                <p className="mt-1 text-sm text-muted">
                  Interviews, transcripts, scorecards and recordings live in this workspace&apos;s own
                  Cloud SQL database and storage bucket. Nothing is shared between workspaces.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </ThemeProvider>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 pb-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
