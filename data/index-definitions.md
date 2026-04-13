# Index Definitions for Hybrid Search

These are the index definitions used for the `sec_document_chunks` table to support advanced hybrid search scenarios.

### 0. Prerequisites (Extensions)
Before creating these indexes, ensure the following extensions are enabled in your database:

```sql
-- Required for AI integration
CREATE EXTENSION IF NOT EXISTS google_ml_integration;

-- Required for RUM index
CREATE EXTENSION IF NOT EXISTS rum;

-- Required for HNSW vector search
CREATE EXTENSION IF NOT EXISTS vector;

-- Required for ScaNN vector search
CREATE EXTENSION IF NOT EXISTS alloydb_scann;

-- Required for index hints
CREATE EXTENSION IF NOT EXISTS pg_hint_plan;
```

---

### 1. Full-Text Search Indexes

#### Native GIN Index
Standard inverted index for full-text search.
```sql
CREATE INDEX idx_sec_chunks_fts ON sec_document_chunks USING gin(fts_document);
```

#### RUM Index
Advanced inverted index with positional information for faster ranking and proximity search.
```sql
CREATE INDEX idx_sec_chunks_rum ON sec_document_chunks USING rum(fts_document rum_tsvector_ops);
```

> NOTE: Can use other RUM index operators as well, such as `rum_tsvector_hash_ops`, `rum_tsvector_addon_ops, TIMESTAMP_COLUMN`, `rum_anyarray_ops`, `rum_int4_ops`, etc. depending on your use case. See [the docs](https://docs.cloud.google.com/alloydb/docs/ai/create-rum-index) for more details.

---

### 2. Vector Search Indexes

#### ScaNN Index
High-performance tree-quantization index for approximate nearest neighbor search.
```sql
CREATE INDEX idx_sec_chunks_scann ON sec_document_chunks
USING scann (embedding cosine)
WITH (mode = 'AUTO');
```

> [!NOTE]
> **Troubleshooting Memory Limits for ScaNN**
> If you encounter an error like: `Expected sample size X exceeds maintenance work memory Y`, you need to increase `maintenance_work_mem` for the session.
> The error message will explicitly state the required memory (e.g., `expected maintenance work memory is 7814400 KB`).
>
> **Solution:** Scale it up in your active session before execution:
> ```sql
> SET maintenance_work_mem = '8GB';
> ```

#### HNSW Index
Hierarchical Navigable Small World graph index for high-recall vector search.
```sql
CREATE INDEX idx_sec_chunks_hnsw ON sec_document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

> [!WARNING]
> **Dimension Limit:** HNSW indexes in `pgvector` (and AlloyDB) have a hard limit of **2000 dimensions**.
> Since our `embedding` column uses 3072 dimensions, this command will fail with: `ERROR: column cannot have more than 2000 dimensions for hnsw index`.
> Use **ScaNN** instead for high-dimensional vectors.

---

### Columnar Engine Acceleration (Optional)
If `google_columnar_engine.enable_index_caching` is enabled, these indexes can be added to the columnar engine for further acceleration.

```sql
-- Example for ScaNN
SELECT google_columnar_engine_add_index(index => 'idx_sec_chunks_scann');

-- Example for HNSW
SELECT google_columnar_engine_add_index(index => 'idx_sec_chunks_hnsw');
```
