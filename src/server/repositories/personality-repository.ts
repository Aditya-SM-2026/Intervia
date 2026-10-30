import "server-only";
import { Pool } from "pg";
import type { AgentPersonality } from "@/lib/agent/personality.types";

/**
 * One row of settings for the whole account: the interviewer's personality.
 * It is deliberately not per-role — a recruiter sets the agent's manner once,
 * and every interview from then on uses it until they change it again.
 *
 * Postgres in production, an in-process value locally so development needs no
 * database. The schema is created idempotently on first use, like the rest of
 * the storage layer.
 */

const ROW_ID = "default";

interface GlobalWithPool {
  __agentSettingsPool?: Pool;
  __agentSettingsBootstrap?: Promise<void>;
}

const globalRefs = globalThis as unknown as GlobalWithPool;

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS agent_settings (
  id TEXT PRIMARY KEY,
  persona TEXT NOT NULL DEFAULT '',
  conduct TEXT NOT NULL DEFAULT '',
  styles JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice TEXT NOT NULL DEFAULT '',
  voice_mode TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS voice TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS voice_mode TEXT NOT NULL DEFAULT '';
`;

let memoryRow: AgentPersonality = {
  persona: "",
  conduct: "",
  styles: {},
  voice: "",
  voiceMode: "",
  updatedAt: null,
};

function postgresEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function getPool(): Pool {
  if (!globalRefs.__agentSettingsPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set; cannot use the Postgres repository");
    }
    globalRefs.__agentSettingsPool = new Pool({ connectionString, max: 2 });
  }
  return globalRefs.__agentSettingsPool;
}

async function ensureSchema(): Promise<void> {
  if (!globalRefs.__agentSettingsBootstrap) {
    globalRefs.__agentSettingsBootstrap = getPool()
      .query(BOOTSTRAP_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalRefs.__agentSettingsBootstrap = undefined;
        throw error;
      });
  }
  await globalRefs.__agentSettingsBootstrap;
}

interface SettingsRow {
  persona: string;
  conduct: string;
  styles: Record<string, string> | null;
  voice: string | null;
  voice_mode: string | null;
  updated_at: Date;
}

export async function readAgentPersonality(): Promise<AgentPersonality> {
  if (!postgresEnabled()) return { ...memoryRow };

  await ensureSchema();
  const result = await getPool().query<SettingsRow>(
    "SELECT persona, conduct, styles, voice, voice_mode, updated_at FROM agent_settings WHERE id = $1",
    [ROW_ID],
  );
  const row = result.rows[0];
  if (!row) {
    return { persona: "", conduct: "", styles: {}, voice: "", voiceMode: "", updatedAt: null };
  }
  return {
    persona: row.persona ?? "",
    conduct: row.conduct ?? "",
    styles: row.styles ?? {},
    voice: row.voice ?? "",
    voiceMode: row.voice_mode === "rolling" ? "rolling" : row.voice_mode === "standard" ? "standard" : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function writePersonality(input: {
  persona: string;
  conduct: string;
  styles: Record<string, string>;
  voice: string;
  voiceMode: AgentPersonality["voiceMode"];
}): Promise<AgentPersonality> {
  const updatedAt = new Date().toISOString();

  if (!postgresEnabled()) {
    memoryRow = {
      persona: input.persona,
      conduct: input.conduct,
      styles: input.styles,
      voice: input.voice,
      voiceMode: input.voiceMode,
      updatedAt,
    };
    return memoryRow;
  }

  await ensureSchema();
  await getPool().query(
    `INSERT INTO agent_settings (id, persona, conduct, styles, voice, voice_mode, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       persona = EXCLUDED.persona,
       conduct = EXCLUDED.conduct,
       styles = EXCLUDED.styles,
       voice = EXCLUDED.voice,
       voice_mode = EXCLUDED.voice_mode,
       updated_at = EXCLUDED.updated_at`,
    [ROW_ID, input.persona, input.conduct, JSON.stringify(input.styles), input.voice, input.voiceMode],
  );
  return { ...input, updatedAt };
}
