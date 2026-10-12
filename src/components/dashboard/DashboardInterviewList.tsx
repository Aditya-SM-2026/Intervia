"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import type {
  DashboardInterviewSummary,
  ScoreSuggestion,
} from "@/lib/interviews/scorecard.types";
import { FACTOR_META } from "./factors";

/**
 * Recruiter dashboard list: sessions with candidate/role/recruiter details,
 * an email search filter, status, the overall score once the interview has
 * been scored, and the recruiter's decision. Loads through
 * GET /api/dashboard/interviews.
 */

const STATUS_STYLES: Record<InterviewStatus, string> = {
  scheduled: "border-border bg-surface text-muted",
  waiting: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  expired: "border-border bg-surface text-muted",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
};

const SUGGESTION_STYLES: Record<ScoreSuggestion, string> = {
  strong: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  positive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  mixed: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  weak: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  insufficient: "border-border bg-surface text-muted",
};

const STATUS_LABELS: Record<InterviewStatus, string> = {
  scheduled: "Not started",
  waiting: "Waiting",
  active: "In progress",
  completed: "Completed",
  expired: "Link expired",
  cancelled: "Cancelled",
};

const DECISION_LABELS = { advance: "Advanced", hold: "On hold", reject: "Rejected" } as const;

async function fetchInterviews(email: string | undefined): Promise<DashboardInterviewSummary[]> {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  params.set("limit", "100");
  const response = await fetch(`/api/dashboard/interviews?${params.toString()}`);
  const data = (await response.json()) as { interviews?: DashboardInterviewSummary[] };
  if (!response.ok || !data.interviews) {
    throw new Error("Could not load the interview list. Please try again.");
  }
  return data.interviews;
}

export function DashboardInterviewList() {
  const [interviews, setInterviews] = useState<DashboardInterviewSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  function load(email: string | undefined) {
    fetchInterviews(email)
      .then((result) => {
        setInterviews(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load the interview list.",
        );
      });
  }

  useEffect(() => {
    load(undefined);
  }, []);

  function submitSearch() {
    const email = searchInput.trim();
    setActiveSearch(email);
    load(email || undefined);
  }

  if (error) {
    return (
      <div className="grid gap-3">
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
        <button
          type="button"
          onClick={() => load(activeSearch || undefined)}
          className="justify-self-start rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-surface"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
        className="flex gap-2"
      >
        <input
          type="email"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search by candidate email…"
          aria-label="Search by candidate email"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Search
        </button>
        {activeSearch && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setActiveSearch("");
              load(undefined);
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition hover:bg-surface"
          >
            Clear
          </button>
        )}
      </form>

      {interviews === null ? (
        <div className="grid gap-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-[68px] animate-pulse rounded-2xl border border-border bg-surface"
            />
          ))}
        </div>
      ) : interviews.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="font-medium">
            {activeSearch ? `No interviews found for “${activeSearch}”` : "No interviews yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {activeSearch
              ? "Check the spelling or clear the search to see all interviews."
              : "Create an interview and share the link — it appears here as soon as it exists."}
          </p>
          {!activeSearch && (
            <Link
              href="/recruiter"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Create an interview
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_7rem_7rem_7rem] gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted md:grid">
            <span>Candidate</span>
            <span>Role</span>
            <span>Status</span>
            <span>Score</span>
            <span>Decision</span>
          </div>
          <ul className="divide-y divide-border">
            {interviews.map(({ room, scorecard }) => (
              <li key={room.id}>
                <Link
                  href={`/dashboard/${room.id}`}
                  className="grid gap-x-4 gap-y-1 px-5 py-4 transition hover:bg-background md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_7rem_7rem_7rem] md:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {room.candidateName || "Candidate name not set"}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {room.candidateEmail ?? "No email"}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{room.roleTitle || room.title}</span>
                    <span className="block text-xs text-muted">{formatDateTime(room.createdAt)}</span>
                  </span>
                  <span>
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[room.status]}`}
                    >
                      {STATUS_LABELS[room.status]}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {scorecard?.overall?.score != null ? (
                      <span title="Overall score out of 100, with its four factors">
                        <span className="font-display text-lg font-semibold">
                          {scorecard.overall.score}
                        </span>
                        <span className="mt-1 flex gap-0.5" aria-hidden="true">
                          {scorecard.overall.factors.map((factor) => (
                            <span key={factor.id} className="h-1 w-4 rounded-full bg-border">
                              {factor.score !== null && (
                                <span
                                  className={`block h-full rounded-full ${FACTOR_META[factor.id].bar}`}
                                  style={{ width: `${factor.score}%` }}
                                />
                              )}
                            </span>
                          ))}
                        </span>
                      </span>
                    ) : scorecard ? (
                      <span
                        title="Answer quality out of 5. Regenerate the scorecard for the full analysis."
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SUGGESTION_STYLES[scorecard.suggestion]}`}
                      >
                        {scorecard.overallScore === null
                          ? "No score"
                          : `${scorecard.overallScore.toFixed(1)} of 5`}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">
                        {room.status === "completed" ? "Scoring…" : "Not yet"}
                      </span>
                    )}
                  </span>
                  <span className="text-sm">
                    {room.decision ? (
                      <span className="font-medium text-accent">
                        {DECISION_LABELS[room.decision.outcome]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">
                        {scorecard?.needsHumanReview ? "Needs review" : "Undecided"}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}