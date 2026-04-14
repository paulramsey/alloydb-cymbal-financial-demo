SELECT 
    'users' AS table_name, 
    (SELECT COUNT(*) FROM users) AS imported_count, 
    2000 AS target_row_count
UNION ALL
SELECT 
    'mcc_codes', 
    (SELECT COUNT(*) FROM mcc_codes), 
    109
UNION ALL
SELECT 
    'transactions_25_26', 
    (SELECT COUNT(*) FROM transactions_25_26), 
    2678137
UNION ALL
SELECT 
    'fraud_labels', 
    (SELECT COUNT(*) FROM fraud_labels), 
    8914963
UNION ALL
SELECT 
    'cards', 
    (SELECT COUNT(*) FROM cards), 
    6146
UNION ALL
SELECT 
    'sec_document_chunks', 
    (SELECT COUNT(*) FROM sec_document_chunks), 
    3256048
UNION ALL
SELECT 
    'sec_to_iceberg_mapping', 
    (SELECT COUNT(*) FROM sec_to_iceberg_mapping), 
    885;