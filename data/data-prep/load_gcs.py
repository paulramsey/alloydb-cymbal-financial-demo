import os
import sys
from google.cloud import storage

PROJECT_ID = os.environ.get("PROJECT_ID")
BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", f"cymbal-text-data-{PROJECT_ID}")

def upload_data():
    client = storage.Client(project=PROJECT_ID)
    bucket = client.bucket(BUCKET_NAME)

    local_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../risk_factors")
    os.makedirs(local_dir, exist_ok=True)
    
    files = [f for f in os.listdir(local_dir) if os.path.isfile(os.path.join(local_dir, f))]
    if not files:
        print("\n" + "="*60)
        print(f"ERROR: No risk factor files found in {local_dir}")
        print("Please place Form 10-K Risk Factor text files in 'data/risk_factors/'.")
        print("You can generate them by running scripts/get_hf_data.py.")
        print("Place the files there and run this script again.")
        print("="*60 + "\n")
        sys.exit(1)

    print(f"Uploading files from {local_dir} to gs://{BUCKET_NAME}...")
    
    for filename in os.listdir(local_dir):
        local_path = os.path.join(local_dir, filename)
        if os.path.isfile(local_path):
            blob = bucket.blob(f"risk_factors/{filename}")
            blob.upload_from_filename(local_path)
            print(f"Uploaded {filename} to gs://{BUCKET_NAME}/risk_factors/{filename}")

if __name__ == "__main__":
    upload_data()
