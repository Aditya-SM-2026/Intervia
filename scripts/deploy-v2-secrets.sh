#!/usr/bin/env bash
# One-time setup of the v2 deployment's own secrets and database user.
# Everything here is named intervia-v2-*; the earlier deployment's
# meetingbot-* secrets and its database are not read or changed.
# Safe to re-run: existing secrets are left as they are.
set -euo pipefail

PROJECT=court-siva-nikhil
INSTANCE=meetingbot-db
RUNTIME_SA="meetingbot-runtime@${PROJECT}.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."

from_env() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

# create_secret NAME VALUE: creates the secret unless it already exists.
create_secret() {
  if gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    echo "kept     $1"
  else
    printf '%s' "$2" | gcloud secrets create "$1" --project "$PROJECT" \
      --replication-policy automatic --data-file=- >/dev/null
    echo "created  $1"
  fi
  gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT" \
    --member "serviceAccount:${RUNTIME_SA}" \
    --role roles/secretmanager.secretAccessor >/dev/null
}

for name in GEMINI_API_KEY OMINIBOT_API_KEY; do
  [ -n "$(from_env "$name")" ] || { echo "$name is missing from .env" >&2; exit 1; }
done

if ! gcloud secrets describe intervia-v2-database-url --project "$PROJECT" >/dev/null 2>&1; then
  db_password=$(openssl rand -hex 24)
  if gcloud sql users list --instance "$INSTANCE" --project "$PROJECT" \
    --format="value(name)" | grep -qx intervia_v2; then
    gcloud sql users set-password intervia_v2 --instance "$INSTANCE" \
      --project "$PROJECT" --password "$db_password" >/dev/null
  else
    gcloud sql users create intervia_v2 --instance "$INSTANCE" \
      --project "$PROJECT" --password "$db_password" >/dev/null
  fi
  create_secret intervia-v2-database-url \
    "postgres://intervia_v2:${db_password}@/intervia_v2?host=/cloudsql/${PROJECT}:asia-south1:${INSTANCE}"
else
  create_secret intervia-v2-database-url ""
fi

create_secret intervia-v2-gemini-api-key "$(from_env GEMINI_API_KEY)"
create_secret intervia-v2-ominibot-api-key "$(from_env OMINIBOT_API_KEY)"
create_secret intervia-v2-agent-api-secret "$(openssl rand -hex 32)"
create_secret intervia-v2-session-secret "$(openssl rand -hex 32)"
create_secret intervia-v2-recruiter-password "$(openssl rand -base64 12 | tr -d '/+=')"

echo
echo "Done. Recruiter password for the deployed site:"
echo "  gcloud secrets versions access latest --secret intervia-v2-recruiter-password --project ${PROJECT}"
