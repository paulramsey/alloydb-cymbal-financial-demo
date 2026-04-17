resource "google_bigquery_dataset" "reference_data" {
  dataset_id                  = "cymbal_reference"
  friendly_name               = "Cymbal Reference Data"
  description                 = "Reference data for the Cymbal Investments demo"
  location                    = var.region
  delete_contents_on_destroy = true
  project                     = var.gcp_project_id
}

# Native Tables with explicit schemas

resource "google_bigquery_table" "stock_metadata" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "stock_metadata"
  project    = var.gcp_project_id
  deletion_protection = false

  clustering = ["iceberg_company_name", "Symbol"]

  schema = <<EOF
[
  {"name": "Nasdaq_Traded", "type": "STRING"},
  {"name": "Symbol", "type": "STRING"},
  {"name": "Security_Name", "type": "STRING"},
  {"name": "Listing_Exchange", "type": "STRING"},
  {"name": "Market_Category", "type": "STRING"},
  {"name": "ETF", "type": "STRING"},
  {"name": "Round_Lot_Size", "type": "FLOAT64"},
  {"name": "Test_Issue", "type": "STRING"},
  {"name": "Financial_Status", "type": "STRING"},
  {"name": "CQS_Symbol", "type": "STRING"},
  {"name": "NASDAQ_Symbol", "type": "STRING"},
  {"name": "NextShares", "type": "STRING"},
  {"name": "iceberg_company_name", "type": "STRING"}
]
EOF
}

resource "google_bigquery_table" "company_concepts" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_concepts"
  project    = var.gcp_project_id
  deletion_protection = false

  range_partitioning {
    field = "fy"
    range {
      start    = 2000
      end      = 2100
      interval = 1
    }
  }
  clustering = ["fp", "cik", "tag"]

  schema = <<EOF
[
  {"name": "cik", "type": "INT64"},
  {"name": "taxonomy", "type": "STRING"},
  {"name": "tag", "type": "STRING"},
  {"name": "unit", "type": "STRING"},
  {"name": "start_date", "type": "DATE"},
  {"name": "end_date", "type": "DATE"},
  {"name": "val", "type": "FLOAT64"},
  {"name": "accn", "type": "STRING"},
  {"name": "fy", "type": "INT64"},
  {"name": "fp", "type": "STRING"},
  {"name": "form", "type": "STRING"},
  {"name": "filed", "type": "DATE"},
  {"name": "frame", "type": "STRING"}
]
EOF
}

resource "google_bigquery_table" "company_facts" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_facts"
  project    = var.gcp_project_id
  deletion_protection = false
  ignore_auto_generated_schema = true

  # Assuming similar schema or autodetect on load. 
  # Since user didn't provide schema, we can use a basic one or try to infer.
  # Let's use the same schema as company_concepts as a placeholder or assume it's similar.
  # Better to let it be created empty or with a minimal schema if we load with autodetect.
  # Let's use a minimal schema or skip explicit schema if we use `bq load` with autodetect.
  # But Terraform requires a schema for native tables if not using external data.
  # Let's use the schema from company_concepts as they are related.
  schema = <<EOF
[
  {"name": "cik", "type": "INT64"},
  {"name": "taxonomy", "type": "STRING"},
  {"name": "tag", "type": "STRING"},
  {"name": "unit", "type": "STRING"},
  {"name": "val", "type": "FLOAT64"},
  {"name": "fact_name", "type": "STRING"},
  {"name": "label", "type": "STRING"},
  {"name": "description", "type": "STRING"}
]
EOF
}

resource "google_bigquery_table" "company_tickers" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_tickers"
  project    = var.gcp_project_id
  deletion_protection = false

  clustering = ["cik", "ticker"]

  schema = <<EOF
[
  {"name": "cik", "type": "INT64"},
  {"name": "ticker", "type": "STRING"},
  {"name": "title", "type": "STRING"}
]
EOF
}

# Using bq query instead of a terraform resource here due to issues
# with clustering not supported by Terraform for external tables
# (but it is supported by the API).

resource "null_resource" "create_sec_10k_iceberg" {
  depends_on = [null_resource.copy_bq_data]

  triggers = {
    query_hash = sha256(<<EOF
CREATE EXTERNAL TABLE IF NOT EXISTS cymbal_reference.temp_sec_10k
OPTIONS (
  format = 'PARQUET',
  uris = ['gs://cymbal-bq-data-${var.gcp_project_id}/sec_10k_iceberg/sec_10k_iceberg/data/*.parquet']
);

CREATE TABLE IF NOT EXISTS cymbal_reference.sec_10k_iceberg
CLUSTER BY company
WITH CONNECTION \`projects/${var.gcp_project_id}/locations/${var.region}/connections/biglake_connection\`
OPTIONS (
  file_format = 'PARQUET',
  table_format = 'ICEBERG',
  storage_uri = 'gs://cymbal-bq-data-${var.gcp_project_id}/iceberg-data/sec_10k_iceberg/'
)
AS SELECT * FROM cymbal_reference.temp_sec_10k;

DROP TABLE IF EXISTS cymbal_reference.temp_sec_10k;
EOF
    )
  }

  provisioner "local-exec" {
    command = <<EOF
bq rm -f --project_id=${var.gcp_project_id} cymbal_reference.sec_10k_iceberg || true
bq query --project_id=${var.gcp_project_id} --use_legacy_sql=false "
CREATE EXTERNAL TABLE IF NOT EXISTS cymbal_reference.temp_sec_10k
OPTIONS (
  format = 'PARQUET',
  uris = ['gs://cymbal-bq-data-${var.gcp_project_id}/sec_10k_iceberg/sec_10k_iceberg/data/*.parquet']
);

CREATE TABLE IF NOT EXISTS cymbal_reference.sec_10k_iceberg
CLUSTER BY company
WITH CONNECTION \`projects/${var.gcp_project_id}/locations/${var.region}/connections/biglake_connection\`
OPTIONS (
  file_format = 'PARQUET',
  table_format = 'ICEBERG',
  storage_uri = 'gs://cymbal-bq-data-${var.gcp_project_id}/iceberg-data/sec_10k_iceberg/'
)
AS SELECT * FROM cymbal_reference.temp_sec_10k;

DROP TABLE IF EXISTS cymbal_reference.temp_sec_10k;
"
EOF
  }
}

# BigLake Table (External with Connection)

resource "google_bigquery_table" "sec_13f_holdings" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "sec_13f_holdings"
  project    = var.gcp_project_id
  deletion_protection = false

  clustering = ["ticker", "manager_name"]

  schema = <<EOF
[
  {"name": "id", "type": "INT64"},
  {"name": "manager_name", "type": "STRING"},
  {"name": "ticker", "type": "STRING"},
  {"name": "cusip", "type": "STRING"},
  {"name": "shares", "type": "INT64"},
  {"name": "value_usd", "type": "FLOAT64"},
  {"name": "put_call", "type": "STRING"},
  {"name": "investment_discretion", "type": "STRING"},
  {"name": "title_of_class", "type": "STRING"},
  {"name": "period_of_report", "type": "INT64"},
  {"name": "created_at", "type": "TIMESTAMP"}
]
EOF
}

resource "google_bigquery_table" "vw_stock_10k_holdings" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "vw_stock_10k_holdings"
  project    = var.gcp_project_id
  deletion_protection = false
  depends_on = [null_resource.create_sec_10k_iceberg, google_bigquery_table.stock_metadata]

  view {
    query = <<EOF
SELECT 
    sm.Symbol,
    sm.Security_Name,
    sm.iceberg_company_name,
    i.*
FROM `${var.gcp_project_id}.cymbal_reference.stock_metadata` sm
JOIN `${var.gcp_project_id}.cymbal_reference.sec_10k_iceberg` i ON sm.iceberg_company_name = i.company
EOF
    use_legacy_sql = false
  }
}
