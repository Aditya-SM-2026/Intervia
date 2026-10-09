"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InterviewStatus } from "@/lib/interviews/interview.types";
import type {
  DashboardInterviewSummary,
  IntegrityLevel,
} from "@/lib/interviews/report.types";

/**
 * Recruiter dashboard list: sessions with candidate/role/recruiter details,
 * an email search filter, status and an AI-usage badge (or "pending") when
 * the report has been generated. Loads through GET /api/dashboard/interviews.
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
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
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
              className="h-[76px] animate-pulse rounded-2xl border border-border bg-surface"
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
        <ul className="grid gap-3">
          {interviews.map(({ room, integrity }) => (
            <li key={room.id}>
              <Link
                href={`/dashboard/${room.id}`}
                className="block rounded-2xl border border-border bg-surface p-5 transition hover:border-accent/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{room.roleTitle || room.title}</span>
                  <span className="flex items-center gap-2">
                    {integrity ? (
                      <span
                        title="Estimated probability the candidate's answers were AI-assisted"
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${LEVEL_STYLES[integrity.level]}`}
                      >
                        AI {integrity.probability}% · {integrity.level}
                      </span>
                    ) : (
                      <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
                        Report pending
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[room.status]}`}
                    >
                      {room.status}
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {room.candidateName ? room.candidateName : "Candidate name not set"}
                  {room.candidateEmail ? ` · ${room.candidateEmail}` : ""}
                  {room.recruiterName ? ` · recruiter ${room.recruiterName}` : ""}
                  {" · created "}
                  {formatDateTime(room.createdAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
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