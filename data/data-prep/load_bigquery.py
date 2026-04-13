import os
import sys
from google.cloud import bigquery

PROJECT_ID = os.environ.get("PROJECT_ID")
DATASET_ID = "cymbal_reference"
TABLE_ID = "stock_metadata"

def load_data():
    client = bigquery.Client(project=PROJECT_ID)
    table_ref = client.dataset(DATASET_ID).table(TABLE_ID)

    local_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../symbols_valid_meta.csv")
    if not os.path.exists(local_file):
        print("\n" + "="*60)
        print(f"ERROR: Stock metadata file not found at {local_file}")
        print("Please download it from Kaggle (jacksoncrow/stock-market-dataset):")
        print("  Specifically we need 'symbols_valid_meta.csv'")
        print("Place the file in the 'data/' directory and run this script again.")
        print("="*60 + "\n")
        sys.exit(1)
    
    print(f"Loading data from {local_file} to BigQuery...")
    
    job_config = bigquery.LoadJobConfig(
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        autodetect=False, # Use schema defined in Terraform
        # Ensure column order or names match if needed, but for simple CSV it usually maps by position if no header mapping, or by name if field_delimiter is set and header is skipped.
        # By default, position mapping is used if autodetect is false and no schema is provided in JobConfig.
        # Since table exists and has schema, it will map by position if we don't specify.
        # Our CSV has 4 columns. TF has 4 columns in order: Symbol, Name, Exchange, Category.
    )

    with open(local_file, "rb") as source_file:
        job = client.load_table_from_file(source_file, table_ref, job_config=job_config)

    job.result()  # Wait for job

    print(f"Loaded {job.output_rows} rows into {DATASET_ID}.{TABLE_ID}.")

if __name__ == "__main__":
    load_data()
