# Interview Audio: Recording Both Sides

> Scope: the recording shown in the report only has the candidate's voice.
> This note explains why, the options for adding the interviewer's voice, and
> the implementation that was built (option 1).
>
> Status: implemented on `feature/agent-voice`. Needs one real test interview
> to verify end to end.

## Where the recording comes from today

Two paths, chosen by whether `RECORDING_BUCKET` is set.

| Path | Trigger | What is captured |
| --- | --- | --- |
| LiveKit participant egress | production (`recording_bucket` set) | candidate camera + mic, 640x360, 15 fps, 48 kbps audio |
| Browser `MediaRecorder` | local dev (no bucket) | candidate camera + mic only |

Both record **one participant**. The agent's own audio is never in the file, so
the report's `<video>` player plays a one-sided conversation.

The agent does publish its voice into the room as a normal LiveKit audio track,
so the audio exists during the call; it just is not being written anywhere.

## Option 1: recorder inside the agent (recommended)

`livekit-agents` 1.8.6 ships `RecorderIO`
(`livekit/agents/voice/recorder_io`). It writes one **stereo OGG**:

- channel 0 = candidate audio as it reached the model (through our `GatedAudioInput`)
- channel 1 = what the agent actually played, so interruptions land correctly
- both on a single timeline, silence where nothing was written

Wiring:

1. After `session.start()`, wrap the existing input and output:
   ```python
   recorder = RecorderIO(agent_session=self.session)
   self.session.input.audio = recorder.record_input(self.session.input.audio)
   self.session.output.audio = recorder.record_output(self.session.output.audio)
   await recorder.start(output_path=path)
   ```
2. On `finish()`, `await recorder.aclose()` and upload the OGG.
   The agent has no GCS client, but the web app already has
   `uploadStoredObject()`, so add `/api/agent/interviews/[roomId]/audio`
   (agent secret is already used for `/api/agent/interviews/[roomId]/complete`).
3. In the web app, mix the OGG into the mp4 **once** and cache the result in the
   bucket as `...-mixed.mp4`, following the existing `buildMergedRecording()`
   pattern. `ffmpeg-static` is already a dependency.
4. `pickRecording()` prefers the mixed file when it exists, so the report's
   player and the download links need no changes.

Pros: one source of truth for timing, speaker-separated channels available for
later analysis, no extra egress cost.

Risks:
- The OGG starts when the agent starts, the mp4 when egress starts; a few seconds
  apart. Align with the `recording_started` event timestamp, or trim the OGG.
- The agent container needs writable temp space for roughly 20 MB per hour of
  Opus audio.

Effort: about half a day including the mix step and a real test interview.

## Option 2: second egress job, no agent change

Keep participant egress as is, add `start_track_egress` on the agent's published
audio track (`self.ctx.room.local_participant`), uploading to the same bucket.
Then mix as in option 1.

Pros: no changes inside the agent, egress does the encoding.

Cons: two egress jobs per interview, two files to wait on, both must be
reconciled before the report can show a complete recording.

## Option 3: room composite egress

Replace participant egress with a composite of the whole room. One mixed mp4,
no muxing step.

Cons: egress has to run a compositor (more CPU, slower to start), the layout
needs care because the agent has no camera, and the per-speaker separation is
lost.

## Local development

With no bucket, the browser records the candidate with `MediaRecorder`. To hear
both sides there, mix the agent's remote audio track into the recorded stream
with WebAudio (`MediaStreamAudioDestinationNode`) before handing it to
`MediaRecorder`. Separate path, separate test.

## Recommendation

Do **option 1**. It captures both voices exactly as they were heard, keeps the
stereo channels for future analysis, adds no egress cost, and the report UI
needs no change once the mixed file is the one `pickRecording()` returns.

Suggested order:

1. RecorderIO wiring + upload endpoint, verified on a local interview.
2. Mix-and-cache step in the web app, `pickRecording()` prefers it.
3. Backfill is not possible for old interviews: their agent audio was never
   captured. Existing reports stay one-sided.

## What was built (2026-11-03)

Agent side:

- `agent/intervia_agent/audio_track.py` — `InterviewAudio`, a thin wrapper over
  livekit-agents' `RecorderIO`. Starts after the session starts, writes a
  stereo OGG (candidate left, interviewer right) to a temp dir, stops with a
  30 s timeout at the end of the interview.
- `worker.py` — starts the recorder in `run()`, uploads the file in
  `_write_outcome()` **before** the completion record (so the web app has the
  audio when scoring starts), then discards the temp file. Failures are logged,
  never raised.
- `backend.py` — `upload_audio()`: one POST of the whole file with the
  agent secret and an `X-Audio-Started-At` header.

Web side:

- `POST /api/agent/interviews/[roomId]/audio` — stores the OGG in the
  recordings bucket (`interviews/{roomId}/agent-audio.ogg`) or, with no bucket
  configured, on this server's disk, and appends an `interview_audio_uploaded`
  event.
- `src/lib/recordings/mix.ts` — `buildMixedRecording(roomId)`: finds the
  candidate video and the agent audio, aligns their start times (the agent's
  recording begins seconds before egress/browser recording does), folds both
  audio channels into one mono track, copies the video stream untouched, and
  caches the result (`interviews/{roomId}/mixed-<roomId>.mp4|webm`). A
  `recording_mixed` event marks it done; per-room locks prevent double work.
- `recording-refs.ts` / `video-analysis.service.ts` — `pickRecording()` now
  returns the mixed copy whenever it exists, so the report player and the
  download links need no changes. `pickCandidateRecording()` is the old logic,
  used as the mix source and fallback.
- The `/complete` route runs the mix in parallel with scoring, after the
  response is sent.

Old interviews are unaffected: no agent audio exists for them, the mix step
returns false, and they keep playing the candidate-only recording.

## Still open

- If the mix ever fails, the report keeps showing the candidate-only video; a
  retry would need a manual trigger (delete the interview and re-run, or call
  `buildMixedRecording` again).
- Loudness is not normalised between the two voices yet; the fold is a plain
  50/50 pan mix. If the interviewer sounds loud or quiet next to the candidate,
  add a `loudnorm` pass to the audio filter in `mixInto()`.
