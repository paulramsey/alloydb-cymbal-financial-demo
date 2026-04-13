resource "google_bigquery_dataset" "reference_data" {
  dataset_id                  = "cymbal_reference"
  friendly_name               = "Cymbal Reference Data"
  description                 = "Reference data for the Cymbal Investments demo"
  location                    = var.region
  delete_contents_on_destroy = true
  project                     = var.gcp_project_id
}

resource "google_bigquery_table" "stock_metadata" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "stock_metadata"
  project    = var.gcp_project_id

  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/stock_metadata/data-*.parquet"]
  }
}

resource "google_bigquery_table" "company_concepts" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_concepts"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/company_concepts/data-*.parquet"]
  }
}

resource "google_bigquery_table" "company_facts" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_facts"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/company_facts/data-*.parquet"]
  }
}

resource "google_bigquery_table" "company_tickers" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "company_tickers"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/company_tickers/data-*.parquet"]
  }
}

resource "google_bigquery_table" "currency_exchange_rates" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "currency_exchange_rates"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/currency_exchange_rates/data-*.parquet"]
  }
}

resource "google_bigquery_table" "sec_10k_iceberg" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "sec_10k_iceberg"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/sec_10k_iceberg/sec_10k_iceberg/data/*.parquet"]
  }
}

resource "google_bigquery_table" "sec_13f_holdings" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "sec_13f_holdings"
  project    = var.gcp_project_id
  deletion_protection = false

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"
    source_uris   = ["${var.bigquery_import_bucket_uri}/sec_13f_holdings/data-*.parquet"]
  }
}
