resource "google_bigquery_connection" "biglake_connection" {
  connection_id = "biglake_connection"
  project       = var.gcp_project_id
  location      = var.region
  friendly_name = "BigLake Connection"
  description   = "Connection for BigLake Iceberg tables accessing GCS"

  cloud_resource {}
}

resource "google_storage_bucket_iam_member" "biglake_connection_gcs_viewer" {
  bucket = google_storage_bucket.text_data.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_bigquery_connection.biglake_connection.cloud_resource[0].service_account_id}"
}

output "biglake_connection_id" {
  value = google_bigquery_connection.biglake_connection.id
}

output "biglake_connection_sa" {
  value = google_bigquery_connection.biglake_connection.cloud_resource[0].service_account_id
}
