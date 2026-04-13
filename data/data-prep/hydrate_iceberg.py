import sys
from google.cloud import bigquery
from google.api_core.exceptions import AlreadyExists

def hydrate_iceberg(project_id, dataset_id, connection_id, bucket_name, table_name="sec_10k_iceberg"):
    client = bigquery.Client(project=project_id)
    
    # DDL expects dots format: project.location.connection
    # Python API expects slashes format: projects/p/locations/l/connections/c
    parts = connection_id.split("/")
    if len(parts) >= 6:
        ddl_connection_id = f"{parts[1]}.{parts[3]}.{parts[5]}"
    else:
        # Fallback if short ID or already dots was passed
        ddl_connection_id = connection_id

    temp_table_id = f"{project_id}.{dataset_id}.temp_parquet_staging"
    iceberg_table_id = f"{project_id}.{dataset_id}.{table_name}"
    
    # 1. Create Temporary External Table over Parquet files
    print(f"Creating temporary external table {temp_table_id}...")
    external_config = bigquery.ExternalConfig("PARQUET")
    external_config.source_uris = [f"gs://{bucket_name}/sec-parquet-cleaned/*.parquet"]
    external_config.autodetect = True
    # Upgrading to BigLake if connection is provided
    external_config.connection_id = connection_id

    temp_table = bigquery.Table(temp_table_id)
    temp_table.external_data_configuration = external_config

    try:
        client.create_table(temp_table)
        print("Created temporary external table.")
    except AlreadyExists:
        print("Temporary table already exists. Proceeding.")

    # 2. Extract Schema from Information Schema
    print("Reading schema from temporary table...")
    schema_query = f"""
    SELECT column_name, data_type
    FROM `{project_id}.{dataset_id}.INFORMATION_SCHEMA.COLUMNS`
    WHERE table_name = 'temp_parquet_staging'
    """
    query_job = client.query(schema_query)
    columns = []
    for row in query_job:
        columns.append(f"`{row.column_name}` {row.data_type}")
    
    if not columns:
        raise Exception("Failed to retrieve schema from temporary table. Verify Parquet files exist in GCS.")
    
    schema_definition = ", ".join(columns)
    print(f"Detected Schema: {schema_definition}")

    # 3. Create EMPTY Managed Iceberg Table
    print(f"Creating managed Iceberg table {iceberg_table_id}...")
    ddl = f"""
    CREATE TABLE IF NOT EXISTS `{iceberg_table_id}`
    (
      {schema_definition}
    )
    CLUSTER BY company
    WITH CONNECTION `{ddl_connection_id}`
    OPTIONS (
      file_format = 'PARQUET',
      table_format = 'ICEBERG',
      storage_uri = 'gs://{bucket_name}/iceberg-data/{table_name}'
    );
    """
    
    try:
        query_job = client.query(ddl)
        query_job.result() # Wait for job to finish
        print("Created managed Iceberg table (or verified existence).")
    except Exception as e:
        print(f"Error creating Iceberg table: {e}")
        # Cleanup if failed
        client.delete_table(temp_table_id, not_found_ok=True)
        return

    # 4. Insert data from Temp Table to Iceberg Table
    print(f"Hydrating {table_name} from temporary table...")
    dml = f"""
    INSERT INTO `{iceberg_table_id}`
    SELECT * FROM `{temp_table_id}`
    """
    try:
        query_job = client.query(dml)
        query_job.result()
        print(f"Hydration complete. Inserted rows.")
    except Exception as e:
        print(f"Error hydrating data: {e}")

    # 5. Cleanup Temporary Table
    print("Cleaning up temporary external table...")
    client.delete_table(temp_table_id, not_found_ok=True)
    print("Cleanup complete.")

if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python3 scripts/hydrate_iceberg.py <PROJECT_ID> <DATASET_ID> <CONNECTION_ID> <BUCKET_NAME> [TABLE_NAME]")
        sys.exit(1)
        
    project = sys.argv[1]
    dataset = sys.argv[2]
    connection = sys.argv[3] # Full path or short ID? DDL requires full path?
    # DDL: WITH CONNECTION `project.location.connection`
    # Let's assume argument is full path or we build it.
    # The search result showed: `project_id.location.connection_name`
    # Wait, the search result DDL used backticks or not.
    # We should pass the full path or build it.
    # Let's pass the full path to be explicit.
    bucket = sys.argv[4]
    table = sys.argv[5] if len(sys.argv) > 5 else "sec_10k_iceberg"
    
    hydrate_iceberg(project, dataset, connection, bucket, table)
