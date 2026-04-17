CREATE INDEX IF NOT EXISTS idx_sec_chunks_scann ON public.sec_document_chunks USING scann (embedding cosine) WITH (mode='AUTO');
