# AlloyDB AI Cymbal Financial Services Demo

This repository contains Terraform code to deploy a fully configured **Google Cloud AlloyDB** environment and a complete **Financial Services Demo Application**. The infrastructure includes advanced features like **AlloyDB AI** and the **Columnar Engine**.

It also sets up a complete network infrastructure using **Private Service Access (PSA)** and a Test VM.

## Demo Application Overview

This demo showcases a financial analytics platform built on Google Cloud, focusing on the analysis of real-world SEC filings (Form 13F and 10-K). It demonstrates how AlloyDB and BigQuery can be used together for hybrid operational and analytical workflows.

### Key Features Demonstrated

*   **Semantic Search on SEC Filings**: Leveraging **AlloyDB AI** with `pgvector` to perform semantic search over 3 million chunks of SEC 10-K documents.
*   **Lakehouse Federation**: Combining real-time and vector data in AlloyDB with **BigQuery** and Apache Iceberg (via **BigLake**).
*   **Vector-based Fraud Detection**: Demonstrating fraud detection capabilities using vector search as an anomaly detection engine and leveraging **ai.if()** to perform nuanced inspection of financial transactions.

### Application Stack

*   **Backend**: A **FastAPI** application serving search, analysis, and fraud detection APIs.
*   **Frontend**: A **Vite-based React** application (bundled with the backend for simplified deployment).


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

5.  **Apply the Configuration**:
    ```bash
    terraform apply
    ```
    *   Type `yes` when prompted.
    *   Deployment typically takes 15-20 minutes (AlloyDB cluster creation).

### Fast Data Import Workflow
The data import process of 192GB and subsequent index builds can be slow on a small instance. To maximize performance, it is recommended to initially deploy the instance with 32 vCPUs, and then scale down to 4 vCPUs once the import and indexing are complete.

1.  **Initial Deploy with 32 vCPUs**:
    Run `terraform apply` overriding the CPU count:
    ```bash
    terraform apply -var="alloydb_cpu_count=32"
    ```
    *   This will also apply aggressive performance database flags (like `maintenance_work_mem` and `max_wal_size`) tailored for large imports.
2.  **Wait for Import and Indexing to Complete**:
    The sequential pipeline will run DDL, then import CSV files, and finally create indexes.
3.  **Scale Down to 4 vCPUs**:
    Once the import and indexing are complete, run `terraform apply` without the override to revert to the default of 4 vCPUs (assuming you have `alloydb_cpu_count = 4` or left it at default in your `terraform.tfvars`):
    ```bash
    terraform apply
    ```
    *   This will also remove the performance flags, reverting them to database defaults.

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

## Clean Up

When you are finished with the environment, **delete the project** to ensure all resources are destroyed and you stop incurring charges.

```bash
gcloud projects delete YOUR_PROJECT_ID
```

Alternatively, you can run `terraform destroy`, but deleting the project is the safest way to ensure nothing is left behind associated with the environment.

## Disclaimers

This is not an officially supported Google product.

This software is provided "as is", without warranty of any kind, expressed or implied, including but not limited to, the warranties of merchantability, fitness for a particular purpose, and/or infringement.