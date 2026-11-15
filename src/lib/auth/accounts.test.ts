import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOGIN_FAILURE_WINDOW_MS,
  MAX_LOGIN_FAILURES,
  afterFailure,
  clientAddress,
  isAdmin,
  lockStatus,
  passwordProblem,
  validateNewMember,
  type LoginAttemptState,
} from "./accounts.logic.ts";

test("only the owner manages the team", () => {
  assert.equal(isAdmin({ id: "owner", name: "Admin", email: null, role: "owner", sessionId: "s" }), true);
  assert.equal(isAdmin({ id: "u1", name: "Priya", email: "p@x.com", role: "member", sessionId: "s" }), false);
  assert.equal(isAdmin(null), false);
});

test("a new member needs a name, a real email and a long enough password", () => {
  const bad = validateNewMember({ name: " ", email: "nope", password: "short" }, "admin");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "name", "password"]);
  const good = validateNewMember({ name: "  Priya   Sharma ", email: " Priya@Example.COM ", password: "a-long-password" }, "admin");
  assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.value, { name: "Priya Sharma", email: "priya@example.com", password: "a-long-password" });
  const owner = validateNewMember({ name: "X Y", email: "admin@x.com", password: "a-long-password" }, "admin@x.com");
  assert.equal(owner.ok, false);
});

test("password rules", () => {
  assert.match(passwordProblem("123456789") ?? "", /at least 10/);
  assert.equal(passwordProblem("0123456789"), null);
  assert.match(passwordProblem(" 0123456789") ?? "", /spaces/);
  assert.match(passwordProblem(undefined) ?? "", /at least/);
});

test("the caller's address is the last forwarded entry, which a client cannot choose", () => {
  assert.equal(clientAddress("203.0.113.7, 34.1.2.3"), "34.1.2.3");
  assert.equal(clientAddress("34.1.2.3"), "34.1.2.3");
  assert.equal(clientAddress(null), "unknown");
});

test("eight wrong passwords lock the login for 15 minutes, then it starts again", () => {
  let state: LoginAttemptState | null = null;
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_LOGIN_FAILURES - 1; i += 1) state = afterFailure(state, t0 + i);
  assert.equal(lockStatus(state, t0 + 10).locked, false);
  state = afterFailure(state, t0 + 10);
  assert.equal(lockStatus(state, t0 + 11).locked, true);
  assert.equal(lockStatus(state, t0 + 10 + 15 * 60 * 1000 + 1).locked, false);
  const after = afterFailure(state, t0 + 10 + 15 * 60 * 1000 + 1);
  assert.equal(after.failures, 1);
});

test("old mistakes stop counting", () => {
  let state: LoginAttemptState | null = null;
  for (let i = 0; i < MAX_LOGIN_FAILURES - 1; i += 1) state = afterFailure(state, 1000 + i);
  state = afterFailure(state, 1000 + LOGIN_FAILURE_WINDOW_MS + 5000);
  assert.equal(state.failures, 1);
  assert.equal(lockStatus(state, 1000 + LOGIN_FAILURE_WINDOW_MS + 5001).locked, false);
});
