#!/bin/bash
set -e

PROJECT_ID="${PROJECT_ID:-YOUR_PROJECT_ID}"
REGION="${REGION:-us-central1}"
CLUSTER_ID="${CLUSTER_ID:-alloydb-psa-cluster}"
FUNCTION_NAME="alloydb-scheduler-fn"
TIMEZONE="America/Los_Angeles"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "1. Deploying Cloud Function '$FUNCTION_NAME' in $PROJECT_ID..."

gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=python311 \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --source="$SCRIPT_DIR" \
  --entry-point=manage_cluster \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=300s \
  --set-env-vars PROJECT_ID="$PROJECT_ID",REGION="$REGION",CLUSTER_ID="$CLUSTER_ID"

FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" --gen2 --region="$REGION" --project="$PROJECT_ID" --format="value(serviceConfig.uri)")

echo "Cloud Function deployed successfully at: $FUNCTION_URL"

echo "2. Creating Cloud Scheduler job to START cluster daily at 7:00 AM Pacific..."
gcloud scheduler jobs create http alloydb-start-daily \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --schedule="0 7 * * *" \
  --time-zone="$TIMEZONE" \
  --uri="$FUNCTION_URL?action=start" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"action":"start"}' \
  --attempt-deadline=180s \
  --quiet || gcloud scheduler jobs update http alloydb-start-daily \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --schedule="0 7 * * *" \
  --time-zone="$TIMEZONE" \
  --uri="$FUNCTION_URL?action=start" \
  --http-method=POST \
  --update-headers="Content-Type=application/json" \
  --message-body='{"action":"start"}' \
  --attempt-deadline=180s

echo "3. Creating Cloud Scheduler job to PAUSE cluster daily at 7:00 PM Pacific..."
gcloud scheduler jobs create http alloydb-pause-daily \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --schedule="0 19 * * *" \
  --time-zone="$TIMEZONE" \
  --uri="$FUNCTION_URL?action=pause" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"action":"pause"}' \
  --attempt-deadline=180s \
  --quiet || gcloud scheduler jobs update http alloydb-pause-daily \
  --location="$REGION" \
  --project="$PROJECT_ID" \
  --schedule="0 19 * * *" \
  --time-zone="$TIMEZONE" \
  --uri="$FUNCTION_URL?action=pause" \
  --http-method=POST \
  --update-headers="Content-Type=application/json" \
  --message-body='{"action":"pause"}' \
  --attempt-deadline=180s

echo "Deployment complete! AlloyDB cluster schedule active."
