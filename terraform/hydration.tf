# This resource triggers the data import from the GCS bucket.
# It uses a local-exec provisioner to make a REST API call, similar to the notebook.
resource "null_resource" "import_data" {
  depends_on = [
    google_alloydb_instance.primary,
    google_project_iam_member.project_alloydb_sa_roles
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=${var.database_backup_uri} \
        --sql
    EOT
  }
}
