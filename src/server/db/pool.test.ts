import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_POOL_MAX, poolMaxFrom } from "./pool.ts";

test("the shared pool is small unless set, and a bad setting falls back", () => {
  assert.equal(poolMaxFrom(undefined), DEFAULT_POOL_MAX);
  assert.equal(DEFAULT_POOL_MAX, 3);
  assert.equal(poolMaxFrom("5"), 5);
  assert.equal(poolMaxFrom("0"), DEFAULT_POOL_MAX);
  assert.equal(poolMaxFrom("many"), DEFAULT_POOL_MAX);
  assert.equal(poolMaxFrom("500"), DEFAULT_POOL_MAX);
});
