import "server-only";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import type {
  HumanDecision,
  InterviewStatus,
} from "@/lib/interviews/interview.types";
import type { Scorecard } from "@/lib/interviews/scorecard.types";
import type { InterviewRoom } from "@/lib/interviews/interview.types";
import type {
  Role,
  RoleStats,
  RoleStatus,
} from "@/lib/roles/role.types";
import {
  aggregateCandidates,
  computeRoleStats,
  matchesRoleAssociation,
  parseSuggestion,
  type AggregatedCandidate,
  type AggregationInterview,
  type AggregationScorecard,
  type CandidateInterviewRow,
} from "@/lib/roles/candidate-aggregation";
import { getInterviewStore } from "./in-memory-interview-repository";

const ROLE_ID_RANDOM_BYTES = 16;

/** Server-side shape used by the service to create a role. */
export interface CreateRoleRow {
  title: string;
  description: string;
  skills: string[];
  deadline: string | null;
}

/** Server-side shape used by the service to update a role. */
export interface UpdateRoleRow {
  title?: string;
  description?: string;
  skills?: string[];
  deadline?: string | null;
  status?: RoleStatus;
}

/** Filter for listRoles. */
export interface RoleListFilter {
  q?: string;
  status?: RoleStatus;
}

/** One candidate row as stored/read by the repository. */
export type CandidateRow = AggregatedCandidate;

/** Roles are linked to interviews two ways: by id (new) or legacy title match. */
function roleAssociationSql(roleIdsParam: string, roleTitlesParam: string): string {
  return `(i.role_id = ANY(${roleIdsParam}) OR (i.role_id IS NULL AND i.role_title = ANY(${roleTitlesParam})))`;
}

export interface RoleRepository {
  createRole(input: CreateRoleRow): Promise<Role>;
  getRole(id: string): Promise<Role | null>;
  listRoles(filter: RoleListFilter): Promise<Role[]>;
  updateRole(id: string, patch: UpdateRoleRow): Promise<Role | null>;
  /** Live stats for many roles in one call; roles without interviews get zeroed stats. */
  getRoleStats(roles: readonly { id: string; title: string }[]): Promise<Map<string, RoleStats>>;
  listRoleCandidates(
    roleId: string,
    roleTitle: string,
    limit: number,
    offset: number,
  ): Promise<{ candidates: CandidateRow[]; total: number }>;
  getCandidateInterviews(
    roleId: string,
    roleTitle: string,
    candidateId: string,
  ): Promise<CandidateInterviewRow[]>;
  /** Latest resume text available for the candidate inside the role. */
  getCandidateResume(
    roleId: string,
    roleTitle: string,
    candidateId: string,
  ): Promise<{ fileName: string | null; text: string } | null>;
}

export function newRoleId(): string {
  return `role_${randomBytes(ROLE_ID_RANDOM_BYTES).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Postgres implementation (Cloud SQL in production)
// ---------------------------------------------------------------------------

const globalRefs = globalThis as unknown as {
  __rolesPgPool?: Pool;
  __rolesPgBootstrapV2?: Promise<void>;
};

const BOOTSTRAP_ROLES_SQL = `
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS role_id TEXT;
CREATE INDEX IF NOT EXISTS interviews_role_id_idx ON interviews (role_id);
`;

function getPool(): Pool {
  if (!globalRefs.__rolesPgPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; cannot use the Postgres roles repository");
    }
    globalRefs.__rolesPgPool = new Pool({ connectionString, max: 3 });
  }
  return globalRefs.__rolesPgPool;
}

async function ensureSchema(): Promise<void> {
  if (!globalRefs.__rolesPgBootstrapV2) {
    globalRefs.__rolesPgBootstrapV2 = getPool()
      .query(BOOTSTRAP_ROLES_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalRefs.__rolesPgBootstrapV2 = undefined;
        throw error;
      });
  }
  await globalRefs.__rolesPgBootstrapV2;
}

interface RolePgRow {
  id: string;
  title: string;
  description: string;
  skills: unknown;
  deadline: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function rowToRole(row: RolePgRow): Role {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    skills: Array.isArray(row.skills) ? row.skills.filter((s): s is string => typeof s === "string") : [],
    deadline: row.deadline,
    status: row.status === "completed" ? "completed" : "open",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function decisionFromJson(value: unknown): HumanDecision | null {
  if (!value || typeof value !== "object") return null;
  const decision = value as { outcome?: string; note?: unknown; decidedAt?: unknown };
  if (decision.outcome !== "advance" && decision.outcome !== "hold" && decision.outcome !== "reject") {
    return null;
  }
  return {
    outcome: decision.outcome,
    note: typeof decision.note === "string" ? decision.note : "",
    decidedAt: typeof decision.decidedAt === "string" ? decision.decidedAt : "",
  };
}

export function getPostgresRolesRepository(): RoleRepository {
  return {
    async createRole(input: CreateRoleRow): Promise<Role> {
      await ensureSchema();
      const id = newRoleId();
      const result = await getPool().query(
        `INSERT INTO roles (id, title, description, skills, deadline, status)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'open')
         RETURNING id, title, description, skills, deadline, status, created_at, updated_at`,
        [id, input.title, input.description, JSON.stringify(input.skills), input.deadline],
      );
      return rowToRole(result.rows[0] as RolePgRow);
    },

    async getRole(id: string): Promise<Role | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT id, title, description, skills, deadline, status, created_at, updated_at
         FROM roles WHERE id = $1`,
        [id],
      );
      const row = result.rows[0] as RolePgRow | undefined;
      return row ? rowToRole(row) : null;
    },

    async listRoles(filter: RoleListFilter): Promise<Role[]> {
      await ensureSchema();
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filter.q) {
        params.push(`%${filter.q}%`);
        conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
      }
      if (filter.status) {
        params.push(filter.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await getPool().query(
        `SELECT id, title, description, skills, deadline, status, created_at, updated_at
         FROM roles ${where} ORDER BY created_at DESC, id DESC`,
        params,
      );
      return (result.rows as RolePgRow[]).map(rowToRole);
    },

    async updateRole(id: string, patch: UpdateRoleRow): Promise<Role | null> {
      await ensureSchema();
      const assignments: string[] = [];
      const params: unknown[] = [id];
      if (patch.title !== undefined) {
        params.push(patch.title);
        assignments.push(`title = $${params.length}`);
      }
      if (patch.description !== undefined) {
        params.push(patch.description);
        assignments.push(`description = $${params.length}`);
      }
      if (patch.skills !== undefined) {
        params.push(JSON.stringify(patch.skills));
        assignments.push(`skills = $${params.length}::jsonb`);
      }
      if (patch.deadline !== undefined) {
        params.push(patch.deadline);
        assignments.push(`deadline = $${params.length}`);
      }
      if (patch.status !== undefined) {
        params.push(patch.status);
        assignments.push(`status = $${params.length}`);
      }
      if (assignments.length === 0) return this.getRole(id);
      const result = await getPool().query(
        `UPDATE roles SET ${assignments.join(", ")}, updated_at = now()
         WHERE id = $1
         RETURNING id, title, description, skills, deadline, status, created_at, updated_at`,
        params,
      );
      const row = result.rows[0] as RolePgRow | undefined;
      return row ? rowToRole(row) : null;
    },

    async getRoleStats(
      roles: readonly { id: string; title: string }[],
    ): Promise<Map<string, RoleStats>> {
      await ensureSchema();
      const stats = new Map<string, RoleStats>();
      for (const role of roles) {
        stats.set(role.id, {
          interviews: 0,
          candidates: 0,
          completed: 0,
          pending: 0,
          avgOverallScore: null,
        });
      }
      if (roles.length === 0) return stats;
      const ids = roles.map((role) => role.id);
      const titles = roles.map((role) => role.title);
      const result = await getPool().query(
        `WITH assoc AS (
           -- Legacy-title matches have a NULL role_id; map the matched title
           -- back to its role id (ids and titles arrive in the same order) so
           -- every association groups under a real role.
           SELECT (CASE
                     WHEN i.role_id IS NOT NULL THEN i.role_id
                     ELSE (SELECT t.rid FROM unnest($2::text[], $1::text[]) AS t(title, rid)
                           WHERE t.title = i.role_title LIMIT 1)
                   END) AS role_id,
             i.id, i.status, LOWER(COALESCE(i.candidate_email, '')) AS email
           FROM interviews i
           WHERE ${roleAssociationSql("$1::text[]", "$2::text[]")}
         )
         SELECT a.role_id,
           COUNT(*)::int AS interviews,
           COUNT(DISTINCT CASE WHEN a.email = '' THEN NULL ELSE a.email END)::int AS candidates,
           (COUNT(*) FILTER (WHERE a.status = 'completed'))::int AS completed,
           (COUNT(*) FILTER (WHERE a.status <> 'completed'))::int AS pending,
           AVG((s.scorecard ->> 'overallScore')::float)
             FILTER (WHERE a.status = 'completed' AND s.room_id IS NOT NULL) AS avg_overall
         FROM assoc a
         LEFT JOIN scorecards s ON s.room_id = a.id
         GROUP BY a.role_id`,
        [ids, titles],
      );
      for (const row of result.rows as {
        role_id: string;
        interviews: number;
        candidates: number;
        completed: number;
        pending: number;
        avg_overall: string | number | null;
      }[]) {
        stats.set(row.role_id, {
          interviews: Number(row.interviews ?? 0),
          candidates: Number(row.candidates ?? 0),
          completed: Number(row.completed ?? 0),
          pending: Number(row.pending ?? 0),
          avgOverallScore:
            row.avg_overall === null || row.avg_overall === undefined
              ? null
              : Math.round(Number(row.avg_overall)),
        });
      }
      return stats;
    },

    async listRoleCandidates(
      roleId: string,
      roleTitle: string,
      limit: number,
      offset: number,
    ): Promise<{ candidates: CandidateRow[]; total: number }> {
      await ensureSchema();
      const result = await getPool().query(
        `WITH assoc AS (
           SELECT i.id, i.candidate_name, i.candidate_email, i.status, i.created_at, i.decision
           FROM interviews i
           WHERE (i.role_id = $1 OR (i.role_id IS NULL AND i.role_title = $2))
             AND i.candidate_email IS NOT NULL AND i.candidate_email <> ''
         ),
         latest AS (
           SELECT DISTINCT ON (LOWER(candidate_email)) *
           FROM assoc
           ORDER BY LOWER(candidate_email), created_at DESC, id DESC
         )
         SELECT
           l.id,
           l.candidate_email,
           l.status,
           l.created_at,
           l.decision,
           (SELECT a.candidate_name FROM assoc a
             WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)
               AND a.candidate_name IS NOT NULL
             ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS candidate_name,
           (SELECT COUNT(*)::int FROM assoc a
             WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)) AS interviews,
           (SELECT COUNT(*)::int FROM assoc a
             WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)
               AND a.status = 'completed') AS completed,
           s.scorecard ->> 'overallScore' AS overall,
           s.scorecard ->> 'suggestion' AS suggestion,
           COUNT(*) OVER()::int AS total
         FROM latest l
         LEFT JOIN scorecards s ON s.room_id = l.id
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $3 OFFSET $4`,
        [roleId, roleTitle, limit, offset],
      );
      const rows = result.rows as {
        id: string;
        candidate_email: string;
        candidate_name: string | null;
        status: string;
        created_at: Date;
        decision: unknown;
        interviews: number;
        completed: number;
        overall: string | null;
        suggestion: string | null;
        total: number;
      }[];
      const candidates = rows.map((row) => ({
        roomId: row.id,
        candidateId: row.candidate_email.toLowerCase(),
        candidateEmail: row.candidate_email.toLowerCase(),
        candidateName: row.candidate_name,
        interviews: Number(row.interviews ?? 1),
        completed: Number(row.completed ?? 0),
        latestStatus: row.status as InterviewStatus,
        latestInterviewAt: row.created_at.toISOString(),
        overallScore: row.overall === null ? null : Math.round(Number(row.overall)),
        suggestion: parseSuggestion(row.suggestion),
        decision: decisionFromJson(row.decision),
      }));
      return { candidates, total: rows.length > 0 ? Number(rows[0].total) : 0 };
    },

    async getCandidateInterviews(
      roleId: string,
      roleTitle: string,
      candidateId: string,
    ): Promise<CandidateInterviewRow[]> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT i.id, i.title, i.status, i.created_at, i.completed_at, i.candidate_name, i.decision,
           (i.resume_text IS NOT NULL OR i.resume_file_name IS NOT NULL) AS has_resume,
           s.scorecard ->> 'overallScore' AS overall,
           s.scorecard ->> 'suggestion' AS suggestion,
           COALESCE((s.scorecard ->> 'needsHumanReview')::boolean, false) AS needs_review
         FROM interviews i
         LEFT JOIN scorecards s ON s.room_id = i.id
         WHERE (i.role_id = $1 OR (i.role_id IS NULL AND i.role_title = $2))
           AND i.candidate_email IS NOT NULL AND LOWER(i.candidate_email) = $3
         ORDER BY i.created_at DESC, i.id DESC`,
        [roleId, roleTitle, candidateId],
      );
      return (
        result.rows as {
          id: string;
          title: string;
          status: string;
          created_at: Date;
          completed_at: Date | null;
          candidate_name: string | null;
          decision: unknown;
          has_resume: boolean;
          overall: string | null;
          suggestion: string | null;
          needs_review: boolean;
        }[]
      ).map((row) => ({
        roomId: row.id,
        title: row.title,
        status: row.status as InterviewStatus,
        createdAt: row.created_at.toISOString(),
        completedAt: row.completed_at ? row.completed_at.toISOString() : null,
        candidateName: row.candidate_name,
        hasResume: Boolean(row.has_resume),
        overallScore: row.overall === null ? null : Math.round(Number(row.overall)),
        suggestion: parseSuggestion(row.suggestion),
        needsHumanReview: Boolean(row.needs_review),
        decision: decisionFromJson(row.decision),
      }));
    },

    async getCandidateResume(
      roleId: string,
      roleTitle: string,
      candidateId: string,
    ): Promise<{ fileName: string | null; text: string } | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT i.resume_file_name, i.resume_text
         FROM interviews i
         WHERE (i.role_id = $1 OR (i.role_id IS NULL AND i.role_title = $2))
           AND i.candidate_email IS NOT NULL AND LOWER(i.candidate_email) = $3
           AND i.resume_text IS NOT NULL AND i.resume_text <> ''
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT 1`,
        [roleId, roleTitle, candidateId],
      );
      const row = result.rows[0] as
        | { resume_file_name: string | null; resume_text: string }
        | undefined;
      return row ? { fileName: row.resume_file_name, text: row.resume_text } : null;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (zero-setup local development)
// ---------------------------------------------------------------------------

interface InMemoryRoleStore {
  roles: Map<string, Role>;
}

const globalStore = globalThis as unknown as { __rolesStoreV2?: InMemoryRoleStore };

function getStore(): InMemoryRoleStore {
  if (!globalStore.__rolesStoreV2) {
    globalStore.__rolesStoreV2 = { roles: new Map() };
  }
  return globalStore.__rolesStoreV2;
}

/** Adapts an in-memory InterviewRoom to the shared aggregation shape. */
function toAggregationInterview(room: InterviewRoom): AggregationInterview {
  return {
    id: room.id,
    title: room.title,
    candidateName: room.candidateName,
    candidateEmail: room.candidateEmail,
    status: room.status,
    createdAt: room.createdAt,
    completedAt: room.completedAt,
    decision: room.decision,
    resumeFileName: room.resume?.fileName ?? null,
    resumeText: room.resume?.text ?? null,
    roleId: room.roleId,
    roleTitle: room.roleTitle,
  };
}

/** Adapts a stored Scorecard to the shared aggregation shape. */
function toAggregationScorecard(scorecard: Scorecard): AggregationScorecard {
  return {
    overallScore: scorecard.overallScore,
    suggestion: scorecard.suggestion,
    needsHumanReview: scorecard.needsHumanReview,
  };
}

export function getInMemoryRolesRepository(): RoleRepository {
  const roleOf = (id: string): Role | null => getStore().roles.get(id) ?? null;

  return {
    async createRole(input: CreateRoleRow): Promise<Role> {
      const now = new Date().toISOString();
      const role: Role = {
        id: newRoleId(),
        title: input.title,
        description: input.description,
        skills: [...input.skills],
        deadline: input.deadline,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      getStore().roles.set(role.id, role);
      return role;
    },

    async getRole(id: string): Promise<Role | null> {
      return roleOf(id);
    },

    async listRoles(filter: RoleListFilter): Promise<Role[]> {
      const roles = [...getStore().roles.values()].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
      const q = filter.q?.toLowerCase();
      return roles.filter((role) => {
        if (filter.status && role.status !== filter.status) return false;
        if (q && !role.title.toLowerCase().includes(q) && !role.description.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
    },

    async updateRole(id: string, patch: UpdateRoleRow): Promise<Role | null> {
      const role = roleOf(id);
      if (!role) return null;
      const updated: Role = {
        ...role,
        ...patch,
        skills: patch.skills ? [...patch.skills] : role.skills,
        updatedAt: new Date().toISOString(),
      };
      getStore().roles.set(id, updated);
      return updated;
    },

    async getRoleStats(
      roles: readonly { id: string; title: string }[],
    ): Promise<Map<string, RoleStats>> {
      const store = getInterviewStore();
      const interviews = [...store.rooms.values()].map(toAggregationInterview);
      const scorecards = new Map<string, AggregationScorecard>();
      for (const [roomId, scorecard] of store.scorecards) {
        scorecards.set(roomId, toAggregationScorecard(scorecard));
      }
      const result = new Map<string, RoleStats>();
      for (const role of roles) {
        result.set(role.id, computeRoleStats(role.id, role.title, interviews, scorecards));
      }
      return result;
    },

    async listRoleCandidates(
      roleId: string,
      roleTitle: string,
      limit: number,
      offset: number,
    ): Promise<{ candidates: CandidateRow[]; total: number }> {
      const store = getInterviewStore();
      const interviews = [...store.rooms.values()].map(toAggregationInterview);
      const scorecards = new Map<string, AggregationScorecard>();
      for (const [roomId, scorecard] of store.scorecards) {
        scorecards.set(roomId, toAggregationScorecard(scorecard));
      }
      const all = aggregateCandidates(roleId, roleTitle, interviews, scorecards);
      return { candidates: all.slice(offset, offset + limit), total: all.length };
    },

    async getCandidateInterviews(
      roleId: string,
      roleTitle: string,
      candidateId: string,
    ): Promise<CandidateInterviewRow[]> {
      const store = getInterviewStore();
      return [...store.rooms.values()]
        .filter(
          (room) =>
            matchesRoleAssociation(roleId, roleTitle, room) &&
            room.candidateEmail?.toLowerCase() === candidateId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map((room) => {
          const scorecard = store.scorecards.get(room.id);
          return {
            roomId: room.id,
            title: room.title,
            status: room.status as InterviewStatus,
            createdAt: room.createdAt,
            completedAt: room.completedAt,
            candidateName: room.candidateName,
            hasResume: room.resume !== null,
            overallScore: scorecard?.overallScore ?? null,
            suggestion: scorecard?.suggestion ?? null,
            needsHumanReview: scorecard?.needsHumanReview ?? false,
            decision: room.decision,
          };
        });
    },

    async getCandidateResume(
      roleId: string,
      roleTitle: string,
      candidateId: string,
    ): Promise<{ fileName: string | null; text: string } | null> {
      const store = getInterviewStore();
      const withResume = [...store.rooms.values()]
        .filter(
          (room) =>
            matchesRoleAssociation(roleId, roleTitle, room) &&
            room.candidateEmail?.toLowerCase() === candidateId &&
            typeof room.resume?.text === "string" &&
            room.resume.text !== "",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = withResume[0];
      return latest?.resume
        ? { fileName: latest.resume.fileName ?? null, text: latest.resume.text }
        : null;
    },
  };
}

export function getRolesRepository(): RoleRepository {
  if (process.env.DATABASE_URL?.trim()) {
    return getPostgresRolesRepository();
  }
  return getInMemoryRolesRepository();
}