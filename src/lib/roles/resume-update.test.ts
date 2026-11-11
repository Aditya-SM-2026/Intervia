import assert from "node:assert/strict";
import test from "node:test";
import {
  RESUME_UPDATE_WINDOW_MS,
  isResumeUpdateOpen,
  isResumeUpdateToken,
  resumeUpdateExpiresAt,
  samePhone,
} from "./resume-update.ts";

const DAY = 24 * 60 * 60_000;

test("resume update tokens must look like a URL-safe random token", () => {
  assert.equal(isResumeUpdateToken("a".repeat(24)), true);
  assert.equal(isResumeUpdateToken("Ab_9-" + "x".repeat(19)), true);
  assert.equal(isResumeUpdateToken("short"), false);
  assert.equal(isResumeUpdateToken("has spaces in the token"), false);
  assert.equal(isResumeUpdateToken("../../etc/passwd"), false);
});

test("a fresh application keeps its replace link open for a week", () => {
  const created = new Date("2026-11-01T10:00:00.000Z").toISOString();
  const application = { createdAt: created, resumeUpdatedAt: null };

  assert.equal(
    resumeUpdateExpiresAt(application),
    new Date(Date.parse(created) + RESUME_UPDATE_WINDOW_MS).toISOString(),
  );
  assert.equal(isResumeUpdateOpen(application, Date.parse("2026-11-07T10:00:00.000Z")), true);
});

test("the link closes once the window has passed", () => {
  const application = {
    createdAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
    resumeUpdatedAt: null,
  };

  assert.equal(isResumeUpdateOpen(application, Date.parse("2026-11-08T10:00:01.000Z")), false);
});

test("replacing the resume restarts the window", () => {
  const application = {
    createdAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
    resumeUpdatedAt: new Date("2026-11-05T10:00:00.000Z").toISOString(),
  };

  assert.equal(isResumeUpdateOpen(application, Date.parse("2026-11-10T10:00:00.000Z")), true);
  assert.equal(
    resumeUpdateExpiresAt(application),
    new Date("2026-11-12T10:00:00.000Z").toISOString(),
  );
});

test("an unreadable timestamp never leaves the link open", () => {
  const application = { createdAt: "not a date", resumeUpdatedAt: null };

  assert.equal(isResumeUpdateOpen(application, 0), false);
  assert.equal(isResumeUpdateOpen(application, Date.now()), false);
});

test("the window is exactly seven days", () => {
  assert.equal(RESUME_UPDATE_WINDOW_MS, 7 * DAY);
});

test("the same phone number matches with or without spaces and country code", () => {
  assert.equal(samePhone("9876543210", "9876543210"), true);
  assert.equal(samePhone("+91 98765 43210", "9876543210"), true);
  assert.equal(samePhone("0091-98765-43210", "98765 43210"), true);
  assert.equal(samePhone("(987) 654-3210", "+919876543210"), true);
});

test("different phone numbers never match", () => {
  assert.equal(samePhone("9876543210", "9876543211"), false);
  assert.equal(samePhone("9876543210", "1234567890"), false);
});

test("an empty phone never matches, so a missing field cannot claim an application", () => {
  assert.equal(samePhone("", "9876543210"), false);
  assert.equal(samePhone("9876543210", "   "), false);
  assert.equal(samePhone("+", "-"), false);
});

test("short numbers must match exactly", () => {
  assert.equal(samePhone("12345", "12345"), true);
  assert.equal(samePhone("12345", "1234"), false);
});
