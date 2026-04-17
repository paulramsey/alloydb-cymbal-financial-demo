resource "google_storage_bucket" "text_data" {
  name          = "cymbal-text-data-${var.gcp_project_id}"
  location      = var.region
  project       = var.gcp_project_id
  force_destroy = true

  uniform_bucket_level_access = true
}

resource "google_storage_bucket" "bq_data" {
  name          = "cymbal-bq-data-${var.gcp_project_id}"
  location      = var.region
  project       = var.gcp_project_id
  force_destroy = true

  uniform_bucket_level_access = true
}

resource "null_resource" "copy_bq_data" {
  depends_on = [google_storage_bucket.bq_data]

  provisioner "local-exec" {
    command = "gcloud storage cp -r gs://pr-public-demo-data/cymbal-financial-demo/bigquery/* gs://${google_storage_bucket.bq_data.name}/"
  }
}
