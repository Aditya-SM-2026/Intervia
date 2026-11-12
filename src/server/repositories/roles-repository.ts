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
  RoleCandidateStageCounts,
  RoleStats,
  RoleStatus,
} from "@/lib/roles/role.types";
import type {
  ApplicationField,
  ApplicationStatus,
  RoleApplication,
  RoleFormLink,
} from "@/lib/roles/application.types";
import {
  DEFAULT_SCREENING_WEIGHTS,
  type ScreeningSnapshot,
  type ScreeningWeights,
  type SectionResult,
} from "@/lib/screening/types";
import { sanitizeWeights } from "@/lib/screening/score";
import { clampCutoff, DEFAULT_SHORTLIST_CUTOFF } from "@/lib/roles/shortlist";
import {
  DEFAULT_AUTO_FILTER_RULE,
  sanitizeAutoFilterRule,
  type AutoFilterRule,
} from "@/lib/roles/auto-filter";
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

/** Input for creating an application from the public form. */
export interface CreateApplicationRow {
  id: string;
  roleId: string;
  name: string;
  phone: string;
  email: string;
  collegeId: string | null;
  /** Qualification picked on the built-in education field, e.g. "B.Tech". */
  education: string | null;
  /** CGPA or percentage as typed, or null when the candidate left it blank. */
  cgpa: number | null;
  answers: Record<string, string>;
  resumeFileName: string | null;
  resumeText: string;
  resumeObjectPath: string | null;
  /** Private token the candidate uses to replace this resume later. */
  resumeUpdateToken: string;
}

/** Roles are linked to interviews two ways: by id (new) or legacy title match. */
function roleAssociationSql(roleIdsParam: string, roleTitlesParam: string): string {
  return `(i.role_id = ANY(${roleIdsParam}) OR (i.role_id IS NULL AND lower(i.role_title) = ANY(${roleTitlesParam})))`;
}

export interface RoleRepository {
  createRole(input: CreateRoleRow): Promise<Role>;
  getRole(id: string): Promise<Role | null>;
  listRoles(filter: RoleListFilter): Promise<Role[]>;
  updateRole(id: string, patch: UpdateRoleRow): Promise<Role | null>;
  /**
   * Deletes roles together with their candidate interviews: turns, events,
   * scorecards and the interview rows themselves. A role is the container HR
   * sees, so leaving its candidates behind in the dashboard is a surprise.
   */
  deleteRoles(ids: readonly string[]): Promise<{ roles: number; interviews: number }>;
  /** Live stats for many roles in one call; roles without interviews get zeroed stats. */
  getRoleStats(roles: readonly { id: string; title: string }[]): Promise<Map<string, RoleStats>>;
  listRoleCandidates(
    roleId: string,
    roleTitle: string,
    limit: number,
    offset: number,
  ): Promise<{ candidates: CandidateRow[]; total: number }>;
  /** Live candidate totals per primary stage for the whole role. */
  getRoleCandidateCounts(
    roleId: string,
    roleTitle: string,
  ): Promise<RoleCandidateStageCounts>;
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
  /**
   * Removes candidates from one role for good: their interviews (turns,
   * events, scorecards), their applications and any invited-candidate
   * screening. Emails are matched case-insensitively.
   */
  deleteRoleCandidates(
    roleId: string,
    roleTitle: string,
    emails: readonly string[],
  ): Promise<{ interviews: number; applications: number; screenings: number }>;

  // --- Resume screening ---------------------------------------------------------
  /** Whether screening runs for this role, and the six section weights. */
  getRoleScreeningSettings(
    roleId: string,
  ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null>;
  updateRoleScreeningSettings(
    roleId: string,
    settings: { enabled: boolean; weights: ScreeningWeights },
  ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null>;
  /** Minimum Match score that shortlists automatically; 0 means no cutoff. */
  getRoleShortlistCutoff(roleId: string): Promise<number>;
  setRoleShortlistCutoff(roleId: string, cutoff: number): Promise<number>;
  /** The per-role automatic filtration rule: Match below X and CGPA below Y. */
  getAutoFilterRule(roleId: string): Promise<AutoFilterRule>;
  setAutoFilterRule(roleId: string, rule: AutoFilterRule): Promise<AutoFilterRule>;
  /** A recruiter's manual shortlist decision on one application; null clears it. */
  setApplicationShortlisted(
    roleId: string,
    applicationId: string,
    shortlisted: boolean | null,
  ): Promise<boolean>;
  /** Resume text and the hash of the last screening, for one application. */
  getApplicationResumeText(
    roleId: string,
    applicationId: string,
  ): Promise<{ fileName: string | null; text: string; inputHash: string | null } | null>;
  /**
   * Screening results for candidates who never filled the form and were invited
   * straight to an interview, keyed by lowercased email. Their score comes from
   * the resume uploaded for the interview.
   */
  getInvitedCandidateScreenings(roleId: string): Promise<Map<string, ScreeningSnapshot>>;
  saveInvitedCandidateScreening(
    roleId: string,
    email: string,
    snapshot: ScreeningSnapshot,
  ): Promise<void>;
  /** Invited candidates with an interview resume and no result yet. */
  listUnscreenedInvitedCandidates(
    roleId: string,
    roleTitle: string,
    limit: number,
  ): Promise<{ email: string; hasText: boolean }[]>;
  saveApplicationScreening(applicationId: string, snapshot: ScreeningSnapshot): Promise<void>;
  /** Applications without a result yet, oldest first, for the backfill job. */
  listUnscreenedApplications(
    roleId: string,
    limit: number,
  ): Promise<{ id: string; hasText: boolean }[]>;
  /** Score per application, for the candidate table. */
  getApplicationScreeningScores(
    roleId: string,
  ): Promise<Map<string, { score: number | null; status: string; sections: SectionResult[] }>>;

  // --- Public application form -------------------------------------------------
  /** The role's form link row (active or revoked), or null when none exists. */
  getFormLink(roleId: string): Promise<RoleFormLink | null>;
  /** Reuses the role's token, creating it (or reactivating it) when needed. */
  getOrCreateFormLink(roleId: string): Promise<RoleFormLink>;
  /** Replaces the extra questions the form asks. */
  updateFormLinkFields(roleId: string, fields: ApplicationField[]): Promise<RoleFormLink | null>;
  /** Stops a link working without throwing away the applications it collected. */
  revokeFormLink(roleId: string): Promise<void>;
  /** Stores the link's own limits: cap on applications and deadline in hours. */
  updateFormLinkSettings(
    roleId: string,
    settings: { maxApplications: number | null; expiresAfterHours: number | null },
  ): Promise<RoleFormLink | null>;
  /**
   * Issues a brand-new token, resets this round's counter and reopens the link.
   * The previous token stops resolving, so old shared links stay dead.
   */
  rotateFormLink(roleId: string): Promise<RoleFormLink | null>;
  /** Applications received at or after a moment, for the link's own counter. */
  countApplicationsSince(roleId: string, since: string | null): Promise<number>;
  /** The role a public token belongs to; only active links resolve. */
  getRoleByFormToken(token: string): Promise<Role | null>;
  /** Inserts an application; null when this email already applied to the role. */
  createApplication(input: CreateApplicationRow): Promise<RoleApplication | null>;
  listApplications(
    roleId: string,
    limit: number,
    offset: number,
  ): Promise<{ applications: RoleApplication[]; total: number }>;
  getApplication(roleId: string, applicationId: string): Promise<RoleApplication | null>;
  updateApplicationStatus(
    roleId: string,
    applicationId: string,
    status: ApplicationStatus,
    interviewId?: string | null,
  ): Promise<RoleApplication | null>;
  /** Stored resume for one application, for the recruiter's download link. */
  getApplicationResume(
    roleId: string,
    applicationId: string,
  ): Promise<{ fileName: string | null; objectPath: string | null; text: string } | null>;
  /** The application this email already sent to this role, or null. */
  getApplicationByEmail(roleId: string, email: string): Promise<RoleApplication | null>;
  /**
   * Rewrites the candidate-editable parts of an application: name, roll
   * number, answers and the resume. Status, interview link and creation time
   * are deliberately left alone.
   */
  refreshApplication(
    applicationId: string,
    patch: {
      name: string;
      collegeId: string | null;
      education: string | null;
      cgpa: number | null;
      answers: Record<string, string>;
      fileName: string;
      text: string;
      objectPath: string | null;
      updatedAt: string;
    },
  ): Promise<RoleApplication | null>;
  /** The application a resume-replacement token belongs to, or null. */
  getApplicationByResumeToken(token: string): Promise<RoleApplication | null>;
  /**
   * Swaps the resume stored on one application. Everything else on the
   * application (answers, status, interview link) is left untouched.
   */
  replaceApplicationResume(
    applicationId: string,
    resume: {
      fileName: string;
      text: string;
      objectPath: string | null;
      updatedAt: string;
    },
  ): Promise<RoleApplication | null>;
}

export function newRoleId(): string {
  return `role_${randomBytes(ROLE_ID_RANDOM_BYTES).toString("base64url")}`;
}

/** Public form tokens: 24 random bytes, URL-safe. */
const FORM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export function newFormToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isFormToken(value: string): boolean {
  return FORM_TOKEN_PATTERN.test(value);
}

export function newApplicationId(): string {
  return `app_${randomBytes(12).toString("base64url")}`;
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
CREATE TABLE IF NOT EXISTS role_form_links (
  role_id TEXT PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  max_applications INT,
  expires_after_hours INT,
  round_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE role_form_links ADD COLUMN IF NOT EXISTS max_applications INT;
ALTER TABLE role_form_links ADD COLUMN IF NOT EXISTS expires_after_hours INT;
ALTER TABLE role_form_links ADD COLUMN IF NOT EXISTS round_started_at TIMESTAMPTZ;
UPDATE role_form_links SET round_started_at = created_at WHERE round_started_at IS NULL;
ALTER TABLE role_form_links ALTER COLUMN round_started_at SET DEFAULT now();
ALTER TABLE role_form_links ALTER COLUMN round_started_at SET NOT NULL;
CREATE TABLE IF NOT EXISTS role_applications (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  college_id TEXT,
  education TEXT,
  cgpa NUMERIC,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_file_name TEXT,
  resume_text TEXT,
  resume_object_path TEXT,
  resume_update_token TEXT,
  resume_updated_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'new',
  interview_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS resume_update_token TEXT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS resume_updated_at TIMESTAMPTZ;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS cgpa NUMERIC;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS shortlisted BOOLEAN;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS shortlist_cutoff INT NOT NULL DEFAULT 0;
ALTER TABLE roles ALTER COLUMN shortlist_cutoff SET DEFAULT ${DEFAULT_SHORTLIST_CUTOFF};
ALTER TABLE roles ADD COLUMN IF NOT EXISTS auto_filter_match_below INT NOT NULL DEFAULT ${DEFAULT_AUTO_FILTER_RULE.matchBelow};
ALTER TABLE roles ADD COLUMN IF NOT EXISTS auto_filter_cgpa_below NUMERIC NOT NULL DEFAULT ${DEFAULT_AUTO_FILTER_RULE.cgpaBelow};
-- Roles created before the 70% door existed still say 0, which means "off".
-- Move each role to the new starting point exactly once: the marker row is the
-- guard, so a later 0 set by HR on purpose is left alone.
CREATE TABLE IF NOT EXISTS app_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
WITH applied AS (
  INSERT INTO app_migrations (id) VALUES ('shortlist-cutoff-70')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE roles SET shortlist_cutoff = ${DEFAULT_SHORTLIST_CUTOFF}
WHERE shortlist_cutoff = 0 AND EXISTS (SELECT 1 FROM applied);
CREATE TABLE IF NOT EXISTS role_candidate_screenings (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  candidate_email TEXT NOT NULL,
  status TEXT NOT NULL,
  score INT,
  sections JSONB,
  keywords JSONB,
  summary TEXT,
  reason TEXT,
  model TEXT,
  cost_usd NUMERIC,
  screened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_hash TEXT,
  PRIMARY KEY (role_id, candidate_email)
);
CREATE UNIQUE INDEX IF NOT EXISTS role_applications_resume_update_token_idx
  ON role_applications (resume_update_token);
CREATE UNIQUE INDEX IF NOT EXISTS role_applications_role_email_idx
  ON role_applications (role_id, lower(email));
CREATE INDEX IF NOT EXISTS role_applications_role_created_idx
  ON role_applications (role_id, created_at DESC);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS screening_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE roles ALTER COLUMN screening_enabled SET DEFAULT FALSE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS screening_weights JSONB;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_status TEXT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_score INT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_sections JSONB;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_keywords JSONB;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_summary TEXT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_model TEXT;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_cost_usd NUMERIC;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_at TIMESTAMPTZ;
ALTER TABLE role_applications ADD COLUMN IF NOT EXISTS screening_input_hash TEXT;
CREATE INDEX IF NOT EXISTS role_applications_role_screening_idx
  ON role_applications (role_id, screening_status);
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
  screening_enabled: boolean | null;
  screening_weights: unknown;
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
    screeningEnabled: row.screening_enabled ?? true,
    screeningWeights: sanitizeWeights(row.screening_weights),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const FORM_LINK_COLUMNS =
  "role_id, token, fields, created_at, revoked_at, max_applications, expires_after_hours, round_started_at";

interface FormLinkPgRow {
  role_id: string;
  token: string;
  fields: unknown;
  created_at: Date;
  revoked_at: Date | null;
  max_applications: number | null;
  expires_after_hours: number | null;
  round_started_at: Date;
}

function rowToFormLink(row: FormLinkPgRow): RoleFormLink {
  return {
    roleId: row.role_id,
    token: row.token,
    fields: Array.isArray(row.fields) ? (row.fields as ApplicationField[]) : [],
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    maxApplications: row.max_applications ?? null,
    expiresAfterHours: row.expires_after_hours ?? null,
    roundStartedAt: row.round_started_at.toISOString(),
  };
}

interface ApplicationPgRow {
  id: string;
  role_id: string;
  name: string;
  phone: string;
  email: string;
  college_id: string | null;
  education: string | null;
  cgpa: string | number | null;
  shortlisted: boolean | null;
  answers: unknown;
  resume_file_name: string | null;
  resume_text: string | null;
  resume_object_path: string | null;
  resume_updated_at: Date | null;
  status: string;
  interview_id: string | null;
  screening_status: string | null;
  screening_score: number | null;
  screening_sections: unknown;
  screening_keywords: unknown;
  screening_summary: string | null;
  screening_model: string | null;
  screening_cost_usd: string | null;
  screening_at: Date | null;
  screening_input_hash: string | null;
  created_at: Date;
}

/** Assembles the stored screening columns into the shape the app reads. */
function rowToScreening(row: ApplicationPgRow): ScreeningSnapshot | null {
  const status = row.screening_status;
  if (status !== "scored" && status !== "not_screened" && status !== "failed") return null;
  if (!row.screening_at) return null;
  const sections = Array.isArray(row.screening_sections) ? row.screening_sections : [];
  const keywords =
    row.screening_keywords && typeof row.screening_keywords === "object"
      ? (row.screening_keywords as ScreeningSnapshot["keywords"])
      : { matched: [], missing: [] };
  const scoredSections = sections.filter(
    (section) =>
      typeof section === "object" &&
      section !== null &&
      (section as { status?: string }).status === "scored",
  ).length;
  return {
    status,
    score: row.screening_score ?? null,
    sections: sections as ScreeningSnapshot["sections"],
    keywords,
    summary: row.screening_summary ?? "",
    reason: null,
    model: row.screening_model,
    costUsd: row.screening_cost_usd === null ? null : Number(row.screening_cost_usd),
    createdAt: row.screening_at.toISOString(),
    inputHash: row.screening_input_hash ?? "",
    scoredSections,
    weightedSections: scoredSections,
  };
}

function rowToApplication(row: ApplicationPgRow): RoleApplication {
  return {
    id: row.id,
    roleId: row.role_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    collegeId: row.college_id,
    education: row.education ?? null,
    cgpa: row.cgpa === null || row.cgpa === undefined ? null : Number(row.cgpa),
    shortlisted: row.shortlisted ?? null,
    answers:
      row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)
        ? (row.answers as Record<string, string>)
        : {},
    resumeFileName: row.resume_file_name,
    resumeObjectPath: row.resume_object_path,
    resumeUpdatedAt: row.resume_updated_at ? row.resume_updated_at.toISOString() : null,
    hasResumeText: Boolean(row.resume_text && row.resume_text.trim() !== ""),
    status: row.status === "rejected" || row.status === "scheduled" ? row.status : "new",
    interviewId: row.interview_id,
    screening: rowToScreening(row),
    createdAt: row.created_at.toISOString(),
  };
}

const APPLICATION_COLUMNS = `id, role_id, name, phone, email, college_id, education, cgpa,
  shortlisted, answers,
  resume_file_name, resume_text, resume_object_path, resume_updated_at, status, interview_id,
  screening_status, screening_score, screening_sections, screening_keywords, screening_summary,
  screening_model, screening_cost_usd, screening_at, screening_input_hash, created_at`;

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

    async deleteRoles(ids: readonly string[]): Promise<{ roles: number; interviews: number }> {
      if (ids.length === 0) return { roles: 0, interviews: 0 };
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const rooms = await client.query<{ id: string }>(
          "SELECT id FROM interviews WHERE role_id = ANY($1)",
          [ids],
        );
        const roomIds = rooms.rows.map((row) => row.id);
        let interviews = 0;
        if (roomIds.length > 0) {
          await client.query("DELETE FROM interview_turns WHERE room_id = ANY($1)", [roomIds]);
          await client.query("DELETE FROM interview_events WHERE room_id = ANY($1)", [roomIds]);
          await client.query("DELETE FROM scorecards WHERE room_id = ANY($1)", [roomIds]);
          const removed = await client.query("DELETE FROM interviews WHERE id = ANY($1)", [roomIds]);
          interviews = removed.rowCount ?? 0;
        }
        const result = await client.query("DELETE FROM roles WHERE id = ANY($1)", [ids]);
        await client.query("COMMIT");
        return { roles: result.rowCount ?? 0, interviews };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
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
      // The SQL compares against lower(title); lowercase here so the array
      // elements line up with the lowercased column values.
      const titles = roles.map((role) => role.title.toLowerCase());
      const result = await getPool().query(
        `WITH assoc AS (
           -- Legacy-title matches have a NULL role_id; map the matched title
           -- back to its role id (ids and titles arrive in the same order) so
           -- every association groups under a real role.
           SELECT (CASE
                     WHEN i.role_id IS NOT NULL THEN i.role_id
                     ELSE (SELECT t.rid FROM unnest($2::text[], $1::text[]) AS t(title, rid)
                           WHERE lower(t.title) = lower(i.role_title) LIMIT 1)
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
           AVG((s.scorecard -> 'overall' ->> 'score')::float)
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
           SELECT i.id, i.candidate_name, i.candidate_email, i.status, i.created_at, i.decision,
             i.scheduled_at, i.completed_at, i.expires_at
           FROM interviews i
           WHERE (i.role_id = $1 OR (i.role_id IS NULL AND lower(i.role_title) = lower($2)))
             AND i.candidate_email IS NOT NULL AND i.candidate_email <> ''
         ),
         latest AS (
           SELECT DISTINCT ON (LOWER(candidate_email)) *
           FROM assoc
           ORDER BY LOWER(candidate_email), created_at DESC, id DESC
         ),
         interview_rows AS (
           SELECT
             l.id AS room_id,
             l.candidate_email,
             l.status,
             l.created_at,
             l.decision,
             l.scheduled_at,
             l.completed_at,
             l.expires_at,
             (SELECT a.candidate_name FROM assoc a
               WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)
                 AND a.candidate_name IS NOT NULL
               ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS candidate_name,
             (SELECT COUNT(*)::int FROM assoc a
               WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)) AS interviews,
             (SELECT COUNT(*)::int FROM assoc a
               WHERE LOWER(a.candidate_email) = LOWER(l.candidate_email)
                 AND a.status = 'completed') AS completed,
             COALESCE(s.scorecard -> 'overall' ->> 'score', NULL) AS overall,
             s.scorecard ->> 'suggestion' AS suggestion,
             ra.id AS application_id,
             ra.created_at AS applied_at,
             ra.status AS application_status,
             ra.phone AS application_phone,
             ra.college_id AS application_college_id,
             ra.education AS application_education,
             ra.cgpa AS application_cgpa,
             ra.shortlisted AS application_shortlisted,
             ra.answers AS application_answers
           FROM latest l
           LEFT JOIN scorecards s ON s.room_id = l.id
           LEFT JOIN role_applications ra
             ON ra.role_id = $1 AND LOWER(ra.email) = LOWER(l.candidate_email)
         ),
         application_rows AS (
           SELECT
             ''::text AS room_id,
             a.email AS candidate_email,
             'scheduled'::text AS status,
             a.created_at,
             NULL::jsonb AS decision,
             NULL::timestamptz AS scheduled_at,
             NULL::timestamptz AS completed_at,
             NULL::timestamptz AS expires_at,
             a.name AS candidate_name,
             0 AS interviews,
             0 AS completed,
             NULL::text AS overall,
             NULL::text AS suggestion,
             a.id AS application_id,
             a.created_at AS applied_at,
             a.status AS application_status,
             a.phone AS application_phone,
             a.college_id AS application_college_id,
             a.education AS application_education,
             a.cgpa AS application_cgpa,
             a.shortlisted AS application_shortlisted,
             a.answers AS application_answers
           FROM role_applications a
           WHERE a.role_id = $1
             AND LOWER(a.email) NOT IN (SELECT LOWER(candidate_email) FROM assoc)
         )
         SELECT u.*, COUNT(*) OVER()::int AS total
         FROM (SELECT * FROM interview_rows UNION ALL SELECT * FROM application_rows) u
         ORDER BY u.created_at DESC, u.room_id DESC
         LIMIT $3 OFFSET $4`,
        [roleId, roleTitle, limit, offset],
      );
      const rows = result.rows as {
        room_id: string;
        candidate_email: string;
        candidate_name: string | null;
        status: string;
        created_at: Date;
        decision: unknown;
        scheduled_at: Date | null;
        completed_at: Date | null;
        expires_at: Date | null;
        interviews: number;
        completed: number;
        overall: string | null;
        suggestion: string | null;
        application_id: string | null;
        applied_at: Date | null;
        application_status: string | null;
        application_phone: string | null;
        application_college_id: string | null;
        application_education: string | null;
        application_cgpa: string | number | null;
        application_shortlisted: boolean | null;
        application_answers: unknown;
        total: number;
      }[];
      const candidates = rows.map((row) => ({
        roomId: row.room_id,
        candidateId: row.candidate_email.toLowerCase(),
        candidateEmail: row.candidate_email.toLowerCase(),
        candidateName: row.candidate_name,
        interviews: Number(row.interviews ?? 1),
        completed: Number(row.completed ?? 0),
        latestStatus: row.status as InterviewStatus,
        latestInterviewAt: row.created_at.toISOString(),
        scheduledAt: row.scheduled_at ? row.scheduled_at.toISOString() : null,
        completedAt: row.completed_at ? row.completed_at.toISOString() : null,
        latestExpiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        overallScore: row.overall === null ? null : Math.round(Number(row.overall)),
        suggestion: parseSuggestion(row.suggestion),
        decision: decisionFromJson(row.decision),
        applicationId: row.application_id,
        applicationStatus:
          row.application_id === null
            ? null
            : row.application_status === "rejected"
              ? ("rejected" as const)
              : row.application_status === "scheduled"
                ? ("scheduled" as const)
                : ("new" as const),
        appliedAt: row.applied_at ? row.applied_at.toISOString() : null,
        candidatePhone: row.application_phone,
        candidateCollegeId: row.application_college_id,
        candidateEducation: row.application_education ?? null,
        candidateCgpa:
          row.application_cgpa === null || row.application_cgpa === undefined
            ? null
            : Number(row.application_cgpa),
        shortlisted: row.application_shortlisted ?? null,
        answers:
          row.application_answers &&
          typeof row.application_answers === "object" &&
          !Array.isArray(row.application_answers)
            ? (row.application_answers as Record<string, string>)
            : null,
      }));
      return { candidates, total: rows.length > 0 ? Number(rows[0].total) : 0 };
    },

    async getRoleCandidateCounts(
      roleId: string,
      roleTitle: string,
    ): Promise<RoleCandidateStageCounts> {
      await ensureSchema();
      const result = await getPool().query(
        `WITH assoc AS (
           SELECT DISTINCT LOWER(i.candidate_email) AS email
           FROM interviews i
           WHERE (i.role_id = $1 OR (i.role_id IS NULL AND lower(i.role_title) = lower($2)))
             AND i.candidate_email IS NOT NULL AND i.candidate_email <> ''
         )
         SELECT
           (SELECT COUNT(*)::int FROM assoc) AS interview,
           (SELECT COUNT(*)::int FROM role_applications a
             WHERE a.role_id = $1
               AND LOWER(a.email) NOT IN (SELECT email FROM assoc)) AS applied`,
        [roleId, roleTitle],
      );
      const row = result.rows[0] as { applied: number; interview: number } | undefined;
      return {
        applied: Number(row?.applied ?? 0),
        interview: Number(row?.interview ?? 0),
      };
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
           COALESCE(s.scorecard -> 'overall' ->> 'score', NULL) AS overall,
           s.scorecard ->> 'suggestion' AS suggestion,
           COALESCE((s.scorecard ->> 'needsHumanReview')::boolean, false) AS needs_review
         FROM interviews i
         LEFT JOIN scorecards s ON s.room_id = i.id
         WHERE (i.role_id = $1 OR (i.role_id IS NULL AND lower(i.role_title) = lower($2)))
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
         WHERE (i.role_id = $1 OR (i.role_id IS NULL AND lower(i.role_title) = lower($2)))
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

    async deleteRoleCandidates(
      roleId: string,
      roleTitle: string,
      emails: readonly string[],
    ): Promise<{ interviews: number; applications: number; screenings: number }> {
      const lowered = [...new Set(emails.map((email) => email.trim().toLowerCase()))].filter(
        (email) => email !== "",
      );
      if (lowered.length === 0) return { interviews: 0, applications: 0, screenings: 0 };
      await ensureSchema();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const rooms = await client.query<{ id: string }>(
          `SELECT i.id FROM interviews i
           WHERE ${roleAssociationSql("$1::text[]", "$2::text[]")}
             AND i.candidate_email IS NOT NULL
             AND lower(i.candidate_email) = ANY($3::text[])`,
          [[roleId], [roleTitle.toLowerCase()], lowered],
        );
        const roomIds = rooms.rows.map((row) => row.id);
        let interviews = 0;
        if (roomIds.length > 0) {
          await client.query("DELETE FROM interview_turns WHERE room_id = ANY($1)", [roomIds]);
          await client.query("DELETE FROM interview_events WHERE room_id = ANY($1)", [roomIds]);
          await client.query("DELETE FROM scorecards WHERE room_id = ANY($1)", [roomIds]);
          const removed = await client.query("DELETE FROM interviews WHERE id = ANY($1)", [roomIds]);
          interviews = removed.rowCount ?? 0;
        }
        const applications = await client.query(
          `DELETE FROM role_applications WHERE role_id = $1 AND lower(email) = ANY($2::text[])`,
          [roleId, lowered],
        );
        const screenings = await client.query(
          `DELETE FROM role_candidate_screenings
           WHERE role_id = $1 AND lower(candidate_email) = ANY($2::text[])`,
          [roleId, lowered],
        );
        await client.query("COMMIT");
        return {
          interviews,
          applications: applications.rowCount ?? 0,
          screenings: screenings.rowCount ?? 0,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    async getFormLink(roleId: string): Promise<RoleFormLink | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT ${FORM_LINK_COLUMNS}
         FROM role_form_links WHERE role_id = $1`,
        [roleId],
      );
      const row = result.rows[0] as FormLinkPgRow | undefined;
      return row ? rowToFormLink(row) : null;
    },

    async getOrCreateFormLink(roleId: string): Promise<RoleFormLink> {
      await ensureSchema();
      const found = await getPool().query(
        `SELECT ${FORM_LINK_COLUMNS}
         FROM role_form_links WHERE role_id = $1`,
        [roleId],
      );
      const existingRow = found.rows[0] as FormLinkPgRow | undefined;
      const existing = existingRow ? rowToFormLink(existingRow) : null;
      if (existing) {
        if (existing.revokedAt === null) return existing;
        // Sharing the link again brings the same token back to life, so a
        // group that already has it does not need a fresh one.
        const restored = await getPool().query(
          `UPDATE role_form_links SET revoked_at = NULL WHERE role_id = $1
           RETURNING ${FORM_LINK_COLUMNS}`,
          [roleId],
        );
        return rowToFormLink(restored.rows[0] as FormLinkPgRow);
      }
      // A token collision is vanishingly unlikely; retry a few times anyway.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const created = await getPool().query(
            `INSERT INTO role_form_links (role_id, token)
             VALUES ($1, $2)
             RETURNING ${FORM_LINK_COLUMNS}`,
            [roleId, newFormToken()],
          );
          return rowToFormLink(created.rows[0] as FormLinkPgRow);
        } catch (error) {
          if ((error as { code?: string }).code !== "23505") throw error;
        }
      }
      throw new Error("Could not allocate a unique form token.");
    },

    async updateFormLinkFields(
      roleId: string,
      fields: ApplicationField[],
    ): Promise<RoleFormLink | null> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_form_links SET fields = $2::jsonb
         WHERE role_id = $1
         RETURNING ${FORM_LINK_COLUMNS}`,
        [roleId, JSON.stringify(fields)],
      );
      const row = result.rows[0] as FormLinkPgRow | undefined;
      return row ? rowToFormLink(row) : null;
    },

    async revokeFormLink(roleId: string): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `UPDATE role_form_links SET revoked_at = now() WHERE role_id = $1 AND revoked_at IS NULL`,
        [roleId],
      );
    },

    async updateFormLinkSettings(
      roleId: string,
      settings: { maxApplications: number | null; expiresAfterHours: number | null },
    ): Promise<RoleFormLink | null> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_form_links
         SET max_applications = $2, expires_after_hours = $3
         WHERE role_id = $1
         RETURNING ${FORM_LINK_COLUMNS}`,
        [roleId, settings.maxApplications, settings.expiresAfterHours],
      );
      const row = result.rows[0] as FormLinkPgRow | undefined;
      return row ? rowToFormLink(row) : null;
    },

    async rotateFormLink(roleId: string): Promise<RoleFormLink | null> {
      await ensureSchema();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const result = await getPool().query(
            `UPDATE role_form_links
             SET token = $2, revoked_at = NULL, created_at = now(), round_started_at = now()
             WHERE role_id = $1
             RETURNING ${FORM_LINK_COLUMNS}`,
            [roleId, newFormToken()],
          );
          const row = result.rows[0] as FormLinkPgRow | undefined;
          return row ? rowToFormLink(row) : null;
        } catch (error) {
          if ((error as { code?: string }).code !== "23505") throw error;
        }
      }
      throw new Error("Could not allocate a unique form token.");
    },

    async countApplicationsSince(roleId: string, since: string | null): Promise<number> {
      await ensureSchema();
      const result = since
        ? await getPool().query(
            `SELECT COUNT(*)::int AS total FROM role_applications
             WHERE role_id = $1 AND created_at >= $2`,
            [roleId, since],
          )
        : await getPool().query(
            `SELECT COUNT(*)::int AS total FROM role_applications WHERE role_id = $1`,
            [roleId],
          );
      return Number((result.rows[0] as { total: number } | undefined)?.total ?? 0);
    },

    async getRoleByFormToken(token: string): Promise<Role | null> {
      if (!isFormToken(token)) return null;
      await ensureSchema();
      const result = await getPool().query(
        `SELECT r.id, r.title, r.description, r.skills, r.deadline, r.status, r.created_at, r.updated_at
         FROM role_form_links f
         JOIN roles r ON r.id = f.role_id
         WHERE f.token = $1 AND f.revoked_at IS NULL`,
        [token],
      );
      const row = result.rows[0] as RolePgRow | undefined;
      return row ? rowToRole(row) : null;
    },

    async createApplication(input: CreateApplicationRow): Promise<RoleApplication | null> {
      await ensureSchema();
      try {
        const result = await getPool().query(
          `INSERT INTO role_applications
             (id, role_id, name, phone, email, college_id, education, cgpa, answers,
              resume_file_name, resume_text, resume_object_path, resume_update_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
           RETURNING ${APPLICATION_COLUMNS}`,
          [
            input.id,
            input.roleId,
            input.name,
            input.phone,
            input.email,
            input.collegeId,
            input.education,
            input.cgpa,
            JSON.stringify(input.answers),
            input.resumeFileName,
            input.resumeText,
            input.resumeObjectPath,
            input.resumeUpdateToken,
          ],
        );
        return rowToApplication(result.rows[0] as ApplicationPgRow);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return null;
        throw error;
      }
    },

    async listApplications(
      roleId: string,
      limit: number,
      offset: number,
    ): Promise<{ applications: RoleApplication[]; total: number }> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT ${APPLICATION_COLUMNS}, COUNT(*) OVER()::int AS total
         FROM role_applications
         WHERE role_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [roleId, limit, offset],
      );
      const rows = result.rows as (ApplicationPgRow & { total: number })[];
      return {
        applications: rows.map(rowToApplication),
        total: rows.length > 0 ? Number(rows[0].total) : 0,
      };
    },

    async getApplication(roleId: string, applicationId: string): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT ${APPLICATION_COLUMNS} FROM role_applications WHERE role_id = $1 AND id = $2`,
        [roleId, applicationId],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },

    async updateApplicationStatus(
      roleId: string,
      applicationId: string,
      status: ApplicationStatus,
      interviewId?: string | null,
    ): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_applications
         SET status = $3, interview_id = COALESCE($4, interview_id)
         WHERE role_id = $1 AND id = $2
         RETURNING ${APPLICATION_COLUMNS}`,
        [roleId, applicationId, status, interviewId ?? null],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },

    async getApplicationResume(
      roleId: string,
      applicationId: string,
    ): Promise<{ fileName: string | null; objectPath: string | null; text: string } | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT resume_file_name, resume_object_path, resume_text
         FROM role_applications WHERE role_id = $1 AND id = $2`,
        [roleId, applicationId],
      );
      const row = result.rows[0] as
        | { resume_file_name: string | null; resume_object_path: string | null; resume_text: string | null }
        | undefined;
      if (!row) return null;
      return {
        fileName: row.resume_file_name,
        objectPath: row.resume_object_path,
        text: row.resume_text ?? "",
      };
    },

    async getRoleScreeningSettings(
      roleId: string,
    ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT screening_enabled, screening_weights FROM roles WHERE id = $1`,
        [roleId],
      );
      const row = result.rows[0] as
        | { screening_enabled: boolean | null; screening_weights: unknown }
        | undefined;
      if (!row) return null;
      return {
        enabled: row.screening_enabled ?? true,
        weights: sanitizeWeights(row.screening_weights),
      };
    },

    async updateRoleScreeningSettings(
      roleId: string,
      settings: { enabled: boolean; weights: ScreeningWeights },
    ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null> {
      await ensureSchema();
      const weights = sanitizeWeights(settings.weights);
      const result = await getPool().query(
        `UPDATE roles
         SET screening_enabled = $2, screening_weights = $3::jsonb, updated_at = now()
         WHERE id = $1
         RETURNING screening_enabled, screening_weights`,
        [roleId, settings.enabled, JSON.stringify(weights)],
      );
      const row = result.rows[0] as
        | { screening_enabled: boolean | null; screening_weights: unknown }
        | undefined;
      if (!row) return null;
      return {
        enabled: row.screening_enabled ?? true,
        weights: sanitizeWeights(row.screening_weights),
      };
    },

    async getRoleShortlistCutoff(roleId: string): Promise<number> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT shortlist_cutoff FROM roles WHERE id = $1`,
        [roleId],
      );
      const row = result.rows[0] as { shortlist_cutoff: number | null } | undefined;
      return clampCutoff(row?.shortlist_cutoff ?? DEFAULT_SHORTLIST_CUTOFF);
    },

    async setRoleShortlistCutoff(roleId: string, cutoff: number): Promise<number> {
      await ensureSchema();
      const value = clampCutoff(cutoff);
      const result = await getPool().query(
        `UPDATE roles SET shortlist_cutoff = $2, updated_at = now()
         WHERE id = $1 RETURNING shortlist_cutoff`,
        [roleId, value],
      );
      const row = result.rows[0] as { shortlist_cutoff: number | null } | undefined;
      return clampCutoff(row?.shortlist_cutoff ?? value);
    },

    async getAutoFilterRule(roleId: string): Promise<AutoFilterRule> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT auto_filter_match_below, auto_filter_cgpa_below FROM roles WHERE id = $1`,
        [roleId],
      );
      const row = result.rows[0] as
        | { auto_filter_match_below: number | null; auto_filter_cgpa_below: string | number | null }
        | undefined;
      if (!row) return { ...DEFAULT_AUTO_FILTER_RULE };
      return sanitizeAutoFilterRule({
        matchBelow: row.auto_filter_match_below,
        cgpaBelow: row.auto_filter_cgpa_below,
      });
    },

    async setAutoFilterRule(roleId: string, rule: AutoFilterRule): Promise<AutoFilterRule> {
      await ensureSchema();
      const value = sanitizeAutoFilterRule(rule);
      await getPool().query(
        `UPDATE roles SET auto_filter_match_below = $2, auto_filter_cgpa_below = $3, updated_at = now()
         WHERE id = $1`,
        [roleId, value.matchBelow, value.cgpaBelow],
      );
      return value;
    },

    async setApplicationShortlisted(
      roleId: string,
      applicationId: string,
      shortlisted: boolean | null,
    ): Promise<boolean> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_applications SET shortlisted = $3
         WHERE role_id = $1 AND id = $2 RETURNING id`,
        [roleId, applicationId, shortlisted],
      );
      return result.rowCount !== null && result.rowCount > 0;
    },

    async getApplicationResumeText(
      roleId: string,
      applicationId: string,
    ): Promise<{ fileName: string | null; text: string; inputHash: string | null } | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT resume_file_name, resume_text, screening_input_hash
         FROM role_applications WHERE role_id = $1 AND id = $2`,
        [roleId, applicationId],
      );
      const row = result.rows[0] as
        | { resume_file_name: string | null; resume_text: string | null; screening_input_hash: string | null }
        | undefined;
      if (!row) return null;
      return {
        fileName: row.resume_file_name,
        text: row.resume_text ?? "",
        inputHash: row.screening_input_hash,
      };
    },

    async saveApplicationScreening(
      applicationId: string,
      snapshot: ScreeningSnapshot,
    ): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `UPDATE role_applications
         SET screening_status = $2,
             screening_score = $3,
             screening_sections = $4::jsonb,
             screening_keywords = $5::jsonb,
             screening_summary = $6,
             screening_model = $7,
             screening_cost_usd = $8,
             screening_at = $9::timestamptz,
             screening_input_hash = $10
         WHERE id = $1`,
        [
          applicationId,
          snapshot.status,
          snapshot.score === null ? null : Math.round(snapshot.score),
          JSON.stringify(snapshot.sections),
          JSON.stringify(snapshot.keywords),
          snapshot.summary,
          snapshot.model,
          snapshot.costUsd,
          snapshot.createdAt,
          snapshot.inputHash,
        ],
      );
    },

    async getInvitedCandidateScreenings(
      roleId: string,
    ): Promise<Map<string, ScreeningSnapshot>> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT candidate_email, status, score, sections, keywords, summary, reason, model,
                cost_usd, screened_at, input_hash
         FROM role_candidate_screenings WHERE role_id = $1`,
        [roleId],
      );
      const rows = result.rows as {
        candidate_email: string;
        status: string;
        score: number | null;
        sections: unknown;
        keywords: unknown;
        summary: string | null;
        reason: string | null;
        model: string | null;
        cost_usd: number | string | null;
        screened_at: Date;
        input_hash: string | null;
      }[];
      return new Map(
        rows.map((row) => {
          const sections = Array.isArray(row.sections)
            ? (row.sections as ScreeningSnapshot["sections"])
            : [];
          const keywords = Array.isArray(row.keywords)
            ? (row.keywords as unknown as ScreeningSnapshot["keywords"])
            : ([] as unknown as ScreeningSnapshot["keywords"]);
          const snapshot: ScreeningSnapshot = {
            status:
              row.status === "scored" || row.status === "failed" || row.status === "not_screened"
                ? row.status
                : "not_screened",
            score: row.score === null ? null : Number(row.score),
            sections,
            keywords,
            summary: row.summary ?? "",
            reason: row.reason ?? null,
            model: row.model,
            costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
            createdAt: row.screened_at.toISOString(),
            inputHash: row.input_hash ?? "",
            scoredSections: sections.filter((item) => item.score !== null).length,
            weightedSections: sections.length,
          };
          return [row.candidate_email.toLowerCase(), snapshot] as const;
        }),
      );
    },

    async saveInvitedCandidateScreening(
      roleId: string,
      email: string,
      snapshot: ScreeningSnapshot,
    ): Promise<void> {
      await ensureSchema();
      await getPool().query(
        `INSERT INTO role_candidate_screenings
           (role_id, candidate_email, status, score, sections, keywords, summary, reason,
            model, cost_usd, screened_at, input_hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::timestamptz, $12)
         ON CONFLICT (role_id, candidate_email) DO UPDATE SET
           status = EXCLUDED.status,
           score = EXCLUDED.score,
           sections = EXCLUDED.sections,
           keywords = EXCLUDED.keywords,
           summary = EXCLUDED.summary,
           reason = EXCLUDED.reason,
           model = EXCLUDED.model,
           cost_usd = EXCLUDED.cost_usd,
           screened_at = EXCLUDED.screened_at,
           input_hash = EXCLUDED.input_hash`,
        [
          roleId,
          email.toLowerCase(),
          snapshot.status,
          snapshot.score === null ? null : Math.round(snapshot.score),
          JSON.stringify(snapshot.sections),
          JSON.stringify(snapshot.keywords),
          snapshot.summary,
          snapshot.reason,
          snapshot.model,
          snapshot.costUsd,
          snapshot.createdAt,
          snapshot.inputHash,
        ],
      );
    },

    async listUnscreenedInvitedCandidates(
      roleId: string,
      roleTitle: string,
      limit: number,
    ): Promise<{ email: string; hasText: boolean }[]> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT DISTINCT ON (lower(i.candidate_email))
                lower(i.candidate_email) AS email,
                (i.resume_text IS NOT NULL AND length(trim(i.resume_text)) > 0) AS has_text
         FROM interviews i
         LEFT JOIN role_candidate_screenings s
           ON s.role_id = $1 AND s.candidate_email = lower(i.candidate_email)
         WHERE (i.role_id = $1 OR (i.role_id IS NULL AND lower(i.role_title) = lower($2)))
           AND i.candidate_email IS NOT NULL AND i.candidate_email <> ''
           AND s.candidate_email IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM role_applications a
             WHERE a.role_id = $1 AND lower(a.email) = lower(i.candidate_email)
           )
         ORDER BY lower(i.candidate_email), i.created_at DESC
         LIMIT $3`,
        [roleId, roleTitle, Math.min(Math.max(limit, 1), 200)],
      );
      return (result.rows as { email: string; has_text: boolean }[]).map((row) => ({
        email: row.email,
        hasText: Boolean(row.has_text),
      }));
    },

    async listUnscreenedApplications(
      roleId: string,
      limit: number,
    ): Promise<{ id: string; hasText: boolean }[]> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT id, (resume_text IS NOT NULL AND length(trim(resume_text)) > 0) AS has_text
         FROM role_applications
         WHERE role_id = $1 AND screening_at IS NULL
         ORDER BY created_at ASC
         LIMIT $2`,
        [roleId, Math.min(Math.max(limit, 1), 200)],
      );
      return (result.rows as { id: string; has_text: boolean }[]).map((row) => ({
        id: row.id,
        hasText: row.has_text,
      }));
    },

    async getApplicationScreeningScores(
      roleId: string,
    ): Promise<Map<string, { score: number | null; status: string; sections: SectionResult[] }>> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT id, screening_score, screening_status, screening_sections
         FROM role_applications
         WHERE role_id = $1 AND screening_status IS NOT NULL`,
        [roleId],
      );
      const map = new Map<
        string,
        { score: number | null; status: string; sections: SectionResult[] }
      >();
      for (const row of result.rows as {
        id: string;
        screening_score: number | null;
        screening_status: string;
        screening_sections: unknown;
      }[]) {
        map.set(row.id, {
          score: row.screening_score,
          status: row.screening_status,
          sections: Array.isArray(row.screening_sections)
            ? (row.screening_sections as SectionResult[])
            : [],
        });
      }
      return map;
    },

    async getApplicationByResumeToken(token: string): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT ${APPLICATION_COLUMNS}
         FROM role_applications WHERE resume_update_token = $1`,
        [token],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },

    async getApplicationByEmail(roleId: string, email: string): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `SELECT ${APPLICATION_COLUMNS}
         FROM role_applications
         WHERE role_id = $1 AND lower(email) = lower($2)`,
        [roleId, email],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },

    async refreshApplication(
      applicationId: string,
      patch: {
        name: string;
        collegeId: string | null;
        education: string | null;
        cgpa: number | null;
        answers: Record<string, string>;
        fileName: string;
        text: string;
        objectPath: string | null;
        updatedAt: string;
      },
    ): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_applications
         SET name = $2,
             college_id = $3,
             education = $4,
             cgpa = $5,
             answers = $6::jsonb,
             resume_file_name = $7,
             resume_text = $8,
             resume_object_path = $9,
             resume_updated_at = $10::timestamptz,
             screening_status = NULL,
             screening_score = NULL,
             screening_sections = NULL,
             screening_keywords = NULL,
             screening_summary = NULL,
             screening_model = NULL,
             screening_cost_usd = NULL,
             screening_at = NULL,
             screening_input_hash = NULL
         WHERE id = $1
         RETURNING ${APPLICATION_COLUMNS}`,
        [
          applicationId,
          patch.name,
          patch.collegeId,
          patch.education,
          patch.cgpa,
          JSON.stringify(patch.answers),
          patch.fileName,
          patch.text,
          patch.objectPath,
          patch.updatedAt,
        ],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },

    async replaceApplicationResume(
      applicationId: string,
      resume: {
        fileName: string;
        text: string;
        objectPath: string | null;
        updatedAt: string;
      },
    ): Promise<RoleApplication | null> {
      await ensureSchema();
      const result = await getPool().query(
        `UPDATE role_applications
         SET resume_file_name = $2,
             resume_text = $3,
             resume_object_path = $4,
             resume_updated_at = $5::timestamptz,
             screening_status = NULL,
             screening_score = NULL,
             screening_sections = NULL,
             screening_keywords = NULL,
             screening_summary = NULL,
             screening_model = NULL,
             screening_cost_usd = NULL,
             screening_at = NULL,
             screening_input_hash = NULL
         WHERE id = $1
         RETURNING ${APPLICATION_COLUMNS}`,
        [applicationId, resume.fileName, resume.text, resume.objectPath, resume.updatedAt],
      );
      const row = result.rows[0] as ApplicationPgRow | undefined;
      return row ? rowToApplication(row) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (zero-setup local development)
// ---------------------------------------------------------------------------

interface InMemoryRoleStore {
  roles: Map<string, Role>;
  formLinks: Map<string, RoleFormLink>;
  applications: Map<string, RoleApplication>;
  /** Resume-replacement token to application id. */
  resumeTokens: Map<string, string>;
  /** Extracted resume text per application, used only by resume screening. */
  resumeTexts: Map<string, string>;
  /** Per-role Match score that shortlists automatically; absent means none. */
  shortlistCutoffs: Map<string, number>;
  autoFilterRules: Map<string, AutoFilterRule>;
  /** Screening results for invited candidates, keyed `roleId:email`. */
  invitedScreenings: Map<string, ScreeningSnapshot>;
}

const globalStore = globalThis as unknown as { __rolesStoreV2?: InMemoryRoleStore };

function getStore(): InMemoryRoleStore {
  if (!globalStore.__rolesStoreV2) {
    globalStore.__rolesStoreV2 = {
      roles: new Map(),
      formLinks: new Map(),
      applications: new Map(),
      resumeTokens: new Map(),
      resumeTexts: new Map(),
      shortlistCutoffs: new Map(),
      autoFilterRules: new Map(),
      invitedScreenings: new Map(),
    };
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
    scheduledAt: room.scheduledAt,
    expiresAt: room.expiresAt,
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
    overallScore: scorecard.overall?.score ?? null,
    suggestion: scorecard.suggestion,
    needsHumanReview: scorecard.needsHumanReview,
  };
}

/** Fills limits added after a link was stored, so older links keep working. */
function normaliseFormLink(link: RoleFormLink): RoleFormLink {
  return {
    ...link,
    maxApplications: link.maxApplications ?? null,
    expiresAfterHours: link.expiresAfterHours ?? null,
    roundStartedAt: link.roundStartedAt ?? link.createdAt,
  };
}

/** Application-only candidate row, shaped like an aggregated interview row. */
function applicationToCandidate(application: RoleApplication): CandidateRow {
  return {
    roomId: "",
    candidateId: application.email.toLowerCase(),
    candidateEmail: application.email.toLowerCase(),
    candidateName: application.name,
    interviews: 0,
    completed: 0,
    latestStatus: "scheduled",
    latestInterviewAt: application.createdAt,
    scheduledAt: null,
    completedAt: null,
    latestExpiresAt: null,
    overallScore: null,
    suggestion: null,
    decision: null,
    applicationId: application.id,
    applicationStatus: application.status,
    appliedAt: application.createdAt,
    candidatePhone: application.phone,
    candidateCollegeId: application.collegeId,
    candidateEducation: application.education,
    candidateCgpa: application.cgpa,
    shortlisted: application.shortlisted,
    answers: application.answers,
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
        screeningEnabled: false,
        screeningWeights: { ...DEFAULT_SCREENING_WEIGHTS },
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

    async deleteRoles(ids: readonly string[]): Promise<{ roles: number; interviews: number }> {
      const store = getInterviewStore();
      let roles = 0;
      let interviews = 0;
      for (const id of ids) {
        for (const [roomId, room] of store.rooms) {
          if (room.roleId !== id) continue;
          store.rooms.delete(roomId);
          store.turns.delete(roomId);
          store.events.delete(roomId);
          store.scorecards.delete(roomId);
          interviews += 1;
        }
        if (getStore().roles.delete(id)) roles += 1;
        getStore().formLinks.delete(id);
        for (const [applicationId, application] of getStore().applications) {
          if (application.roleId !== id) continue;
          getStore().applications.delete(applicationId);
          for (const [token, tokenApplicationId] of getStore().resumeTokens) {
            if (tokenApplicationId === applicationId) getStore().resumeTokens.delete(token);
          }
        }
      }
      return { roles, interviews };
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
      // An applicant who later interviewed still keeps their application, so the
      // resume score follows them. Postgres joins it the same way in SQL; this
      // path used to drop it, which is why Match showed a dash locally.
      const applications = [...getStore().applications.values()].filter(
        (application) => application.roleId === roleId,
      );
      const applicationByEmail = new Map(
        applications.map((application) => [application.email.toLowerCase(), application]),
      );
      const withApplications = all.map((candidate) => {
        const application = applicationByEmail.get(candidate.candidateEmail);
        if (!application) return candidate;
        return {
          ...candidate,
          applicationId: application.id,
          applicationStatus: application.status,
          appliedAt: application.createdAt,
          candidatePhone: application.phone,
          candidateCollegeId: application.collegeId,
          candidateEducation: application.education,
          candidateCgpa: application.cgpa,
          shortlisted: application.shortlisted,
          answers: application.answers,
        };
      });
      const interviewed = new Set(all.map((candidate) => candidate.candidateId));
      const appRows = applications
        .filter((application) => !interviewed.has(application.email.toLowerCase()))
        .map(applicationToCandidate);
      const merged = [...withApplications, ...appRows].sort(
        (a, b) => b.latestInterviewAt.localeCompare(a.latestInterviewAt),
      );
      return { candidates: merged.slice(offset, offset + limit), total: merged.length };
    },

    async getRoleCandidateCounts(
      roleId: string,
      roleTitle: string,
    ): Promise<RoleCandidateStageCounts> {
      const store = getInterviewStore();
      const emails = new Set<string>();
      for (const room of store.rooms.values()) {
        if (!matchesRoleAssociation(roleId, roleTitle, room)) continue;
        const email = room.candidateEmail?.trim().toLowerCase();
        if (email) emails.add(email);
      }
      const applied = [...getStore().applications.values()].filter(
        (application) =>
          application.roleId === roleId &&
          !emails.has(application.email.toLowerCase()),
      ).length;
      return { applied, interview: emails.size };
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
            overallScore: scorecard?.overall?.score ?? null,
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

    async deleteRoleCandidates(
      roleId: string,
      roleTitle: string,
      emails: readonly string[],
    ): Promise<{ interviews: number; applications: number; screenings: number }> {
      const wanted = new Set(
        emails.map((email) => email.trim().toLowerCase()).filter((email) => email !== ""),
      );
      if (wanted.size === 0) return { interviews: 0, applications: 0, screenings: 0 };
      const store = getStore();
      const rooms = getInterviewStore();
      let interviews = 0;
      for (const [roomId, room] of rooms.rooms) {
        if (!matchesRoleAssociation(roleId, roleTitle, room)) continue;
        const email = room.candidateEmail?.trim().toLowerCase() ?? "";
        if (!wanted.has(email)) continue;
        rooms.rooms.delete(roomId);
        rooms.turns.delete(roomId);
        rooms.events.delete(roomId);
        rooms.scorecards.delete(roomId);
        interviews += 1;
      }
      let applications = 0;
      for (const [applicationId, application] of store.applications) {
        if (application.roleId !== roleId) continue;
        if (!wanted.has(application.email.trim().toLowerCase())) continue;
        store.applications.delete(applicationId);
        for (const [token, tokenApplicationId] of store.resumeTokens) {
          if (tokenApplicationId === applicationId) store.resumeTokens.delete(token);
        }
        applications += 1;
      }
      let screenings = 0;
      for (const email of wanted) {
        if (store.invitedScreenings.delete(`${roleId}:${email}`)) screenings += 1;
      }
      return { interviews, applications, screenings };
    },

    async getFormLink(roleId: string): Promise<RoleFormLink | null> {
      const stored = getStore().formLinks.get(roleId);
      return stored ? normaliseFormLink(stored) : null;
    },

    async getOrCreateFormLink(roleId: string): Promise<RoleFormLink> {
      const store = getStore();
      const existing = store.formLinks.get(roleId);
      if (existing) {
        if (existing.revokedAt === null) return normaliseFormLink(existing);
        const restored = { ...normaliseFormLink(existing), revokedAt: null };
        store.formLinks.set(roleId, restored);
        return restored;
      }
      const created = new Date().toISOString();
      const link: RoleFormLink = {
        roleId,
        token: newFormToken(),
        fields: [],
        createdAt: created,
        revokedAt: null,
        maxApplications: null,
        expiresAfterHours: null,
        roundStartedAt: created,
      };
      store.formLinks.set(roleId, link);
      return link;
    },

    async updateFormLinkFields(
      roleId: string,
      fields: ApplicationField[],
    ): Promise<RoleFormLink | null> {
      const store = getStore();
      const existing = store.formLinks.get(roleId);
      if (!existing) return null;
      const updated = { ...existing, fields: [...fields] };
      store.formLinks.set(roleId, updated);
      return updated;
    },

    async revokeFormLink(roleId: string): Promise<void> {
      const store = getStore();
      const existing = store.formLinks.get(roleId);
      if (existing) {
        store.formLinks.set(roleId, { ...existing, revokedAt: new Date().toISOString() });
      }
    },

    async updateFormLinkSettings(
      roleId: string,
      settings: { maxApplications: number | null; expiresAfterHours: number | null },
    ): Promise<RoleFormLink | null> {
      const store = getStore();
      const existing = store.formLinks.get(roleId);
      if (!existing) return null;
      const updated = { ...normaliseFormLink(existing), ...settings };
      store.formLinks.set(roleId, updated);
      return updated;
    },

    async rotateFormLink(roleId: string): Promise<RoleFormLink | null> {
      const store = getStore();
      const existing = store.formLinks.get(roleId);
      if (!existing) return null;
      const now = new Date().toISOString();
      const updated: RoleFormLink = {
        ...normaliseFormLink(existing),
        token: newFormToken(),
        revokedAt: null,
        createdAt: now,
        roundStartedAt: now,
      };
      store.formLinks.set(roleId, updated);
      return updated;
    },

    async countApplicationsSince(roleId: string, since: string | null): Promise<number> {
      return [...getStore().applications.values()].filter(
        (application) =>
          application.roleId === roleId && (!since || application.createdAt >= since),
      ).length;
    },

    async getRoleByFormToken(token: string): Promise<Role | null> {
      if (!isFormToken(token)) return null;
      const link = [...getStore().formLinks.values()].find(
        (entry) => entry.token === token && entry.revokedAt === null,
      );
      return link ? roleOf(link.roleId) : null;
    },

    async createApplication(input: CreateApplicationRow): Promise<RoleApplication | null> {
      const store = getStore();
      const duplicate = [...store.applications.values()].some(
        (application) =>
          application.roleId === input.roleId &&
          application.email.toLowerCase() === input.email.toLowerCase(),
      );
      if (duplicate) return null;
      const application: RoleApplication = {
        id: input.id,
        roleId: input.roleId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        collegeId: input.collegeId,
        education: input.education,
        cgpa: input.cgpa,
        shortlisted: null,
        answers: input.answers,
        resumeFileName: input.resumeFileName,
        resumeObjectPath: input.resumeObjectPath,
        hasResumeText: input.resumeText.trim() !== "",
        resumeUpdatedAt: null,
        status: "new",
        interviewId: null,
        createdAt: new Date().toISOString(),
      };
      store.applications.set(application.id, application);
      store.resumeTokens.set(input.resumeUpdateToken, application.id);
      store.resumeTexts.set(application.id, input.resumeText);
      return application;
    },

    async listApplications(
      roleId: string,
      limit: number,
      offset: number,
    ): Promise<{ applications: RoleApplication[]; total: number }> {
      const all = [...getStore().applications.values()]
        .filter((application) => application.roleId === roleId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return { applications: all.slice(offset, offset + limit), total: all.length };
    },

    async getApplication(
      roleId: string,
      applicationId: string,
    ): Promise<RoleApplication | null> {
      const application = getStore().applications.get(applicationId);
      return application && application.roleId === roleId ? application : null;
    },

    async updateApplicationStatus(
      roleId: string,
      applicationId: string,
      status: ApplicationStatus,
      interviewId?: string | null,
    ): Promise<RoleApplication | null> {
      const store = getStore();
      const application = store.applications.get(applicationId);
      if (!application || application.roleId !== roleId) return null;
      const updated: RoleApplication = {
        ...application,
        status,
        interviewId: interviewId ?? application.interviewId,
      };
      store.applications.set(applicationId, updated);
      return updated;
    },

    async getApplicationResume(
      roleId: string,
      applicationId: string,
    ): Promise<{ fileName: string | null; objectPath: string | null; text: string } | null> {
      const application = getStore().applications.get(applicationId);
      if (!application || application.roleId !== roleId) return null;
      return {
        fileName: application.resumeFileName,
        objectPath: application.resumeObjectPath,
        text: "",
      };
    },

    async getApplicationByResumeToken(token: string): Promise<RoleApplication | null> {
      const store = getStore();
      const applicationId = store.resumeTokens.get(token);
      return applicationId ? store.applications.get(applicationId) ?? null : null;
    },

    async getApplicationByEmail(roleId: string, email: string): Promise<RoleApplication | null> {
      const wanted = email.trim().toLowerCase();
      return (
        [...getStore().applications.values()].find(
          (application) =>
            application.roleId === roleId && application.email.toLowerCase() === wanted,
        ) ?? null
      );
    },

    async refreshApplication(
      applicationId: string,
      patch: {
        name: string;
        collegeId: string | null;
        education: string | null;
        cgpa: number | null;
        answers: Record<string, string>;
        fileName: string;
        text: string;
        objectPath: string | null;
        updatedAt: string;
      },
    ): Promise<RoleApplication | null> {
      const store = getStore();
      const application = store.applications.get(applicationId);
      if (!application) return null;
      const updated: RoleApplication = {
        ...application,
        name: patch.name,
        collegeId: patch.collegeId,
        education: patch.education,
        cgpa: patch.cgpa,
        answers: patch.answers,
        resumeFileName: patch.fileName,
        resumeObjectPath: patch.objectPath,
        hasResumeText: patch.text.trim() !== "",
        resumeUpdatedAt: patch.updatedAt,
        screening: null,
      };
      store.applications.set(applicationId, updated);
      store.resumeTexts.set(applicationId, patch.text);
      return updated;
    },

    async getRoleScreeningSettings(
      roleId: string,
    ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null> {
      const role = roleOf(roleId);
      if (!role) return null;
      return {
        enabled: role.screeningEnabled ?? true,
        weights: sanitizeWeights(role.screeningWeights),
      };
    },

    async updateRoleScreeningSettings(
      roleId: string,
      settings: { enabled: boolean; weights: ScreeningWeights },
    ): Promise<{ enabled: boolean; weights: ScreeningWeights } | null> {
      const store = getStore();
      const role = store.roles.get(roleId);
      if (!role) return null;
      const weights = sanitizeWeights(settings.weights);
      store.roles.set(roleId, {
        ...role,
        screeningEnabled: settings.enabled,
        screeningWeights: weights,
        updatedAt: new Date().toISOString(),
      });
      return { enabled: settings.enabled, weights };
    },

    async getRoleShortlistCutoff(roleId: string): Promise<number> {
      return clampCutoff(getStore().shortlistCutoffs.get(roleId) ?? DEFAULT_SHORTLIST_CUTOFF);
    },

    async setRoleShortlistCutoff(roleId: string, cutoff: number): Promise<number> {
      const value = clampCutoff(cutoff);
      getStore().shortlistCutoffs.set(roleId, value);
      return value;
    },

    async getAutoFilterRule(roleId: string): Promise<AutoFilterRule> {
      return (
        getStore().autoFilterRules.get(roleId) ?? { ...DEFAULT_AUTO_FILTER_RULE }
      );
    },

    async setAutoFilterRule(roleId: string, rule: AutoFilterRule): Promise<AutoFilterRule> {
      const value = sanitizeAutoFilterRule(rule);
      getStore().autoFilterRules.set(roleId, value);
      return value;
    },

    async setApplicationShortlisted(
      roleId: string,
      applicationId: string,
      shortlisted: boolean | null,
    ): Promise<boolean> {
      const store = getStore();
      const application = store.applications.get(applicationId);
      if (!application || application.roleId !== roleId) return false;
      store.applications.set(applicationId, { ...application, shortlisted });
      return true;
    },

    async getApplicationResumeText(
      roleId: string,
      applicationId: string,
    ): Promise<{ fileName: string | null; text: string; inputHash: string | null } | null> {
      const application = getStore().applications.get(applicationId);
      if (!application || application.roleId !== roleId) return null;
      return {
        fileName: application.resumeFileName,
        text: getStore().resumeTexts.get(applicationId) ?? "",
        inputHash: application.screening?.inputHash ?? null,
      };
    },

    async saveApplicationScreening(
      applicationId: string,
      snapshot: ScreeningSnapshot,
    ): Promise<void> {
      const store = getStore();
      const application = store.applications.get(applicationId);
      if (!application) return;
      store.applications.set(applicationId, { ...application, screening: snapshot });
    },

    async listUnscreenedApplications(
      roleId: string,
      limit: number,
    ): Promise<{ id: string; hasText: boolean }[]> {
      return [...getStore().applications.values()]
        .filter((application) => application.roleId === roleId && !application.screening)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, Math.min(Math.max(limit, 1), 200))
        .map((application) => ({ id: application.id, hasText: application.hasResumeText }));
    },

    async getApplicationScreeningScores(
      roleId: string,
    ): Promise<Map<string, { score: number | null; status: string; sections: SectionResult[] }>> {
      const map = new Map<
        string,
        { score: number | null; status: string; sections: SectionResult[] }
      >();
      for (const application of getStore().applications.values()) {
        if (application.roleId !== roleId || !application.screening) continue;
        map.set(application.id, {
          score: application.screening.score,
          status: application.screening.status,
          sections: application.screening.sections,
        });
      }
      return map;
    },

    async replaceApplicationResume(
      applicationId: string,
      resume: {
        fileName: string;
        text: string;
        objectPath: string | null;
        updatedAt: string;
      },
    ): Promise<RoleApplication | null> {
      const store = getStore();
      const application = store.applications.get(applicationId);
      if (!application) return null;
      const updated: RoleApplication = {
        ...application,
        resumeFileName: resume.fileName,
        resumeObjectPath: resume.objectPath,
        hasResumeText: resume.text.trim() !== "",
        resumeUpdatedAt: resume.updatedAt,
        // A new resume makes the old screening stale: clear it so it runs again.
        screening: null,
      };
      store.applications.set(applicationId, updated);
      store.resumeTexts.set(applicationId, resume.text);
      return updated;
    },

    async getInvitedCandidateScreenings(
      roleId: string,
    ): Promise<Map<string, ScreeningSnapshot>> {
      const map = new Map<string, ScreeningSnapshot>();
      for (const [key, snapshot] of getStore().invitedScreenings) {
        const [storedRole, email] = key.split(":");
        if (storedRole === roleId) map.set(email, snapshot);
      }
      return map;
    },

    async saveInvitedCandidateScreening(
      roleId: string,
      email: string,
      snapshot: ScreeningSnapshot,
    ): Promise<void> {
      getStore().invitedScreenings.set(`${roleId}:${email.toLowerCase()}`, snapshot);
    },

    async listUnscreenedInvitedCandidates(
      roleId: string,
      roleTitle: string,
      limit: number,
    ): Promise<{ email: string; hasText: boolean }[]> {
      const store = getStore();
      const screened = await this.getInvitedCandidateScreenings(roleId);
      const withApplication = new Set(
        [...store.applications.values()]
          .filter((application) => application.roleId === roleId)
          .map((application) => application.email.toLowerCase()),
      );
      const seen = new Map<string, boolean>();
      for (const room of getInterviewStore().rooms.values()) {
        if (!matchesRoleAssociation(roleId, roleTitle, room)) continue;
        const email = room.candidateEmail?.trim().toLowerCase();
        if (!email || withApplication.has(email) || screened.has(email)) continue;
        const hasText = typeof room.resume?.text === "string" && room.resume.text.trim() !== "";
        seen.set(email, Boolean(hasText) || seen.get(email) === true);
      }
      return [...seen.entries()]
        .slice(0, Math.min(Math.max(limit, 1), 200))
        .map(([email, hasText]) => ({ email, hasText }));
    },
  };
}

export function getRolesRepository(): RoleRepository {
  if (process.env.DATABASE_URL?.trim()) {
    return getPostgresRolesRepository();
  }
  return getInMemoryRolesRepository();
}