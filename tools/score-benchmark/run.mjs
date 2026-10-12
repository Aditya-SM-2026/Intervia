/* eslint-disable */
// Phase 0 benchmark runner: scores the fixture set with candidate models and
// reports agreement with planted ground truth, JSON validity, latency, cost.
//
//   node tools/score-benchmark/run.mjs --backend=mock
//   node tools/score-benchmark/run.mjs --backend=gemini --models=gemini-2.5-flash-lite,gemini-3.1-flash-lite
//   node tools/score-benchmark/run.mjs --backend=openrouter --models=vendor/model:free   (needs OPENROUTER_API_KEY)
//
// Gemini cost rates (USD per 1M tokens) are approximations for comparison;
// OpenRouter reports cost directly in usage.

import { FIXTURES, PLANTED_CHECKS } from "./fixtures.mjs";
import { SYSTEM_PROMPT, buildUserPrompt } from "./rubric.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = ""] = a.replace(/^--/, "").split("=");
  return [k, v];
}));
const backend = args.backend ?? "mock";

const GEMINI_DEFAULT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-3.1-pro-preview",
];
const GEMINI_RATES = {
  // USD per 1M input/output tokens (approximate catalog rates for comparison)
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-3.1-flash-lite": [0.25, 1.5],
  "gemini-3.5-flash-lite": [0.25, 1.5],
  "gemini-3.8-flash": [0.5, 3.0],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-3.1-pro-preview": [2.0, 12.0],
  "gemini-2.5-pro": [1.25, 10.0],
};

const defaultModels = backend === "gemini" ? GEMINI_DEFAULT_MODELS.join(",") : "mock";
const models = (args.models || defaultModels).split(",").map((m) => m.trim()).filter(Boolean);

function parseScores(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function shapeOk(parsed) {
  const s = parsed?.scores;
  if (!s) return false;
  for (const key of ["overall", "jdMatch", "aiRisk", "communication"]) {
    const entry = s[key];
    if (!entry || !Number.isInteger(entry.score) || entry.score < 0 || entry.score > 100) return false;
    if (typeof entry.rationale !== "string" || entry.rationale.length === 0) return false;
    if (!Array.isArray(entry.evidenceTurnSeq)) return false;
  }
  return s.proctoring === null;
}

const seqSet = (fixture) => new Set(fixture.turns.map((t) => t.seq));
const grounded = (fixture, parsed) =>
  ["overall", "jdMatch", "aiRisk", "communication"].every((k) =>
    parsed.scores[k].evidenceTurnSeq.every((seq) => seqSet(fixture).has(seq)));

function scoreEntry(fixture, parsed) {
  const keys = ["overall", "jdMatch", "aiRisk", "communication"];
  const errors = {};
  let inRange = 0;
  for (const k of keys) {
    const [lo, hi] = fixture.gt[k];
    const score = parsed.scores[k].score;
    errors[k] = Math.max(0, lo - score, score - hi);
    if (score >= lo && score <= hi) inRange++;
  }
  return { errors, inRange, total: keys.length };
}

function recordReply(stats, fixture, reply) {
  stats.latencies.push(reply.latencyMs);
  stats.cost += reply.cost;
  const parsed = parseScores(reply.text);
  if (!parsed) { stats.failures.push(`${fixture.id}: JSON parse failed`); return null; }
  stats.validJson++;
  if (!shapeOk(parsed)) { stats.failures.push(`${fixture.id}: shape invalid`); return null; }
  stats.shapeOk++;
  if (grounded(fixture, parsed)) stats.grounded++;
  const scored = scoreEntry(fixture, parsed);
  stats.rangeHits += scored.inRange;
  stats.rangeTotal += scored.total;
  for (const k of Object.keys(scored.errors)) stats.mae[k].push(scored.errors[k]);
  return parsed;
}

const mockReply = (fixture) => JSON.stringify({
  scores: Object.fromEntries(["overall", "jdMatch", "aiRisk", "communication"].map((k) => {
    const [lo, hi] = fixture.gt[k];
    return [k, { score: Math.round((lo + hi) / 2), rationale: "mock", evidenceTurnSeq: [1, 2] }];
  }).concat([["proctoring", null]])),
});

async function callGemini(model, fixture) {
  const started = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(fixture) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 3000 },
      }),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const usage = data.usageMetadata ?? {};
  const rate = GEMINI_RATES[model] ?? [0, 0];
  const cost = ((usage.promptTokenCount ?? 0) * rate[0] + (usage.candidatesTokenCount ?? 0) * rate[1]) / 1e6;
  return { text, latencyMs: Date.now() - started, cost };
}

async function callOpenRouter(model, fixture) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(fixture) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, latencyMs: Date.now() - started, cost: data.usage?.cost ?? 0 };
}

const callMock = async (model, fixture) => ({ text: mockReply(fixture), latencyMs: 5, cost: 0 });
const callFn = backend === "gemini" ? callGemini : backend === "openrouter" ? callOpenRouter : callMock;

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const CONCURRENCY = 4;

const results = {};
for (const model of models) {
  results[model] = { validJson: 0, shapeOk: 0, grounded: 0, rangeHits: 0, rangeTotal: 0, mae: {}, planted: { pass: 0, total: 0, details: [] }, latencies: [], cost: 0, failures: [], plantedExtras: [] };
  for (const key of ["overall", "jdMatch", "aiRisk", "communication"]) results[model].mae[key] = [];
}

let fixtureIndex = 0;
for (const fixture of FIXTURES) {
  fixtureIndex++;
  const pair = PLANTED_CHECKS.find((p) => p.pairWith === fixture.id);
  // score each (fixture, model) pair; difficulty-pair re-calls run with them
  const jobs = models.map((model) => ({ model, fixture, stats: results[model] }));
  await mapPool(jobs, CONCURRENCY, async ({ model, fixture: fx, stats }) => {
    let reply;
    try {
      reply = await callFn(model, fx);
    } catch (cause) {
      stats.failures.push(`${fx.id}: ${cause.message.slice(0, 120)}`);
      return;
    }
    const parsed = recordReply(stats, fx, reply);
    if (!parsed) return;
    stats.plantedExtras.push({ fixture: fx.id, parsed });
    for (const planted of PLANTED_CHECKS) {
      if (planted.pairWith || planted.fixture !== fx.id) continue;
      stats.planted.total++;
      if (planted.check(parsed.scores)) stats.planted.pass++;
      else stats.planted.details.push(fx.id);
    }
  });
  // pair checks: all models scored the hard member this round
  if (pair) {
    for (const model of models) {
      const stats = results[model];
      const hardEntry = stats.plantedExtras.find((e) => e.fixture === fixture.id);
      const partnerFixture = FIXTURES.find((f) => f.id === pair.fixture);
      if (!hardEntry) { stats.planted.total++; stats.planted.details.push(`pair partner unscorable`); continue; }
      stats.planted.total++;
      let partnerParsed = stats.plantedExtras.find((e) => e.fixture === partnerFixture.id)?.parsed;
      let partnerLatency, partnerCost;
      if (!partnerParsed) {
        try {
          const partnerReply = await callFn(model, partnerFixture);
          partnerLatency = partnerReply.latencyMs;
          partnerCost = partnerReply.cost;
          partnerParsed = parseScores(partnerReply.text);
          if (partnerParsed && shapeOk(partnerParsed)) recordReply(stats, partnerFixture, partnerReply);
        } catch { partnerParsed = null; }
      }
      if (partnerParsed && shapeOk(partnerParsed)) {
        if (partnerLatency) stats.latencies.push(partnerLatency);
        if (partnerCost) stats.cost += partnerCost;
        const diff = partnerParsed.scores.overall.score - hardEntry.parsed.scores.overall.score;
        if (diff >= 10) stats.planted.pass++;
        else stats.planted.details.push(`pair ${partnerFixture.id} vs ${fixture.id} diff=${diff}`);
      } else {
        stats.planted.details.push(`pair partner ${partnerFixture.id} unscorable`);
      }
    }
    for (const model of models) results[model].plantedExtras = results[model].plantedExtras.filter((e) => e.fixture !== fixture.id && e.fixture !== pair.fixture);
  }
  for (const model of models) results[model].plantedExtras = results[model].plantedExtras.filter((e) => e.fixture !== fixture.id);
  process.stdout.write(`[${backend}] fixtures ${fixtureIndex}/${FIXTURES.length}\r`);
}
console.log("");

const maeOf = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const p = (arr, q) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

console.log(`\n=== RESULTS (${backend}) — ${FIXTURES.length} fixtures ===`);
for (const model of models) {
  const s = results[model];
  const mean = maeOf([...s.mae.overall, ...s.mae.jdMatch, ...s.mae.aiRisk, ...s.mae.communication]);
  console.log(`\n${model}`);
  console.log(`  shape-valid: ${s.shapeOk}/${FIXTURES.length} | grounded: ${s.grounded}/${FIXTURES.length} | range hits: ${s.rangeHits}/${s.rangeTotal}`);
  console.log(`  MAE overall/jd/ai/comm: ${maeOf(s.mae.overall)?.toFixed(1) ?? "-"} / ${maeOf(s.mae.jdMatch)?.toFixed(1) ?? "-"} / ${maeOf(s.mae.aiRisk)?.toFixed(1) ?? "-"} / ${maeOf(s.mae.communication)?.toFixed(1) ?? "-"} | all-scores MAE: ${mean?.toFixed(1) ?? "-"}`);
  console.log(`  planted checks: ${s.planted.pass}/${s.planted.total}${s.planted.details.length ? ` FAIL: ${s.planted.details.join("; ")}` : ""}`);
  console.log(`  latency p50/p95: ${p(s.latencies, 0.5) ?? "-"}ms / ${p(s.latencies, 0.95) ?? "-"}ms | est cost: $${s.cost.toFixed(4)} | failures: ${s.failures.length}${s.failures.length ? ` (${s.failures[0]})` : ""}`);
}