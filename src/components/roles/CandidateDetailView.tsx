"use client";

import { ScorePill } from "@/components/ui/ScorePill";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Download, FileText, Mail, Phone } from "lucide-react";
import { Avatar, StatusBadge } from "@/components/dashboard/primitives";
import type { ApplicationField, RoleApplication } from "@/lib/roles/application.types";
import type { HumanDecision } from "@/lib/interviews/interview.types";
import type {
  CandidateInterviewDetail,
  RoleCandidateResponse,
} from "@/lib/roles/role.types";

/**
 * One candidate inside one role: profile, resume, and every interview with
 * its real score. Detailed scorecards open in the existing interview view.
 */

const DECISION_LABELS: Record<HumanDecision["outcome"], string> = {
  advance: "Advanced",
  hold: "On hold",
  reject: "Rejected",
};

const SUGGESTION_LABELS: Record<string, string> = {
  strong: "Strong",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Insufficient",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CandidateDetailView({
  roleId,
  candidateId,
}: {
  roleId: string;
  candidateId: string;
}) {
  const [candidate, setCandidate] = useState<RoleCandidateResponse["candidate"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [application, setApplication] = useState<RoleApplication | null>(null);
  const [fields, setFields] = useState<ApplicationField[]>([]);

  function load() {
    fetch(`/api/roles/${roleId}/candidates/${encodeURIComponent(candidateId)}`)
      .then(async (response) => {
        const body = (await response.json()) as RoleCandidateResponse & { error?: { message?: string } };
        if (!response.ok || !body.candidate) {
          throw new Error(body.error?.message ?? "Could not load this candidate.");
        }
        setCandidate(body.candidate);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  // The application this person sent through the role's form, if any.
  useEffect(() => {
    let cancelled = false;
    const email = decodeURIComponent(candidateId).trim().toLowerCase();
    Promise.all([
      fetch(`/api/roles/${roleId}/applications`).then((r) => (r.ok ? (r.json() as Promise<{ applications: RoleApplication[] }>) : null)),
      fetch(`/api/roles/${roleId}/form-link`).then((r) => (r.ok ? (r.json() as Promise<{ fields: ApplicationField[] }>) : null)),
    ])
      .then(([apps, form]) => {
        if (cancelled) return;
        setApplication(apps?.applications.find((a) => a.email.toLowerCase() === email) ?? null);
        setFields(form?.fields ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roleId, candidateId]);

  useEffect(() => {
    load();
    // Reload when the route params change; load is stable for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, candidateId]);

  if (error && candidate === null) {
    return (
      <div className="py-8">
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Link href={`/dashboard/roles/${roleId}`} className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
          ← Back to role
        </Link>
      </div>
    );
  }

  if (candidate === null) {
    return (
      <div aria-hidden className="space-y-4 py-8">
        <div className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />
        <div className="h-48 animate-pulse rounded-2xl border border-border bg-surface" />
      </div>
    );
  }

  const scoredInterviews = candidate.interviews.filter((interview) => interview.overallScore !== null);
  const bestScore =
    scoredInterviews.length > 0
      ? Math.max(...scoredInterviews.map((interview) => interview.overallScore ?? 0))
      : null;

  const name = candidate.candidateName ?? application?.name ?? "Unnamed candidate";
  const answers = application
    ? fields
        .filter((field) => !("system" in field && (field as { system?: boolean }).system) && application.answers[field.id]?.trim())
        .map((field) => ({ label: field.label, value: application.answers[field.id] }))
    : [];
  const match = application?.screening?.status === "scored" ? application.screening.score : null;

  return (
    <div className="py-8">
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/dashboard/roles" className="transition hover:text-foreground">Roles</Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <Link href={`/dashboard/roles/${roleId}`} className="transition hover:text-foreground">{candidate.role.title}</Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span className="text-foreground">{name}</span>
      </nav>

      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <Avatar name={name} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5" aria-hidden />{candidate.candidateEmail}</span>
            {application?.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5" aria-hidden />{application.phone}</span>}
          </p>
        </div>
        {bestScore !== null && (
          <div className="flex items-center gap-2 text-sm text-muted">
            Best interview
            <ScorePill score={bestScore} size="lg" />
          </div>
        )}
        {candidate.resume?.hasText && (
          <a
            href={`/api/roles/${roleId}/candidates/${encodeURIComponent(candidateId)}/resume`}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-3.5 py-2 text-sm font-medium transition hover:border-accent/50"
          >
            <Download className="size-4" aria-hidden />
            Resume
          </a>
        )}
      </section>

      <Journey
        steps={[
          application
            ? { label: "Applied", done: true, detail: formatDateTime(application.createdAt) }
            : { label: "Invited", done: true, detail: "Directly, not through the form" },
          { label: "Resume checked", done: match !== null, detail: match !== null ? `Match ${match}` : "Not scored" },
          {
            label: "Interviewed",
            done: candidate.interviews.some((interview) => interview.status === "completed"),
            detail: `${candidate.interviews.filter((interview) => interview.status === "completed").length} of ${candidate.interviews.length} finished`,
          },
          {
            label: "Decided",
            done: candidate.interviews.some((interview) => interview.decision),
            detail: (() => {
              const decided = candidate.interviews.find((interview) => interview.decision);
              return decided?.decision ? DECISION_LABELS[decided.decision.outcome] : "Not yet";
            })(),
          },
        ]}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-3 font-semibold tracking-tight">Interviews</h2>
          <ul className="grid gap-3">
            {candidate.interviews.map((interview: CandidateInterviewDetail) => (
              <li key={interview.roomId}>
                <Link
                  href={`/dashboard/${interview.roomId}`}
                  className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition hover:border-foreground/20 hover:shadow-sm"
                >
                  {interview.overallScore !== null ? (
                    <ScorePill score={interview.overallScore} size="lg" />
                  ) : (
                    <StatusBadge status={interview.status} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {interview.suggestion ? SUGGESTION_LABELS[interview.suggestion] : interview.status === "completed" ? "Report on the way" : "Interview"}
                      {interview.decision && (
                        <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-foreground/80">
                          {DECISION_LABELS[interview.decision.outcome]}
                        </span>
                      )}
                      {interview.needsHumanReview && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Needs review</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">{formatDateTime(interview.createdAt)}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
                    {interview.status === "completed" ? "Report" : "Open"}
                    <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-semibold tracking-tight">Application</h2>
          {application ? (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Fact label="Applied" value={formatDateTime(application.createdAt)} />
                <Fact label="Resume match" value={match !== null ? `${match}/100` : application.screening?.status === "not_screened" ? "No readable resume" : "Not scored"} tone={match !== null ? scoreTone(match) : undefined} />
                {application.education && <Fact label="Education" value={application.education} />}
                {application.cgpa !== null && <Fact label="CGPA or %" value={String(application.cgpa)} />}
                {application.collegeId && <Fact label="College roll no." value={application.collegeId} />}
                {application.resumeFileName && <Fact label="Resume file" value={application.resumeFileName} icon />}
              </dl>
              {answers.length > 0 && (
                <div className="mt-5 grid gap-3 border-t border-border pt-4">
                  {answers.map((answer) => (
                    <div key={answer.label}>
                      <p className="text-xs font-medium text-muted">{answer.label}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{answer.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Fact label="How they came in" value="Invited directly" />
                <Fact label="Resume" value={candidate.resume?.hasText ? "On file" : "Not uploaded"} />
              </dl>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Where the candidate is: four steps from applying to a decision. */
function Journey({ steps }: { steps: { label: string; done: boolean; detail: string }[] }) {
  return (
    <ol className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-start gap-3 bg-surface px-4 py-3.5">
          <span
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
              step.done ? "bg-emerald-500 text-white" : "bg-foreground/[0.07] text-muted"
            }`}
            aria-hidden
          >
            {step.done ? "✓" : index + 1}
          </span>
          <span className="min-w-0">
            <span className={`block text-sm font-medium ${step.done ? "" : "text-muted"}`}>{step.label}</span>
            <span className="block truncate text-xs text-muted">{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Red below 50, amber below 70, green from 70: a weak score never looks good. */
function scoreTone(score: number): string {
  if (score < 50) return "text-red-600 dark:text-red-400";
  if (score < 70) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function Fact({ label, value, tone, icon }: { label: string; value: string; tone?: string; icon?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 truncate font-medium ${tone ?? ""}`} title={value}>
        {icon && <FileText className="mr-1 inline size-3.5 text-muted" aria-hidden />}
        {value}
      </dd>
    </div>
  );
}
