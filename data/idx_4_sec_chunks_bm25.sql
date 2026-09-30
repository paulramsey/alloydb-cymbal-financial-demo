-- Create BM25 index on chunk_text
CREATE INDEX IF NOT EXISTS idx_sec_chunks_bm25 ON public.sec_document_chunks USING bm25 (chunk_text) WITH (text_config = 'english');

