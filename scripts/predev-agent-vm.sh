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
MEMORY_LIMIT=800m

TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

fetch() {
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode().strip())'
}

AGENT_API_SECRET=$(fetch predev-agent-api-secret)
# Shared with production on purpose: the predev app reads and writes the same
# interviews. The secret is socket-form (for Cloud Run); the VM reaches Cloud
# SQL over TCP from its allowlisted address, so rewrite it the way the
# production startup script does.
DATABASE_URL=$(fetch meetingbot-database-url)
DB_HOST=34.93.73.47
if [[ "$DATABASE_URL" == *"?host=/cloudsql/"* ]]; then
  _base="${DATABASE_URL%%\?host=*}"
  DATABASE_URL="${_base/@\//@${DB_HOST}:5432/}?sslmode=disable"
fi
GEMINI_API_KEY=$(fetch meetingbot-gemini-api-key)
OMINIBOT_API_KEY=$(fetch meetingbot-ominibot-api-key)
LIVEKIT_URL=$(fetch meetingbot-livekit-url)
LIVEKIT_API_KEY=$(fetch meetingbot-livekit-api-key)
LIVEKIT_API_SECRET=$(fetch meetingbot-livekit-api-secret)

export HOME=/tmp
echo "$TOKEN" | docker login -u oauth2accesstoken --password-stdin https://asia-south1-docker.pkg.dev >/dev/null
docker pull "$IMAGE"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart=always --memory="$MEMORY_LIMIT" \
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

sleep 15
echo "--- container state ---"
docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}} {{.Image}}'
echo "--- last log lines ---"
docker logs --tail 25 "$NAME" 2>&1
