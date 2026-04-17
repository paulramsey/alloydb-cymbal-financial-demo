-- Create index
CREATE INDEX IF NOT EXISTS idx_sec_chunks_rum ON public.sec_document_chunks USING rum (fts_document);
