CHECKPOINT;
CREATE INDEX IF NOT EXISTS idx_transactions_25_26_scann ON public.transactions_25_26 USING scann (embedding cosine) WITH (mode='AUTO');
