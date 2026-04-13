import os
import subprocess
from google.cloud import aiplatform

PROJECT_ID = os.environ.get("PROJECT_ID")
REGION = "us-central1"
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME")
MODEL_BUCKET = f"gs://{BUCKET_NAME}/timesfm"
MODEL_VARIANT = "timesfm-2.5-200m-flax"
PUBLIC_BUCKET = "gs://vertex-model-garden-public-us/timesfm"

print("Initializing Vertex AI SDK...")
aiplatform.init(
    project=PROJECT_ID, location=REGION, staging_bucket=f"{MODEL_BUCKET}/staging"
)

# Copy model artifacts
print("Copying model artifacts...")
src = f"{PUBLIC_BUCKET}/{MODEL_VARIANT}"
dst = f"{MODEL_BUCKET}/{MODEL_VARIANT}"

gcloud_path = "${GCLOUD_PATH}"
cmd = [gcloud_path, "storage", "cp", "-R", src, MODEL_BUCKET]
print(f"Running: {' '.join(cmd)}")
subprocess.run(cmd, check=True)

SERVE_DOCKER_URI = "us-docker.pkg.dev/vertex-ai-restricted/vertex-vision-model-garden-dockers/timesfm-serve-v2p5:latest"

print("Checking for existing endpoint...")
endpoints = aiplatform.Endpoint.list()
existing_endpoint = None
for ep in endpoints:
    if ep.display_name == "timesfm-2.5-gpu-endpoint":
        existing_endpoint = ep
        break

if existing_endpoint:
    print(f"Found existing endpoint: {existing_endpoint.resource_name}")
    endpoint = existing_endpoint
else:
    print("Creating non-dedicated endpoint (Shared endpoint)...")
    endpoint = aiplatform.Endpoint.create(
        display_name="timesfm-2.5-gpu-endpoint",
        dedicated_endpoint_enabled=False, # Required for AlloyDB integration
    )

print("Checking for existing model...")
models = aiplatform.Model.list()
existing_model = None
for m in models:
    if m.display_name == "timesfm-2.5-gpu":
        existing_model = m
        break

if existing_model:
    print(f"Found existing model: {existing_model.resource_name}")
    model = existing_model
else:
    print("Uploading model to Model Registry...")
    model = aiplatform.Model.upload(
        display_name="timesfm-2.5-gpu",
        serving_container_image_uri=SERVE_DOCKER_URI,
        serving_container_ports=[8080],
        serving_container_predict_route="/predict",
        serving_container_health_route="/health",
        serving_container_environment_variables={
            "MODEL_ID": dst,
            "AIP_STORAGE_URI": dst,
            "TIMESFM_CONTEXT": "0",  # dynamic
            "TIMESFM_HORIZON": "0",  # dynamic
        },
        model_garden_source_model_name="publishers/google/models/timesfm2p5",
    )

is_deployed = False
if existing_endpoint:
    try:
        deployed_models = existing_endpoint.deployed_models
        for dm in deployed_models:
            if dm.model == model.resource_name:
                is_deployed = True
                print(f"Model {model.resource_name} is already deployed to endpoint.")
                break
    except Exception as e:
        print(f"Error checking deployed models: {e}")
        # Proceed with deployment attempt if check fails

if not is_deployed:
    print("Deploying model to endpoint...")
    model.deploy(
        endpoint=endpoint,
        machine_type="g2-standard-8",
        accelerator_type="NVIDIA_L4",
        accelerator_count=1,
        deploy_request_timeout=1800,
        enable_access_logging=True,
        min_replica_count=0,
        sync=True,
        service_account="343892240101-compute@developer.gserviceaccount.com",
    )

print(f"Model deployed successfully!")
print(f"Endpoint name: {endpoint.name}")
print(f"Resource name: {endpoint.resource_name}")
print(f"Endpoint URL should be: https://{REGION}-aiplatform.googleapis.com/v1/{endpoint.resource_name}:predict")
