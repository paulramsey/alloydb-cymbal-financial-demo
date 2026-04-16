CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_labels_is_fraud_true ON public.fraud_labels USING btree (transaction_id) WHERE (is_fraud = true);
