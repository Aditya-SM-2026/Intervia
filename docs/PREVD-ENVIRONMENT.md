# predev environment

Isolated stack for new-feature work, built 3 Nov 2026 in `siva-nikhil`. It runs
the same code as `feature/roles-candidates`, on the same two paid machines, with
its own database and its own recordings bucket. The data in them is a **copy of
production taken on 3 Nov 2026**, so predev looks like the real app without
anything it does reaching production.

| | |
|---|---|
| Branch | `features/predev` (from `feature/roles-candidates`) |
| Web | https://intervia-predev-web-199504026920.asia-south1.run.app |
| Video worker | `intervia-predev-video-worker` (private) |
| Cost | about $2–4/month on top of the existing VM and Cloud SQL instance |

## Shared with production

| Shared | How predev stays separate |
|---|---|
| VM `meetingbot-agent-vm` | Second container `agent-predev`, image `agent:predev`, no published ports, `--memory=800m`; stop it with `scripts/predev-agent.ps1 stop` when not testing |
| Cloud SQL `meetingbot-db` | **Separate database `intervia_predev`**, holding a copy of the production rows; production stays on `meetingbot` |
| LiveKit project | Agent registers as `predev-interviewer`; the web dispatches that name only |
| Artifact Registry `meetingbot` | Tags `web:predev`, `agent:predev`, `worker:predev`; `:latest` is never written |

## Own resources

| Resource | Name |
|---|---|
| Cloud Run web | `intervia-predev-web` (1 vCPU / 2 GiB, min 0, max 3, gcsfuse volume) |
| Cloud Run worker | `intervia-predev-video-worker` (2 vCPU / 2 GiB, invoker = `tasks-invoker`) |
| Cloud Tasks queue | `intervia-predev-video-analysis` |
| Database | `intervia_predev` on `meetingbot-db` |
| GCS bucket | `siva-nikhil-intervia-predev-recordings`, recordings copied from production |
| Secrets | `predev-database-url`, `predev-database-url-tcp`, `predev-agent-api-secret`, `predev-session-secret`, `predev-recruiter-password`, `predev-internal-secret` |
| Room prefix | `predev-interview-` |
| Agent name | `predev-interviewer` |

Reused by reference (same values as production): `meetingbot-gemini-api-key`,
`meetingbot-ominibot-api-key`, `meetingbot-livekit-*`.

## The data copy

Taken once, on 3 Nov 2026, from `meetingbot` and from the production recordings
bucket. 20 interviews came across with their turns, events, scorecards and roles;
219 recording objects were copied.

```bash
gcloud sql export sql meetingbot-db gs://siva-nikhil-intervia-predev-recordings/db-export/meetingbot.sql --database=meetingbot
gcloud sql databases delete intervia_predev --instance=meetingbot-db --quiet
gcloud sql databases create intervia_predev --instance=meetingbot-db
gcloud sql import sql meetingbot-db gs://siva-nikhil-intervia-predev-recordings/db-export/meetingbot.sql --database=intervia_predev

gcloud storage cp -r "gs://siva-nikhil-intervia-v2-recordings/*" gs://siva-nikhil-intervia-predev-recordings/
```

- The imported tables are owned by `postgres`, so `predev-database-url` and
  `predev-database-url-tcp` connect as `postgres` to `intervia_predev`. The app
  bootstrap runs `ALTER TABLE ... IF NOT EXISTS`, which needs table ownership.
- The Cloud SQL instance service account
  (`p199504026920-xayp94@gcp-sa-cloud-sql.iam.gserviceaccount.com`) has
  `roles/storage.objectAdmin` on the predev bucket so export and import can read
  and write it.
- `db-export/meetingbot.sql` (761 KB) is kept in the bucket; delete it when the
  copy is no longer needed.
- The copy is a snapshot: interviews created in production after 3 Nov do not
  appear in predev. Re-run the four commands to refresh it.

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

The predev agent shares the production VM, so give it back when you are not
testing:

```powershell
.\scripts\predev-agent.ps1 status
.\scripts\predev-agent.ps1 stop
.\scripts\predev-agent.ps1 start
```

`stop` leaves the production container alone; `start` re-pulls `agent:predev`
and recreates only `agent-predev`.

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

These remove only predev-named resources. The production database and the
production recordings bucket are not in the list on purpose.

```bash
gcloud run services delete intervia-predev-web --region asia-south1 --quiet
gcloud run services delete intervia-predev-video-worker --region asia-south1 --quiet
gcloud tasks queues delete intervia-predev-video-analysis --location asia-south1 --quiet
gcloud compute ssh meetingbot-agent-vm --zone asia-south1-a --command "sudo docker rm -f agent-predev"
# predev-only copies, safe to drop:
gcloud sql databases delete intervia_predev --instance meetingbot-db --quiet
gcloud storage rm -r gs://siva-nikhil-intervia-predev-recordings
```
