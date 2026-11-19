import type { Metadata } from "next";
import { InfoTip } from "@/components/ui/InfoTip";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import Link from "next/link";
import { Bot, ChevronRight, Database, KeyRound, Mic, Users } from "lucide-react";
import { readAgentPersonalityForSettings } from "@/lib/agent/personality.service";
import { isDefaultPersonality } from "@/lib/agent/personality.types";
import { findAgentVoice } from "@/lib/agent/agent-voices";
import { isAdmin } from "@/lib/auth/accounts.logic";
import { getActor } from "@/lib/auth/actor";
import { getAccountsRepository } from "@/server/repositories/accounts-repository";

export const metadata: Metadata = {
  title: "Settings",
};

// Reads the saved personality, so it must render per request, never at build.
export const dynamic = "force-dynamic";

/** Product and agent settings, in the shape of a usual app settings page. */
export default async function SettingsPage() {
  const { personality, available } = await readAgentPersonalityForSettings();
  const basic = isDefaultPersonality(personality);
  const voice = findAgentVoice(personality.voice);
  const actor = await getActor();
  const admin = isAdmin(actor);
  const members = admin ? await getAccountsRepository().listMembers().catch(() => []) : [];
  const activeMembers = members.filter((member) => member.active).length;

  return (
    <>
      <SettingsPageHeader title="Overview" tip="What this workspace runs on, and how the interview agent behaves." />

      {!available && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          The saved agent settings could not be loaded just now, so the built-in personality is shown. Saving still
          works; try again if the values look stale.
        </p>
      )}

      <div className="grid gap-6">
        <section className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          <LinkRow
            href="/dashboard/settings/agent"
            icon={<Bot className="size-4" aria-hidden />}
            label="Behaviour"
            value={basic ? "Built-in personality" : "Custom behaviour"}
          />
          <LinkRow
            href="/dashboard/settings/voice"
            icon={<Mic className="size-4" aria-hidden />}
            label="Voice"
            value={voice.name}
          />
          {admin ? (
            <LinkRow
              href="/dashboard/settings/team"
              icon={<Users className="size-4" aria-hidden />}
              label="Team"
              value={`${activeMembers + 1} ${activeMembers === 0 ? "person" : "people"} can sign in`}
            />
          ) : (
            <LinkRow
              href="/dashboard/settings/account"
              icon={<KeyRound className="size-4" aria-hidden />}
              label="Your password"
              value={actor?.email ?? "Your login"}
            />
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-semibold tracking-tight">Interview agent</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Voice conversation" value="Gemini Live, audio only" />
            <Row label="Language" value="English" tip="The interviewer also follows the candidate into another language if they switch." />
            <Row label="Join window" value="5 minutes" tip="The interviewer waits up to 5 minutes for the candidate to join." />
            <Row label="Recording" value="Kept and playable" tip="The recording is kept on the report and can be played back there." />
            <Row label="Interview length" value="Fixed" tip="Every interview runs to its booked time. The interviewer cannot end it early." />
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-semibold tracking-tight">Report analysis</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Report model" value="Ominibot" tip="Gemini 3.8 Flash writes the report if Ominibot is unavailable." />
            <Row label="Score weights" value="Answers 45 · Resume 20 · Authenticity 20 · Video 15" />
            <Row label="Cost gate" value="50/100" tip="When the transcript scores below 50/100, the paid video and resume analyses are skipped." />
            <Row label="Video analysis" value="Gaze and key frames" tip="Gaze is scored locally, then a vision model looks at key frames from the recording." />
          </dl>
        </section>

        <p className="flex items-center gap-2 px-1 text-sm text-muted">
          <Database className="size-4" aria-hidden />
          Data stored privately
          <InfoTip text="Interviews, transcripts, reports and recordings are stored privately for Medhas Academy and are never shared with anyone else." />
        </p>
      </div>
    </>
  );
}

function Row({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 pb-2 last:border-0">
      <dt className="flex items-center gap-1 text-xs text-muted">
        {label}
        {tip && <InfoTip text={tip} />}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinkRow({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 px-5 py-4 transition hover:bg-foreground/[0.025]">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <span className="truncate text-sm text-muted">{value}</span>
      <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
    </Link>
  );
}
