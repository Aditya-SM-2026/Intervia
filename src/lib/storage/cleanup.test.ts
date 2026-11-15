import assert from "node:assert/strict";
import { test } from "node:test";
import { orphanedObjects, ownerOf, prefixesFor } from "./cleanup.logic.ts";

test("objects are matched to the interview or application they belong to", () => {
  assert.equal(ownerOf("AmcdaXSFumma7b1O5lba1Q/candidate-1.webm"), "AmcdaXSFumma7b1O5lba1Q");
  assert.equal(ownerOf("interviews/AmcdaXSFumma7b1O5lba1Q/mixed.webm"), "AmcdaXSFumma7b1O5lba1Q");
  assert.equal(ownerOf("resumes/app_QSPqlwYkJu5DJRfJ/1-resume.pdf"), "app_QSPqlwYkJu5DJRfJ");
  assert.equal(ownerOf("pipeline-test/x.webm"), null);
  assert.equal(ownerOf("loose-file.pdf"), null);
  assert.deepEqual(prefixesFor("abc"), ["abc/", "interviews/abc/", "resumes/abc/"]);
});

test("only new, settled files of deleted owners are removed", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const notBefore = Date.parse("2026-11-15T00:00:00Z");
  const objects = [
    { name: "deletedRoom12345678901/a.webm", timeCreated: "2026-11-15T10:00:00Z" },
    { name: "keptRoom12345678901234/a.webm", timeCreated: "2026-11-15T10:00:00Z" },
    { name: "oldCopiedRoom123456789/a.webm", timeCreated: "2026-11-01T10:00:00Z" },
    { name: "resumes/app_inFlight12345678/r.pdf", timeCreated: "2026-11-16T11:55:00Z" },
    { name: "notes/readme.txt", timeCreated: "2026-11-15T10:00:00Z" },
  ];
  const result = orphanedObjects(objects, new Set(["keptRoom12345678901234"]), { notBefore, olderThanMs: 6 * 3600_000, now });
  assert.deepEqual(result, ["deletedRoom12345678901/a.webm"]);
});
