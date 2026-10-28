# Video analysis worker

On-camera gaze analysis, out of the web request. The web app decides *what* to
analyse (which recording, which answer windows) and hands that to this service;
the worker downloads the recording, cuts it, measures it with OpenCV +
MediaPipe, and POSTs the numbers back. The web app stays the only writer to the
database, so the scorecard shape lives in one place.

The worker holds no product data and no API key: it needs read access to the
recordings bucket and nothing else.

## Contract

| Direction | Call | Body |
| --- | --- | --- |
| web → worker | `POST /analyse` | `{ roomId, recording: { bucket, path }, startedAt, answers: [{ turnSeq, start, end, questionStart }], hiddenCount, hiddenSeconds }` |
| worker → web | `POST /api/internal/video-result` | `{ roomId, status: "analysed" \| "failed", reason?, durationSeconds?, totalSegments?, segments: [{ offset, faceVisible, model, answers, moments }] }` |

Both directions carry `x-internal-secret: $INTERNAL_SECRET`. `start`/`end` are
seconds measured from the start of the recording; the worker converts them to
clip-local times itself. `GET /healthz` is open, for probes.

## Environment

| Variable | Meaning |
| --- | --- |
| `INTERNAL_SECRET` | Shared secret, same value on the web service. |
| `INTERVIA_WEB_URL` | Base URL of the web app, for the callback. |
| `VIDEO_ANALYSIS_FPS` | Frames sampled per second (default `1`). |
| `WORKER_LOCAL_RECORDINGS` | Dev only: read recordings from this folder instead of GCS. |
| `FFMPEG_BIN` / `FFPROBE_BIN` | Dev only: paths to the binaries (the image has them on `PATH`). |
| `GOOGLE_OAUTH_ACCESS_TOKEN` | Dev only: `gcloud auth print-access-token`, instead of the metadata server. |

## Deploying to the siva-nikhil project

```bash
# 1. Image (same Artifact Registry repo as the web app, ~8-10 min, no layer cache)
gcloud builds submit --config cloudbuild-worker.yaml --project siva-nikhil .

# 2. Worker service (private; Cloud Tasks and the web app call it with the secret)
gcloud run deploy intervia-video-worker \
  --image asia-south1-docker.pkg.dev/siva-nikhil/meetingbot/web-v2:video-worker \
  --project siva-nikhil --region asia-south1 \
  --memory 2Gi --cpu 2 --concurrency 4 --timeout 1800 \
  --no-allow-unauthenticated \
  --set-env-vars INTERNAL_SECRET=<secret>,INTERVIA_WEB_URL=https://meetingbot-web-199504026920.asia-south1.run.app

# 3. Queue + the identity Cloud Tasks uses to call the worker
gcloud tasks queues create intervia-video-analysis --location=asia-south1 --project siva-nikhil
gcloud iam service-accounts create tasks-invoker --project siva-nikhil
gcloud run services add-iam-policy-binding intervia-video-worker \
  --member=serviceAccount:tasks-invoker@siva-nikhil.iam.gserviceaccount.com \
  --role=roles/run.invoker --region=asia-south1 --project siva-nikhil
```

Then on the web service set `VIDEO_ANALYSIS_MODE=worker`, `VIDEO_WORKER_URL`
(the worker's URL), `INTERNAL_SECRET`, `TASKS_PROJECT`, `TASKS_LOCATION`,
`TASKS_QUEUE` and `TASKS_INVOKER_SA`. Leave `VIDEO_ANALYSIS_MODE` unset or
`inline` to keep the old behaviour; flipping back is the same one variable.

The web service's service account needs `roles/cloudtasks.enqueuer` on the
project.

## Local run

```bash
# from the repo root, with the venv from video-analysis/
INTERNAL_SECRET=dev-secret INTERVIA_WEB_URL=http://localhost:3000 \
GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) \
FFMPEG_BIN=node_modules/ffmpeg-static/ffmpeg.exe \
  video-analysis/.venv/Scripts/python -m uvicorn main:app --app-dir worker --port 8090
```

`POST /analyse-sync` does the same work but answers only when it is finished,
which is easier to test from a script.
