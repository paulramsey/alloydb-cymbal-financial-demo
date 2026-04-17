resource "null_resource" "load_stock_metadata" {
  depends_on = [google_bigquery_table.stock_metadata, null_resource.copy_bq_data]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.stock_metadata gs://${google_storage_bucket.bq_data.name}/stock_metadata/data-*.parquet"
  }
}

resource "null_resource" "load_company_concepts" {
  depends_on = [google_bigquery_table.company_concepts, null_resource.copy_bq_data]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.company_concepts gs://${google_storage_bucket.bq_data.name}/company_concepts/data-*.parquet"
  }
}

resource "null_resource" "load_company_facts" {
  depends_on = [google_bigquery_table.company_facts, null_resource.copy_bq_data]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET --autodetect --schema_update_option=ALLOW_FIELD_ADDITION cymbal_reference.company_facts gs://${google_storage_bucket.bq_data.name}/company_facts/data-*.parquet"
  }
}

resource "null_resource" "load_company_tickers" {
  depends_on = [google_bigquery_table.company_tickers, null_resource.copy_bq_data]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.company_tickers gs://${google_storage_bucket.bq_data.name}/company_tickers/data-*.parquet"
  }
}



resource "null_resource" "load_sec_13f_holdings" {
  depends_on = [google_bigquery_table.sec_13f_holdings, null_resource.copy_bq_data]
  provisioner "local-exec" {
    command = "bq load --project_id=${var.gcp_project_id} --source_format=PARQUET cymbal_reference.sec_13f_holdings gs://${google_storage_bucket.bq_data.name}/sec_13f_holdings/data-*.parquet"
  }
}
