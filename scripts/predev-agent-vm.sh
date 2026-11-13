#!/bin/bash
# Runs the predev interviewer agent on meetingbot-agent-vm, beside the
# production container. Only the `agent-predev` container is touched, so a
# predev release never interrupts a production interview.
#
# No ports are published: the agent connects outbound to LiveKit Cloud, and
# the production container already owns 7880/7881/7882.
#
# Run from the VM (or over ssh):
#   sudo bash /tmp/predev-agent-vm.sh
set -euo pipefail

PROJECT=siva-nikhil
IMAGE="asia-south1-docker.pkg.dev/${PROJECT}/meetingbot/agent:predev"
NAME=agent-predev
WEB_URL="https://intervia-predev-web-199504026920.asia-south1.run.app"
# A single job needs about 550 MB on top of the worker, and the old 800m cap
# let the kernel OOM-kill an interview mid-call. The process died, the
# candidate reconnected onto a fresh agent, and the first agent's recording was
# never uploaded. Give a job room to grow and let a spike borrow swap.
MEMORY_LIMIT=1200m
MEMORY_SWAP=2048m

TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

fetch() {
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode().strip())'
}

AGENT_API_SECRET=$(fetch predev-agent-api-secret)
# The predev database: its own copy of the production rows, on the same Cloud
# SQL instance. The secret is already in TCP form for this VM.
DATABASE_URL=$(fetch predev-database-url-tcp)
GEMINI_API_KEY=$(fetch meetingbot-gemini-api-key)
OMINIBOT_API_KEY=$(fetch meetingbot-ominibot-api-key)
LIVEKIT_URL=$(fetch meetingbot-livekit-url)
LIVEKIT_API_KEY=$(fetch meetingbot-livekit-api-key)
LIVEKIT_API_SECRET=$(fetch meetingbot-livekit-api-secret)

export HOME=/tmp
echo "$TOKEN" | docker login -u oauth2accesstoken --password-stdin https://asia-south1-docker.pkg.dev >/dev/null
docker pull "$IMAGE"

# Replacing the container kills whatever it is doing. If an interview is live
# on predev, wait for it to end (up to four minutes); a call must never lose its
# interviewer, its audio or its report because a deploy landed mid-interview.
ACTIVE=0
for attempt in $(seq 1 12); do
  ACTIVE=$(curl -s -H "Authorization: Bearer $AGENT_API_SECRET" \
    "$WEB_URL/api/agent/active" \
    | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("active",[])))' 2>/dev/null || echo 0)
  if [ "${ACTIVE:-0}" = "0" ]; then
    break
  fi
  echo "interview in progress ($ACTIVE); waiting 20s before replacing the agent"
  sleep 20
done
if [ "${ACTIVE:-0}" != "0" ]; then
  echo "an interview is still live; keeping $NAME on its current image. Re-run this script once it ends."
  exit 0
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart=always \
  --memory="$MEMORY_LIMIT" --memory-swap="$MEMORY_SWAP" \
  -e AGENT_NAME=predev-interviewer \
  -e INTERVIA_WEB_URL="$WEB_URL" \
  -e AGENT_API_SECRET="$AGENT_API_SECRET" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  -e OMINIBOT_API_KEY="$OMINIBOT_API_KEY" \
  -e LIVEKIT_URL="$LIVEKIT_URL" \
  -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
  -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
  -e AGENT_TTS_PROVIDER=cloud \
  -e NEXT_PUBLIC_VOICE_PROVIDER=cascade \
  -e NODE_ENV=production \
  "$IMAGE"

# Each release leaves the previous image behind untagged (about 1.6 GB). Seven
# of them filled the 16 GB disk and broke the next pull, so remove untagged
# images that no container uses. Tagged images (production :latest) are kept.
docker image prune -f >/dev/null || true

sleep 15
echo "--- container state ---"
docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}} {{.Image}}'
echo "--- last log lines ---"
docker logs --tail 25 "$NAME" 2>&1
