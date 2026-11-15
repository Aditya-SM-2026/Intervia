// Run with: npm test  (node --test, no model or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRecording, listRecordings, storedRecordingForAnalysis, type RecordingEvent } from "./recording-refs.ts";

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

test("the uploaded GCS copy keeps the recording's real start time", () => {
  // The upload is logged minutes after the interview began. Answer windows are
  // measured from the recording's start, so the uploaded ref must keep it.
  const started = { ...event("recording_started", { storage: "local", recordingId: "candidate-abc" }), at: "2026-10-14T10:00:00.000Z" };
  const uploaded = {
    ...event("recording_uploaded", {
      storage: "gcs",
      bucket: "recordings-bucket",
      path: "room-1/candidate-abc.play.webm",
      recordingId: "candidate-abc",
    }),
    at: "2026-10-14T10:05:00.000Z",
  };
  const gcs = listRecordings([started, uploaded]).filter((ref) => ref.kind === "gcs");
  assert.equal(gcs.length, 1);
  assert.equal(gcs[0].startedAt, "2026-10-14T10:00:00.000Z");
});
test("video analysis reads the candidate's own recording, not the mixed copy", () => {
  const events = [
    event("recording_started", { storage: "local", recordingId: "candidate-abc", mimeType: "video/webm" }),
    event("recording_uploaded", { storage: "gcs", bucket: "b", path: "room-1/candidate-abc.play.webm", recordingId: "candidate-abc", mimeType: "video/webm" }),
    event("recording_mixed", { storage: "gcs", bucket: "b", path: "interviews/room-1/mixed-room-1.webm", recordingId: "candidate-abc", mimeType: "video/webm" }),
  ];
  assert.equal(storedRecordingForAnalysis(events)?.object.path, "room-1/candidate-abc.play.webm");
});

test("video analysis falls back to the mixed copy when it is the only one stored", () => {
  const events = [
    event("recording_mixed", { storage: "gcs", bucket: "b", path: "interviews/room-1/mixed-room-1.webm", mimeType: "video/webm" }),
  ];
  assert.equal(storedRecordingForAnalysis(events)?.object.path, "interviews/room-1/mixed-room-1.webm");
});

test("after a rejoin, video analysis reads the long recording, not a short last one", () => {
  const events = [
    event("recording_started", { storage: "local", recordingId: "candidate-long", mimeType: "video/webm" }),
    event("recording_finished", { recordingId: "candidate-long", bytes: 59_513_780 }),
    event("recording_uploaded", { storage: "gcs", bucket: "b", path: "room-1/candidate-long.play.webm", recordingId: "candidate-long", mimeType: "video/webm" }),
    event("recording_started", { storage: "local", recordingId: "candidate-short", mimeType: "video/webm" }),
    event("recording_finished", { recordingId: "candidate-short", bytes: 2_091_856 }),
    event("recording_uploaded", { storage: "gcs", bucket: "b", path: "room-1/candidate-short.play.webm", recordingId: "candidate-short", mimeType: "video/webm" }),
  ];
  assert.equal(storedRecordingForAnalysis(events)?.object.path, "room-1/candidate-long.play.webm");
});
