-- Pre-requisite: Add "BigQuery User" (or roles/bigquery.dataViewer and roles/bigquery.readSessionUser) permissions for the 
-- AlloyDB Service Account (looks like c-343892240101-683f5e6b@gcp-sa-alloydb.iam.gserviceaccount.com)

-- Create Extension
CREATE EXTENSION IF NOT EXISTS bigquery_fdw;

-- Create Server
DROP SERVER IF EXISTS "bq_server" CASCADE;
CREATE SERVER IF NOT EXISTS "bq_server"
FOREIGN DATA WRAPPER bigquery_fdw;

-- Create User Mapping for postgres user
CREATE USER MAPPING IF NOT EXISTS FOR postgres SERVER bq_server;
CREATE USER MAPPING IF NOT EXISTS FOR alloydbsuperuser SERVER bq_server;

-- Create Foreign Table
CREATE FOREIGN TABLE IF NOT EXISTS public.ext_stock_metadata (
    "Nasdaq_Traded" TEXT,
    "Symbol" TEXT,
    "Security_Name" TEXT,
    "Listing_Exchange" TEXT,
    "Market_Category" TEXT,
    "ETF" TEXT,
    "Round_Lot_Size" FLOAT8,
    "Test_Issue" TEXT,
    "Financial_Status" TEXT,
    "CQS_Symbol" TEXT,
    "NASDAQ_Symbol" TEXT,
    "NextShares" TEXT
)
SERVER bq_server
OPTIONS (
    project '${project_id}',
    dataset 'cymbal_reference',
    table 'stock_metadata'
);

CREATE FOREIGN TABLE IF NOT EXISTS public.ext_sec_10k_iceberg (
    "cik" TEXT,
    "sic" TEXT,
    "company" TEXT,
    "date" TIMESTAMP,
    "item_1" TEXT,
    "item_1A" TEXT,
    "item_1B" TEXT,
    "item_2" TEXT,
    "item_3" TEXT,
    "item_4" TEXT,
    "item_5" TEXT,
    "item_6" TEXT,
    "item_7" TEXT,
    "item_7A" TEXT,
    "item_8" TEXT,
    "item_9" TEXT,
    "item_9A" TEXT,
    "item_9B" TEXT,
    "item_10" TEXT,
    "item_11" TEXT,
    "item_12" TEXT,
    "item_13" TEXT,
    "item_14" TEXT,
    "item_15" TEXT,
    "ret" FLOAT8,
    "mkt_cap" FLOAT8,
    "f_1_day_return" FLOAT8,
    "f_3_day_return" FLOAT8,
    "f_5_day_return" FLOAT8,
    "f_10_day_return" FLOAT8,
    "f_20_day_return" FLOAT8,
    "f_40_day_return" FLOAT8,
    "f_60_day_return" FLOAT8,
    "f_80_day_return" FLOAT8,
    "f_100_day_return" FLOAT8,
    "f_150_day_return" FLOAT8,
    "f_252_day_return" FLOAT8
)
SERVER bq_server
OPTIONS (
    project '${project_id}',
    dataset 'cymbal_reference',
    table 'sec_10k_iceberg'
);

CREATE FOREIGN TABLE IF NOT EXISTS public.ext_company_concepts (
    "cik" INTEGER,
    "taxonomy" TEXT,
    "tag" TEXT,
    "unit" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "val" FLOAT8,
    "accn" TEXT,
    "fy" INTEGER,
    "fp" TEXT,
    "form" TEXT,
    "filed" DATE,
    "frame" TEXT
)
SERVER bq_server
OPTIONS (
    project '${project_id}',
    dataset 'cymbal_reference',
    table 'company_concepts'
);

CREATE FOREIGN TABLE IF NOT EXISTS public.ext_company_tickers (
    "cik" INT, 
    "ticker" TEXT
) SERVER bq_server 
OPTIONS (
    project '${project_id}', 
    dataset 'cymbal_reference', 
    table 'company_tickers'
);

CREATE FOREIGN TABLE IF NOT EXISTS public.ext_sec_13f_holdings (
    "id" INT, 
    "manager_name" TEXT,
    "ticker" TEXT,
    "cusip" TEXT,
    "shares" BIGINT,
    "value_usd" FLOAT8, 
    "put_call" TEXT,
    "investment_discretion" TEXT,
    "title_of_class" TEXT,
    "period_of_report" DATE,
    "created_at" TIMESTAMP
)
SERVER bq_server
OPTIONS (
    project '${project_id}', 
    table 'sec_13f_holdings', 
    dataset 'cymbal_reference'
);

CREATE FOREIGN TABLE IF NOT EXISTS public.ext_vw_stock_10k_holdings (
    "Symbol" TEXT,
    "Security_Name" TEXT,
    "iceberg_company_name" TEXT,
    "cik" TEXT,
    "sic" TEXT,
    "company" TEXT,
    "date" TIMESTAMP,
    "item_1" TEXT,
    "item_1A" TEXT,
    "item_1B" TEXT,
    "item_2" TEXT,
    "item_3" TEXT,
    "item_4" TEXT,
    "item_5" TEXT,
    "item_6" TEXT,
    "item_7" TEXT,
    "item_7A" TEXT,
    "item_8" TEXT,
    "item_9" TEXT,
    "item_9A" TEXT,
    "item_9B" TEXT,
    "item_10" TEXT,
    "item_11" TEXT,
    "item_12" TEXT,
    "item_13" TEXT,
    "item_14" TEXT,
    "item_15" TEXT,
    "ret" FLOAT8,
    "mkt_cap" FLOAT8,
    "f_1_day_return" FLOAT8,
    "f_3_day_return" FLOAT8,
    "f_5_day_return" FLOAT8,
    "f_10_day_return" FLOAT8,
    "f_20_day_return" FLOAT8,
    "f_40_day_return" FLOAT8,
    "f_60_day_return" FLOAT8,
    "f_80_day_return" FLOAT8,
    "f_100_day_return" FLOAT8,
    "f_150_day_return" FLOAT8,
    "f_252_day_return" FLOAT8
)
SERVER bq_server
OPTIONS (
    project '${project_id}',
    dataset 'cymbal_reference',
    table 'vw_stock_10k_holdings'
);

-- Reverse ETL setup
-- Create and Load Reverse ETL Tables
CREATE TABLE IF NOT EXISTS retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
DROP TABLE IF EXISTS retl_company_concepts;
ALTER TABLE IF EXISTS retl_company_concepts_staging RENAME TO retl_company_concepts;

CREATE TABLE IF NOT EXISTS retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
DROP TABLE IF EXISTS retl_company_tickers;
ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;

-- Create index to support fast lookups of latest concept filings
CREATE INDEX IF NOT EXISTS idx_retl_concepts_partial 
ON public.retl_company_concepts (cik)
WHERE fy = 2025 AND fp = 'FY';

-- Setup recurring daily refresh of the Reverse ETL Tables
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
    'daily_retl_table_refresh', -- Job name
    '0 0 * * *',                -- Every day at midnight (Cron syntax)
    $$-- Refresh company_concepts
    CREATE TABLE IF NOT EXISTS retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
    DROP TABLE IF EXISTS retl_company_concepts;
    ALTER TABLE retl_company_concepts_staging RENAME TO retl_company_concepts;

    -- Refresh company_tickers
    CREATE TABLE IF NOT EXISTS retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
    DROP TABLE IF EXISTS retl_company_tickers;
    ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;

    -- Re-create the index
    CREATE INDEX IF NOT EXISTS idx_retl_concepts_partial 
    ON public.retl_company_concepts (cik)
    WHERE fy = 2025 AND fp = 'FY';$$
);

