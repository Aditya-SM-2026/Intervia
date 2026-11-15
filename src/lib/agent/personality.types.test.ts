import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_CONDUCT, DEFAULT_PERSONA, DEFAULT_STYLES } from "./personality.types.ts";

// Settings shows these as the built-in text, and "Load the built-in text"
// saves them. A stale copy would quietly undo the agent's newer rules.
const prompts = readFileSync(new URL("../../../agent/intervia_agent/prompts.py", import.meta.url), "utf8");

function pythonBlock(name: string): string {
  const match = prompts.match(new RegExp(`^${name} = """([\\s\\S]*?)"""`, "m"));
  assert.ok(match, `${name} not found in prompts.py`);
  return match[1];
}

test("the built-in persona and conduct match the agent's", () => {
  assert.equal(DEFAULT_PERSONA, pythonBlock("PERSONA"));
  assert.equal(DEFAULT_CONDUCT, pythonBlock("CONDUCT"));
});

test("the built-in difficulty styles match the agent's", () => {
  for (const [level, text] of Object.entries(DEFAULT_STYLES)) {
    assert.ok(prompts.includes(`"${level}": "${text}"`), `style ${level} differs from prompts.py`);
  }
});
