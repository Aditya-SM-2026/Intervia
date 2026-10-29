import "server-only";
import type { HumanDecision } from "@/lib/interviews/interview.types";
import { recordDecision } from "@/lib/interviews/interview.service";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import type { RoleCandidateSummary, RoleSummary } from "@/lib/roles/role.types";
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
 * Makes sure a role exists for an interview's role title, so every role a
 * recruiter works with shows up on the roles page. Roles created this way
 * start empty (no description or skills) and can be filled in via Edit role.
 * Case-insensitive: "AI engineer" and "AI Engineer" are the same role.
 */
export async function ensureRoleForTitle(title: string | null | undefined): Promise<void> {
  const trimmed = title?.trim();
  if (!trimmed || trimmed.length < 2) return;
  const existing = await repository().listRoles({ q: trimmed });
  if (existing.some((role) => role.title.toLowerCase() === trimmed.toLowerCase())) return;
  await repository().createRole({
    title: trimmed,
    description: "",
    skills: [],
    deadline: null,
  });
}

export async function updateRole(id: string, input: unknown) {
  const parsed = updateRoleSchema.parse(input) as UpdateRoleRow;
  return repository().updateRole(id, parsed);
}

/**
 * Deletes one or more roles. Interviews (with their reports, recordings and
 * analyses) are kept and detached, so nothing a candidate said is lost.
 */
export async function deleteRoles(ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)].filter((id) => ROOM_ID_PATTERN.test(id));
  if (unique.length === 0) return 0;
  return repository().deleteRoles(unique);
}

/** Validates pagination the way the dashboard list does. */
export function parsePaging(
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
): Promise<{ candidates: RoleCandidateSummary[]; total: number } | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const page = await repository().listRoleCandidates(roleId, role.title, limit, offset);
  const candidates: RoleCandidateSummary[] = page.candidates.map((row) => ({
    candidateId: row.candidateId,
    candidateEmail: row.candidateEmail,
    candidateName: row.candidateName,
    interviews: row.interviews,
    completed: row.completed,
    pending: row.interviews - row.completed,
    latestInterviewId: row.roomId,
    latestInterviewAt: row.latestInterviewAt,
    latestStatus: row.latestStatus,
    overallScore: row.overallScore,
    suggestion: row.suggestion,
    decision: row.decision,
  }));
  return { candidates, total: page.total };
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
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const page = await repository().listRoleCandidates(
    roleId,
    role.title,
    EXPORT_MAX_CANDIDATES,
    0,
  );
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

