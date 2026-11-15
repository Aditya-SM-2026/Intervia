import "server-only";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { sharedPool } from "@/server/db/pool";
import type { LoginAttemptState } from "@/lib/auth/accounts.logic";

/**
 * Team members, their sessions, sign-in attempts and the activity log.
 * Postgres when DATABASE_URL is set, memory otherwise (local development).
 */

export interface MemberRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  lastSignInAt: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ActivityEntry {
  id: number;
  at: string;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export type NewActivity = Omit<ActivityEntry, "id" | "at">;

export interface ActivityFilter {
  actorId?: string;
  group?: string;
  before?: number;
  limit?: number;
}

export interface AccountsRepository {
  listMembers(): Promise<MemberRecord[]>;
  getMember(id: string): Promise<MemberRecord | null>;
  getMemberByEmail(email: string): Promise<MemberRecord | null>;
  /** Null when the email is already taken. */
  createMember(input: { name: string; email: string; passwordHash: string; createdBy: string }): Promise<MemberRecord | null>;
  updateMember(id: string, patch: { name?: string; active?: boolean; passwordHash?: string }): Promise<MemberRecord | null>;
  markSignedIn(id: string): Promise<void>;

  createSession(userId: string, expiresAt: Date): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  /** Ends every session of one person (account turned off, password reset). */
  revokeSessionsFor(userId: string, exceptSessionId?: string): Promise<number>;

  getLoginAttempt(key: string): Promise<LoginAttemptState | null>;
  saveLoginAttempt(key: string, state: LoginAttemptState): Promise<void>;
  clearLoginAttempt(key: string): Promise<void>;

  addActivity(entry: NewActivity): Promise<void>;
  listActivity(filter: ActivityFilter): Promise<ActivityEntry[]>;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

// --- Postgres ----------------------------------------------------------------

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  last_sign_in_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_idx ON app_users (lower(email));
CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INT NOT NULL,
  first_failure_at TIMESTAMPTZ NOT NULL,
  locked_until TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  details JSONB,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS activity_log_at_idx ON activity_log (id DESC);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx ON activity_log (actor_id, id DESC);
`;

const globalRefs = globalThis as unknown as {
  __accountsPool?: Pool;
  __accountsBootstrap?: Promise<void>;
  __accountsMemory?: MemoryStore;
};

function pool(): Pool {
  if (!globalRefs.__accountsPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalRefs.__accountsPool = sharedPool(connectionString);
  }
  return globalRefs.__accountsPool;
}

async function ensureSchema(): Promise<void> {
  if (!globalRefs.__accountsBootstrap) {
    globalRefs.__accountsBootstrap = pool()
      .query(BOOTSTRAP_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalRefs.__accountsBootstrap = undefined;
        throw error;
      });
  }
  await globalRefs.__accountsBootstrap;
}

type Row = Record<string, unknown>;
const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : value ? String(value) : null);

function toMember(row: Row): MemberRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    active: row.active === true,
    createdAt: iso(row.created_at) ?? "",
    createdBy: (row.created_by as string | null) ?? null,
    lastSignInAt: iso(row.last_sign_in_at),
  };
}

function toSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    expiresAt: iso(row.expires_at) ?? "",
    revokedAt: iso(row.revoked_at),
  };
}

function toActivity(row: Row): ActivityEntry {
  return {
    id: Number(row.id),
    at: iso(row.at) ?? "",
    actorId: String(row.actor_id),
    actorName: String(row.actor_name),
    actorEmail: (row.actor_email as string | null) ?? null,
    action: String(row.action),
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    summary: String(row.summary),
    details: (row.details as Record<string, unknown> | null) ?? null,
    ip: (row.ip as string | null) ?? null,
  };
}

const MEMBER_COLUMNS = "id, name, email, password_hash, active, created_at, created_by, last_sign_in_at";

const postgres: AccountsRepository = {
  async listMembers() {
    await ensureSchema();
    const result = await pool().query(`SELECT ${MEMBER_COLUMNS} FROM app_users ORDER BY active DESC, lower(name)`);
    return result.rows.map(toMember);
  },
  async getMember(id) {
    await ensureSchema();
    const result = await pool().query(`SELECT ${MEMBER_COLUMNS} FROM app_users WHERE id = $1`, [id]);
    return result.rows[0] ? toMember(result.rows[0]) : null;
  },
  async getMemberByEmail(email) {
    await ensureSchema();
    const result = await pool().query(`SELECT ${MEMBER_COLUMNS} FROM app_users WHERE lower(email) = lower($1)`, [email]);
    return result.rows[0] ? toMember(result.rows[0]) : null;
  },
  async createMember(input) {
    await ensureSchema();
    try {
      const result = await pool().query(
        `INSERT INTO app_users (id, name, email, password_hash, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${MEMBER_COLUMNS}`,
        [newId("usr"), input.name, input.email, input.passwordHash, input.createdBy],
      );
      return toMember(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return null;
      throw error;
    }
  },
  async updateMember(id, patch) {
    await ensureSchema();
    const sets: string[] = [];
    const values: unknown[] = [id];
    if (patch.name !== undefined) { values.push(patch.name); sets.push(`name = $${values.length}`); }
    if (patch.active !== undefined) { values.push(patch.active); sets.push(`active = $${values.length}`); }
    if (patch.passwordHash !== undefined) { values.push(patch.passwordHash); sets.push(`password_hash = $${values.length}`); }
    if (sets.length === 0) return this.getMember(id);
    const result = await pool().query(`UPDATE app_users SET ${sets.join(", ")} WHERE id = $1 RETURNING ${MEMBER_COLUMNS}`, values);
    return result.rows[0] ? toMember(result.rows[0]) : null;
  },
  async markSignedIn(id) {
    await ensureSchema();
    await pool().query("UPDATE app_users SET last_sign_in_at = now() WHERE id = $1", [id]);
  },
  async createSession(userId, expiresAt) {
    await ensureSchema();
    const id = randomBytes(24).toString("base64url");
    const result = await pool().query(
      "INSERT INTO app_sessions (id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING id, user_id, expires_at, revoked_at",
      [id, userId, expiresAt],
    );
    return toSession(result.rows[0]);
  },
  async getSession(id) {
    await ensureSchema();
    const result = await pool().query("SELECT id, user_id, expires_at, revoked_at FROM app_sessions WHERE id = $1", [id]);
    return result.rows[0] ? toSession(result.rows[0]) : null;
  },
  async revokeSession(id) {
    await ensureSchema();
    await pool().query("UPDATE app_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  },
  async revokeSessionsFor(userId, exceptSessionId) {
    await ensureSchema();
    const result = await pool().query(
      "UPDATE app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2",
      [userId, exceptSessionId ?? ""],
    );
    return result.rowCount ?? 0;
  },
  async getLoginAttempt(key) {
    await ensureSchema();
    const result = await pool().query("SELECT failures, first_failure_at, locked_until FROM login_attempts WHERE key = $1", [key]);
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    return {
      failures: Number(row.failures),
      firstFailureAt: Date.parse(iso(row.first_failure_at) ?? "") || 0,
      lockedUntil: row.locked_until ? Date.parse(iso(row.locked_until) ?? "") : 0,
    };
  },
  async saveLoginAttempt(key, state) {
    await ensureSchema();
    await pool().query(
      `INSERT INTO login_attempts (key, failures, first_failure_at, locked_until) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET failures = EXCLUDED.failures, first_failure_at = EXCLUDED.first_failure_at, locked_until = EXCLUDED.locked_until`,
      [key, state.failures, new Date(state.firstFailureAt), state.lockedUntil ? new Date(state.lockedUntil) : null],
    );
  },
  async clearLoginAttempt(key) {
    await ensureSchema();
    await pool().query("DELETE FROM login_attempts WHERE key = $1", [key]);
  },
  async addActivity(entry) {
    await ensureSchema();
    await pool().query(
      `INSERT INTO activity_log (actor_id, actor_name, actor_email, action, target_type, target_id, summary, details, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [entry.actorId, entry.actorName, entry.actorEmail, entry.action, entry.targetType, entry.targetId,
        entry.summary.slice(0, 500), entry.details ? JSON.stringify(entry.details) : null, entry.ip],
    );
  },
  async listActivity(filter) {
    await ensureSchema();
    const where: string[] = [];
    const values: unknown[] = [];
    if (filter.actorId) { values.push(filter.actorId); where.push(`actor_id = $${values.length}`); }
    if (filter.group) { values.push(`${filter.group}.%`); where.push(`action LIKE $${values.length}`); }
    if (filter.before) { values.push(filter.before); where.push(`id < $${values.length}`); }
    values.push(Math.min(Math.max(filter.limit ?? 50, 1), 200));
    const result = await pool().query(
      `SELECT id, at, actor_id, actor_name, actor_email, action, target_type, target_id, summary, details, ip
       FROM activity_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY id DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(toActivity);
  },
};

// --- Memory (local development) ----------------------------------------------

interface MemoryStore {
  members: Map<string, MemberRecord>;
  sessions: Map<string, SessionRecord>;
  attempts: Map<string, LoginAttemptState>;
  activity: ActivityEntry[];
}

function memoryStore(): MemoryStore {
  globalRefs.__accountsMemory ??= { members: new Map(), sessions: new Map(), attempts: new Map(), activity: [] };
  return globalRefs.__accountsMemory;
}

const memory: AccountsRepository = {
  async listMembers() {
    return [...memoryStore().members.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  },
  async getMember(id) {
    return memoryStore().members.get(id) ?? null;
  },
  async getMemberByEmail(email) {
    return [...memoryStore().members.values()].find((m) => m.email.toLowerCase() === email.toLowerCase()) ?? null;
  },
  async createMember(input) {
    if (await this.getMemberByEmail(input.email)) return null;
    const member: MemberRecord = { id: newId("usr"), name: input.name, email: input.email, passwordHash: input.passwordHash,
      active: true, createdAt: new Date().toISOString(), createdBy: input.createdBy, lastSignInAt: null };
    memoryStore().members.set(member.id, member);
    return member;
  },
  async updateMember(id, patch) {
    const member = memoryStore().members.get(id);
    if (!member) return null;
    Object.assign(member, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return member;
  },
  async markSignedIn(id) {
    const member = memoryStore().members.get(id);
    if (member) member.lastSignInAt = new Date().toISOString();
  },
  async createSession(userId, expiresAt) {
    const session = { id: randomBytes(24).toString("base64url"), userId, expiresAt: expiresAt.toISOString(), revokedAt: null };
    memoryStore().sessions.set(session.id, session);
    return session;
  },
  async getSession(id) {
    return memoryStore().sessions.get(id) ?? null;
  },
  async revokeSession(id) {
    const session = memoryStore().sessions.get(id);
    if (session && !session.revokedAt) session.revokedAt = new Date().toISOString();
  },
  async revokeSessionsFor(userId, exceptSessionId) {
    let count = 0;
    for (const session of memoryStore().sessions.values()) {
      if (session.userId === userId && !session.revokedAt && session.id !== exceptSessionId) {
        session.revokedAt = new Date().toISOString();
        count += 1;
      }
    }
    return count;
  },
  async getLoginAttempt(key) {
    return memoryStore().attempts.get(key) ?? null;
  },
  async saveLoginAttempt(key, state) {
    memoryStore().attempts.set(key, state);
  },
  async clearLoginAttempt(key) {
    memoryStore().attempts.delete(key);
  },
  async addActivity(entry) {
    const store = memoryStore();
    store.activity.push({ ...entry, id: store.activity.length + 1, at: new Date().toISOString() });
  },
  async listActivity(filter) {
    return [...memoryStore().activity]
      .reverse()
      .filter((e) => (!filter.actorId || e.actorId === filter.actorId) && (!filter.group || e.action.startsWith(`${filter.group}.`)) && (!filter.before || e.id < filter.before))
      .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 200));
  },
};

export function getAccountsRepository(): AccountsRepository {
  return process.env.DATABASE_URL?.trim() ? postgres : memory;
}
