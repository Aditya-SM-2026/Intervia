import type { Metadata } from "next";
import { InfoTip } from "@/components/ui/InfoTip";
import Link from "next/link";
import { Bot, ChevronRight, Database, History, KeyRound, Mic, SlidersHorizontal, Users } from "lucide-react";
import { BrandEmblem } from "@/components/brand/BrandMark";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/components/dashboard/theme";
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
    <ThemeProvider>
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
        <div className="py-10">
          <h1 className="flex items-center gap-2 text-4xl font-semibold tracking-tight">
            Settings
            <InfoTip text="What this workspace runs on, and how the interview agent behaves." />
          </h1>
        </div>

        <div className="grid gap-6">
          {!available && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              The saved agent settings could not be loaded just now, so the built-in
              personality is shown. Saving still works; try again if the values look stale.
            </p>
          )}
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-center gap-4">
              <BrandEmblem className="size-14" />
              <div className="min-w-0">
                <p className="text-lg font-semibold tracking-tight">Medhas Academy Interviews</p>
                <p className="text-sm text-muted">
                  AI interview agent
                </p>
              </div>
            </div>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            <SettingsCard
              href="/dashboard/settings/agent"
              icon={<Bot className="size-5" aria-hidden />}
              title="Agent behaviour"
              tip="Change how the interviewer speaks and runs the interview. Blank text fields keep the built-in behaviour."
              badge={basic ? "Basic personality in use" : "Custom behaviour in use"}
              badgeIcon={<SlidersHorizontal className="size-3.5" aria-hidden />}
            />
            <SettingsCard
              href="/dashboard/settings/voice"
              icon={<Mic className="size-5" aria-hidden />}
              title="Voice and engine"
              tip="Hear a sample of each interviewer voice, and choose which engine runs the call. Every interview uses both."
              badge={`${voice.name} · ${voice.tone}`}
              badgeIcon={<Mic className="size-3.5" aria-hidden />}
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {admin ? (
              <>
                <SettingsCard
                  href="/dashboard/settings/team"
                  icon={<Users className="size-5" aria-hidden />}
                  title="Team"
                  tip="Give each person who hires with you their own login, reset passwords, and turn accounts off."
                  badge={`${activeMembers + 1} ${activeMembers === 0 ? "person" : "people"} can sign in`}
                />
                <SettingsCard
                  href="/dashboard/settings/activity"
                  icon={<History className="size-5" aria-hidden />}
                  title="Activity"
                  tip="Who did what and when: sign-ins, roles, invitations, interviews, decisions, settings and downloads."
                  badge="Everyone's actions"
                />
              </>
            ) : (
              <SettingsCard
                href="/dashboard/settings/account"
                icon={<KeyRound className="size-5" aria-hidden />}
                title="Your password"
                tip="Change the password you sign in with."
                badge={actor?.email ?? "Your login"}
              />
            )}
          </div>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="font-semibold tracking-tight">Interview agent</h2>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Voice conversation" value="Gemini Live, audio only" />
              <Row label="Voice" value={`${voice.name} · ${voice.tone}`} />
              <Row
                label="Voice engine"
                value={personality.voiceMode === "rolling" ? "Lower cost" : "Standard"}
              />
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

          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-muted">
                <Database className="size-5" aria-hidden />
              </span>
              <p className="flex items-center gap-2 self-center font-semibold tracking-tight">
                Data stored privately
                <InfoTip text="Interviews, transcripts, reports and recordings are stored privately for Medhas Academy and are never shared with anyone else." />
              </p>
            </div>
          </section>
        </div>
      </main>
    </ThemeProvider>
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

function SettingsCard({
  href,
  icon,
  title,
  tip,
  badge,
  badgeIcon,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  tip: string;
  badge: string;
  badgeIcon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-5 transition hover:border-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">{icon}</span>
        <ChevronRight className="size-5 shrink-0 text-muted transition group-hover:text-foreground" aria-hidden />
      </div>
      <div>
        <p className="flex items-center gap-1.5 font-semibold tracking-tight">
          {title}
          <InfoTip text={tip} />
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted">
          {badgeIcon}
          {badge}
        </p>
      </div>
    </Link>
  );
}
