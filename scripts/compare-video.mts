/**
 * One-off comparison harness: runs the original vision-LLM path and the local
 * (OpenCV + MediaPipe) analyser over the same completed interviews and writes
 * both results to media/ for a side-by-side accuracy/cost comparison.
 *
 * Usage (needs the Cloud SQL proxy on 5434):
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/compare-video.mts <roomId> [...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { analyseCandidateVideo } from "../src/lib/interviews/video-analysis.service";
import type { InterviewEvent, InterviewTurn } from "../src/lib/interviews/interview.types";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();
for (const line of env.split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

const pool = new pg.Pool({ connectionString: url });
const roomIds = process.argv.slice(2);
if (roomIds.length === 0) {
  console.error("give at least one room id");
  process.exit(1);
}

for (const roomId of roomIds) {
  const turnsResult = await pool.query(
    `SELECT room_id, seq, speaker, text, started_at, ended_at, response_latency_ms,
            interrupted, phase, competency_id
     FROM interview_turns WHERE room_id = $1 ORDER BY seq ASC`,
    [roomId],
  );
  const eventsResult = await pool.query(
    "SELECT room_id, seq, type, at, data FROM interview_events WHERE room_id = $1 ORDER BY seq ASC",
    [roomId],
  );
  const turns: InterviewTurn[] = turnsResult.rows.map((row) => ({
    roomId: row.room_id,
    seq: row.seq,
    speaker: row.speaker,
    text: row.text,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    responseLatencyMs: row.response_latency_ms,
    interrupted: row.interrupted,
    phase: row.phase,
    competencyId: row.competency_id,
  }));
  const events: InterviewEvent[] = eventsResult.rows.map((row) => ({
    roomId: row.room_id,
    seq: row.seq,
    type: row.type,
    at: row.at.toISOString(),
    data: row.data ?? {},
  }));

  const providers = (process.env.COMPARE_PROVIDERS === "local" ? ["local"] : ["llm", "local"]) as const;
  for (const provider of providers) {
    process.env.VIDEO_ANALYSIS_PROVIDER = provider;
    const started = Date.now();
    const behaviour = await analyseCandidateVideo(events, turns, {
      hiddenCount: 0,
      hiddenSeconds: 0,
    });
    const seconds = (Date.now() - started) / 1000;
    const out = path.join("media", `compare-${roomId}-${provider}.json`);
    writeFileSync(out, JSON.stringify(behaviour, null, 2));
    console.log(
      `[${roomId}] ${provider}: status=${behaviour.status} score=${behaviour.score} ` +
        `answers=${behaviour.answers.length} moments=${behaviour.moments.length} ` +
        `model=${behaviour.model} in ${seconds.toFixed(0)}s -> ${out}`,
    );
  }
}
await pool.end();