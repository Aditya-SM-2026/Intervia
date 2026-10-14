"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RoleStatus, RoleSummary, RolesResponse } from "@/lib/roles/role.types";

/**
 * Roles list: real roles with their live candidate statistics, a search and
 * status filter, and an inline create form. Loads through GET /api/roles.
 */

const STATUS_LABELS: Record<RoleStatus, string> = {
  open: "Open",
  completed: "Completed",
};

const STATUS_STYLES: Record<RoleStatus, string> = {
  open: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  completed: "border-border bg-surface text-muted",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function fetchRoles(q: string | undefined, status: RoleStatus | undefined): Promise<RoleSummary[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const response = await fetch(`/api/roles?${params.toString()}`);
  const data = (await response.json()) as RolesResponse & { error?: { message?: string } };
  if (!response.ok || !data.roles) {
    throw new Error(data.error?.message ?? "Could not load the roles. Please try again.");
  }
  return data.roles;
}

export function RolesView() {
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RoleStatus | "">("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    fetchRoles(search.trim() || undefined, statusFilter || undefined)
      .then((result) => {
        setRoles(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      });
  }

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
    // Reload when the filters change; load reads the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  async function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return; // no duplicate submissions
    const form = event.currentTarget;
    const data = new FormData(form);
    const skills = String(data.get("skills") ?? "")
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill !== "");
    const deadline = String(data.get("deadline") ?? "").trim();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(data.get("title") ?? ""),
          description: String(data.get("description") ?? ""),
          skills,
          deadline: deadline === "" ? null : deadline,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not create the role.");
      }
      form.reset();
      setShowForm(false);
      setNotice("Role created.");
      await load();
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search roles"
          aria-label="Search roles"
          className="w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as RoleStatus | "")}
          aria-label="Filter by status"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>
        <div className="grow" />
        <button
          type="button"
          onClick={() => {
            setShowForm((open) => !open);
            setFormError(null);
          }}
          aria-expanded={showForm}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {showForm ? "Cancel" : "New role"}
        </button>
      </div>

      {notice && (
        <p role="status" className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={createRole}
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          aria-label="Create role"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Role title *</span>
              <input
                name="title"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Senior Backend Engineer"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Hiring deadline (optional)</span>
              <input
                name="deadline"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Job description *</span>
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={20000}
                rows={4}
                placeholder="What the person will do, the team, and what success looks like."
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Skills &amp; qualifications (comma-separated, optional)</span>
              <input
                name="skills"
                placeholder="e.g. Go, PostgreSQL, Kubernetes"
                className="w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {submitting ? "Creating…" : "Create role"}
            </button>
            {submitting && <span className="text-sm text-muted">Saving…</span>}
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {roles === null && !error && (
        <div aria-hidden className="space-y-3">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}

      {roles !== null && roles.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
          <p className="font-medium">No roles yet</p>
          <p className="mt-1 text-sm text-muted">
            {search || statusFilter
              ? "No roles match this search or filter."
              : "Create your first role, then invite candidates to interview for it."}
          </p>
        </div>
      )}

      {roles !== null && roles.length > 0 && (
        <ul className="grid gap-3">
          {roles.map((role) => (
            <li key={role.id}>
              <Link
                href={`/dashboard/roles/${role.id}`}
                className="block rounded-lg border border-border bg-surface p-5 transition hover:border-accent/50 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">{role.title}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[role.status]}`}>
                    {STATUS_LABELS[role.status]}
                  </span>
                  <span className="grow" />
                  {role.deadline && (
                    <span className="text-xs text-muted">Closes {formatDate(role.deadline)}</span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{role.description}</p>
                {role.skills.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {role.skills.slice(0, 6).map((skill) => (
                      <span key={skill} className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                        {skill}
                      </span>
                    ))}
                    {role.skills.length > 6 && (
                      <span className="text-xs text-muted">+{role.skills.length - 6} more</span>
                    )}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                  <span>
                    <strong className="text-foreground">{role.stats.candidates}</strong> candidates
                  </span>
                  <span>
                    <strong className="text-foreground">{role.stats.interviews}</strong> interviews
                  </span>
                  <span>
                    <strong className="text-foreground">{role.stats.completed}</strong> scored ·{" "}
                    <strong className="text-foreground">{role.stats.pending}</strong> pending
                  </span>
                  {role.stats.avgOverallScore !== null && (
                    <span>
                      Avg score <strong className="text-foreground">{role.stats.avgOverallScore}</strong>/100
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}