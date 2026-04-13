# Deployment Guide

This guide outlines the automated steps required to provision and deploy the application in a fresh Google Cloud Platform (GCP) environment.

---

## 🏗️ 1. Core Prerequisites
- Ensure billing is enabled on the target GCP Project.
- Required permissions: `Owner` or a high-level IAM role allocating Secret Manager, Cloud Run, Cloud Build, and AlloyDB configurations.
- Installed Tools: `gcloud` CLI.

---

## 🧱 2. Terraform Provisioning (Infrastructure)
Run Terraform to provision the underlying infrastructure:
```bash
cd terraform
terraform init
terraform plan
terraform apply
```
This provisions:
- AlloyDB Primary and Autoscaling Read Pool instances.
- BigQuery datasets and Apache Iceberg bindings.
- Secret Manager instances.
- Google Artifact Registry for Docker images.

---

## 📦 3. Remote Container Builds via Cloud Build
Container images are built automatically using Google Cloud Build as defined in `terraform/build.tf`.
This dynamically builds the multi-stage container (bundling the Vite React frontend directly within the FastAPI backend) and pushes it to Artifact Registry.

---

## 💧 4. Data Ingestion
Database ingestion happens automatically after the infrastructure is provisioned:

### AlloyDB Ingestion
Automated data loading is configured within `terraform/hydration.tf`. Terraform pulls data directly from the configured GCS buckets.

---

## 🚀 5. Cloud Run Deployment
Deployments are automated via Terraform configurations (`terraform/cloudrun.tf`).

Refer to `internal/design-decisions.md` for details on the Single-Container architecture.
