output "vpc_name" {
  description = "The name of the created VPC."
  value       = google_compute_network.demo_vpc.name
}

output "alloydb_cluster_name" {
  description = "The name of the AlloyDB cluster."
  value       = google_alloydb_cluster.default.name
}

output "alloydb_private_ip" {
  description = "The Private IP address of the AlloyDB instance."
  value       = google_alloydb_instance.primary.ip_address
}


output "alloydb_public_ip" {
  description = "The Public IP address of the AlloyDB instance."
  value       = google_alloydb_instance.primary.public_ip_address
}

output "bigquery_dataset_id" {
  description = "The ID of the BigQuery dataset."
  value       = google_bigquery_dataset.reference_data.dataset_id
}

output "bigquery_table_id" {
  description = "The ID of the BigQuery table."
  value       = google_bigquery_table.stock_metadata.table_id
}

output "gcs_bucket_name" {
  description = "The name of the GCS bucket."
  value       = google_storage_bucket.text_data.name
}

# output "alloydb_read_pool_ip" {
#   description = "The IP address of the AlloyDB read pool."
#   value       = data.google_alloydb_instance.read_pool.ip_address
# }

output "cloud_run_url" {
  description = "The URL of the Cloud Run service."
  value       = google_cloud_run_v2_service.unified_app.uri
}


