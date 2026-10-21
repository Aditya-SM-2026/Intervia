/**
 * Side-by-side on one raw recording file: synthesises the interview events
 * (a single answer window) so analyseCandidateVideo can run both the LLM and
 * local providers on the same video.
 *
 * Usage: NODE_OPTIONS=... npx tsx scripts/compare-file.mts <video-file> [answerEnd=600]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyseCandidateVideo } from "../src/lib/interviews/video-analysis.service";

const file = process.argv[2];
if (!file) { console.error("give a video file"); process.exit(1); }
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}
const answerEnd = Number(process.argv[3] ?? 600);

const roomId = "WS3Ousn822c31pfJs2KolQ";
const recordingId = "candidate-cda7aaf6-af50-467b-ba78-85ef9d83bc37";
const base = Date.parse("2026-10-19T15:00:00Z");
const events = [
  {
    roomId, seq: 1, type: "recording_started",
    at: new Date(base).toISOString(),
    data: { scope: "candidate", storage: "local", mimeType: "video/webm", recordingId },
  },
];
const turns = [
  { roomId, seq: 1, speaker: "interviewer", text: "Tell me about a project you built.", startedAt: new Date(base).toISOString(), endedAt: new Date(base + 10_000).toISOString(), responseLatencyMs: null, interrupted: false, phase: "topic", competencyId: null },
  { roomId, seq: 2, speaker: "candidate", text: "(answer)", startedAt: new Date(base + 12_000).toISOString(), endedAt: new Date(base + answerEnd * 1000).toISOString(), responseLatencyMs: 2000, interrupted: false, phase: "topic", competencyId: null },
];

for (const provider of ["llm", "local"] as const) {
  process.env.VIDEO_ANALYSIS_PROVIDER = provider;
  const started = Date.now();
  const behaviour = await analyseCandidateVideo(events, turns, { hiddenCount: 0, hiddenSeconds: 0 });
  const seconds = (Date.now() - started) / 1000;
  const out = path.join("media", `compare-file-${provider}.json`);
  writeFileSync(out, JSON.stringify(behaviour, null, 2));
  console.log(
    `${provider}: status=${behaviour.status} answers=${behaviour.answers.length} moments=${behaviour.moments.length} attention=${behaviour.attentionPercent} model=${behaviour.model} in ${seconds.toFixed(0)}s -> ${out}`,
  );
}