# Intervia infrastructure in GCP project `siva-nikhil`

What is running, how it is configured, and why each piece exists. Everything here was read
live from the project on 27 Oct 2026 and cross-checked against the `feature/roles-candidates`
branch of `Aditya-SM-2026/Intervia`.

| | |
|---|---|
| Project | `siva-nikhil` (number `199504026920`) |
| Billing account | `01F343-897928-949959` |
| Primary region | `asia-south1` (Mumbai) |
| Deployed branch | `feature/roles-candidates` |
| Public app URL | https://meetingbot-web-199504026920.asia-south1.run.app |

## 1. The shape of the system

Intervia is a two-part application, and that split is the single biggest driver of the
infrastructure bill.

```
                    ┌──────────────────────────────┐
   recruiter  ──────►   Cloud Run: meetingbot-web  │  Next.js app, 1 vCPU / 2 GiB, max 3 instances
   candidate  ──────►   (asia-south1)              │  serves pages, API routes, auth, scorecards
                    └───┬───────────┬──────────┬───┘
                        │           │          │
          Cloud SQL ────┘           │          └──── GCS bucket (gcsfuse mount)
          Postgres 16                │                siva-nikhil-intervia-v2-recordings
          interviews, turns,         │                candidate audio/video + uploads
          reports                    │
                                     │ HTTPS (agent secret)
                                     ▼
                    ┌──────────────────────────────┐
                    │  VM: meetingbot-agent-vm     │  e2-small, Container-Optimized OS
                    │  (asia-south1-a)             │  runs the Docker image `agent:latest`
                    │  static IP 34.93.18.244      │  LiveKit Agents worker + Gemini Live
                    └──────────────┬───────────────┘
                                   │ outbound WebRTC (UDP)
                                   ▼
                          LiveKit Cloud (wss://ai-interview-platform-....livekit.cloud)
                                   ▲
                                   │ WebRTC audio/video
                            candidate browser
```

Two things follow from this:

- **The web app fits Cloud Run** because it is stateless HTTP. It scales to zero, has no
  always-on cost, and gets a managed HTTPS URL and certificate for free.
- **The interviewer agent cannot run on Cloud Run** because it is a LiveKit media worker: it
  needs **outbound UDP** to join a WebRTC room, and Cloud Run only carries TCP/HTTP. So it
  gets a small always-on VM instead. That one limitation is why the project has a Compute
  Engine VM at all, and it is the largest fixed monthly cost.

## 2. Resource inventory

| Resource | Name | Key configuration | Why it is used |
|---|---|---|---|
| Cloud Run service | `meetingbot-web` | asia-south1, 1 vCPU / 2 GiB, max 3 instances, min 0, port 8080, startup CPU boost | Hosts the Next.js recruiter + candidate app and all `/api/*` routes. Managed HTTPS, scales to zero. |
| Compute Engine VM | `meetingbot-agent-vm` | e2-small, asia-south1-a, 20 GB boot disk, COS image, static IP, tag `meetingbot-agent` | Runs the Python LiveKit agent that talks to Gemini Live. Needs UDP egress, which Cloud Run cannot do. |
| Cloud SQL | `meetingbot-db` | Postgres 16, db-f1-micro, 10 GB PD-SSD, zonal, asia-south1-c | System of record: `interviews`, `interview_turns`, `reports`, candidates, decisions. Replaces the in-memory fallback used when `DATABASE_URL` is unset. |
| Artifact Registry | `meetingbot` | Docker, asia-south1, 27.8 GB | Stores the two built images: `web` (Cloud Run) and `agent` (VM). Colocated with both runtimes so pulls are regional and fast. |
| GCS bucket | `siva-nikhil-intervia-v2-recordings` | asia-south1, ~426 MB | Candidate recordings and resume uploads. Mounted into Cloud Run at `/data/recordings` with gcsfuse so playback and upload work across container restarts and any replica. |
| GCS bucket | `siva-nikhil_cloudbuild` | US multi-region, ~0.5 GB | Not referenced by any code. It is the implicit default bucket `gcloud builds submit` uses for source tarballs and logs. Safe to relocate or ignore. |
| Secret Manager | 10 secrets (see §3.6) | automatic replication | Keeps DB URL, LiveKit keys, Gemini key, session secret, recruiter password out of the image and out of git. Read at deploy time by Cloud Run and at boot by the VM. |
| Static external IP | `meetingbot-agent-ip` | `34.93.18.244`, asia-south1 | The VM's address must not change because Cloud SQL allowlists exactly this IP and the agent's URL is baked into config. |
| Firewall rule | `meetingbot-agent-udp` | ingress UDP from `0.0.0.0/0` to tag `meetingbot-agent` | Exposes the LiveKit media ports on the VM (historical; see §5.3). |
| Service account | `meetingbot-deployer` | roles: run.admin, artifactregistry.writer, instanceAdmin.v1, cloudbuild builder/editor, viewer, serviceAccountUser, secretAccessor | The intended CI identity for GitHub Actions. |
| Service account | `199504026920-compute` (default) | roles/editor, run.admin, artifactregistry.writer, instanceAdmin.v1, secretAccessor | Runtime identity for both Cloud Run and the VM: needs GCS, Secret Manager, Cloud SQL, and self-reset. |
| Workload Identity pool | `github-intervia` / provider `github` | OIDC `token.actions.githubusercontent.com`, condition `repository == 'Aditya-SM-2026/Intervia'` | Lets GitHub Actions authenticate to GCP with short-lived tokens instead of a stored JSON key. |

## 3. Why each piece is configured the way it is

### 3.1 Cloud Run `meetingbot-web`

- **1 vCPU / 2 GiB** – the app does server-side rendering plus Gemini text calls for plan
  generation and scorecards. 2 GiB keeps the Next.js build and PDF/image work clear of OOM.
- **max 3 instances, no min instances** – demo-to-early-production scale. Zero minimum means
  zero idle cost; the trade-off is cold starts, which is why `startup-cpu-boost` is on and the
  startup probe allows up to 240 s.
- **`--add-cloudsql-instances`** – attaches the Cloud SQL socket
  `/cloudsql/siva-nikhil:asia-south1:meetingbot-db` so the container reaches Postgres without a
  public IP hop.
- **gcsfuse volume on the recordings bucket** – `RECORDINGS_DIR=/data/recordings` is a real
  filesystem path in the container, but the bytes land in GCS. That is what makes recording
  playback work from any replica and survive redeploys.
- **All secrets injected via `secretKeyRef:latest`** – no credentials in the image or the repo.

### 3.2 Compute Engine `meetingbot-agent-vm`

- **e2-small** – the agent is mostly idle waiting on audio; the real work is Gemini Live in the
  cloud. A shared-core e2 is the cheapest shape that still handles a live WebRTC session.
- **Container-Optimized OS** – Docker is already there, minimal attack surface.
- **No `gce-container-declaration` metadata** – the container is started by a custom
  `startup-script`, not by the managed container feature. This is deliberate: the script
  fetches all seven secrets from Secret Manager, rewrites the socket-form `DATABASE_URL` into
  `34.93.73.47:5432` (because Cloud SQL only allowlists this VM's IP), then
  `docker pull agent:latest` and `docker run`.
- **Deploy = `gcloud compute instances reset`** – the pipeline resets the VM so the startup
  script re-runs and pulls the freshly pushed image. `update-container` would not work here
  because there is no container declaration to update.
- **`docker image prune -af` before and after** – old agent images filled the 20 GB boot disk
  in the past, and a failed pull silently keeps the old container running. The script clears
  space first and logs the pull failure instead of dying.
- **Static IP** – Cloud SQL's authorised network is a single /32 (this address), and
  `INTERVIA_WEB_URL` and the LiveKit wiring assume a stable endpoint.

### 3.3 Cloud SQL `meetingbot-db`

- **db-f1-micro, 10 GB, zonal** – the cheapest viable Postgres for a workload measured in
  interviews per day. No HA replica, so a zone failure means downtime; acceptable at this stage.
- **Backups on, 07:00, 7 retained + 7 days of PITR** – transcripts and scorecards are the
  product; a week of point-in-time recovery is the floor.
- **Public IP with a single authorised network** – the VM connects over TCP and needs a public
  endpoint because it is not in a VPC peering with Cloud SQL. Cloud Run uses the socket
  instead. `requireSsl` is currently **false** (see §5.2).

#### What is actually stored (measured 27 Oct 2026)

The whole `meetingbot` database is **9 MB**. The instance is provisioned with 10 GB, so it is
using about 0.1% of its disk.

| Table | Rows | Size | Holds |
|---|---|---|---|
| `interview_events` | 1,016 | 336 kB | Append-only log per interview: join, consent, topic changes, recording uploads |
| `interviews` | 16 | 424 kB | One row per interview: candidate, role, JD text, resume text, plan, outcome, decision |
| `interview_turns` | 319 | 176 kB | The transcript: speaker, text, timings, competency per turn |
| `scorecards` | 15 | 208 kB | Generated scorecard JSON per finished interview |
| `roles` | 19 | 32 kB | Job roles and their skills, used to create interviews |

Rows date from 15 to 27 Oct 2026. Postgres keeps ~8 MB of its own catalogs and templates
(`postgres`, `template0`, `template1`, `cloudsqladmin`) alongside that, which is why the managed
storage reads a few megabytes above the table sizes.

The point: the 10 GB is the **smallest disk Cloud SQL will sell you**, not a measurement of the
data. You are paying for a running Postgres server, not for storage volume.

### 3.4 GCS buckets

- **`siva-nikhil-intervia-v2-recordings`** – the only Intervia data bucket. Holds candidate
  recordings and resume uploads, and backs the dashboard playback endpoint. Regional
  asia-south1 so it is next to Cloud Run and cheap on egress within the region.
- **`siva-nikhil_cloudbuild`** – incidental. `gcloud builds submit` needs a staging bucket and
  creates this one by default. Nothing in the repo references it.

### 3.5 Artifact Registry `meetingbot`

- **Two image families** – `web:<sha>` (immutable, one per commit) and also `web:latest`, plus
  `agent:latest` which the VM always pulls. A stale `web-v2` family exists from the earlier
  `cloudbuild-web-siva.yaml` path.
- **27.8 GB** – accumulated from ~38 web revisions and ~30 agent builds. There is no cleanup
  policy, so every historical digest is still billed.

### 3.6 Secret Manager

Ten secrets, all consumed by name:

| Secret | Consumer | Purpose |
|---|---|---|
| `meetingbot-database-url` | Cloud Run, VM | Postgres DSN (socket form; the VM rewrites it to TCP) |
| `meetingbot-gemini-api-key` | Cloud Run, VM | Gemini Live voice, plan generation, scoring |
| `meetingbot-ominibot-api-key` | Cloud Run, VM | Fallback text LLM and the Ominibot analysis provider |
| `meetingbot-livekit-url` | Cloud Run, VM | `wss://ai-interview-platform-fyd3b9yi.livekit.cloud` |
| `meetingbot-livekit-api-key` / `-secret` | Cloud Run, VM | Mint join tokens, dispatch the agent to the room |
| `meetingbot-agent-api-secret` | Cloud Run, VM | Shared secret on `/api/agent/*` between agent and web |
| `meetingbot-session-secret` | Cloud Run | Signs the recruiter session cookie |
| `meetingbot-recruiter-password` | Cloud Run | Recruiter sign-in |
| `intervia-v2-recruiter-password` | – | Unused leftover from the v2 migration |

### 3.7 IAM and Workload Identity

- **No service account keys anywhere.** GitHub Actions federates through the
  `github-intervia` pool, and the provider's attribute condition pins it to
  `repository == 'Aditya-SM-2026/Intervia'`, so no other repository can mint tokens for this
  project.
- **`meetingbot-deployer`** was built with exactly the roles a deploy needs: push images, deploy
  Cloud Run, reset the VM, read Cloud Build logs, read secrets at deploy time.
- **The default compute SA** does runtime duty. It needs `secretmanager.secretAccessor` (Cloud
  Run reads secrets as itself), `storage.objectAdmin` on the recordings bucket (for gcsfuse),
  `run.admin` and `compute.instanceAdmin.v1` (so the pipeline service account can act as it).

## 4. The deploy path, end to end

1. Push to `feature/roles-candidates`.
2. GitHub Actions authenticates with `google-github-actions/auth` through WIF.
3. `dorny/paths-filter` decides whether `web`, `agent` or both changed.
4. **Web changed** → `docker build -f Dockerfile.web` (with `NEXT_PUBLIC_VOICE_PROVIDER=cascade`),
   push `web:$GITHUB_SHA` + `web:latest`, then `gcloud run deploy meetingbot-web` with the
   sha-tagged image.
5. **Agent changed** → `docker build -f agent/Dockerfile`, push `agent:latest`, then
   `gcloud compute instances reset meetingbot-agent-vm` (falls back to `instances start`).
6. VM boots → startup script reads secrets → pulls `agent:latest` → recreates the container.
7. Cloud Run pulls its new revision and shifts 100% of traffic.

`cloudbuild-web.yaml` and `cloudbuild-web-siva.yaml` are manual Cloud Build alternatives. The
second one still points at the old `web-v2` tag; `cloudbuild-agent.yaml` still points at the old
`court-siva-nikhil` project. Neither is on the automated path.

## 5. Findings worth acting on

Ordered by how much they matter.

### 5.1 The Gmail SMTP password is stored as plain Cloud Run env

`SMTP_PASSWORD` is set as a literal environment variable on the service, so anyone with
`run.services.get` in this project can read a working app password for that mailbox. It belongs
in Secret Manager with the other eight credentials, referenced by `secretKeyRef`. Rotating it
should happen either way, because it has been readable in this form since the service was
created.

### 5.2 Cloud SQL accepts unencrypted connections

`sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED` and `requireSsl: false`. The only allowed network is
the VM's /32, so exposure is limited, but the traffic between the VM and Postgres crosses the
public internet in the clear. Setting the DSN to `sslmode=require` and flipping `requireSsl` is
a one-line change on each side.

### 5.3 The VM exposes UDP media ports to the whole internet

`meetingbot-agent-udp` allows UDP from `0.0.0.0/0` to the `meetingbot-agent` tag, and the
container publishes 7880, 7881 and 7882/udp. But LiveKit is **LiveKit Cloud**, not self-hosted on
this VM, so the agent only makes outbound connections and nothing should be listening on those
ports. The rule is a leftover from the self-hosted LiveKit plan and can be deleted, along with
the `-p` flags in the startup script.

### 5.4 CI authenticates as a project Editor

`deploy.yml` sets `SA: 199504026920-compute@developer.gserviceaccount.com`, which carries
`roles/editor` across the whole project, rather than the `meetingbot-deployer` service account
that was purpose-built with least privilege. The WIF repository condition is a real guard, but a
compromised workflow still inherits Editor. Switching the `SA` line to
`meetingbot-deployer@siva-nikhil.iam.gserviceaccount.com` closes that and needs no other change.

### 5.5 Artifact Registry has no cleanup policy

27.8 GB and growing by roughly one web image per deploy. A cleanup policy keeping the last 10
tags per image would cut most of the ~$2.80/month and speed up every pull.

### 5.6 The project carries work that is not Intervia

Three resources in `siva-nikhil` belong to other tasks and dominate the spend:

| Resource | Size | Estimated cost |
|---|---|---|
| `courtlistener-embedding-data-migrated` (us-central1) | ~1.4 TB, ~9.3 M objects | ~$28/month |
| `court-siva-nikhil-cloudbuild-migrated` (US) | bucket, migrated | < $1/month |
| `maindisk-baltest-snap` (snapshot, us-central1) | ~235 GiB | ~$5–11/month |

Intervia itself is a small share of this project's bill.

## 6. Rough monthly cost

Estimates at asia-south1 list prices, not a bill. Excludes Cloud Build minutes and Gemini/LiveKit
usage, which are charged by the provider rather than by GCP.

| Item | Est. / month |
|---|---|
| e2-small VM running 24/7 + 20 GB disk | ~$17 |
| Static IP attached to a running VM | ~$3 |
| Cloud SQL db-f1-micro + 10 GB SSD + backups | ~$12 |
| Cloud Run (near-zero traffic, scales to 0) | ~$1–5 |
| Artifact Registry 27.8 GB | ~$2.80 |
| GCS recordings (426 MB + gcsfuse ops) | < $1 |
| 10 secrets | ~$0.60 |
| **Intervia subtotal** | **~$37–40** |
| Non-Intervia resources in the same project | ~$35–40 |

The fixed floor is the VM plus Cloud SQL: about $29/month before a single interview happens.
If the agent ever moves to a runtime with UDP egress, that is the number that changes.

## 7. If this project were rebuilt from scratch

The minimum to reproduce the deployment:

1. Enable: run, compute, sqladmin, storage, artifactregistry, secretmanager, iamcredentials,
   cloudbuild, gcsfuse.
2. Create the `meetingbot` Artifact Registry repo in asia-south1.
3. Create `meetingbot-db` (Postgres 16, db-f1-micro, 10 GB), then a bucket
   `<project>-intervia-v2-recordings` in asia-south1.
4. Put the ten secrets in Secret Manager.
5. Reserve a static IP, create the e2-small COS VM with the startup script, and allowlist its IP
   on Cloud SQL.
6. Deploy `meetingbot-web` from the `web` image with the Cloud SQL attachment and the gcsfuse
   volume.
7. Create the WIF pool + provider with the repository condition, and grant the deployer account
   the seven roles listed in §3.7.

Everything in that list is described in the repo (`deploy.yml`, the startup-script metadata, and
`.env.example`) except the plain-gcloud steps, which is why this document exists.
