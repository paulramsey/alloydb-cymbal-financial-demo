resource "google_storage_bucket_object" "extensions_script" {
  name   = "alloydb-extensions.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-extensions.sql"
}

resource "null_resource" "run_extensions" {
  depends_on = [
    google_alloydb_instance.primary,
    google_project_iam_member.project_alloydb_sa_roles,
    google_storage_bucket_object.extensions_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.extensions_script.name} \
        --sql
    EOT
  }
}

resource "google_storage_bucket_object" "ddl_script" {
  name   = "alloydb-ddl.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-ddl.sql"
}

resource "null_resource" "run_ddl" {
  depends_on = [
    null_resource.run_extensions,
    google_storage_bucket_object.ddl_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.ddl_script.name} \
        --sql
    EOT
  }
}

# This resource triggers the data import from the GCS bucket.
# It uses a local-exec provisioner to make a REST API call, similar to the notebook.
locals {
  csv_imports = {
    "cards"                   = "cards"
    "fraud_labels"            = "fraud_labels"
    "mcc_codes"               = "mcc_codes"
    "sec_to_iceberg_mapping"  = "sec_to_iceberg_mapping"
    "transactions_25_26"      = "transactions_25_26"
    "users"                   = "users"
    "sec_document_chunks"     = "sec_document_chunks"
  }
}

resource "null_resource" "import_csv" {
  for_each = local.csv_imports

  depends_on = [
    google_alloydb_instance.primary,
    google_project_iam_member.project_alloydb_sa_roles,
    null_resource.run_ddl
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://pr-public-demo-data/cymbal-financial-demo/alloydb/${each.key}.csv \
        --table=${each.value} \
        --csv \
        --async \
        --format="value(name)")
      
      echo "Started import for ${each.value}. Operation: $OPERATION_PATH"
      
      while true; do
        # Use basename to extract only the operation ID. OPERATION_PATH contains the full resource name,
        # which causes double-prefixing in the URL when combined with --region.
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        
        # Extract only the JSON part (starting with {) to ignore potential environment noise at the beginning.
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
        # If parsing failed (e.g. command failed with non-JSON error), print the output and retry.
        if [ -z "$DONE" ]; then
          echo "Warning: Failed to parse operation status. Raw output was:"
          echo "$DESC"
          echo "Retrying..."
          sleep 10
          continue
        fi
        
        if [ "$DONE" = "true" ]; then
          ERROR=$(echo $DESC | jq -r '.error')
          if [ "$ERROR" != "null" ]; then
            echo "Operation failed: $ERROR"
            exit 1
          fi
          echo "Operation completed successfully."
          break
        fi
        
        echo "Waiting for operation to complete..."
        sleep 30
      done
    EOT
  }
}

resource "google_storage_bucket_object" "indexes_script" {
  name   = "alloydb-indexes.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-indexes.sql"
}

resource "null_resource" "run_indexes" {
  depends_on = [
    null_resource.import_csv,
    google_storage_bucket_object.indexes_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.indexes_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started indexes creation. Operation: $OPERATION_PATH"
      
      while true; do
        # Use basename to extract only the operation ID. OPERATION_PATH contains the full resource name,
        # which causes double-prefixing in the URL when combined with --region.
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        
        # Extract only the JSON part (starting with {) to ignore potential environment noise at the beginning.
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
        # If parsing failed (e.g. command failed with non-JSON error), print the output and retry.
        if [ -z "$DONE" ]; then
          echo "Warning: Failed to parse operation status. Raw output was:"
          echo "$DESC"
          echo "Retrying..."
          sleep 10
          continue
        fi
        
        if [ "$DONE" = "true" ]; then
          ERROR=$(echo $DESC | jq -r '.error')
          if [ "$ERROR" != "null" ]; then
            echo "Operation failed: $ERROR"
            exit 1
          fi
          echo "Operation completed successfully."
          break
        fi
        
        echo "Waiting for operation to complete..."
        sleep 30
      done
    EOT
  }
}

resource "google_storage_bucket_object" "setup_fdw_script" {
  name   = "alloydb-setup-fdw-and-reverse-etl.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-setup-fdw-and-reverse-etl.sql"
}

resource "null_resource" "run_setup_fdw" {
  depends_on = [
    null_resource.run_indexes,
    google_storage_bucket_object.setup_fdw_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.setup_fdw_script.name} \
        --sql
    EOT
  }
}
