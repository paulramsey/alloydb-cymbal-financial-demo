# AlloyDB AI Cymbal Financial Services Demo

This repository contains Terraform code to deploy a fully configured **Google Cloud AlloyDB** environment and a complete **Financial Services Demo Application**. The infrastructure includes advanced features like **AlloyDB AI** and the **Columnar Engine**.

It also sets up a complete network infrastructure using **Private Service Access (PSA)** and a Test VM.

## Demo Application Overview

This demo showcases a financial platform for a fictional investment firm, **Cymbal Investments**. It demonstrates advanced AlloyDB capabilities for high-frequency trading workloads, SEC filing analysis, and real-time fraud detection.

### Key Features Demonstrated

*   **Transparent Query Forwarding (TQF)**: Automatically reroutes expensive read queries from the primary instance to the read pool without application code changes, ensuring read-after-write consistency and low latency for mission-critical writes.
*   **Lakehouse Federation**: Unifies live transactional data with historical archives in BigQuery and Apache Iceberg (parquet), allowing direct queries across the entire data platform through a single lens.
*   **Hybrid Search**: Combines keyword precision with semantic depth using Google's ScaNN algorithm and Supercharged HNSW with Columnar Engine acceleration, scaling up to 10B+ vectors. Supports native GIN indexing, the RUM extension for full-text performance, and future native BM25. Provides seamless reranking with Reciprocal Rank Fusion (RRF) and Vertex AI models (or bring your own model).
*   **Real-Time Fraud Detection**: Leverages vector search for anomaly detection in high-velocity transaction streams and enhances recall with Gemini's reasoning via the `ai.if()` function.

### Application Stack

*   **Backend**: A **FastAPI** application serving search, analysis, and fraud detection APIs, demonstrating native in-database AI execution and array-based processing.
*   **Frontend**: A **Vite-based React** application providing interfaces for TQF simulation, Hybrid Search, and Fraud Detection visualization.


## Features Deployed

*   **AlloyDB Cluster & Instance**:
    *   **AlloyDB AI**: Enabled (`google_ml_integration.enable_model_support`).
    *   **Columnar Engine**: Enabled (`google_columnar_engine.enabled`) for analytical performance.
    *   **High Availability**: Configured (Zonal/Regional as defined in `variables.tf`).
*   **Networking**:
    *   **VPC**: A dedicated VPC (`demo-vpc`) for the environment.
    *   **Private Service Access (PSA)**: Secure private connectivity via VPC peering.
    *   **Public IP**: Optional public access restricted to your IP address.
*   **Testing**:
    *   **Test VM**: A Compute Engine instance (`test-vm`) compliant with Shielded VM policies, pre-loaded with `postgresql-client` for connectivity testing.

## Prerequisites

Before deploying, ensure you have the following:

1.  **Google Cloud Project**:
    *   Create a NEW project (recommended to avoid conflicts).
    *   Enable **Billing** for the project.
    
    ```bash
    # Create project
    gcloud projects create YOUR_PROJECT_ID
    
    # Link billing (Find your BILLING_ACCOUNT_ID with `gcloud billing accounts list`)
    gcloud billing projects link YOUR_PROJECT_ID --billing-account=YOUR_BILLING_ACCOUNT_ID
    ```

2.  **Tools Installed**:
    *   [Terraform](https://developer.hashicorp.com/terraform/install) (>= 1.0)
    *   [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)

3.  **Authentication**:
    *   Login to `gcloud` and set your application default credentials.
    
    ```bash
    gcloud auth login
    gcloud auth application-default login
    ```

## Deployment Steps

1.  **Navigate to the Terraform directory**:
    ```bash
    cd terraform
    ```

2.  **Initialize Terraform**:
    ```bash
    terraform init
    ```

3.  **Configure Variables**:
    *   Rename the sample file `terraform.tfvars.example` to `terraform.tfvars`.
    *   Update the first four variables in `terraform.tfvars` to match your environment.
    *   *(Note: `terraform.tfvars` is excluded in `.gitignore` to ensure sensitive information like passwords are not committed to Git.)*
    
    ```hcl
    # terraform.tfvars
    ### Update these variables for your environment ###
    gcp_project_id   = "YOUR_PROJECT_ID"
    region           = "us-central1"
    alloydb_password = "StrongPassword!"
    argolis          = false # set to true if in Argolis
    ```

4.  **Review the Plan**:
    ```bash
    terraform plan
    ```

5.  **Apply the Configuration (High CPU for Fast Import)**:
    To maximize performance during the large data import (~72GB) and index builds, it is recommended to initially deploy the instance with 32 vCPUs.
    
    Run `terraform apply` overriding the CPU count:
    ```bash
    terraform apply -var="alloydb_cpu_count=32"
    ```
    *   Type `yes` when prompted.
    *   Deployment typically takes up to 2 hours end-to-end, as it loads millions of records and builds very large indexes (ScaNN, HNSW, GIN, and RUM).
    *   This will also apply aggressive performance database flags (like `maintenance_work_mem` and `max_wal_size`) tailored for large imports.

6.  **Scale Down to 4 vCPUs**:
    Once the import and indexing are complete, run `terraform apply` without the override to revert to the default of 4 vCPUs (assuming you have `alloydb_cpu_count = 4` or left it at default in your `terraform.tfvars`):
    ```bash
    terraform apply
    ```
    *   This will also remove the performance flags, reverting them to database defaults.

### Verifying Data Import
After the deployment and data import are complete, you can verify the loaded data by running the row count check scripts provided in the `data` directory.

#### AlloyDB
1. Connect to the AlloyDB instance (see instructions below).
2. Execute the SQL script `data/alloydb-row-counts.sql` to compare your row counts with the expected counts. You can run this using `psql`:
   ```bash
   psql "host=$DB_HOST user=postgres sslmode=require" -f ../data/alloydb-row-counts.sql
   ```
   *(Note: Adjust the path to `../data/...` if you are running from the `terraform` directory or use the appropriate path.)*

#### BigQuery
You can verify the row counts for the native and external tables in BigQuery by running the `data/bq-row-counts.sql` script in the BigQuery console or via the `bq` CLI:
```bash
bq query --use_legacy_sql=false < ../data/bq-row-counts.sql
```

## Connecting to AlloyDB

After deployment, Terraform will output connectivity details.

### Option 1: From the Test VM (Private)

1.  **Copy the AlloyDB Private IP to the Test VM**:
    Run this from your **local machine** (where you ran Terraform):
    ```bash
    # Save the IP to a file
    terraform output -raw alloydb_private_ip > alloydb_private_ip.txt

    # Copy the file to the VM
    gcloud compute scp alloydb_private_ip.txt $(terraform output -raw test_vm_name):/tmp/alloydb_private_ip.txt --zone $(terraform output -raw test_vm_zone)
    ```

2.  **SSH into the Test VM**:
    ```bash
    gcloud compute ssh $(terraform output -raw test_vm_name) --zone $(terraform output -raw test_vm_zone)
    ```

3.  **Connect using Private IP**:
    From **inside the VM**:
    ```bash
    psql "host=$(cat /tmp/alloydb_private_ip.txt) user=postgres sslmode=require"
    ```

### Option 2: From your Local Machine (Public)
1.  **Get the Public IP**:
    ```bash
    terraform output alloydb_public_ip
    ```
2.  **Connect**:
    ```bash
    export DB_HOST=$(terraform output -raw alloydb_public_ip)
    psql "host=$DB_HOST user=postgres sslmode=require"
    ```
    *(Note: Access is automatically restricted to the IP address from which you ran `terraform apply`.)*

## Pausing and Resuming the Cluster (Cost Savings)

To save costs when the demo is not in use without deleting your data, you can pause the AlloyDB cluster. This is important because the demo requires at least 4 vCPUs for decent performance with over 10 Million rows, which can be expensive if left running.

We provide two scripts in the `operations/` directory for this purpose:

1.  **Pause Cluster**: Stops the read pool instance first, followed by the primary instance.
    ```bash
    ./operations/pause-cluster.sh
    ```
2.  **Start Cluster**: Starts the primary instance first, followed by the read pool instance.
    ```bash
    ./operations/start-cluster.sh
    ```

These scripts dynamically resolve the project, region, and cluster ID from Terraform output and use `--activation-policy` to stop and start the instances. They also include polling to ensure operations complete in the correct order.

## Clean Up

When you are finished with the environment, **delete the project** to ensure all resources are destroyed and you stop incurring charges.

```bash
gcloud projects delete YOUR_PROJECT_ID
```

Alternatively, you can run `terraform destroy`, but deleting the project is the safest way to ensure nothing is left behind associated with the environment.

## Disclaimers

This is not an officially supported Google product.

This software is provided "as is", without warranty of any kind, expressed or implied, including but not limited to, the warranties of merchantability, fitness for a particular purpose, and/or infringement.