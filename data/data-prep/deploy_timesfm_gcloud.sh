#!/bin/bash
set -e

PROJECT_ID="${PROJECT_ID}"
REGION="${REGION}"
GCLOUD_PATH="${GCLOUD_PATH}"
BUCKET_NAME="${GCS_BUCKET_NAME}"
MODEL_BUCKET="gs://${BUCKET_NAME}/timesfm"

echo "Creating Endpoint..."
$GCLOUD_PATH ai endpoints create \
  --display-name=timesfm-2.5-gpu-endpoint-gcloud \
  --region=$REGION \
  --project=$PROJECT_ID

echo "Getting Endpoint Resource Name..."
ENDPOINT_RESOURCE_NAME=$($GCLOUD_PATH ai endpoints list --region=$REGION --filter="display_name=timesfm-2.5-gpu-endpoint-gcloud" --format="value(name)" --project=$PROJECT_ID | head -n 1)
echo "Endpoint Resource Name: $ENDPOINT_RESOURCE_NAME"

echo "Uploading Model to Model Registry..."
# Note: We pass the parent directory as MODEL_ID as implied by the notebook
$GCLOUD_PATH ai models upload \
  --container-image-uri="us-docker.pkg.dev/vertex-ai-restricted/vertex-vision-model-garden-dockers/timesfm-serve-v2p5:latest" \
  --container-env-vars="MODEL_ID=$MODEL_BUCKET,AIP_STORAGE_URI=$MODEL_BUCKET,TIMESFM_CONTEXT=0,TIMESFM_HORIZON=0" \
  --container-ports=8080 \
  --container-health-route="/health" \
  --container-predict-route="/predict" \
  --display-name="timesfm-2.5-gpu-gcloud" \
  --region=$REGION \
  --project=$PROJECT_ID

echo "Getting Model ID..."
MODEL_ID=$($GCLOUD_PATH ai models list --region=$REGION --filter="display_name=timesfm-2.5-gpu-gcloud" --format="value(name)" --project=$PROJECT_ID | head -n 1)
echo "Model ID: $MODEL_ID"

echo "Deploying Model to Endpoint..."
$GCLOUD_PATH ai endpoints deploy-model $ENDPOINT_RESOURCE_NAME \
  --model=$MODEL_ID \
  --display-name="timesfm-2.5-deployment" \
  --machine-type="g2-standard-8" \
  --accelerator="type=nvidia-l4,count=1" \
  --region=$REGION \
  --project=$PROJECT_ID

echo "Deployment completed successfully!"
echo "Endpoint URL should be: https://${REGION}-aiplatform.googleapis.com/v1/${ENDPOINT_RESOURCE_NAME}:predict"
