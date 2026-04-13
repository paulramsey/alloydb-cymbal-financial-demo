# Data source to get the auto-created subnetwork in the demo VPC for the specified region.
# This is needed to attach the Cloud Run service to the VPC.
data "google_compute_subnetwork" "auto_subnet" {
  depends_on = [google_compute_network.demo_vpc]
  name   = google_compute_network.demo_vpc.name
  region = var.region
}

# Deploy the demo application to Cloud Run
resource "google_cloud_run_v2_service" "unified_app" {
  depends_on = [
    null_resource.build_and_push_image,
    google_secret_manager_secret_iam_member.compute_sa_secret_accessor
  ]

  name     = var.demo_app_name
  location = var.region
  project  = var.gcp_project_id

  deletion_protection = false

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.app_repo.repository_id}/${var.alloydb_image_name}:latest"
      
      ports {
        container_port = 8080
      }

      env {
        name  = "DB_HOST"
        value = google_alloydb_instance.primary.ip_address
      }

      env {
        name  = "DB_PORT"
        value = "5432"
      }

      env {
        name  = "DB_USER"
        value = "postgres"
      }

      env {
        name  = "DB_DATABASE"
        value = var.alloydb_database
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.alloydb_password.secret_id
            version = "latest"
          }
        }
      }
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.demo_vpc.id
        subnetwork = data.google_compute_subnetwork.auto_subnet.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }
}

# Allow unauthenticated (public) access to the Cloud Run service
resource "google_cloud_run_v2_service_iam_member" "noauth" {
  project  = google_cloud_run_v2_service.unified_app.project
  location = google_cloud_run_v2_service.unified_app.location
  name     = google_cloud_run_v2_service.unified_app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
