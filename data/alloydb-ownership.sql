-- Reassign ownership from alloydbsuperuser to postgres
ALTER TABLE public.fraud_labels OWNER TO postgres;
ALTER TABLE public.cards OWNER TO postgres;
ALTER TABLE public.mcc_codes OWNER TO postgres;
ALTER TABLE public.transactions_25_26 OWNER TO postgres;
ALTER TABLE public.users OWNER TO postgres;
ALTER TABLE public.sec_document_chunks OWNER TO postgres;
ALTER TABLE public.sec_to_iceberg_mapping OWNER TO postgres;
ALTER SERVER "bq_server" OWNER TO postgres;
ALTER FOREIGN TABLE public.ext_stock_metadata OWNER TO postgres;
ALTER FOREIGN TABLE public.ext_sec_10k_iceberg OWNER TO postgres;
ALTER FOREIGN TABLE public.ext_company_concepts OWNER TO postgres;
ALTER FOREIGN TABLE public.ext_company_tickers OWNER TO postgres;
ALTER FOREIGN TABLE public.ext_sec_13f_holdings OWNER TO postgres;
ALTER TABLE public.retl_company_concepts OWNER TO postgres;
ALTER TABLE public.retl_company_tickers OWNER TO postgres;
