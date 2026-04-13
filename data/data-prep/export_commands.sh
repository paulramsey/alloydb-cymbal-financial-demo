#!/bin/bash
# Data Export Commands for Cymbal Financial Demo

# IMPORTANT: Make sure to set your environment variables before running
export DB_HOST="YOUR_ALLOYDB_IP"
export DB_PASSWORD="YOUR_ALLOYDB_PASSWORD"
export BUCKET_NAME="gs://pr-public-demo-data/cymbal-financial-demo/data"
export GCP_PROJECT="YOUR_PROJECT_ID"

echo "=== Exporting AlloyDB Tables ==="
# 1. transactions_25_26
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U postgres -d postgres -t transactions_25_26 -F c -b -v -f transactions_25_26.dump
gsutil cp transactions_25_26.dump $BUCKET_NAME/alloydb/

# 2. sec_document_chunks
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U postgres -d postgres -t sec_document_chunks -F c -b -v -f sec_document_chunks.dump
gsutil cp sec_document_chunks.dump $BUCKET_NAME/alloydb/

# 3. ext_sec_10k_iceberg
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U postgres -d postgres -t ext_sec_10k_iceberg -F c -b -v -f ext_sec_10k_iceberg.dump
gsutil cp ext_sec_10k_iceberg.dump $BUCKET_NAME/alloydb/

echo "=== Exporting BigQuery Tables ==="
# Note: replace 'dataset' with your actual BigQuery dataset name
bq extract --project_id=$GCP_PROJECT --destination_format=PARQUET dataset.sec_13f_holdings $BUCKET_NAME/bigquery/sec_13f_holdings/*.parquet
bq extract --project_id=$GCP_PROJECT --destination_format=PARQUET dataset.stock_metadata $BUCKET_NAME/bigquery/stock_metadata/*.parquet

echo "Data exports completed and uploaded to GCS."
