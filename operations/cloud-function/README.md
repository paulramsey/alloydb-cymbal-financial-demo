# AlloyDB Automated Cluster Scheduler

This directory contains the Cloud Function and deployment script to automatically start and pause your AlloyDB cluster on a set daily schedule for cost management.

## Components

1. **Cloud Function (`main.py`)**:
   - HTTP-triggered Gen 2 Cloud Function (`alloydb-scheduler-fn`) running Python 3.11.
   - Accepts parameters `?action=start` or `?action=pause` (or JSON body `{"action": "start"}`).
   - Automatically manages proper instance ordering:
     - **Start**: Starts the Primary instance (`alloydb-psa-instance`), polls until `READY`, and then starts the Read Pool (`alloydb-psa-instance-read-pool`).
     - **Pause**: Stops the Read Pool instance first, polls until `STOPPED`, and then stops the Primary instance.
   - Includes retry logic (`HTTPAdapter`) and fresh connection handling (`Connection: close`) to handle SSL/socket drops during state polling loops.

2. **Deployment Script (`deploy.sh`)**:
   - Enables required GCP APIs (`cloudfunctions`, `cloudscheduler`, `run`, `cloudbuild`, `artifactregistry`).
   - Deploys the Cloud Function with a `--timeout=300s`.
   - Creates/updates two Cloud Scheduler HTTP jobs in `America/Los_Angeles` timezone:
     - **`alloydb-start-daily`**: Runs daily at **7:00 AM Pacific Time** (`0 7 * * *`).
     - **`alloydb-pause-daily`**: Runs daily at **7:00 PM Pacific Time** (`0 19 * * *`).

---

## Prerequisites

1. Authenticate with `gcloud`:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
2. Set your default project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```
3. Ensure your compute service account has AlloyDB Admin permissions:
   ```bash
   PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")
   gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
     --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
     --role="roles/alloydb.admin"
   ```

---

## Deployment

Deploy the function and scheduler jobs by executing `deploy.sh`:

```bash
./operations/cloud-function/deploy.sh
```

### Environment Variable Overrides
You can customize the project, region, or cluster ID during deployment:

```bash
PROJECT_ID="your-project-id" REGION="us-central1" CLUSTER_ID="your-cluster" ./operations/cloud-function/deploy.sh
```

---

## Manual Execution & Testing

You can trigger the scheduled jobs on-demand at any time using `gcloud scheduler`:

```bash
# Trigger immediate cluster start
gcloud scheduler jobs run alloydb-start-daily --location=us-central1

# Trigger immediate cluster pause
gcloud scheduler jobs run alloydb-pause-daily --location=us-central1
```

Alternatively, invoke the HTTP Cloud Function endpoint directly:

```bash
FUNCTION_URL=$(gcloud functions describe alloydb-scheduler-fn --gen2 --region=us-central1 --format="value(serviceConfig.uri)")

# Start cluster
curl -X POST "${FUNCTION_URL}?action=start" -H "Content-Type: application/json"

# Pause cluster
curl -X POST "${FUNCTION_URL}?action=pause" -H "Content-Type: application/json"
```
