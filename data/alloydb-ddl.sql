-- DDL for table fraud_labels
CREATE TABLE IF NOT EXISTS fraud_labels (
  transaction_id bigint NOT NULL PRIMARY KEY,
  is_fraud boolean NOT NULL
);

-- DDL for table cards
CREATE TABLE IF NOT EXISTS cards (
  id bigint NOT NULL PRIMARY KEY,
  client_id integer,
  card_brand character varying,
  card_type character varying,
  card_number character varying,
  expires character varying,
  cvv character varying,
  has_chip boolean,
  num_cards_issued integer,
  credit_limit money,
  acct_open_date date,
  year_pin_last_changed integer,
  card_on_dark_web boolean
);

-- DDL for table mcc_codes
CREATE TABLE IF NOT EXISTS mcc_codes (
  mcc smallint NOT NULL PRIMARY KEY,
  description character varying NOT NULL
);

-- DDL for table transactions_25_26
CREATE TABLE IF NOT EXISTS transactions_25_26 (
  id bigint NOT NULL PRIMARY KEY,
  date timestamp without time zone,
  client_id integer,
  card_id integer,
  amount numeric,
  use_chip character varying,
  merchant_id integer,
  merchant_city character varying,
  merchant_state character varying,
  zip character varying,
  mcc integer,
  errors text,
  transaction_description text,
  embedding vector (768),
  embedding_model text
);

-- DDL for table users
CREATE TABLE IF NOT EXISTS users (
  id bigint NOT NULL PRIMARY KEY,
  current_age integer,
  retirement_age integer,
  birth_year integer,
  birth_month integer,
  gender character varying,
  address character varying,
  latitude numeric,
  longitude numeric,
  per_capita_income money,
  yearly_income money,
  total_debt money,
  credit_score integer,
  num_credit_cards integer
);

-- DDL for table sec_document_chunks
CREATE TABLE IF NOT EXISTS sec_document_chunks (
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ticker character varying,
  accession_number character varying,
  chunk_index integer,
  chunk_text text,
  embedding vector (3072),
  embedding_model text,
  embedding_hnsw vector (768),
  embedding_hnsw_model text,
  fts_document tsvector
);

-- DDL for table sec_to_iceberg_mapping
CREATE TABLE IF NOT EXISTS sec_to_iceberg_mapping (
  ticker character varying,
  security_name text,
  iceberg_company text
);

