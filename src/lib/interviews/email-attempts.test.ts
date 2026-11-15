import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCK_DURATION_MS, emailLockFrom } from "./email-attempts.logic.ts";

const t0 = Date.parse("2026-11-15T10:00:00Z");
const times = (n: number, start = t0) => Array.from({ length: n }, (_, i) => start + i * 1000);

test("four wrong emails still allow another try", () => {
  assert.deepEqual(emailLockFrom(times(4), t0 + 10_000), { allowed: true });
});

test("the fifth wrong email locks the link for 15 minutes", () => {
  const locked = emailLockFrom(times(5), t0 + 10_000);
  assert.equal(locked.allowed, false);
  assert.ok((locked.retryAfterSeconds ?? 0) > 14 * 60);
  assert.deepEqual(emailLockFrom(times(5), t0 + 4000 + LOCK_DURATION_MS), { allowed: true });
});

test("after a lock the count starts again", () => {
  const after = t0 + 4000 + LOCK_DURATION_MS + 1000;
  assert.deepEqual(emailLockFrom([...times(5), ...times(4, after)], after + 10_000), { allowed: true });
  assert.equal(emailLockFrom([...times(5), ...times(5, after)], after + 10_000).allowed, false);
});

test("attempts that raced in during a lock are not counted", () => {
  const during = times(5).concat(times(5, t0 + 60_000));
  const end = t0 + 4000 + LOCK_DURATION_MS;
  assert.deepEqual(emailLockFrom(during, end + 1), { allowed: true });
});

test("old mistakes stop counting after 15 minutes", () => {
  const later = t0 + 20 * 60_000;
  assert.deepEqual(emailLockFrom([...times(4), later], later + 1000), { allowed: true });
});
