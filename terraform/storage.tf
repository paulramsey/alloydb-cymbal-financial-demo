resource "google_storage_bucket" "text_data" {
  name          = "cymbal-text-data-${var.gcp_project_id}"
  location      = var.region
  project       = var.gcp_project_id
  force_destroy = true

  uniform_bucket_level_access = true
}
