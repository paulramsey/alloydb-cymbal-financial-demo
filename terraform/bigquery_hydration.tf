resource "null_resource" "load_stock_metadata" {
  depends_on = [google_bigquery_table.stock_metadata]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.stock_metadata ${var.bigquery_import_bucket_uri}/stock_metadata/data-*.parquet"
  }
}

resource "null_resource" "load_company_concepts" {
  depends_on = [google_bigquery_table.company_concepts]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.company_concepts ${var.bigquery_import_bucket_uri}/company_concepts/data-*.parquet"
  }
}

resource "null_resource" "load_company_facts" {
  depends_on = [google_bigquery_table.company_facts]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET --autodetect --schema_update_option=ALLOW_FIELD_ADDITION cymbal_reference.company_facts ${var.bigquery_import_bucket_uri}/company_facts/data-*.parquet"
  }
}

resource "null_resource" "load_company_tickers" {
  depends_on = [google_bigquery_table.company_tickers]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.company_tickers ${var.bigquery_import_bucket_uri}/company_tickers/data-*.parquet"
  }
}

resource "null_resource" "load_currency_exchange_rates" {
  depends_on = [google_bigquery_table.currency_exchange_rates]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.currency_exchange_rates ${var.bigquery_import_bucket_uri}/currency_exchange_rates/data-*.parquet"
  }
}

resource "null_resource" "load_sec_13f_holdings" {
  depends_on = [google_bigquery_table.sec_13f_holdings]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.sec_13f_holdings ${var.bigquery_import_bucket_uri}/sec_13f_holdings/data-*.parquet"
  }
}
