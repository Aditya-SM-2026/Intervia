#!/usr/bin/env bash
# Deploys the v2 stack beside the earlier one, sharing only the project, the
# Cloud SQL instance, the LiveKit project and the agent VM:
#   web    Cloud Run service intervia-v2-web (image meetingbot/web-v2)
#   agent  container intervia-v2-agent on meetingbot-agent-vm (image meetingbot/agent-v2)
#   data   database intervia_v2, bucket <project>-intervia-v2-recordings
# The earlier service (meetingbot-web), its images, database and container are
# not changed. Run scripts/deploy-v2-secrets.sh once first.
#   scripts/deploy-v2.sh [build] [web] [agent]     (default: all three)
set -euo pipefail

PROJECT=court-siva-nikhil
REGION=asia-south1
ZONE=asia-south1-a
SERVICE=intervia-v2-web
REPO=${REGION}-docker.pkg.dev/${PROJECT}/meetingbot
cd "$(dirname "$0")/.."
steps=${*:-build web agent}

if [[ " $steps " == *" build "* ]]; then
  gcloud builds submit --project "$PROJECT" --config cloudbuild-web.yaml . >/dev/null &
  gcloud builds submit --project "$PROJECT" --config cloudbuild-agent.yaml . >/dev/null &
  wait
fi

if [[ " $steps " == *" web "* ]]; then
  # One instance: recordings and sign-in lockouts live on it. CPU stays on
  # after a response because scoring runs once the agent's request returns.
  # Rooms are prefixed so the earlier agent, which joins every "interview-"
  # room in the shared LiveKit project, leaves these alone.
  gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --image "${REPO}/web-v2:latest" \
    --service-account "meetingbot-runtime@${PROJECT}.iam.gserviceaccount.com" \
    --allow-unauthenticated --execution-environment gen2 \
    --cpu 1 --memory 2Gi --timeout 900 --no-cpu-throttling \
    --min-instances 0 --max-instances 1 \
    --add-cloudsql-instances "${PROJECT}:${REGION}:meetingbot-db" \
    --add-volume "name=recordings,type=cloud-storage,bucket=${PROJECT}-intervia-v2-recordings" \
    --add-volume-mount volume=recordings,mount-path=/data/recordings \
    --set-env-vars "RECORDINGS_DIR=/data/recordings,MEETINGBOT_ROOM_PREFIX=v2-interview-" \
    --set-secrets "DATABASE_URL=intervia-v2-database-url:latest,GEMINI_API_KEY=intervia-v2-gemini-api-key:latest,OMINIBOT_API_KEY=intervia-v2-ominibot-api-key:latest,AGENT_API_SECRET=intervia-v2-agent-api-secret:latest,SESSION_SECRET=intervia-v2-session-secret:latest,RECRUITER_PASSWORD=intervia-v2-recruiter-password:latest,LIVEKIT_URL=meetingbot-livekit-url:latest,LIVEKIT_API_KEY=meetingbot-livekit-api-key:latest,LIVEKIT_API_SECRET=meetingbot-livekit-api-secret:latest"
fi

url=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format="value(status.url)")

if [[ " $steps " == *" agent "* ]]; then
  gcloud compute scp scripts/deploy-v2-agent-vm.sh meetingbot-agent-vm:/tmp/deploy-v2-agent-vm.sh \
    --zone "$ZONE" --project "$PROJECT" >/dev/null
  gcloud compute ssh meetingbot-agent-vm --zone "$ZONE" --project "$PROJECT" \
    --command "bash /tmp/deploy-v2-agent-vm.sh '$url'; rm -f /tmp/deploy-v2-agent-vm.sh"
fi

echo "v2 is at $url"
