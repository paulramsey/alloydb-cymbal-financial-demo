import os
import sys
import psycopg2
from google.cloud import bigquery
from google.cloud import storage

PROJECT_ID = os.environ.get("PROJECT_ID")
ALLOYDB_IP = os.environ.get("ALLOYDB_IP")
ALLOYDB_PASSWORD = os.environ.get("ALLOYDB_PASSWORD")
GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", f"cymbal-text-data-{PROJECT_ID}")

def verify_alloydb():
    if not ALLOYDB_IP:
        print("Skipping AlloyDB verification: ALLOYDB_IP not set.")
        return
    print("--- Verifying AlloyDB ---")
    try:
        conn = psycopg2.connect(
            host=ALLOYDB_IP,
            database="postgres",
            user="postgres",
            password=ALLOYDB_PASSWORD
        )
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM ext_sec_13f_holdings;")
            count = cur.fetchone()[0]
            print(f"AlloyDB: Found {count} rows in ext_sec_13f_holdings.")
        conn.close()
    except Exception as e:
        print(f"AlloyDB Verification Failed: {e}")

def verify_bigquery():
    print("--- Verifying BigQuery ---")
    try:
        client = bigquery.Client(project=PROJECT_ID)
        query = f"SELECT count(*) as count FROM `{PROJECT_ID}.cymbal_reference.stock_metadata`"
        query_job = client.query(query)
        results = query_job.result()
        for row in results:
            print(f"BigQuery: Found {row.count} rows in stock_metadata.")
    except Exception as e:
        print(f"BigQuery Verification Failed: {e}")

def verify_gcs():
    print("--- Verifying GCS ---")
    try:
        client = storage.Client(project=PROJECT_ID)
        bucket = client.bucket(GCS_BUCKET_NAME)
        blobs = bucket.list_blobs(prefix="risk_factors/")
        count = sum(1 for _ in blobs)
        print(f"GCS: Found {count} files in gs://{GCS_BUCKET_NAME}/risk_factors/")
    except Exception as e:
        print(f"GCS Verification Failed: {e}")

def main():
    verify_alloydb()
    verify_bigquery()
    verify_gcs()

if __name__ == "__main__":
    main()
