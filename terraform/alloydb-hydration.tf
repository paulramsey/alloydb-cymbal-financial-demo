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

resource "google_storage_bucket_object" "create_models_script" {
  name   = "alloydb-create-models.sql"
  bucket = google_storage_bucket.text_data.name
  content = templatefile("${path.module}/../data/alloydb-create-models.sql", {
    project_id = var.gcp_project_id
  })
}

resource "null_resource" "run_create_models" {
  depends_on = [
    null_resource.run_extensions,
    google_storage_bucket_object.create_models_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.create_models_script.name} \
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
    null_resource.run_create_models,
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
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "post_load_prep_script" {
  name   = "alloydb-checkpoint.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-checkpoint.sql"
}

resource "null_resource" "post_load_prep" {
  depends_on = [
    null_resource.import_csv,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started post-load preparation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_1_script" {
  name   = "idx_1_fraud_labels_btree.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_1_fraud_labels_btree.sql"
}

resource "null_resource" "run_idx_1" {
  depends_on = [
    null_resource.post_load_prep,
    google_storage_bucket_object.idx_1_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_1_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 1 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "run_checkpoint_after_idx_1" {
  depends_on = [
    null_resource.run_idx_1,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started checkpoint after index 1. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_2_script" {
  name   = "idx_2_transactions_scann.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_2_transactions_scann.sql"
}

resource "null_resource" "run_idx_2" {
  depends_on = [
    null_resource.run_checkpoint_after_idx_1,
    google_storage_bucket_object.idx_2_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_2_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 2 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "run_checkpoint_after_idx_2" {
  depends_on = [
    null_resource.run_idx_2,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started checkpoint after index 2. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_3_script" {
  name   = "idx_3_sec_chunks_fts.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_3_sec_chunks_fts.sql"
}

resource "null_resource" "run_idx_3" {
  depends_on = [
    null_resource.run_checkpoint_after_idx_2,
    google_storage_bucket_object.idx_3_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_3_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 3 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "run_checkpoint_after_idx_3" {
  depends_on = [
    null_resource.run_idx_3,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started checkpoint after index 3. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "rum_patch_script" {
  name   = "alloydb-rum-patch.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-rum-patch.sql"
}

resource "null_resource" "run_rum_patch" {
  depends_on = [
    null_resource.run_checkpoint_after_idx_3,
    google_storage_bucket_object.rum_patch_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.rum_patch_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started RUM patch. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_4_script" {
  name   = "idx_4_sec_chunks_rum.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_4_sec_chunks_rum.sql"
}

resource "null_resource" "run_idx_4" {
  depends_on = [
    null_resource.run_rum_patch,
    google_storage_bucket_object.idx_4_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_4_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 4 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "run_checkpoint_after_idx_4" {
  depends_on = [
    null_resource.run_idx_4,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started checkpoint after index 4. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_5_script" {
  name   = "idx_5_sec_chunks_scann.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_5_sec_chunks_scann.sql"
}

resource "null_resource" "run_idx_5" {
  depends_on = [
    null_resource.run_checkpoint_after_idx_4,
    google_storage_bucket_object.idx_5_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_5_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 5 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "run_checkpoint_after_idx_5" {
  depends_on = [
    null_resource.run_idx_5,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started checkpoint after index 5. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "idx_6_script" {
  name   = "idx_6_sec_chunks_hnsw.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/idx_6_sec_chunks_hnsw.sql"
}

resource "null_resource" "run_idx_6" {
  depends_on = [
    null_resource.run_checkpoint_after_idx_5,
    google_storage_bucket_object.idx_6_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.idx_6_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started index 6 creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "null_resource" "post_load_prep_final" {
  depends_on = [
    null_resource.run_idx_6,
    google_storage_bucket_object.post_load_prep_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.post_load_prep_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started final post-load preparation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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

resource "google_storage_bucket_object" "alloydb_pin_hnsw_script" {
  name   = "alloydb-pin-hnsw.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-pin-hnsw.sql"
}

resource "null_resource" "run_alloydb_pin_hnsw" {
  depends_on = [
    null_resource.post_load_prep_final,
    google_storage_bucket_object.alloydb_pin_hnsw_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      OPERATION_PATH=$(gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.alloydb_pin_hnsw_script.name} \
        --sql \
        --async \
        --format="value(name)")
      
      echo "Started pin HNSW index creation. Operation: $OPERATION_PATH"
      
      while true; do
        DESC=$(gcloud alloydb operations describe $(basename $OPERATION_PATH) --region=${var.region} --format="json" 2>&1)
        DONE=$(echo "$DESC" | sed -n '/^{/,$p' | jq -r '.done' 2>/dev/null)
        
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
  content = templatefile("${path.module}/../data/alloydb-setup-fdw-and-reverse-etl.sql", {
    project_id = var.gcp_project_id
  })
}

resource "null_resource" "run_setup_fdw" {
  depends_on = [
    null_resource.run_alloydb_pin_hnsw,
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

resource "google_storage_bucket_object" "setup_tqf_script" {
  name   = "alloydb-setup-tqf.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-setup-tqf.sql"
}

resource "null_resource" "run_setup_tqf" {
  depends_on = [
    null_resource.run_setup_fdw,
    google_storage_bucket_object.setup_tqf_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.setup_tqf_script.name} \
        --sql
    EOT
  }
}

resource "google_storage_bucket_object" "setup_ownership_script" {
  name   = "alloydb-ownership.sql"
  bucket = google_storage_bucket.text_data.name
  source = "${path.module}/../data/alloydb-ownership.sql"
}

resource "null_resource" "run_setup_ownership" {
  depends_on = [
    null_resource.run_setup_tqf,
    google_storage_bucket_object.setup_ownership_script
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud alloydb clusters import ${var.alloydb_cluster_id} \
        --region=${var.region} \
        --project=${var.gcp_project_id} \
        --database=${var.alloydb_database} \
        --gcs-uri=gs://${google_storage_bucket.text_data.name}/${google_storage_bucket_object.setup_ownership_script.name} \
        --sql
    EOT
  }
}

