#!/bin/bash

# Script to help setup and run DBT-5 (TPC-E) for AlloyDB
# Reference: https://github.com/osdldbt/dbt5

echo "=== DBT-5 (TPC-E) Load Generator Setup ==="

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "Error: git is not installed."
    exit 1
fi

REPO_DIR="dbt5"

if [ ! -d "$REPO_DIR" ]; then
    echo "Cloning DBT-5 repository..."
    git clone https://github.com/osdldbt/dbt5.git
    echo "Applying macOS compatibility patch..."
    cd "$REPO_DIR" && git apply ../scripts/dbt5-macos.patch && cd ..
else
    echo "DBT-5 repository already exists."
fi

echo ""
echo "=== Instructions ==="
echo "To build and run DBT-5, you typically need build tools (cmake, gcc, etc.) and PostgreSQL development libraries."
echo "Navigate to the dbt5 directory and follow the README to build."
echo ""
echo "Once built, you can use it to generate load against your AlloyDB instance using the public or private IP."
echo "Make sure your IP is authorized in AlloyDB if using public IP."
echo ""
echo "For simple load generation without complex build steps, you can also use standard pgbench if installed:"
echo "  pgbench -h \$ALLOYDB_IP -U postgres -i -s 10 postgres"
echo "  pgbench -h \$ALLOYDB_IP -U postgres -c 10 -j 2 -t 1000 postgres"
