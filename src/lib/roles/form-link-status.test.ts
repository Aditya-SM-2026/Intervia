// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { closedReasonMessage, formLinkStatus, linkExpiresAt } from "./form-link-status.ts";
import type { RoleFormLink } from "./application.types.ts";

const START = Date.parse("2026-11-06T10:00:00.000Z");

function link(overrides: Partial<RoleFormLink> = {}): RoleFormLink {
  return {
    roleId: "role_1",
    token: "token_1",
    fields: [],
    createdAt: new Date(START).toISOString(),
    revokedAt: null,
    maxApplications: null,
    expiresAfterHours: null,
    roundStartedAt: new Date(START).toISOString(),
    ...overrides,
  };
}

test("a link with no limits stays open", () => {
  const status = formLinkStatus(link(), 500, START + 1000);
  assert.equal(status.open, true);
  assert.equal(status.closedReason, null);
  assert.equal(status.expiresAt, null);
});

test("a link closes once the application limit is reached", () => {
  const limited = link({ maxApplications: 100 });
  assert.equal(formLinkStatus(limited, 99, START).open, true);
  assert.equal(formLinkStatus(limited, 99, START).closedReason, null);

  const full = formLinkStatus(limited, 100, START);
  assert.equal(full.open, false);
  assert.equal(full.closedReason, "limit");
  assert.equal(full.maxApplications, 100);
  assert.equal(full.applicationsReceived, 100);
});

test("a link closes when its hours run out, and time never reopens it", () => {
  const timed = link({ expiresAfterHours: 24 });
  const expiresAt = linkExpiresAt(timed);
  assert.equal(expiresAt, "2026-11-07T10:00:00.000Z");

  assert.equal(formLinkStatus(timed, 3, START + 23 * 3_600_000).open, true);
  const after = formLinkStatus(timed, 3, START + 25 * 3_600_000);
  assert.equal(after.open, false);
  assert.equal(after.closedReason, "expired");
  // Days later it is still closed, whatever the count.
  assert.equal(formLinkStatus(timed, 0, START + 30 * 86_400_000).open, false);
});

test("turning a link off wins over its other limits", () => {
  const off = link({ revokedAt: new Date(START).toISOString(), maxApplications: 5 });
  const status = formLinkStatus(off, 0, START);
  assert.equal(status.open, false);
  assert.equal(status.closedReason, "revoked");
});

test("each closed reason explains itself to the applicant", () => {
  assert.match(closedReasonMessage("limit"), /application limit/i);
  assert.match(closedReasonMessage("expired"), /expired/i);
  assert.match(closedReasonMessage("revoked"), /turned off/i);
  assert.match(closedReasonMessage(null), /no longer accepting/i);
});
