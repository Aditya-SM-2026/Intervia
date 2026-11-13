import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The pause window: how long a candidate who left the full screen has to
 * come back, decided only from the server's event log.
 */

const MIN = 60_000;

type Event = { type: string; at: string };

function log(entries: Array<[string, number]>): Event[] {
  return entries.map(([type, at]) => ({ type, at: new Date(at).toISOString() }));
}

const started = { roomId: "r", seq: 1, data: {} };

function events(entries: Array<[string, number]>) {
  return log(entries).map((event, index) => ({ ...started, seq: index + 1, ...event }));
}

test("a fresh interview has no pause", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  assert.equal(pauseStateFor([], Date.now()), null);
});

test("a pause under two minutes is still open", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(events([["candidate_paused", now - MIN]]), now);
  assert.ok(pause);
  assert.equal(pause.expired, false);
  assert.equal(pause.deadline, now - MIN + 2 * MIN);
});

test("a pause over two minutes has expired", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(events([["candidate_paused", now - 3 * MIN]]), now);
  assert.ok(pause);
  assert.equal(pause.expired, true);
});

test("resuming closes the pause", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 4 * MIN],
      ["candidate_resumed", now - 3 * MIN],
    ]),
    now,
  );
  assert.equal(pause, null);
});

test("a second pause uses the newer window", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 10 * MIN],
      ["candidate_resumed", now - 9 * MIN],
      ["candidate_paused", now - 30_000],
    ]),
    now,
  );
  assert.ok(pause);
  assert.equal(pause.expired, false);
});

test("the end of the interview clears the pause", async () => {
  const { pauseStateFor } = await import("./pause.logic.ts");
  const now = Date.now();
  const pause = pauseStateFor(
    events([
      ["candidate_paused", now - 3 * MIN],
      ["interview_ended", now - 2 * MIN],
    ]),
    now,
  );
  assert.equal(pause, null);
});
