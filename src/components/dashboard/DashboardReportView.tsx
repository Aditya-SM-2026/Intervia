"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import type {
  InterviewReport,
  InterviewReportResponse,
  InterviewScoreEntry,
  InterviewScores,
  IntegrityLevel,
  TranscriptTurn,
} from "@/lib/interviews/report.types";

/**
 * Post-interview report view: transcript thread with turn numbers, analysis,
 * JD coverage, integrity panel with signals linked back to turn seqs, data
 * notes, and a collapsed raw-JSON toggle. Handles sessions without turns or
 * reports (pre-pipeline data, live sessions, insufficient content) with
 * explicit empty states.
 */

const STATUS_STYLES: Record<InterviewStatus, string> = {
  scheduled: "border-border bg-surface text-muted",
  waiting: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  expired: "border-border bg-surface text-muted",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

const LEVEL_STYLES: Record<IntegrityLevel, string> = {
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

interface ReportPageState {
  session: InterviewReportResponse["session"];
  turns: TranscriptTurn[];
  report: InterviewReport | null;
  reason: string | null;
}

async function fetchReport(roomId: string, force: boolean): Promise<ReportPageState | null> {
  const response = await fetch(
    force
      ? `/api/dashboard/interviews/${roomId}/report/regenerate`
      : `/api/dashboard/interviews/${roomId}/report`,
    { method: force ? "POST" : "GET" },
  );
  if (response.status === 404) return null;
  const body = (await response.json()) as InterviewReportResponse;
  if (!response.ok) {
    throw new Error("Could not load the report. Please try again.");
  }
  return body;
}

export function DashboardReportView({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReportPageState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    (force: boolean) => {
      fetchReport(roomId, force)
        .then((result) => {
          if (result === null) {
            setNotFound(true);
            setData(null);
            setError(null);
          } else {
            setNotFound(false);
            setError(null);
            setData(result);
          }
          if (force) setRegenerating(false);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not load the report.");
          if (force) setRegenerating(false);
        });
    },
    [roomId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  function regenerate() {
    setRegenerating(true);
    load(true);
  }

  /**
   * Asks once, then permanently removes the session with its transcript and
   * report, and returns to the list. setState stays inside the promise
   * callbacks (react-hooks rule).
   */
  function removeSession() {
    const confirmed = window.confirm(
      "Delete this interview permanently? The session, its transcript and its report will be removed. This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    fetch(`/api/dashboard/interviews/${roomId}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not delete this interview. Please try again.");
        router.push("/dashboard");
      })
      .catch((cause: unknown) => {
        setDeleting(false);
        setError(cause instanceof Error ? cause.message : "Could not delete this interview.");
      });
  }

  if (notFound) {
    return (
      <EmptyPanel
        title="Interview not found"
        body="This interview does not exist. Check the link or go back to the dashboard."
      />
    );
  }

  if (error) {
    return (
      <div className="grid gap-3">
        <Link href="/dashboard" className="text-sm text-accent hover:underline">
          ← Back to dashboard
        </Link>
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
        <button
          type="button"
          onClick={() => load(false)}
          className="justify-self-start rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          Retry
        </button>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-surface" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
        <div className="h-40 animate-pulse rounded-2xl border border-border bg-surface" />
      </div>
    );
  }

  const { session, turns, report, reason } = data;
  const live = session.status === "scheduled" || session.status === "active";

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Link href="/dashboard" className="justify-self-start text-sm text-accent hover:underline">
          ← Back to dashboard
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{session.roleTitle || session.title}</h1>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[session.status]}`}>
            {session.status}
          </span>
        </div>
        <p className="text-sm text-muted">
          {session.candidateName ? session.candidateName : "Candidate name not set"}
          {session.candidateEmail ? ` · ${session.candidateEmail}` : ""}
          {session.recruiterName ? ` · recruiter ${session.recruiterName}` : ""}
          {" · created "}
          {formatDateTime(session.createdAt)}
        </p>
      </div>

      {live && (
        <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 p-5 text-sm text-blue-700 dark:text-blue-400">
          This interview is live ({session.status}). The report becomes available once the
          conversation has produced enough content.
        </div>
      )}

      {report ? (
        <ReportSections report={report} />
      ) : (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-700 dark:text-amber-400">
          <p className="font-medium">No report available</p>
          <p className="mt-1 text-amber-600 dark:text-amber-400/90">{reason}</p>
          {turns.length === 0 && !live && (
            <p className="mt-2 text-amber-600 dark:text-amber-400/90">
              The candidate never joined or never verified their email, so there is nothing to analyze.
            </p>
          )}
        </div>
      )}

      {turns.length > 0 && <TranscriptSection turns={turns} />}

      {report && <RawJsonSection label="Raw report JSON" value={report} />}

      {(report || (!live && turns.length > 0)) && (
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="justify-self-start rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface disabled:opacity-60"
        >
          {regenerating ? "Regenerating report… (this can take up to a minute)" : "Regenerate report"}
        </button>
      )}

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={removeSession}
          disabled={deleting}
          className="justify-self-start rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
        >
          {deleting ? "Deleting…" : "Delete interview"}
        </button>
        <p className="mt-2 text-xs text-muted">
          Permanently removes the session, its transcript and its report. This cannot be undone.
        </p>
      </div>
    </div>
  );
}

function SeqChips({ seqs }: { seqs: number[] }) {
  if (seqs.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {seqs.map((seq) => (
        <a
          key={seq}
          href={`#turn-${seq}`}
          title={`Jump to turn #${seq}`}
          className="rounded-md bg-surface px-2 py-0.5 font-mono text-xs text-accent hover:underline"
        >
          #{seq}
        </a>
      ))}
    </span>
  );
}

const SCORE_BAND_STYLES = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  mixed: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  bad: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
} as const;

/** Higher-is-better bands: 70+ good, 40-69 mixed, <40 bad. */
function bandForScore(score: number, inverted: boolean): keyof typeof SCORE_BAND_STYLES {
  if (inverted) {
    if (score >= 60) return "bad";
    if (score >= 26) return "mixed";
    return "good";
  }
  if (score >= 70) return "good";
  if (score >= 40) return "mixed";
  return "bad";
}

function ScoreCard({
  label,
  entry,
  inverted = false,
}: {
  label: string;
  entry: InterviewScoreEntry;
  inverted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            SCORE_BAND_STYLES[bandForScore(entry.score, inverted)]
          }`}
        >
          {entry.score}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{entry.rationale}</p>
      <div className="mt-2">
        <SeqChips seqs={entry.evidenceTurnSeq} />
      </div>
    </div>
  );
}

function ScoresSection({ scores }: { scores: InterviewScores }) {
  return (
    <section aria-label="Evaluation scores" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Evaluation scores</h2>
        <span className="text-xs text-muted">0–100 · difficulty-normalized · grounded in the transcript</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ScoreCard label="Overall performance" entry={scores.overall} />
        <ScoreCard label="JD / skill match" entry={scores.jdMatch} />
        <ScoreCard label="AI-assistance risk" entry={scores.aiRisk} inverted />
        <ScoreCard label="Communication quality" entry={scores.communication} />
        <div className="rounded-xl border border-border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Video proctoring</span>
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-muted">
              not available
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            Requires a recorded video stream — proctoring scores arrive when interview recording
            is enabled.
          </p>
        </div>
      </div>
    </section>
  );
}

function ReportSections({ report }: { report: InterviewReport }) {
  const { analysis, integrity } = report;
  return (
    <div className="grid gap-6">
      {report.notes.length > 0 && (
        <section aria-label="Data notes" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-700 dark:text-amber-400">
          <h2 className="font-medium">Data notes</h2>
          <ul className="mt-2 grid gap-1 text-amber-600 dark:text-amber-400/90">
            {report.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {report.scores ? (
        <ScoresSection scores={report.scores} />
      ) : (
        <section
          aria-label="Evaluation scores"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-700 dark:text-amber-400"
        >
          <p className="font-medium">Evaluation scores pending</p>
          <p className="mt-1 text-amber-600 dark:text-amber-400/90">
            This report was generated before the scoring engine was enabled, or scoring was
            unavailable at the time. Use &quot;Regenerate report&quot; to compute the scores.
          </p>
        </section>
      )}

      <section aria-label="Integrity assessment" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Integrity assessment</h2>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-medium ${LEVEL_STYLES[integrity.level]}`}
          >
            {integrity.level} AI-usage risk
          </span>
        </div>
        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-4xl font-semibold tracking-tight">{integrity.probability}%</span>
          <span className="text-sm text-muted">estimated probability answers were AI-assisted</span>
        </div>
        {integrity.signals.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No transcript evidence of AI assistance was found.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {integrity.signals.map((signal, index) => (
              <li key={index} className="rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-xs text-muted">
                    {signal.type}
                  </span>
                  <span className="flex items-center gap-3">
                    <SeqChips seqs={signal.evidenceTurnSeq} />
                    <span className="text-xs text-muted">weight {signal.weight}</span>
                  </span>
                </div>
                <p className="mt-2 text-sm">{signal.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Analysis" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="font-semibold">Analysis</h2>
        {analysis.topics.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No topics were summarized.</p>
        ) : (
          <dl className="mt-3 grid gap-3">
            {analysis.topics.map((topic, index) => (
              <div key={index} className="rounded-xl border border-border bg-background p-4">
                <dt className="text-sm font-medium">{topic.topic}</dt>
                <dd className="mt-1 text-sm text-muted">{topic.summary}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {analysis.jdCoverage.length > 0 && (
        <section aria-label="JD coverage" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="font-semibold">JD coverage</h2>
          <ul className="mt-3 grid gap-2">
            {analysis.jdCoverage.map((entry, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-4 text-sm">
                <span className="flex items-center gap-2">
                  <span
                    aria-label={entry.probed ? "probed" : "not probed"}
                    className={entry.probed ? "text-emerald-500" : "text-red-500"}
                  >
                    {entry.probed ? "✓" : "✗"}
                  </span>
                  {entry.skill}
                </span>
                <SeqChips seqs={entry.evidenceTurnSeq} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <section aria-label="Strengths" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="font-semibold">Strengths</h2>
          <BulletList items={analysis.strengths} emptyText="No strengths were identified." tone="emerald" />
        </section>
        <section aria-label="Weaknesses" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 className="font-semibold">Weaknesses</h2>
          <BulletList items={analysis.weaknesses} emptyText="No weaknesses were identified." tone="amber" />
        </section>
      </div>

      <p className="text-xs text-muted">
        Generated {formatDateTime(report.engineMeta.generatedAt)} · model {report.engineMeta.model}
      </p>
    </div>
  );
}

function BulletList({
  items,
  emptyText,
  tone,
}: {
  items: string[];
  emptyText: string;
  tone: "emerald" | "amber";
}) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-muted">{emptyText}</p>;
  }
  return (
    <ul className="mt-3 grid gap-2 text-sm">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span aria-hidden className={tone === "emerald" ? "text-emerald-500" : "text-amber-500"}>
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function TranscriptSection({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <section aria-label="Transcript" className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="font-semibold">Transcript</h2>
      <ul className="mt-3 grid gap-3 text-sm leading-relaxed">
        {turns.map((turn) => (
          <li key={turn.seq} id={`turn-${turn.seq}`} className="scroll-mt-6">
            <span
              className={`mb-0.5 block text-[10px] font-medium uppercase tracking-wide ${
                turn.speaker === "candidate" ? "text-muted" : "text-accent"
              }`}
            >
              #{turn.seq} · {turn.speaker === "candidate" ? "Candidate" : "Intervia AI"}
              {turn.speaker === "candidate" && turn.latencyMs !== null && (
                <span className="ml-2 normal-case tracking-normal opacity-70">
                  answered in {formatLatency(turn.latencyMs)}
                </span>
              )}
              {turn.speaker === "interviewer" && turn.askedAt && (
                <span className="ml-2 normal-case tracking-normal opacity-70">
                  {formatDateTime(turn.askedAt)}
                </span>
              )}
            </span>
            {turn.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RawJsonSection({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="rounded-2xl border border-border bg-surface">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-muted transition hover:text-foreground">
        {label}
      </summary>
      <pre className="overflow-x-auto border-t border-border p-5 text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid gap-4">
      <Link href="/dashboard" className="justify-self-start text-sm text-accent hover:underline">
        ← Back to dashboard
      </Link>
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
    </div>
  );
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms * 10) / 10}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}