resource "google_bigquery_table" "currency_exchange_rates" {
  dataset_id = google_bigquery_dataset.reference_data.dataset_id
  table_id   = "currency_exchange_rates"
  project    = var.gcp_project_id

  deletion_protection = false

  schema = <<EOF
[
  {
    "name": "Date",
    "type": "TIMESTAMP",
    "mode": "NULLABLE"
  },
  {
    "name": "From_Currency",
    "type": "STRING",
    "mode": "NULLABLE"
  },
  {
    "name": "To_Currency",
    "type": "STRING",
    "mode": "NULLABLE"
  },
  {
    "name": "Rate",
    "type": "FLOAT",
    "mode": "NULLABLE"
  }
]
EOF

  time_partitioning {
    type  = "DAY"
    field = "Date"
  }
}
