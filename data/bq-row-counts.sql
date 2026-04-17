-- Row count validation for BigQuery tables
-- Syntax similar to alloydb-row-counts.sql
-- Target row counts are set to NULL as they are not provided in the source.

SELECT 
    'stock_metadata' AS table_name, 
    (SELECT COUNT(*) FROM `cymbal_reference.stock_metadata`) AS imported_count, 
    8204 AS target_row_count
UNION ALL
SELECT 
    'company_concepts', 
    (SELECT COUNT(*) FROM `cymbal_reference.company_concepts`), 
    3362134
UNION ALL
SELECT 
    'company_facts', 
    (SELECT COUNT(*) FROM `cymbal_reference.company_facts`), 
    121791605
UNION ALL
SELECT 
    'company_tickers', 
    (SELECT COUNT(*) FROM `cymbal_reference.company_tickers`), 
    10426
UNION ALL
SELECT 
    'currency_exchange_rates', 
    (SELECT COUNT(*) FROM `cymbal_reference.currency_exchange_rates`), 
    12382
UNION ALL
SELECT 
    'sec_10k_iceberg', 
    (SELECT COUNT(*) FROM `cymbal_reference.sec_10k_iceberg`), 
    6282
UNION ALL
SELECT 
    'sec_13f_holdings', 
    (SELECT COUNT(*) FROM `cymbal_reference.sec_13f_holdings`), 
    3473209
UNION ALL
SELECT 
    'vw_stock_10k_holdings', 
    (SELECT COUNT(*) FROM `cymbal_reference.vw_stock_10k_holdings`), 
    5488;
