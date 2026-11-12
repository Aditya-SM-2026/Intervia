"use client";

import { useState } from "react";
import { Loader2, Mail, X } from "lucide-react";

interface BulkResult {
  email: string;
  name: string | null;
  status: "created" | "skipped" | "failed";
  url?: string;
  emailed?: boolean;
  reason?: string;
}

/**
 * One interview setup for everyone selected. Each candidate gets their own room
 * and their own link, and the invitation email goes out as soon as their
 * interview exists. The results list stays on screen so a partial failure is
 * visible instead of being averaged into a number.
 */
export function BulkScheduleDialog({
  roleId,
  candidateIds,
  onClose,
  onDone,
}: {
  roleId: string;
  candidateIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState("medium");
  const [voiceMode, setVoiceMode] = useState("standard");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [hrEmail, setHrEmail] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkResult[] | null>(null);

  /**
   * One interview plan is produced by the model and takes several seconds, so
   * the candidates go up in small batches. Each request stays well inside the
   * deployment's request timeout and the dialog can show progress instead of
   * hanging on one long call.
   */
  const CHUNK = 3;

  async function schedule() {
    if (running) return;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: candidateIds.length });
    const collected: BulkResult[] = [];
    try {
      for (let index = 0; index < candidateIds.length; index += CHUNK) {
        const chunk = candidateIds.slice(index, index + CHUNK);
        const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/interviews/bulk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateIds: chunk,
            durationMinutes,
            difficulty,
            voiceMode,
            scheduledDate: scheduledDate || undefined,
            scheduledTime: scheduledTime || undefined,
            hrEmail: hrEmail || undefined,
          }),
        });
        const body = (await response.json()) as {
          results?: BulkResult[];
          error?: { message?: string };
        };
        if (!response.ok || !body.results) {
          throw new Error(body.error?.message ?? "Could not schedule the interviews.");
        }
        collected.push(...body.results);
        setProgress({ done: collected.length, total: candidateIds.length });
      }
      setResults(collected);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule the interviews.");
      if (collected.length > 0) setResults(collected);
    } finally {
      setRunning(false);
    }
  }

  const created = results?.filter((item) => item.status === "created").length ?? 0;
  const notCreated = (results?.length ?? 0) - created;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Schedule interviews">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Schedule interviews</h2>
            <p className="mt-0.5 text-sm text-muted">
              {candidateIds.length} candidate{candidateIds.length === 1 ? "" : "s"} · one setup, one link
              and one email each
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {results === null ? (
          <div className="space-y-3 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Length</span>
                <select
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  {[15, 20, 30, 45].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="extra-hard">Extra hard</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Mode</span>
                <select
                  value={voiceMode}
                  onChange={(event) => setVoiceMode(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                >
                  <option value="standard">Standard</option>
                  <option value="rolling">Rolling</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">HR to sit in (optional)</span>
                <input
                  type="email"
                  value={hrEmail}
                  onChange={(event) => setHrEmail(event.target.value)}
                  placeholder="hr@company.com"
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Date (optional)</span>
                <input
                  type="date"
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Time (optional)</span>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-accent"
                />
              </label>
            </div>
            <p className="text-xs text-muted">
              Leave the date and time empty and each link works straight away. Every candidate gets a
              separate link, and the invitation email goes out immediately. Preparing each interview
              takes a few seconds, so the list fills in as it goes.
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg px-3 text-sm text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void schedule()}
                disabled={running}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
              >
                {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Mail className="size-4" aria-hidden />}
                {running
                  ? progress.done > 0
                    ? `Scheduling ${progress.done} of ${progress.total}…`
                    : "Scheduling…"
                  : `Schedule ${candidateIds.length}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4">
            <p className="text-sm">
              <span className="font-medium">{created}</span> scheduled
              {notCreated > 0 && (
                <>
                  , <span className="font-medium">{notCreated}</span> not scheduled
                </>
              )}
              .
            </p>
            <ul className="mt-3 max-h-64 space-y-1.5 overflow-auto text-sm">
              {results.map((item) => (
                <li
                  key={item.email}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.name ?? item.email}</span>
                    <span className="block truncate text-xs text-muted">{item.email}</span>
                    {item.reason && <span className="block text-xs text-muted">{item.reason}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.status === "created"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : item.status === "skipped"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    {item.status === "created"
                      ? item.emailed
                        ? "Sent"
                        : "Link ready"
                      : item.status === "skipped"
                        ? "Skipped"
                        : "Failed"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
