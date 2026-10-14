// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoleSchema, updateRoleSchema } from "./role.validation.ts";

const validRole = {
  title: "Senior Backend Engineer",
  description: "Own our payment services end to end, mentor two juniors.",
  skills: ["Go", "PostgreSQL"],
  deadline: "2026-11-30",
};

test("createRoleSchema accepts a valid role", () => {
  const parsed = createRoleSchema.parse(validRole);
  assert.equal(parsed.title, "Senior Backend Engineer");
  assert.deepEqual(parsed.skills, ["Go", "PostgreSQL"]);
  assert.equal(parsed.deadline, "2026-11-30");
});

test("createRoleSchema defaults skills and deadline", () => {
  const parsed = createRoleSchema.parse({
    title: "Designer",
    description: "Design our candidate-facing surfaces with care.",
  });
  assert.deepEqual(parsed.skills, []);
  assert.equal(parsed.deadline, null);
});

test("createRoleSchema trims the title and rejects short ones", () => {
  assert.equal(createRoleSchema.parse({ ...validRole, title: "  CEO  " }).title, "CEO");
  assert.throws(() => createRoleSchema.parse({ ...validRole, title: "A" }));
  assert.throws(() => createRoleSchema.parse({ ...validRole, title: "" }));
});

test("createRoleSchema rejects a too-short description", () => {
  assert.throws(() => createRoleSchema.parse({ ...validRole, description: "short" }));
});

test("createRoleSchema rejects malformed or impossible deadlines", () => {
  assert.throws(() => createRoleSchema.parse({ ...validRole, deadline: "13/10/2026" }));
  assert.throws(() => createRoleSchema.parse({ ...validRole, deadline: "2026-02-30" }));
  assert.throws(() => createRoleSchema.parse({ ...validRole, deadline: "2026-13-01" }));
  assert.equal(createRoleSchema.parse({ ...validRole, deadline: null }).deadline, null);
});

test("createRoleSchema rejects blank skill entries and oversized lists", () => {
  assert.throws(() => createRoleSchema.parse({ ...validRole, skills: ["Go", "   "] }));
  assert.throws(() =>
    createRoleSchema.parse({ ...validRole, skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }),
  );
});

test("updateRoleSchema accepts partial updates including status", () => {
  const parsed = updateRoleSchema.parse({ status: "completed" });
  assert.deepEqual(parsed, { status: "completed" });
  assert.equal(updateRoleSchema.parse({ title: "New title" }).title, "New title");
  assert.equal(updateRoleSchema.parse({ deadline: null }).deadline, null);
});

test("updateRoleSchema rejects empty updates and invalid statuses", () => {
  assert.throws(() => updateRoleSchema.parse({}));
  assert.throws(() => updateRoleSchema.parse({ status: "archived" }));
  assert.throws(() => updateRoleSchema.parse({ deadline: "tomorrow" }));
});