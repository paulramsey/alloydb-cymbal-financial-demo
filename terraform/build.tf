resource "null_resource" "build_and_push_image" {
  depends_on = [
    google_artifact_registry_repository.app_repo
  ]

  triggers = {
    backend_hash         = filesha256("${path.module}/../backend/main.py")
    frontend_hash        = filesha256("${path.module}/../frontend/src/App.jsx")
    dockerfile_hash      = filesha256("${path.module}/../Dockerfile")
    cloudbuild_yaml_hash = filesha256("${path.module}/../cloudbuild.yaml")
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "Submitting build to Google Cloud Build and waiting for completion..."
      gcloud builds submit ${path.module}/.. \
        --config=${path.module}/../cloudbuild.yaml \
        --project=${var.gcp_project_id} \
        --substitutions=_REGION=${var.region},_REPOSITORY=${google_artifact_registry_repository.app_repo.repository_id},_IMAGE_NAME=${var.alloydb_image_name}
      echo "Cloud Build finished. Image should be available in Artifact Registry."
    EOT
  }
}
