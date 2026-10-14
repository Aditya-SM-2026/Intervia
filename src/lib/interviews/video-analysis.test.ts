// Run with: npm test  (node --test, no model or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRecording, listRecordings, type RecordingEvent } from "./recording-refs.ts";

function event(type: string, data: Record<string, unknown>): RecordingEvent {
  return { roomId: "room-1", type, at: "2026-10-14T10:00:00.000Z", data };
}

test("listRecordings reads a local recording_started event", () => {
  const refs = listRecordings([
    event("recording_started", { storage: "local", recordingId: "candidate-abc", mimeType: "video/webm" }),
  ]);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].kind, "local");
  assert.equal(refs[0].kind === "local" && refs[0].recording.recordingId, "candidate-abc");
});

test("listRecordings ignores unknown event types", () => {
  const refs = listRecordings([event("recording_finished", { recordingId: "candidate-abc" })]);
  assert.equal(refs.length, 0);
});

test("listRecordings reads a recording_uploaded event as a GCS object", () => {
  const events = [
    event("recording_started", { storage: "local", recordingId: "candidate-abc", mimeType: "video/webm" }),
    event("recording_finished", { recordingId: "candidate-abc", bytes: 100 }),
    event("recording_uploaded", {
      storage: "gcs",
      bucket: "recordings-bucket",
      path: "room-1/candidate-abc.play.webm",
      recordingId: "candidate-abc",
    }),
  ];
  const refs = listRecordings(events);
  const gcs = refs.filter((ref) => ref.kind === "gcs");
  assert.equal(gcs.length, 1);
  assert.deepEqual(gcs[0].object, { bucket: "recordings-bucket", path: "room-1/candidate-abc.play.webm" });
  assert.ok(hasRecording(events));
});

test("listRecordings reads a LiveKit-egress style GCS recording_started", () => {
  const refs = listRecordings([
    event("recording_started", { storage: "gcs", bucket: "b", path: "p/x.mp4", mimeType: "video/mp4" }),
  ]);
  assert.equal(refs.length, 1);
  const ref = refs[0];
  assert.equal(ref.kind, "gcs");
  if (ref.kind === "gcs") assert.deepEqual(ref.object, { bucket: "b", path: "p/x.mp4" });
});