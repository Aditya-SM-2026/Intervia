import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Reconnection window logic: the server decides who may resume and when the
 * interview is expired, purely from the event log.
 */

const MIN = 60_000;

function events(startedAt: number, opts: { disconnectAt?: number; reconnectAt?: number } = {}) {
  const list = [
    { roomId: "r", seq: 1, type: "agent_joined", at: new Date(startedAt).toISOString(), data: {} },
    {
      roomId: "r",
      seq: 2,
      type: "interview_started",
      at: new Date(startedAt).toISOString(),
      data: {},
    },
  ];
  if (opts.disconnectAt !== undefined) {
    list.push({
      roomId: "r",
      seq: 3,
      type: "candidate_disconnected",
      at: new Date(opts.disconnectAt).toISOString(),
      data: {},
    });
  }
  if (opts.reconnectAt !== undefined) {
    list.push({
      roomId: "r",
      seq: 4,
      type: "candidate_reconnected",
      at: new Date(opts.reconnectAt).toISOString(),
      data: {},
    });
  }
  return list;
}

function room(durationMinutes = 10) {
  // Only the fields reconnectStateFor reads matter here.
  return { id: "r", durationMinutes } as unknown as Parameters<
    typeof import("./reconnect.logic").reconnectStateFor
  >[0];
}

test("fresh interview has no reconnect state", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const state = reconnectStateFor(room(), [], Date.now());
  assert.equal(state.kind, "fresh");
});

test("active interview reports remaining time", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const start = Date.now() - 2 * MIN;
  const state = reconnectStateFor(room(), events(start), Date.now());
  assert.equal(state.kind, "active");
  assert.ok(state.kind === "active" && state.remainingSeconds > 7 * 60 - 2 && state.remainingSeconds <= 8 * 60);
});

test("candidate away under 5 minutes may resume", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const start = Date.now() - 3 * MIN;
  const state = reconnectStateFor(
    room(),
    events(start, { disconnectAt: Date.now() - 4 * MIN }),
    Date.now(),
  );
  assert.equal(state.kind, "active");
});

test("candidate away more than 5 minutes is expired", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const start = Date.now() - 8 * MIN;
  const state = reconnectStateFor(
    room(),
    events(start, { disconnectAt: Date.now() - 6 * MIN }),
    Date.now(),
  );
  assert.equal(state.kind, "expired");
  assert.match(state.reason, /5 minutes/);
});

test("a reconnected candidate resets the away clock", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const now = Date.now();
  const state = reconnectStateFor(
    room(),
    events(now - 2 * MIN, {
      disconnectAt: now - 8 * MIN,
      reconnectAt: now - 1 * MIN,
      }),
    now,
  );
  assert.equal(state.kind, "active");
});

test("expired duration still expires even when connected", async () => {
  const { reconnectStateFor } = await import("./reconnect.logic");
  const start = Date.now() - 11 * MIN;
  const state = reconnectStateFor(room(), events(start), Date.now());
  assert.equal(state.kind, "expired");
});
