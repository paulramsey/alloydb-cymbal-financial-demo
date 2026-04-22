CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS google_ml_integration;
CREATE EXTENSION IF NOT EXISTS external_search_fdw;
CREATE EXTENSION IF NOT EXISTS bigquery_fdw;
CREATE EXTENSION IF NOT EXISTS rum;
CREATE EXTENSION IF NOT EXISTS alloydb_scann;
CREATE EXTENSION IF NOT EXISTS g_distributed_exec;
CREATE EXTENSION IF NOT EXISTS pg_hint_plan;

ALTER DATABASE postgres SET google_ml_integration.enable_preview_ai_functions = on;
