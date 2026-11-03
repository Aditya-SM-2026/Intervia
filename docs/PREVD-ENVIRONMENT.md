# predev environment

Isolated stack for new-feature work, built 3 Nov 2026 in `siva-nikhil`. It runs
the same code as `feature/roles-candidates`, on the same two paid machines, with
its own data. Nothing here writes to production tables, the production bucket,
the production queue or the production agent container.

| | |
|---|---|
| Branch | `features/predev` (from `feature/roles-candidates`) |
| Web | https://intervia-predev-web-199504026920.asia-south1.run.app |
| Video worker | `intervia-predev-video-worker` (private) |
| Cost | about $2–4/month on top of the existing VM and Cloud SQL instance |

## Shared with production

| Shared | How predev stays separate |
|---|---|
| VM `meetingbot-agent-vm` | Second container `agent-predev`, image `agent:predev`, no published ports, `--memory=800m` |
| Cloud SQL `meetingbot-db` | Database `intervia_predev` with user `intervia_predev` |
| LiveKit project | Agent registers as `predev-interviewer`; the web dispatches that name only |
| Artifact Registry `meetingbot` | Tags `web:predev`, `agent:predev`, `worker:predev`; `:latest` is never written |

## Own resources

| Resource | Name |
|---|---|
| Cloud Run web | `intervia-predev-web` (1 vCPU / 2 GiB, min 0, max 3, gcsfuse volume) |
| Cloud Run worker | `intervia-predev-video-worker` (2 vCPU / 2 GiB, invoker = `tasks-invoker`) |
| Cloud Tasks queue | `intervia-predev-video-analysis` |
| GCS bucket | `siva-nikhil-intervia-predev-recordings` |
| Secrets | `predev-database-url`, `predev-database-url-tcp`, `predev-agent-api-secret`, `predev-session-secret`, `predev-recruiter-password`, `predev-internal-secret` |
| Room prefix | `predev-interview-` |
| Agent name | `predev-interviewer` |

Reused by reference (same values as production): `meetingbot-gemini-api-key`,
`meetingbot-ominibot-api-key`, `meetingbot-livekit-*`.

Email is deliberately not configured, so predev meetings are created but no
invitation or reminder mail leaves the app.

## Deploy

Pushing to `features/predev` runs `.github/workflows/deploy-predev.yml`, which
builds only the images whose paths changed and deploys only predev services.
The agent step copies `scripts/predev-agent-vm.sh` to the VM and runs it, which
pulls `agent:predev` and recreates the `agent-predev` container. It never calls
`instances reset`, so a production interview is never interrupted.

First-time image build (all three, no deploy):

```bash
gcloud builds submit --config cloudbuild-predev.yaml --project siva-nikhil .
```

Sign in at the predev URL with `ADMIN_USERNAME` default `admin` and the
password stored in `predev-recruiter-password`.

## The one code change needed

`AGENT_NAME` is now read from the environment in
`agent/intervia_agent/config.py` and `src/lib/livekit/token.ts`, defaulting to
`intervia-interviewer`. Without it, two agents in the same LiveKit project
register under one name and either can be dispatched into the other's room.

Also fixed here: the schema bootstrap in
`src/server/repositories/postgres-interview-repository.ts` never created
`interviews.role_id`, so a brand-new database failed every dashboard query with
`column "role_id" does not exist`. Production only worked because that column
had been added there earlier.

## Merging back

`features/predev` is meant to be merged into `feature/roles-candidates` when the
feature is ready. Everything above is safe to merge: both code changes are
environment-driven and default to today's behaviour, and the workflow only
triggers on `features/predev`.

## Teardown

```bash
gcloud run services delete intervia-predev-web --region asia-south1 --quiet
gcloud run services delete intervia-predev-video-worker --region asia-south1 --quiet
gcloud tasks queues delete intervia-predev-video-analysis --location asia-south1 --quiet
gcloud sql databases delete intervia_predev --instance meetingbot-db --quiet
gcloud storage rm -r gs://siva-nikhil-intervia-predev-recordings
gcloud compute ssh meetingbot-agent-vm --zone asia-south1-a --command "sudo docker rm -f agent-predev"
```
