#!/bin/bash

# Variables
# Get project, region, and cluster from terraform output
CLUSTER_NAME_OUTPUT=$(terraform -chdir=../terraform output -raw alloydb_cluster_name)
PROJECT_ID=$(echo $CLUSTER_NAME_OUTPUT | cut -d'/' -f2)
REGION=$(echo $CLUSTER_NAME_OUTPUT | cut -d'/' -f4)
CLUSTER_ID=$(echo $CLUSTER_NAME_OUTPUT | cut -d'/' -f6)

PRIMARY_INSTANCE="alloydb-psa-instance"
READ_POOL_INSTANCE="alloydb-psa-instance-read-pool"

STATE=$(gcloud alloydb instances describe $PRIMARY_INSTANCE --cluster=$CLUSTER_ID --region=$REGION --project=$PROJECT_ID --format="value(state)")
echo "Current state of $PRIMARY_INSTANCE: $STATE"

if [ "$STATE" = "READY" ]; then
  echo "Primary instance is already running."
else
  echo "Starting primary instance: $PRIMARY_INSTANCE..."
  OPERATION_PATH=$(gcloud alloydb instances update $PRIMARY_INSTANCE \
    --cluster=$CLUSTER_ID \
    --region=$REGION \
    --project=$PROJECT_ID \
    --activation-policy=ALWAYS \
    --async \
    --format="value(name)")

  echo "Started start operation for $PRIMARY_INSTANCE. Operation: $OPERATION_PATH"

  while true; do
    DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=$REGION --project=$PROJECT_ID --format="json" 2>&1)
    DONE=$(echo "$DESC" | jq -r '.done' 2>/dev/null)
    
    if [ "$DONE" = "true" ]; then
      ERROR=$(echo $DESC | jq -r '.error')
      if [ "$ERROR" != "null" ]; then
        echo "Operation failed: $ERROR"
        exit 1
      fi
      echo "Primary instance started successfully."
      break
    fi
    
    echo "Waiting for primary instance to start..."
    sleep 10
  done
fi

STATE=$(gcloud alloydb instances describe $READ_POOL_INSTANCE --cluster=$CLUSTER_ID --region=$REGION --project=$PROJECT_ID --format="value(state)")
echo "Current state of $READ_POOL_INSTANCE: $STATE"

if [ "$STATE" = "READY" ]; then
  echo "Read pool instance is already running."
else
  echo "Starting read pool instance: $READ_POOL_INSTANCE..."
  OPERATION_PATH=$(gcloud alloydb instances update $READ_POOL_INSTANCE \
    --cluster=$CLUSTER_ID \
    --region=$REGION \
    --project=$PROJECT_ID \
    --activation-policy=ALWAYS \
    --async \
    --format="value(name)")

  echo "Started start operation for $READ_POOL_INSTANCE. Operation: $OPERATION_PATH"

  while true; do
    DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=$REGION --project=$PROJECT_ID --format="json" 2>&1)
    DONE=$(echo "$DESC" | jq -r '.done' 2>/dev/null)
    
    if [ "$DONE" = "true" ]; then
      ERROR=$(echo $DESC | jq -r '.error')
      if [ "$ERROR" != "null" ]; then
        echo "Operation failed: $ERROR"
        exit 1
      fi
      echo "Read pool instance started successfully."
      break
    fi
    
    echo "Waiting for read pool to start..."
    sleep 10
  done
fi

echo "Cluster started successfully."
