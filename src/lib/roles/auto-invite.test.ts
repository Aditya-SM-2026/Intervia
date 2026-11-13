import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearsAutoInviteBar,
  DEFAULT_AUTO_INVITE_SETTINGS,
  sanitizeAutoInviteSettings,
} from "./auto-invite.ts";

test("automatic invitations start off at a Match bar of 70", () => {
  assert.equal(DEFAULT_AUTO_INVITE_SETTINGS.enabled, false);
  assert.equal(DEFAULT_AUTO_INVITE_SETTINGS.threshold, 70);
  assert.equal(DEFAULT_AUTO_INVITE_SETTINGS.durationMinutes, 30);
  assert.equal(DEFAULT_AUTO_INVITE_SETTINGS.difficulty, "medium");
  assert.equal(DEFAULT_AUTO_INVITE_SETTINGS.hrEmail, null);
});

test("stored settings are clamped to values the interview form accepts", () => {
  const saved = sanitizeAutoInviteSettings({
    enabled: true,
    threshold: 150,
    durationMinutes: 500,
    difficulty: "impossible",
    hrEmail: "",
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.threshold, 100);
  assert.equal(saved.durationMinutes, 45);
  assert.equal(saved.difficulty, "medium");
  assert.equal(saved.hrEmail, null);

  const small = sanitizeAutoInviteSettings({ threshold: 0, durationMinutes: 1 });
  assert.equal(small.threshold, 1);
  assert.equal(small.durationMinutes, 2);
});

test("a valid HR copy address is kept and normalised", () => {
  assert.equal(
    sanitizeAutoInviteSettings({ hrEmail: "  HR@Example.COM " }).hrEmail,
    "hr@example.com",
  );
  assert.equal(sanitizeAutoInviteSettings({ hrEmail: "not-an-email" }).hrEmail, null);
});

test("only a scored candidate at or above the bar is invited", () => {
  assert.equal(clearsAutoInviteBar(70, 70), true);
  assert.equal(clearsAutoInviteBar(72.4, 70), true);
  assert.equal(clearsAutoInviteBar(69.4, 70), false);
  assert.equal(clearsAutoInviteBar(null, 70), false);
  assert.equal(clearsAutoInviteBar(undefined, 70), false);
  assert.equal(clearsAutoInviteBar(80, 85), false);
});
