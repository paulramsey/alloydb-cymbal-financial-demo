CHECKPOINT;
-- Patch for RUM index
-- DELETE FROM sec_document_chunks WHERE id IN (55955,55956,55957,51088,51089);
-- Create index
CREATE INDEX IF NOT EXISTS idx_sec_chunks_rum ON public.sec_document_chunks USING rum (fts_document);
