import "server-only";
import type { HumanDecision } from "@/lib/interviews/interview.types";
import { recordDecision } from "@/lib/interviews/interview.service";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { sanitizeWeights, screeningTotal } from "@/lib/screening/score";
import { shortlistStatusFor } from "@/lib/roles/shortlist";
import { deriveCandidateStatus, interviewStateFor } from "@/lib/roles/candidate-status";
import { sanitizeAutoFilterRule, type AutoFilterRule } from "@/lib/roles/auto-filter";
import type { Role, RoleCandidateSummary, RoleSummary } from "@/lib/roles/role.types";
import { createRoleSchema, updateRoleSchema } from "@/lib/roles/role.validation";
import {
  getRolesRepository,
  type RoleListFilter,
  type UpdateRoleRow,
} from "@/server/repositories/roles-repository";

/**
 * Roles and candidates business logic on top of the roles repository.
 * All inputs arrive untrusted from HTTP; everything is validated here or in
 * the routes before it reaches the database.
 */

const MAX_PAGE_SIZE = 50;
const EXPORT_MAX_CANDIDATES = 10_000;
const CANDIDATE_ID_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function repository() {
  return getRolesRepository();
}

export async function createRole(input: unknown) {
  const parsed = createRoleSchema.parse(input);
  return repository().createRole(parsed);
}

export async function listRoles(filter: RoleListFilter): Promise<RoleSummary[]> {
  const roles = await repository().listRoles(filter);
  const stats = await repository().getRoleStats(roles);
  return roles.map((role) => ({ ...role, stats: stats.get(role.id) ?? emptyStats() }));
}

function emptyStats() {
  return { interviews: 0, candidates: 0, completed: 0, pending: 0, avgOverallScore: null };
}

export async function getRoleSummary(id: string): Promise<RoleSummary | null> {
  const role = await repository().getRole(id);
  if (!role) return null;
  const stats = await repository().getRoleStats([role]);
  return { ...role, stats: stats.get(role.id) ?? emptyStats() };
}

/**
 * One role without the stats aggregation, for screens that only need to
 * prefill a form. Returns null for an unknown or malformed id so callers can
 * fall back to the plain flow.
 */
export async function getRoleForForm(id: string): Promise<Role | null> {
  if (!ROOM_ID_PATTERN.test(id)) return null;
  return repository().getRole(id);
}

/** Every role, in the lightweight form used to pick one when scheduling. */
export async function listRoleOptions(): Promise<Role[]> {
  return repository().listRoles({});
}

/**
 * Makes sure a role exists for an interview's role title, so every role a
 * recruiter works with shows up on the roles page. A role created this way
 * keeps the interview's job description when one was supplied, and an older
 * record with no description is filled in the next time it appears.
 * Case-insensitive: "AI engineer" and "AI Engineer" are the same role.
 */
export async function ensureRoleForTitle(
  title: string | null | undefined,
  description?: string | null,
): Promise<void> {
  const trimmed = title?.trim();
  if (!trimmed || trimmed.length < 2) return;
  const jd = description?.trim() ?? "";
  const usableJd = jd.length >= 10 ? jd : "";
  const existing = await repository().listRoles({ q: trimmed });
  const match = existing.find((role) => role.title.toLowerCase() === trimmed.toLowerCase());
  if (match) {
    if (usableJd && !match.description.trim()) {
      await repository().updateRole(match.id, { description: usableJd });
    }
    return;
  }
  await repository().createRole({
    title: trimmed,
    description: usableJd,
    skills: [],
    deadline: null,
  });
}

export async function updateRole(id: string, input: unknown) {
  const parsed = updateRoleSchema.parse(input) as UpdateRoleRow;
  return repository().updateRole(id, parsed);
}

/**
 * Deletes one or more roles together with their candidate interviews: the
 * reports, recordings and analyses for those candidates go with them. Callers
 * warn about that before calling.
 */
export async function deleteRoles(
  ids: readonly string[],
): Promise<{ roles: number; interviews: number }> {
  const unique = [...new Set(ids)].filter((id) => ROOM_ID_PATTERN.test(id));
  if (unique.length === 0) return { roles: 0, interviews: 0 };
  return repository().deleteRoles(unique);
}

/** How many candidates one delete request may carry. */
export const DELETE_MAX_CANDIDATES = 200;

/**
 * Removes candidates from a role for good. Both sides go: the interviews with
 * their turns, events and scorecards, and the application with its resume and
 * screening. Leaving the application behind would put the person straight back
 * in the list on the next load.
 */
export async function deleteRoleCandidates(
  roleId: string,
  candidateIds: readonly string[],
): Promise<{
  roleTitle: string;
  requested: number;
  interviews: number;
  applications: number;
  screenings: number;
} | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const emails = [...new Set(candidateIds.map((id) => id.trim().toLowerCase()))]
    .filter((id) => id.length > 2 && id.length <= 320 && id.includes("@"))
    .slice(0, DELETE_MAX_CANDIDATES);
  if (emails.length === 0) {
    return { roleTitle: role.title, requested: 0, interviews: 0, applications: 0, screenings: 0 };
  }
  const removed = await repository().deleteRoleCandidates(roleId, role.title, emails);
  return { roleTitle: role.title, requested: emails.length, ...removed };
}

/** Validates pagination the way the dashboard list does. */export function parsePaging(
  limitRaw: string | null,
  offsetRaw: string | null,
): { limit: number; offset: number } {
  const limit = clamp(limitRaw, MAX_PAGE_SIZE, 10);
  const offset = clamp(offsetRaw, Number.MAX_SAFE_INTEGER, 0);
  return { limit, offset };
}

function clamp(raw: string | null, max: number, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

/** Candidates of one role, newest interview first. */
export async function listRoleCandidates(
  roleId: string,
  limit: number,
  offset: number,
): Promise<{
  candidates: RoleCandidateSummary[];
  total: number;
  counts: { applied: number; interview: number };
} | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const page = await repository().listRoleCandidates(roleId, role.title, limit, offset);
  const counts = await repository().getRoleCandidateCounts(roleId, role.title);
  const screeningScores = await repository().getApplicationScreeningScores(roleId);
  const weights = sanitizeWeights(role.screeningWeights);
  const cutoff = await repository().getRoleShortlistCutoff(roleId);
  const invitedScreenings = await repository().getInvitedCandidateScreenings(roleId);
  /** The stored section scores re-weighted with the role's current setting. */
  const screeningFor = (applicationId: string | null | undefined, email?: string) => {
    const entry = applicationId
      ? screeningScores.get(applicationId)
      : email
        ? invitedScreenings.get(email.toLowerCase())
        : undefined;
    if (!entry) return { score: null as number | null, status: null as string | null };
    if (entry.status !== "scored") return { score: null as number | null, status: entry.status };
    const totals = screeningTotal(entry.sections, weights);
    return { score: totals.score === null ? null : Math.round(totals.score), status: entry.status };
  };
  const candidates: RoleCandidateSummary[] = page.candidates.map((row) => {
    const screening = screeningFor(row.applicationId, row.candidateEmail);
    const shortlistStatus = shortlistStatusFor(row.shortlisted ?? null, screening.score, cutoff);
    const interviewState = interviewStateFor({
      interviews: row.interviews,
      status: row.latestStatus,
      expiresAt: row.latestExpiresAt ?? null,
      completedAt: row.completedAt ?? null,
      overallScore: row.overallScore,
    });
    return {
      candidateId: row.candidateId,
      candidateEmail: row.candidateEmail,
      candidateName: row.candidateName,
      interviews: row.interviews,
      completed: row.completed,
      pending: row.interviews - row.completed,
      latestInterviewId: row.roomId,
      latestInterviewAt: row.latestInterviewAt,
      scheduledAt: row.scheduledAt ?? null,
      completedAt: row.completedAt ?? null,
      latestExpiresAt: row.latestExpiresAt ?? null,
      latestStatus: row.latestStatus,
      status: deriveCandidateStatus({
        decision: row.decision?.outcome ?? null,
        applicationStatus: row.applicationStatus ?? null,
        screeningScore: screening.score,
        manualShortlist: row.shortlisted ?? null,
        interviewState,
      }),
      interviewState,
      overallScore: row.overallScore,
      suggestion: row.suggestion,
      decision: row.decision,
      applicationId: row.applicationId ?? null,
      applicationStatus: row.applicationStatus ?? null,
      appliedAt: row.appliedAt ?? null,
      candidatePhone: row.candidatePhone ?? null,
      candidateCollegeId: row.candidateCollegeId ?? null,
      candidateEducation: row.candidateEducation ?? null,
      candidateCgpa: row.candidateCgpa ?? null,
      shortlisted: row.shortlisted ?? null,
      answers: row.answers ?? null,
      screeningScore: screening.score,
      screeningStatus: screening.status,
      shortlistStatus,
    };
  });
  return { candidates, total: page.total, counts };
}

/** One candidate's full profile inside a role. */
export async function getCandidateDetail(roleId: string, candidateId: string) {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const id = candidateId.trim().toLowerCase();
  if (!CANDIDATE_ID_PATTERN.test(id)) return null;
  const interviews = await repository().getCandidateInterviews(roleId, role.title, id);
  if (interviews.length === 0) return null;
  const latestWithResume = interviews.find((interview) => interview.hasResume);
  return {
    role,
    candidateId: id,
    candidateEmail: id,
    candidateName: interviews.find((interview) => interview.candidateName)?.candidateName ?? null,
    interviews,
    resume: latestWithResume
      ? { fileName: null, hasText: latestWithResume.hasResume }
      : null,
  };
}

/** The role's automatic filtration rule (Match below X, CGPA below Y). */
export async function getRoleAutoFilterRule(roleId: string): Promise<AutoFilterRule | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  return repository().getAutoFilterRule(roleId);
}

/** Saves the role's automatic filtration rule; values are clamped to usable ones. */
export async function setRoleAutoFilterRule(
  roleId: string,
  input: unknown,
): Promise<AutoFilterRule | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  return repository().setAutoFilterRule(roleId, sanitizeAutoFilterRule(input));
}

/** The candidate's stored resume text, for the download endpoint. */
export async function getCandidateResume(roleId: string, candidateId: string) {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const id = candidateId.trim().toLowerCase();
  if (!CANDIDATE_ID_PATTERN.test(id)) return null;
  return repository().getCandidateResume(roleId, role.title, id);
}

/** Everything needed for the CSV export: all candidates, not just one page. */
export async function exportRoleCandidates(roleId: string) {
  const page = await listRoleCandidates(roleId, EXPORT_MAX_CANDIDATES, 0);
  if (!page) return null;
  const role = await repository().getRole(roleId);
  if (!role) return null;
  return { role, candidates: page.candidates };
}
/** Max candidates a single bulk decision may touch. */
const DECIDE_MAX_CANDIDATES = 100;

/**
 * Bulk hiring decisions from the leaderboard: apply one decision to many
 * candidates at once. Each candidate's most recent interview in the role
 * receives the decision — that is the interview the scorecard advises on.
 * Per-candidate failures are reported, one bad row never blocks the rest.
 */
export async function decideRoleCandidates(
  roleId: string,
  candidateIds: readonly string[],
  outcome: HumanDecision["outcome"],
  note = "",
): Promise<{
  roleTitle: string;
  decided: { candidateId: string; roomId: string; candidateName: string | null }[];
  failed: { candidateId: string; error: string }[];
} | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const page = await repository().listRoleCandidates(
    roleId,
    role.title,
    DECIDE_MAX_CANDIDATES,
    0,
  );
  const byId = new Map(page.candidates.map((row) => [row.candidateId, row]));
  const decided: { candidateId: string; roomId: string; candidateName: string | null }[] = [];
  const failed: { candidateId: string; error: string }[] = [];
  for (const candidateId of candidateIds) {
    const row = byId.get(candidateId);
    if (!row) {
      failed.push({ candidateId, error: "Candidate not found in this role" });
      continue;
    }
    const room = await recordDecision(row.roomId, {
      outcome,
      note,
      decidedAt: new Date().toISOString(),
    });
    if (!room) {
      failed.push({ candidateId, error: "Interview not found (may have been deleted)" });
      continue;
    }
    decided.push({
      candidateId,
      roomId: row.roomId,
      candidateName: row.candidateName,
    });
  }
  return { roleTitle: role.title, decided, failed };
}

