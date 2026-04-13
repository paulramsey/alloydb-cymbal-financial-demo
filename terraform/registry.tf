resource "google_artifact_registry_repository" "app_repo" {
  location      = var.region
  repository_id = var.alloydb_repository_id
  description   = "Unified Vite/FastAPI Docker images"
  format        = "DOCKER"
  project       = var.gcp_project_id
}
