"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Mail, Send, Zap } from "lucide-react";
import {
  AUTO_INVITE_DIFFICULTIES,
  AUTO_INVITE_MAX_DURATION,
  AUTO_INVITE_MIN_DURATION,
  DEFAULT_AUTO_INVITE_SETTINGS,
  type AutoInviteSettings as AutoInviteConfig,
} from "@/lib/roles/auto-invite";
import { Toast, type ToastMessage } from "@/components/ui/Toast";

interface AutoInviteState {
  settings: AutoInviteConfig;
  eligible: number;
  activity: {
    candidateName: string;
    candidateEmail: string;
    status: string;
    note: string | null;
    interviewId: string | null;
    at: string | null;
  }[];
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  "extra-hard": "Extra hard",
};

/**
 * The role's automatic interview invitations: one switch, the Match bar, and
 * the interview setup every invited candidate gets. Off by default; turning it
 * on sends nothing until a candidate clears the bar or HR presses Run now.
 */
export function AutoInviteSettings({ roleId }: { roleId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<AutoInviteConfig>({ ...DEFAULT_AUTO_INVITE_SETTINGS });
  // The number fields keep their own text while typing, so clearing the box or
  // typing "70" one digit at a time is not clamped back to the minimum.
  const [thresholdText, setThresholdText] = useState(String(DEFAULT_AUTO_INVITE_SETTINGS.threshold));
  const [durationText, setDurationText] = useState(String(DEFAULT_AUTO_INVITE_SETTINGS.durationMinutes));
  const [state, setState] = useState<AutoInviteState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const url = `/api/roles/${encodeURIComponent(roleId)}/auto-invite`;

  function apply(body: AutoInviteState) {
    setSettings({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings });
    setThresholdText(String({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings }.threshold));
    setDurationText(String({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings }.durationMinutes));
    setState(body);
    setError(null);
  }

  /** Reads a field's text and keeps it inside the allowed range. */
  function readThreshold(text: string): number {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) return settings.threshold;
    return Math.min(100, Math.max(1, Math.round(parsed)));
  }

  function readDuration(text: string): number {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) return settings.durationMinutes;
    return Math.min(
      AUTO_INVITE_MAX_DURATION,
      Math.max(AUTO_INVITE_MIN_DURATION, Math.round(parsed)),
    );
  }

  function commitThreshold() {
    const value = readThreshold(thresholdText);
    setSettings((current) => ({ ...current, threshold: value }));
    setThresholdText(String(value));
  }

  function commitDuration() {
    const value = readDuration(durationText);
    setSettings((current) => ({ ...current, durationMinutes: value }));
    setDurationText(String(value));
  }

  function saveNumbers() {
    const threshold = readThreshold(thresholdText);
    const durationMinutes = readDuration(durationText);
    setThresholdText(String(threshold));
    setDurationText(String(durationMinutes));
    void save({ threshold, durationMinutes }, "Automatic invitation settings saved.");
  }

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (response) => {
        const body = (await response.json()) as AutoInviteState & { error?: { message?: string } };
        if (!response.ok || !body.settings) {
          throw new Error(body.error?.message ?? "Could not load the automatic invitations.");
        }
        return body;
      })
      .then((body) => {
        if (!cancelled) apply(body);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the automatic invitations.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function save(patch: Partial<AutoInviteConfig>, message = "Automatic invitations saved.") {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = (await response.json()) as { settings?: AutoInviteConfig; error?: { message?: string } };
      if (!response.ok || !body.settings) {
        throw new Error(body.error?.message ?? "Could not save the setting.");
      }
      setSettings({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings });
      setThresholdText(String({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings }.threshold));
      setDurationText(String({ ...DEFAULT_AUTO_INVITE_SETTINGS, ...body.settings }.durationMinutes));
      setError(null);
      setToast({ tone: "success", message });
      void refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the setting.");
      setSettings(settings);
      setThresholdText(String(settings.threshold));
      setDurationText(String(settings.durationMinutes));
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    try {
      const response = await fetch(url);
      const body = (await response.json()) as AutoInviteState & { error?: { message?: string } };
      if (response.ok && body.settings) {
        return body;
      }
    } catch {
      // A refresh failure leaves the saved values on screen; the next action retries.
    }
    return null;
  }

  async function runNow() {
    setRunning(true);
    try {
      const response = await fetch(`${url}/run`, { method: "POST" });
      const body = (await response.json()) as {
        invited?: number;
        failed?: number;
        skipped?: number;
        state?: AutoInviteState;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not send the invitations.");
      if (body.state) setState(body.state);
      const invited = body.invited ?? 0;
      const failed = body.failed ?? 0;
      const skipped = body.skipped ?? 0;
      setError(null);
      setToast({
        tone: failed > 0 && invited === 0 ? "error" : "success",
        message:
          invited === 0 && failed === 0
            ? skipped > 0
              ? "Everyone who clears the bar already has an interview."
              : "No candidate clears the bar yet."
            : `Sent ${invited} invitation${invited === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}${
                skipped ? `, ${skipped} skipped` : ""
              }.`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the invitations.");
    } finally {
      setRunning(false);
    }
  }

  const enabled = settings.enabled;
  const statusLine = settings.enabled
    ? `On · Match ${settings.threshold} and above · ${settings.durationMinutes} min · ${settings.difficulty}`
    : "Off · nobody is invited automatically";

  return (
    <section
      aria-label="Automatic interview invitations"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.02]"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-3.5 lg:shrink-0">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${
              enabled ? "bg-accent-soft text-accent" : "bg-foreground/[0.06] text-muted"
            }`}
          >
            <Zap className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Automatic invitations</h2>
            {loading ? (
              <div className="skeleton mt-1.5 h-3.5 w-48 rounded" />
            ) : (
              <p className="mt-0.5 text-sm text-muted">{statusLine}</p>
            )}
          </div>
        </div>

        <span className="hidden grow lg:block" />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running || loading || !enabled}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-foreground/[0.03] disabled:opacity-40"
          >
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            Run now
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span className={`${enabled ? "font-medium text-accent" : "text-muted"}`}>
              {enabled ? "On" : "Off"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Invite candidates who clear the Match bar"
              disabled={loading || saving}
              onClick={() => void save({ enabled: !enabled }, enabled ? "Automatic invitations stopped." : "Automatic invitations on.")}
              className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-accent" : "bg-foreground/20"} disabled:opacity-50`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition ${enabled ? "left-[18px]" : "left-0.5"}`}
              />
            </button>
          </label>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition hover:opacity-90"
          >
            Set up
            <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-4 rounded-xl bg-rose-500/[0.07] px-3.5 py-2 text-sm text-rose-700 sm:mx-5 dark:text-rose-300">
          {error}
        </p>
      )}

      {!loading && state && state.eligible > 0 && (
        <p className="mx-4 mb-4 rounded-xl bg-accent-soft px-3.5 py-2 text-sm text-accent sm:mx-5">
          {state.eligible} candidate{state.eligible === 1 ? "" : "s"} clear the bar and
          {state.eligible === 1 ? " has" : " have"} not been invited yet.
          {!enabled && " Switch it on to send."}
        </p>
      )}

      {open && (
        <div className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="rounded-xl border border-border px-3 py-2.5">
              <span className="block text-xs font-medium text-muted">Match score at least</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={3}
                  value={thresholdText}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setThresholdText(event.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={commitThreshold}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <span className="text-sm text-muted">/ 100</span>
              </span>
            </label>
            <label className="rounded-xl border border-border px-3 py-2.5">
              <span className="block text-xs font-medium text-muted">Interview length</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={durationText}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setDurationText(event.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={commitDuration}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                <span className="text-sm text-muted">minutes</span>
              </span>
            </label>
            <label className="rounded-xl border border-border px-3 py-2.5">
              <span className="block text-xs font-medium text-muted">Difficulty</span>
              <select
                value={settings.difficulty}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    difficulty: event.target.value as AutoInviteConfig["difficulty"],
                  }))
                }
                className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
              >
                {AUTO_INVITE_DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {DIFFICULTY_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            <label className="rounded-xl border border-border px-3 py-2.5">
              <span className="block text-xs font-medium text-muted">Copy to HR (optional)</span>
              <input
                type="email"
                value={settings.hrEmail ?? ""}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, hrEmail: event.target.value }))
                }
                placeholder="hr@company.com"
                className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted">
              Every invited candidate gets their own interview link by email. People already scheduled,
              running or finished are never invited again.
            </p>
            <span className="grow" />
            <button
              type="button"
              onClick={saveNumbers}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-40"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Mail className="size-4 text-muted" aria-hidden />
              Recent invitations
            </h3>
            {state && state.activity.length > 0 ? (
              <ul className="mt-2 divide-y divide-border">
                {state.activity.map((entry) => (
                  <li key={`${entry.candidateEmail}-${entry.at ?? ""}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="font-medium">{entry.candidateName}</span>
                    <span className="text-muted">{entry.candidateEmail}</span>
                    <span className="grow" />
                    <span
                      className={
                        entry.status === "sent"
                          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                          : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
                      }
                      title={entry.note ?? undefined}
                    >
                      {entry.status === "sent" ? "Invitation sent" : entry.status === "email_failed" ? "Email failed" : "Not sent"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No automatic invitations yet.</p>
            )}
          </div>
        </div>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
