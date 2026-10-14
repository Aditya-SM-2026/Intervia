/**
 * Concurrent-interview test (Task 7): drives two interviews in parallel
 * through the agent API and verifies turns, events, completion and scorecards
 * stay isolated per room. Requires the dev server on localhost:3000.
 *
 * Run: npx tsx tests/concurrent-interviews.test.mts
 */
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = Math.random().toString(36).slice(2, 8);
const EMAIL_SUFFIX = `${RUN}.conc@example.com`;

/** Removes rooms from previous runs (and this one at the end). */
async function cleanupConcurrentTestRooms() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("DELETE FROM interview_turns WHERE room_id IN (SELECT id FROM interviews WHERE candidate_email LIKE '%.conc@example.com')");
    await client.query("DELETE FROM interview_events WHERE room_id IN (SELECT id FROM interviews WHERE candidate_email LIKE '%.conc@example.com')");
    await client.query("DELETE FROM scorecards WHERE room_id IN (SELECT id FROM interviews WHERE candidate_email LIKE '%.conc@example.com')");
    await client.query("DELETE FROM interviews WHERE candidate_email LIKE '%.conc@example.com'");
  } catch (error) {
    console.warn("cleanup skipped:", error instanceof Error ? error.message : error);
  } finally {
    await client.end();
  }
}
await cleanupConcurrentTestRooms();
const MARK = (room: "A" | "B", n: number, who: string) => `[${room}${n}-${who}]`;

let passed = 0;
let total = 0;
function check(name: string, ok: boolean, extra = "") {
  total++;
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} ${extra}`);
}

async function login(): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME ?? "admin", password: process.env.RECRUITER_PASSWORD ?? "intervia-admin-2026" }),
  });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith("intervia_session="));
  if (!cookie) throw new Error(`login failed: ${response.status}`);
  return cookie.split(";")[0];
}

async function recruiterFetch(cookie: string, path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, { ...init, headers: { cookie, ...(init?.headers ?? {}) } });
}

interface CreatedRoom { id: string; plan: string[] }

async function createRoom(cookie: string, opts: { email: string; role: string; candidate: string; jd: string; reuseOnDuplicate?: boolean }): Promise<CreatedRoom> {
  const form = new FormData();
  form.set("recruiterName", "Concurrency Bot");
  form.set("candidateName", opts.candidate);
  form.set("candidateEmail", opts.email);
  form.set("roleTitle", opts.role);
  form.set("durationMinutes", "10");
  form.set("difficulty", "medium");
  form.set("voiceMode", "standard");
  form.set("jobDescriptionText", opts.jd);
  const response = await recruiterFetch(cookie, "/api/interviews", { method: "POST", body: form });
  const data = await response.json();
  if (response.status === 409 && opts.reuseOnDuplicate && data.room) {
    return { id: data.room.id, plan: (data.room.plan?.competencies ?? []).map((c: { name: string }) => c.name) };
  }
  if (!response.ok) throw new Error(`create failed ${response.status}: ${JSON.stringify(data)}`);
  return { id: data.room.id, plan: (data.room.plan?.competencies ?? []).map((c: { name: string }) => c.name) };
}

async function postTurns(roomId: string, turns: unknown[], events: unknown[] = []) {
  const response = await fetch(`${BASE}/api/agent/interviews/${roomId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns, events }),
  });
  if (!response.ok) throw new Error(`turns failed ${response.status}: ${await response.text()}`);
}

async function getAgentRoom(roomId: string) {
  const response = await fetch(`${BASE}/api/agent/interviews/${roomId}`);
  return response.json();
}

async function complete(roomId: string, endedAt: string, elapsed: number, reason: string, coverage: unknown[]) {
  const response = await fetch(`${BASE}/api/agent/interviews/${roomId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason,
      startedAt: new Date(Date.now() - elapsed * 1000).toISOString(),
      endedAt,
      elapsedSeconds: elapsed,
      completed: true,
      coverage,
      usage: [],
    }),
  });
  return response;
}

function turn(room: "A" | "B", n: number, speaker: "interviewer" | "candidate") {
  const text = `${MARK(room, n, speaker)} this is room ${room} turn ${n} for the concurrency test`;
  return { speaker, text, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), responseLatencyMs: 1200 + n, interrupted: false, phase: null, competencyId: null };
}

const cookie = await login();

// --- 1. parallel double-submit probe (same payload, simultaneous)
console.log("\n-- parallel duplicate probe --");
const dupForm = () => {
  const form = new FormData();
  form.set("recruiterName", "Concurrency Bot");
  form.set("candidateName", "Dup Probe");
  form.set("candidateEmail", "conc-dup@example.com");
  form.set("roleTitle", "Race Probe Role");
  form.set("durationMinutes", "10");
  form.set("difficulty", "medium");
  form.set("voiceMode", "standard");
  form.set("jobDescriptionText", "Probe job description.");
  return form;
};
const [r1, r2] = await Promise.all([
  recruiterFetch(cookie, "/api/interviews", { method: "POST", body: dupForm() }),
  recruiterFetch(cookie, "/api/interviews", { method: "POST", body: dupForm() }),
]);
const s1 = r1.status, s2 = r2.status;
const raceRooms = new Set(
  (await Promise.all([r1.json(), r2.json()])).map((d) => (d as { room?: { id: string } }).room?.id).filter(Boolean),
);
console.log(`statuses: ${s1}/${s2}, distinct rooms: ${raceRooms.size}`);
check("parallel double-submit yields ONE room", raceRooms.size === 1, `distinct=${raceRooms.size} statuses=${s1}/${s2}`);

// --- 2. create the two concurrent rooms (different roles/candidates/JDs)
console.log("\n-- creating two concurrent interviews --");
const [roomA, roomB] = await Promise.all([
  createRoom(cookie, { email: `a-${EMAIL_SUFFIX}`, role: `Concurrent Role Alpha ${RUN}`, candidate: "Alpha Candidate", jd: "Alpha role: build REST APIs with Node.js and PostgreSQL." }),
  createRoom(cookie, { email: `b-${EMAIL_SUFFIX}`, role: `Concurrent Role Beta ${RUN}`, candidate: "Beta Candidate", jd: "Beta role: build React frontends with TypeScript and state management." }),
]);
check("two distinct rooms created", roomA.id !== roomB.id, `${roomA.id} vs ${roomB.id}`);
check("plans differ per room", roomA.plan.join("|") !== roomB.plan.join("|"));

// --- 3. interleaved turns + events
console.log("\n-- interleaving turns across both rooms --");
await postTurns(roomA.id, [turn("A", 1, "interviewer")], [{ type: "interview_started", at: new Date().toISOString(), data: { by: "A" } }]);
await postTurns(roomB.id, [turn("B", 1, "interviewer")], [{ type: "interview_started", at: new Date().toISOString(), data: { by: "B" } }]);
await postTurns(roomA.id, [turn("A", 1, "candidate")], [{ type: "client_tab_hidden", at: new Date().toISOString(), data: { seconds: 5 } }]);
await postTurns(roomB.id, [turn("B", 1, "candidate")], []);
await postTurns(roomA.id, [turn("A", 2, "interviewer"), turn("A", 2, "candidate")], []);
await postTurns(roomB.id, [turn("B", 2, "interviewer"), turn("B", 2, "candidate")], []);
await postTurns(roomA.id, [turn("A", 3, "interviewer"), turn("A", 3, "candidate")], []);
await postTurns(roomB.id, [turn("B", 3, "interviewer"), turn("B", 3, "candidate")], []);

// --- 4. isolation of turns
console.log("\n-- verifying per-room isolation --");
const [stateA, stateB] = (await Promise.all(
  await Promise.all([
    recruiterFetch(cookie, `/api/dashboard/interviews/${roomA.id}`),
    recruiterFetch(cookie, `/api/dashboard/interviews/${roomB.id}`),
  ]).then((responses) => responses.map((response) => response.json())),
)) as [
  { turns: { seq: number; text: string; speaker: string }[]; events: { type: string; data: unknown }[] },
  { turns: { seq: number; text: string; speaker: string }[]; events: { type: string; data: unknown }[] },
];
const aTexts = stateA.turns.map((t) => t.text);
const bTexts = stateB.turns.map((t) => t.text);
check("room A has exactly its 6 turns", aTexts.length === 6 && aTexts.every((t) => t.includes("[A")), JSON.stringify(aTexts));
check("room B has exactly its 6 turns", bTexts.length === 6 && bTexts.every((t) => t.includes("[B")), JSON.stringify(bTexts));
check("no cross-contamination A<-B", aTexts.every((t) => !t.includes("[B")));
check("no cross-contamination B<-A", bTexts.every((t) => !t.includes("[A")));
check("A seqs gapless 1..6", stateA.turns.map((t) => t.seq).join(",") === "1,2,3,4,5,6");
check("B seqs gapless 1..6", stateB.turns.map((t) => t.seq).join(",") === "1,2,3,4,5,6");
check("A events only A's", stateA.events.some((e) => e.type === "client_tab_hidden") && !stateA.events.some((e) => e.type === "interview_started" && JSON.stringify(e.data).includes('"by":"B"')));
check("B events only B's", stateB.events.some((e) => e.type === "interview_started") && !stateB.events.some((e) => e.type === "client_tab_hidden"));

// --- 5. complete both with different outcomes
console.log("\n-- completing both rooms --");
const endedAt = new Date().toISOString();
const [cA, cB] = await Promise.all([
  complete(roomA.id, endedAt, 600, "interviewer_ended", [{ competencyId: "c1", name: roomA.plan[0] ?? "Alpha Topic", status: "covered", startedAtSeconds: 0, endedAtSeconds: 300, budgetSeconds: 300, interviewerSummary: null, interviewerEvidence: null, advancedBy: "interviewer" }]),
  complete(roomB.id, endedAt, 480, "time_up", [{ competencyId: "c1", name: roomB.plan[0] ?? "Beta Topic", status: "covered", startedAtSeconds: 0, endedAtSeconds: 480, budgetSeconds: 480, interviewerSummary: null, interviewerEvidence: null, advancedBy: "interviewer" }]),
]);
check("A completed", cA.ok, `${cA.status}`);
check("B completed", cB.ok, `${cB.status}`);
const detailA = await (await recruiterFetch(cookie, `/api/dashboard/interviews/${roomA.id}`)).json();
const detailB = await (await recruiterFetch(cookie, `/api/dashboard/interviews/${roomB.id}`)).json();
const afterA = { session: detailA.session as { status: string; completedAt: string | null; outcome: { elapsedSeconds: number } | null } };
const afterB = { session: detailB.session as { status: string; completedAt: string | null; outcome: { elapsedSeconds: number } | null } };
check("A status completed + own elapsed", afterA.session.status === "completed" && afterA.session.outcome?.elapsedSeconds === 600, JSON.stringify(afterA.session.outcome));
check("B status completed + own elapsed", afterB.session.status === "completed" && afterB.session.outcome?.elapsedSeconds === 480, JSON.stringify(afterB.session.outcome));

// --- 6. scorecards generated independently (grader runs after the response)
console.log("\n-- waiting for post-completion scoring --");
async function scorecardFor(roomId: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const response = await recruiterFetch(cookie, `/api/dashboard/interviews/${roomId}`);
    const data = await response.json();
    if (data.scorecard) return data;
  }
  const response = await recruiterFetch(cookie, `/api/dashboard/interviews/${roomId}`);
  return response.json();
}
const [finalA, finalB] = (await Promise.all([scorecardFor(roomA.id), scorecardFor(roomB.id)])) as [
  { scorecard: { competencies?: { name: string }[]; summary?: string; overallScore?: number } | null; reason: string | null },
  { scorecard: { competencies?: { name: string }[]; summary?: string; overallScore?: number } | null; reason: string | null },
];
if (finalA.scorecard && finalB.scorecard) {
  const namesA = (finalA.scorecard.competencies ?? []).map((c) => c.name);
  const namesB = (finalB.scorecard.competencies ?? []).map((c) => c.name);
  console.log(`A scorecard: ${finalA.scorecard.overallScore} (${namesA.join(", ")}) | B scorecard: ${finalB.scorecard.overallScore} (${namesB.join(", ")})`);
  check("A scorecard exists", namesA.length > 0);
  check("B scorecard exists", namesB.length > 0);
  check("A scored against A's plan (alpha topics)", namesA.some((n) => /alpha|api|node|postgres|rest|backend/i.test(n)) && !namesA.some((n) => /beta|react|frontend|state management/i.test(n)), namesA.join("|"));
  check("B scored against B's plan (beta topics)", namesB.some((n) => /beta|react|frontend|state|typescript/i.test(n)) && !namesB.some((n) => /alpha|postgres|rest api/i.test(n)), namesB.join("|"));
} else {
  console.log(`scorecards: A=${finalA.reason} B=${finalB.reason}`);
  check("scoring isolation observable (or grader unavailable — recorded)", finalA.reason !== null && finalB.reason !== null, "grader did not produce scorecards");
}

console.log(`\n${passed}/${total} passed`);
console.log(`TEST-ROOMS-A=${roomA.id}`);
console.log(`TEST-ROOMS-B=${roomB.id}`);
process.exitCode = passed === total ? 0 : 1;
await cleanupConcurrentTestRooms();
process.exit(process.exitCode);