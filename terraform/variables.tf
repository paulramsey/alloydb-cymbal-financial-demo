variable "gcp_project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "region" {
  description = "The GCP region for resources."
  type        = string
  default     = "us-central1"
}

variable "argolis" {
  description = "Whether to override Argolis policies."
  type        = bool
  default     = false
}

variable "alloydb_password" {
  description = "The password for the 'postgres' user in AlloyDB."
  type        = string
  sensitive   = true
}

variable "alloydb_cluster_id" {
  description = "The ID of the AlloyDB cluster."
  type        = string
  default     = "alloydb-psa-cluster"
}

variable "alloydb_instance_id" {
  description = "The ID of the AlloyDB primary instance."
  type        = string
  default     = "alloydb-psa-instance"
}

variable "alloydb_availability_type" {
  description = "Availability type for the AlloyDB instance. Choices are ZONAL or REGIONAL."
  type        = string
  default     = "ZONAL"
}

variable "alloydb_database" {
  description = "The AlloyDB database name to import into."
  type        = string
  default     = "postgres"
}

variable "database_backup_uri" {
  description = "The GCS path to the database SQL backup."
  type        = string
  default     = "gs://pr-public-demo-data/cymbal-financial-demo/postgres.sql"
}

variable "alloydb_image_name" {
  description = "The name of the container image for the unified backend."
  type        = string
  default     = "alloydb-ai-financial-demo-image"
}

variable "demo_app_name" {
  description = "The name of the Cloud Run service."
  type        = string
  default     = "alloydb-ai-financial-demo"
}

variable "demo_app_image_name" {
  description = "The name of the container image for the unified app."
  type        = string
  default     = "alloydb-ai-financial-demo-app"
}

variable "alloydb_repository_id" {
  description = "The ID of the Artifact Registry repository."
  type        = string
  default     = "alloydb-ai-financial-demo-repo"
}

variable "bigquery_import_bucket_uri" {
  description = "The GCS URI prefix to BigQuery Parquet datasets."
  type        = string
  default     = "gs://pr-public-demo-data/cymbal-financial-demo/bigquery"
}

variable "alloydb_cpu_count" {
  description = "CPU count for the AlloyDB instance. Use 64 for fast import, then scale down."
  type        = number
  default     = 4
}
