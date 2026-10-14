import type { RoleCandidateSummary } from "@/lib/roles/role.types";

/**
 * CSV building for the role candidates export. Pure functions so they are
 * unit-testable without a database.
 */

/** Excel and friends interpret a leading =,+,-,@ (or tab/CR) as a formula. */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Escapes one cell: quotes where needed and neutralises formula prefixes. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (text.length > 0 && FORMULA_PREFIXES.has(text[0])) {
    text = `'${text}`;
  }
  if (/["\n\r,]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

const EXPORT_HEADERS = [
  "Role ID",
  "Role Title",
  "Role Status",
  "Candidate Name",
  "Candidate Email",
  "Interview ID",
  "Interview Status",
  "Interview Date",
  "Overall Score",
  "Evaluation",
  "Decision",
  "Interviews",
  "Completed",
] as const;

/** A lowercase filesystem-safe slug of the role title. */
export function roleSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "role"
  );
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Not started",
  waiting: "Waiting",
  active: "In progress",
  completed: "Completed",
  expired: "Link expired",
  cancelled: "Cancelled",
};

const DECISION_LABELS: Record<string, string> = {
  advance: "Advanced",
  hold: "On hold",
  reject: "Rejected",
};

export interface ExportRoleContext {
  roleId: string;
  roleTitle: string;
  roleStatus: string;
}

/**
 * Builds the full CSV text (with UTF-8 BOM) for every candidate of the role.
 * Missing scores stay empty; the Evaluation column explains pending ones.
 */
export function buildRoleCandidatesCsv(
  role: ExportRoleContext,
  candidates: readonly RoleCandidateSummary[],
): string {
  const lines: string[] = [csvRow(EXPORT_HEADERS)];
  for (const candidate of candidates) {
    lines.push(
      csvRow([
        role.roleId,
        role.roleTitle,
        role.roleStatus === "completed" ? "Completed" : "Open",
        candidate.candidateName,
        candidate.candidateEmail,
        candidate.latestInterviewId,
        STATUS_LABELS[candidate.latestStatus] ?? candidate.latestStatus,
        candidate.latestInterviewAt.slice(0, 10),
        candidate.overallScore ?? "",
        candidate.suggestion
          ? candidate.suggestion.charAt(0).toUpperCase() + candidate.suggestion.slice(1)
          : candidate.completed > 0
            ? "Not scored"
            : "Interview pending",
        candidate.decision ? DECISION_LABELS[candidate.decision.outcome] ?? candidate.decision.outcome : "",
        candidate.interviews,
        candidate.completed,
      ]),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** `candidates-<role-slug>-<date>.csv` */
export function exportFileName(roleTitle: string, date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `candidates-${roleSlug(roleTitle)}-${iso}.csv`;
}