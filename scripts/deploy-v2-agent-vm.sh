#!/bin/bash
# Runs ON meetingbot-agent-vm: starts the v2 interviewer agent as its own
# container (intervia-v2-agent) beside the earlier meetingbot-agent container,
# which is not touched. Secrets are read from Secret Manager with the VM's
# service account, so they never leave the VM.
set -euo pipefail

PROJECT=court-siva-nikhil
IMAGE=asia-south1-docker.pkg.dev/${PROJECT}/meetingbot/agent-v2:latest
WEB_URL=${1:?usage: deploy-v2-agent-vm.sh <web url>}
META=http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token

token=$(curl -sf -H "Metadata-Flavor: Google" "$META" | sed -E 's/.*"access_token" *: *"([^"]+)".*/\1/')

secret() {
  curl -sf -H "Authorization: Bearer ${token}" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" |
    tr -d '\n ' | sed -E 's/.*"data":"([^"]+)".*/\1/' | base64 -d
}

env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT
{
  echo "LIVEKIT_URL=$(secret meetingbot-livekit-url)"
  echo "LIVEKIT_API_KEY=$(secret meetingbot-livekit-api-key)"
  echo "LIVEKIT_API_SECRET=$(secret meetingbot-livekit-api-secret)"
  echo "GEMINI_API_KEY=$(secret intervia-v2-gemini-api-key)"
  echo "AGENT_API_SECRET=$(secret intervia-v2-agent-api-secret)"
  echo "INTERVIA_WEB_URL=${WEB_URL}"
} >"$env_file"

docker_config=/var/lib/intervia-v2-docker
sudo mkdir -p "$docker_config"
printf '%s' "$token" | sudo docker --config "$docker_config" login -u oauth2accesstoken \
  --password-stdin https://asia-south1-docker.pkg.dev >/dev/null 2>&1

sudo docker --config "$docker_config" pull "$IMAGE" >/dev/null
sudo rm -rf "$docker_config"
sudo docker rm -f intervia-v2-agent >/dev/null 2>&1 || true
sudo docker run -d --name intervia-v2-agent --restart=always \
  --env-file "$env_file" --memory 1100m "$IMAGE" >/dev/null
sleep 12
sudo docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}'
sudo docker logs --tail 15 intervia-v2-agent 2>&1 | cut -c1-220
