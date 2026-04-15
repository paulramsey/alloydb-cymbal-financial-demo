terraform {
  required_providers {
    google = {
      source  = "hashicorp/google-beta"
      version = ">= 5.35.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.1"
    }
    http = {
      source  = "hashicorp/http"
      version = ">= 3.4"
    }
  }
}

# Configure the Google Cloud provider
provider "google" {
  project = var.gcp_project_id
  region  = var.region
}

# Get authentication token for the local-exec provisioner
data "google_client_config" "current" {}

# Set gcloud project scope
resource "null_resource" "gcloud_setup" {

  provisioner "local-exec" {
    command = <<-EOT
      gcloud config set project ${var.gcp_project_id}
      gcloud auth application-default set-quota-project ${var.gcp_project_id}
      gcloud auth configure-docker ${var.region}-docker.pkg.dev --quiet
    EOT
  }
}

# Enable the required Google Cloud APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "aiplatform.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "alloydb.googleapis.com",
    "logging.googleapis.com",
    "storage-component.googleapis.com",
    "serviceusage.googleapis.com",
    "networkmanagement.googleapis.com",
    "servicenetworking.googleapis.com",
    "dns.googleapis.com",
    "vpcaccess.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "networkconnectivity.googleapis.com",
    "secretmanager.googleapis.com",
    "monitoring.googleapis.com",
    "discoveryengine.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com"
  ])
  service                    = each.key
  disable_dependent_services = true
}

# Access the project data object
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# Get execution environment IP for network security rules
data "http" "myip" {
  url = "https://ipv4.icanhazip.com"
}

# Override the Argolis policies
resource "null_resource" "override_argolis_policies" {
  count      = var.argolis ? 1 : 0
  depends_on = [google_project_service.apis]

  provisioner "local-exec" {
    command = <<-EOT
      # Update org policies
      echo "Updating org policies"
      declare -a policies=("constraints/run.allowedIngress"
        "constraints/iam.allowedPolicyMemberDomains"
        "constraints/compute.vmExternalIpAccess"
      )
      for policy in "$${policies[@]}"; do
        cat <<EOF >new_policy.yaml
      constraint: $policy
      listPolicy:
        allValues: ALLOW
      EOF
        gcloud resource-manager org-policies set-policy new_policy.yaml --project="${var.gcp_project_id}"
      done

      rm new_policy.yaml

      # Wait for policies to apply
      echo "Waiting 90 seconds for Org policies to apply..."
      sleep 90
    EOT
  }
}

# Create a custom VPC
resource "google_compute_network" "demo_vpc" {
  name                    = "demo-vpc"
  auto_create_subnetworks = true
  mtu                     = 1460
  routing_mode            = "REGIONAL"
  depends_on              = [google_project_service.apis]
}

# Create a Cloud Router
resource "google_compute_router" "router" {
  name    = "nat-router"
  network = google_compute_network.demo_vpc.id
  region  = var.region
}

# Create a Cloud NAT Gateway
resource "google_compute_router_nat" "nat" {
  name                               = "managed-nat-gateway"
  router                             = google_compute_router.router.name
  region                             = google_compute_router.router.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# Reserve IP range for Private Service Access
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "alloydb-psa-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.demo_vpc.id
  project       = var.gcp_project_id
}

# Create the VPC Peering connection
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.demo_vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

# Create firewall rule for IAP internal traffic
resource "google_compute_firewall" "iap_internal_communication" {
  name    = "allow-iap-internal"
  network = google_compute_network.demo_vpc.name
  project = var.gcp_project_id

  allow {
    protocol = "all"
  }

  source_ranges = ["35.235.240.0/20"]
  direction     = "INGRESS"
  priority      = 1000 # You can adjust the priority if needed. Lower numbers have higher precedence.
  description   = "Allows internal TCP communication for IAP."
}

# Create an AlloyDB cluster with PSC
resource "google_alloydb_cluster" "default" {
  cluster_id          = var.alloydb_cluster_id
  location            = var.region
  deletion_policy     = "force"
  deletion_protection = false
  project             = var.gcp_project_id
  initial_user {
    password = var.alloydb_password
  }

  network_config {
    network            = google_compute_network.demo_vpc.id
    allocated_ip_range = google_compute_global_address.private_ip_alloc.name
  }

  depends_on = [
    google_project_service.apis,
    google_service_networking_connection.private_vpc_connection
  ]
}

# Create a single-zone AlloyDB instance
resource "google_alloydb_instance" "primary" {
  depends_on = [
    null_resource.override_argolis_policies,
    google_project_iam_member.project_alloydb_sa_roles
  ]

  cluster           = google_alloydb_cluster.default.name
  instance_id       = var.alloydb_instance_id
  instance_type     = "PRIMARY"
  availability_type = var.alloydb_availability_type
  machine_config {
    cpu_count = var.alloydb_cpu_count
  }
  database_flags = merge(
    {
      "google_columnar_engine.enabled"                = "on"
      "google_columnar_engine.enable_vectorized_join" = "on"
      "google_columnar_engine.enable_index_caching"   = "on"
      "google_ml_integration.enable_model_support"    = "on"
      "google_ml_integration.enable_ai_query_engine"  = "on"
      "password.enforce_complexity"                   = "on"
      "password.min_uppercase_letters"                = "1"
      "password.min_numerical_chars"                  = "1"
      "password.min_pass_length"                      = "10"
      "bigquery_fdw.enabled"                          = "on"
      "alloydb.enable_pg_cron"                        = "on"
    },
    var.alloydb_cpu_count == 32 ? {
      # Import optimizations
      "maintenance_work_mem" = "33554432"
      "max_wal_size"         = "20480"
      "checkpoint_timeout"   = "1800"
      "autovacuum"           = "off"
    } : {}
  )
  client_connection_config {
    ssl_config {
      ssl_mode = "ALLOW_UNENCRYPTED_AND_ENCRYPTED"
    }
  }

  connection_pool_config {
    enabled      = true
  }

  network_config {
    enable_public_ip = true
    authorized_external_networks {
      cidr_range = "${chomp(data.http.myip.response_body)}/32"
    }
  }
}

resource "null_resource" "alloydb_read_pool" {
  depends_on = [
    google_alloydb_instance.primary
  ]

  triggers = {
    cluster_id     = var.alloydb_cluster_id
    instance_id    = var.alloydb_instance_id
    region         = var.region
    project_id     = var.gcp_project_id
    max_node_count = 2
    my_ip          = "${chomp(data.http.myip.response_body)}/32"
  }

  provisioner "local-exec" {
    command = <<-EOT
      INSTANCE_ID="${self.triggers.instance_id}-read-pool"
      CLUSTER_ID="${self.triggers.cluster_id}"
      REGION_ID="${self.triggers.region}"
      PROJECT_ID="${self.triggers.project_id}"
      MY_IP="${self.triggers.my_ip}"
      
      echo "Checking if read pool $INSTANCE_ID exists..."
      if gcloud alloydb instances describe $INSTANCE_ID --cluster=$CLUSTER_ID --region=$REGION_ID --project=$PROJECT_ID > /dev/null 2>&1; then
        echo "Instance already exists, skipping creation."
      else
        echo "Creating autoscaling read pool..."
        gcloud beta alloydb instances create $INSTANCE_ID \
          --instance-type=READ_POOL \
          --read-pool-node-count=1 \
          --region=$REGION_ID \
          --cluster=$CLUSTER_ID \
          --project=$PROJECT_ID \
          --enable-autoscaler \
          --autoscaler-max-node-count=${self.triggers.max_node_count} \
          --autoscaler-target-cpu-usage=0.6 \
          --cpu-count=2 \
          --assign-inbound-public-ip=ASSIGN_IPV4 \
          --ssl-mode=ALLOW_UNENCRYPTED_AND_ENCRYPTED \
          --database-flags="google_columnar_engine.enabled=on,google_columnar_engine.enable_vectorized_join=on,google_columnar_engine.enable_index_caching=on,google_ml_integration.enable_model_support=on,google_ml_integration.enable_ai_query_engine=on,password.enforce_complexity=on,password.min_uppercase_letters=1,password.min_numerical_chars=1,password.min_pass_length=10,bigquery_fdw.enabled=on" \
          --authorized-external-networks=${self.triggers.my_ip}
      fi
    EOT
  }

  provisioner "local-exec" {
    when    = destroy
    command = <<-EOT
      INSTANCE_ID="${self.triggers.instance_id}-read-pool"
      CLUSTER_ID="${self.triggers.cluster_id}"
      REGION_ID="${self.triggers.region}"
      PROJECT_ID="${self.triggers.project_id}"
      
      echo "Checking if read pool $INSTANCE_ID exists..."
      if gcloud alloydb instances describe $INSTANCE_ID --cluster=$CLUSTER_ID --region=$REGION_ID --project=$PROJECT_ID > /dev/null 2>&1; then
        echo "Deleting read pool $INSTANCE_ID..."
        gcloud alloydb instances delete $INSTANCE_ID --cluster=$CLUSTER_ID --region=$REGION_ID --project=$PROJECT_ID --quiet
      else
        echo "Instance does not exist, skipping deletion."
      fi
    EOT
  }
}

# data "google_alloydb_instance" "read_pool" {
#   depends_on = [null_resource.alloydb_read_pool]
# 
#   cluster_id  = var.alloydb_cluster_id
#   location    = var.region
#   instance_id = "${var.alloydb_instance_id}-read-pool"
# }



# --- START: Section for creating the AlloyDB password secret ---

# Create a secret for the AlloyDB password
resource "google_secret_manager_secret" "alloydb_password" {
  depends_on = [google_project_service.apis]
  secret_id  = "alloydb-password"
  project    = var.gcp_project_id

  replication {
    auto {}
  }
}

# Store the AlloyDB password in Secret Manager
resource "google_secret_manager_secret_version" "alloydb_password_version" {
  secret      = google_secret_manager_secret.alloydb_password.id
  secret_data = var.alloydb_password
}

# Grant the Compute SA access to the AlloyDB password secret
resource "google_secret_manager_secret_iam_member" "compute_sa_secret_accessor" {
  project   = var.gcp_project_id
  secret_id = google_secret_manager_secret.alloydb_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.compute_service_account
}

# --- END: Section for creating the AlloyDB password secret ---



# --- START: Section for assigning permissions to the AlloyDB service account ---

# Define lists of roles to assign to the default compute service account
locals {
  # Roles to be applied to the GCP project
  alloydb_sa_project_roles = [
    "roles/aiplatform.user",
    "roles/alloydb.serviceAgent", # Required for AlloyDB to create tenant projects and manage resources
    "roles/serviceusage.serviceUsageConsumer",
    "roles/storage.admin",
    "roles/servicenetworking.serviceAgent",
    "roles/discoveryengine.viewer",
    "roles/bigquery.admin"
    # Add any other project-wide roles here
  ]

  compute_service_account = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

# Define the service account name once to keep the code DRY (Don't Repeat Yourself)
locals {
  alloydb_service_account_member = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-alloydb.iam.gserviceaccount.com"
}

# Loop: Create IAM role bindings for the GCP PROJECT
resource "google_project_iam_member" "project_alloydb_sa_roles" {
  depends_on = [google_alloydb_cluster.default]

  # This for_each creates a resource instance for each role in the list
  for_each = toset(local.alloydb_sa_project_roles)

  project = data.google_project.project.id
  role    = each.key # 'each.key' refers to the current role in the loop
  member  = local.alloydb_service_account_member
}

resource "google_project_iam_member" "compute_sa_storage_admin" {
  project = data.google_project.project.id
  role    = "roles/storage.admin"
  member  = local.compute_service_account
}

resource "google_project_iam_member" "compute_sa_cloudbuild" {
  project = data.google_project.project.id
  role    = "roles/cloudbuild.builds.builder"
  member  = local.compute_service_account
}

resource "google_project_iam_member" "compute_sa_logging" {
  project = data.google_project.project.id
  role    = "roles/logging.logWriter"
  member  = local.compute_service_account
}

# --- END: Section for assigning permissions to the AlloyDB service account ---

# Create a Test VM to verify connectivity
resource "google_compute_instance" "test_vm" {
  name                      = "alloydb-test-vm"
  machine_type              = "e2-standard-2"
  zone                      = "${var.region}-a"
  project                   = var.gcp_project_id
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }

  network_interface {
    network    = google_compute_network.demo_vpc.id
    subnetwork = "projects/${var.gcp_project_id}/regions/${var.region}/subnetworks/demo-vpc"
  }

  service_account {
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = "apt-get update && apt-get install -y postgresql-client"

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  depends_on = [google_project_service.apis]
}




