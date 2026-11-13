import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The pause budget: how long a candidate may be away in total, and when the
 * pause currently in force runs out, decided only from the server's log.
 */

const SEC = 1000;
const MIN = 60 * SEC;
const BUDGET = 30 * SEC;

type Event = { type: string; at: string };

function log(entries: Array<[string, number]>): Event[] {
  return entries.map(([type, at]) => ({ type, at: new Date(at).toISOString() }));
}

const started = { roomId: "r", seq: 1, data: {} };

function events(entries: Array<[string, number]>) {
  return log(entries).map((event, index) => ({ ...started, seq: index + 1, ...event }));
}

test("a fresh interview has the whole budget and no pause", async () => {
  const { pauseBudgetFor } = await import("./pause.logic.ts");
  const budget = pauseBudgetFor([], Date.now());
  assert.equal(budget.pause, null);
  assert.equal(budget.usedSeconds, 0);
  assert.equal(budget.remainingSeconds, 30);
});

test("a first pause runs for the whole budget", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(events([["candidate_paused", now - 10 * SEC]]), now);
  assert.ok(pause);
  assert.equal(pause.expired, false);
  assert.equal(pause.deadline, now - 10 * SEC + BUDGET);
});

test("a first pause past the budget has expired", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(events([["candidate_paused", now - 40 * SEC]]), now);
  assert.ok(pause);
  assert.equal(pause.expired, true);
});

test("coming back records the time away", async () => {
  const { pauseBudgetFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const budget = pauseBudgetFor(
    events([
      ["candidate_paused", now - 40 * SEC],
      ["candidate_resumed", now - 30 * SEC],
    ]),
    now,
  );
  assert.equal(budget.pause, null);
  assert.equal(budget.usedSeconds, 10);
  assert.equal(budget.remainingSeconds, 20);
});

test("a second pause only gets what is left of the budget", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 60 * SEC],
      ["candidate_resumed", now - 50 * SEC], // ten seconds spent
      ["candidate_paused", now - 5 * SEC],
    ]),
    now,
  );
  assert.ok(pause);
  assert.equal(pause.expired, false);
  // 20 seconds were left, not a fresh 30.
  assert.equal(pause.deadline, now - 5 * SEC + 20 * SEC);
});

test("a pause with nothing left of the budget is already over", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 60 * SEC],
      ["candidate_resumed", now - 25 * SEC],
      ["candidate_paused", now - 5 * SEC],
    ]),
    now,
  );
  assert.ok(pause);
  assert.equal(pause.expired, true);
});

test("the budget spent while away never counts past what was allowed", async () => {
  const { pauseBudgetFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const budget = pauseBudgetFor(events([["candidate_paused", now - 5 * MIN]]), now);
  assert.equal(budget.usedSeconds, 30);
  assert.equal(budget.remainingSeconds, 0);
});

test("the end of the interview clears the pause", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 40 * SEC],
      ["interview_ended", now - 30 * SEC],
    ]),
    now,
  );
  assert.equal(pause, null);
});
