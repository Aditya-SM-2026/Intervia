"use client";

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
          <div className="text-right">
            <p className={`text-3xl font-semibold tabular-nums ${scoreTone(bestScore)}`}>{bestScore}<span className="text-base font-medium text-muted">/100</span></p>
            <p className="text-xs text-muted">Best interview score</p>
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-3 font-semibold tracking-tight">Interviews</h2>
          <ul className="grid gap-3">
            {candidate.interviews.map((interview: CandidateInterviewDetail) => (
              <li key={interview.roomId} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={interview.status} />
                  {interview.needsHumanReview && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Needs review</span>
                  )}
                  <span className="grow" />
                  {interview.overallScore !== null && (
                    <span className={`text-lg font-semibold tabular-nums ${scoreTone(interview.overallScore)}`}>{interview.overallScore}<span className="text-sm text-muted">/100</span></span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted">
                  {formatDateTime(interview.createdAt)}
                  {interview.suggestion ? ` · ${SUGGESTION_LABELS[interview.suggestion]}` : ""}
                  {interview.decision ? ` · ${DECISION_LABELS[interview.decision.outcome]}` : ""}
                </p>
                <Link
                  href={`/dashboard/${interview.roomId}`}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                >
                  {interview.status === "completed" ? "Open report" : "Open interview"}
                  <ArrowUpRight className="size-3.5" aria-hidden />
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
            <p className="rounded-2xl border border-dashed border-border bg-surface p-5 text-sm text-muted">
              Invited directly, not through the application form.
            </p>
          )}
        </section>
      </div>
    </div>
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
