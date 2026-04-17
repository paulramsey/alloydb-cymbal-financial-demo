CHECKPOINT;
CREATE INDEX IF NOT EXISTS idx_sec_chunks_fts ON public.sec_document_chunks USING gin (fts_document);
