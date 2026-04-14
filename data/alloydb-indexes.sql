--- Indexes for table fraud_labels
CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_labels_is_fraud_true ON public.fraud_labels USING btree (transaction_id) WHERE (is_fraud = true);

-- Indexes for table transactions_25_26
CREATE INDEX IF NOT EXISTS idx_transactions_25_26_scann ON public.transactions_25_26 USING scann (embedding cosine) WITH (mode='AUTO');

-- Indexes for table sec_document_chunks
CREATE INDEX IF NOT EXISTS idx_sec_chunks_fts ON public.sec_document_chunks USING gin (fts_document);
CREATE INDEX IF NOT EXISTS idx_sec_chunks_rum ON public.sec_document_chunks USING rum (fts_document);
CREATE INDEX IF NOT EXISTS idx_sec_chunks_scann ON public.sec_document_chunks USING scann (embedding cosine) WITH (mode='AUTO');
CREATE INDEX IF NOT EXISTS idx_sec_chunks_hnsw ON public.sec_document_chunks USING hnsw (embedding_hnsw vector_cosine_ops) WITH (m='16', ef_construction='64');
