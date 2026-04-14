# Cymbal Investments Demo - Data Reproduction Guide

This manual outlines the step-by-step pipeline steps required to rebuild the data catalog documented in `data/data_summary.md`.

---

## 🛠️ Prerequisites

### Option A: Manual Data Placement (Recommended)
Pre-mount the following source archives directly into the `data/` volume:
- `data/symbols_valid_meta.csv`: Nasdaq stock directory (source Kaggle).
- `data/*.zip`: SEC Form 13F holding archives (source SEC structured data).
- `data/*.parquet`: Historical SEC aggregate shards (source HuggingFace).

### Option B: API Key automation
Export environment credentials to authorize direct scrap extraction:
```bash
export HUGGINGFACE_TOKEN="hf_..."
export KAGGLE_USERNAME="..."
export KAGGLE_KEY="..."
```

---

## 🚀 Step-by-Step Execution Sequence

### 📋 2. Business Reference (BigQuery)
Populate Nasdaq classifications and Yahoo currency watermarks:
```bash
# Verify PROJECT_ID env is set
export PROJECT_ID="<YOUR_PROJECT_ID>"

# 1. Load Category Metadata (Requires symbols_valid_meta.csv)
venv/bin/python3 scripts/load_bigquery.py

# 2. Iterative Currency Ticker extraction
venv/bin/python3 scripts/load_currency_rates.py
```

### 🗃️ 3. Institutional Holdings (AlloyDB)
Manifest Form Institutional Ownership ledgers:
```bash
export ALLOYDB_IP="<YOUR_ALLOYDB_IP>"
export ALLOYDB_PASSWORD="<alloydb_password>"

# Automatically expands landed ZIP archives and injects INFOTABLE/COVERPAGE joins
venv/bin/python3 scripts/load_alloydb.py
```

> [!IMPORTANT]
> The raw SEC TSV data lacks ticker symbols (only has CUSIPs). You must run the OpenFIGI backfill tool suite to repair the `ticker` column to enable demo joins:
> ```bash
> # Run persistently in authorized staging VM territory to bypass sandbox routing limits
> nohup env ALLOYDB_IP=<YOUR_ALLOYDB_IP> python3 scripts/patch_openfigi.py > patch_openfigi.log 2>&1 &
> ```
> 
> [!NOTE]
> OpenFIGI may only match about 50% of the CUSIPs to tickers because 13F filings include non-equity instruments (bonds, options) that do not have standard stock symbols. This accounts for rows that remain without tickers.

### 🧹 4. Deduplication of Document Chunks
If you suspect duplicate data in `sec_document_chunks` (e.g. from multiple load runs), remove them by keeping the first occurrence:
```sql
DELETE FROM sec_document_chunks a
USING sec_document_chunks b
WHERE a.id > b.id
  AND a.accession_number = b.accession_number
  AND a.chunk_index = b.chunk_index;
```


### ❄️ 4. Lakehouse Warehouse (Apache Iceberg)
Construct ACID-capable managed tables over GCS Parquet:
```bash
# 1. Fetch source archives (if not manually landed)
venv/bin/python3 scripts/get_hf_data.py

# 2. Repair invalid BigQuery column naming boundaries
venv/bin/python3 scripts/clean_parquet.py

# 3. Synchronize sanitized Parquet to staging bucket
gcloud storage cp temp_hf_data_cleaned/*.parquet gs://<YOUR_GCS_BUCKET_NAME>/sec-parquet-cleaned/

# 4. Apply Terraform infra (BigLake Connection + IAM)
cd terraform && terraform apply -auto-approve && cd ..

# 5. Manifest manifestation hydration
venv/bin/python3 scripts/hydrate_iceberg.py
```

### 🔍 5. Chunk and Embed SEC Form Documents (AlloyDB pgvector)
Sharding and embedding raw Form documents:
```bash
export ALLOYDB_IP="<YOUR_ALLOYDB_IP>"
# Iterate through HTML files in GCS, strip HTML tags, and segment text into chunks.
venv/bin/python3 scripts/chunk_and_embed.py
```

### 🤖 6. TimesFM Endpoint (Vertex AI)
Deploy the TimesFM model to Vertex AI endpoint for forecasting:
```bash
# Ensure the default Compute Engine service account has Storage Admin permissions.
# Then run the deployment script (takes ~15-20 minutes).
venv/bin/python3 scratch/deploy_timesfm.py
```

### 🧠 7. Semantic Feature Store & Embeddings (AlloyDB AI)
Generate consolidated feature strings and vector embeddings for transactions to enable semantic search and fraud detection.

1. **Generate Transaction Descriptions**:
   Run a SQL query to combine user, card, and merchant data into a single descriptive string in the `transactions_25_26` table.
   ```sql
   ALTER TABLE transactions_25_26 ADD COLUMN transaction_description text;

   UPDATE transactions_25_26 t
   SET transaction_description = concat(
       'User Age: ', u.current_age, 
       ', Gender: ', u.gender, 
       ', Credit Score: ', u.credit_score,
       ', Yearly Income: ', u.yearly_income,
       ', Card Brand: ', c.card_brand, 
       ', Card Type: ', c.card_type, 
       ', Card on Dark Web: ', c.card_on_dark_web,
       ', Transaction Amount: ', t.amount, 
       ', Use Chip: ', t.use_chip, 
       ', Merchant City: ', t.merchant_city,
       ', Merchant State: ', t.merchant_state,
       ', MCC Description: ', m.description
   )
   FROM users u, cards c, mcc_codes m
   WHERE t.client_id = u.id
     AND t.card_id = c.id
     AND t.mcc = m.mcc;
   ```

2. **Generate Vector Embeddings**:
   Add a vector column and use AlloyDB AI's `initialize_embeddings` to generate embeddings for all 2.67M rows. This is best run via `nohup` on a VM connected via private IP due to the data volume.
   ```sql
   -- Add the embedding column (768 dimensions for text-embedding-005)
   ALTER TABLE transactions_25_26 ADD COLUMN embedding vector(768);

   -- Initialize embeddings
   CALL ai.initialize_embeddings(
       'text-embedding-005',
       'transactions_25_26',
       'transaction_description',
       'embedding',
       100 -- batch size
   );
   ```
### 🏢 9. SEC EDGAR Ingestion Pipeline (BigQuery)
Ingest historical company facts and fetch dynamic XBRL company concepts:
```bash
# 1. Load Company Facts from local JSON files
venv/bin/python3 scripts/load_edgar_facts.py

# 2. Load Company Tickers CIK mapping
venv/bin/python3 scripts/load_company_tickers.py

# 3. Fetch default XBRL Company Concepts via REST API
venv/bin/python3 scripts/load_company_concepts.py
```

### 🔄 10. Reverse ETL to AlloyDB
Bring BigQuery company concepts and tickers into AlloyDB for faster execution in the frontend:
```sql
CREATE TABLE IF NOT exists retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
DROP TABLE IF EXISTS retl_company_concepts;
ALTER TABLE retl_company_concepts_staging RENAME TO retl_company_concepts;
SELECT COUNT(*) FROM retl_company_concepts;

CREATE TABLE IF NOT exists retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
DROP TABLE IF EXISTS retl_company_tickers;
ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;
SELECT COUNT(*) FROM retl_company_tickers;
```

---

## ✅ Verification

Run the audit script to confirm all data has been loaded successfully:
```bash
venv/bin/python3 scripts/verify_loads.py
```

### 🧠 8. Register Gemini 3 Model for Fraud Analysis
To use Gemini 3 in `ai.if` queries for fraud detection, you must register it in AlloyDB:
```sql
CALL
  google_ml.create_model(
    model_id => 'gemini-3.1-pro-preview',
    model_request_url => 'https://aiplatform.googleapis.com/v1/projects/<YOUR_PROJECT_ID>/locations/global/publishers/google/models/gemini-3.1-pro-preview:generateContent',
    model_qualified_name => 'gemini-3.1-pro-preview',
    model_provider => 'google',
    model_type => 'llm',
    model_auth_type => 'alloydb_service_agent_iam'
);
```
