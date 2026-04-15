-- Pre-requisite: Add "BigQuery User" permissions for the 
-- AlloyDB Service Account (looks like c-343892240101-683f5e6b@gcp-sa-alloydb.iam.gserviceaccount.com)

-- Create Extension
CREATE EXTENSION IF NOT EXISTS bigquery_fdw;

-- Create Server
CREATE SERVER "bq_server"
FOREIGN DATA WRAPPER bigquery_fdw;

-- Create User Mapping
CREATE USER MAPPING FOR current_user SERVER bq_server;

-- Create Foreign Table
DROP FOREIGN TABLE IF EXISTS public.ext_stock_metadata;
CREATE FOREIGN TABLE public.ext_stock_metadata (
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
    project 'alloydb-whats-new',
    dataset 'cymbal_reference',
    table 'stock_metadata'
);

DROP FOREIGN TABLE IF EXISTS public.ext_sec_10k_iceberg;
CREATE FOREIGN TABLE public.ext_sec_10k_iceberg (
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
    project 'alloydb-whats-new',
    dataset 'cymbal_reference',
    table 'sec_10k_iceberg'
);

-- Reverse ETL setup
-- Create and Load Reverse ETL Tables
CREATE TABLE IF NOT exists retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
DROP TABLE IF EXISTS retl_company_concepts;
ALTER TABLE retl_company_concepts_staging RENAME TO retl_company_concepts;
SELECT COUNT(*) FROM retl_company_concepts;

CREATE TABLE IF NOT exists retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
DROP TABLE IF EXISTS retl_company_tickers;
ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;
SELECT COUNT(*) FROM retl_company_tickers;

-- Create index to support fast lookups of latest concept filings
CREATE INDEX idx_retl_concepts_partial 
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
    CREATE INDEX idx_retl_concepts_partial 
    ON public.retl_company_concepts (cik)
    WHERE fy = 2025 AND fp = 'FY';$$
);
