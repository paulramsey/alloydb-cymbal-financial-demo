from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import psycopg2
from psycopg2.extras import RealDictCursor
import textwrap
import asyncio
import random
import os

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "database": os.environ.get("DB_DATABASE", "postgres"),
    "user": os.environ.get("DB_USER", "postgres"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "port": int(os.environ.get("DB_PORT", 5432))
}

load_running = False
tqf_enabled = False
load_tasks = []
active_reads = 0
active_writes = 0
total_reads = 0
total_writes = 0
last_read_query = ""
last_write_query = ""

def db_worker(tqf_flag, run_read, run_write):
    global last_read_query, last_write_query
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    try:
        if tqf_flag:
            cur.execute("SET alloydb.enable_query_forwarding = ON;")
            cur.execute("SET alloydb.query_forwarding_startup_cost = 0.0;")
        else:
            cur.execute("SET alloydb.enable_query_forwarding = OFF;")
            
        if run_read:
            # Heavy Read
            random_letter = random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            random_limit = random.randint(5, 20)
            query = f"SELECT manager_name, SUM(value_usd) FROM ext_sec_13f_holdings WHERE manager_name LIKE '{random_letter}%' GROUP BY manager_name ORDER BY 2 DESC LIMIT {random_limit};"
            cur.execute(query)
            cur.fetchall()
            last_read_query = query
        
        if run_write:
            # Write
            ticker = random.choice(['AAPL', 'GOOGL', 'MSFT', 'AMZN'])
            shares = random.randint(1, 1000)
            price = float(random.uniform(50, 250))
            query = f"INSERT INTO simulated_trades (ticker, shares, price) VALUES ('{ticker}', {shares}, {price:.2f});"
            cur.execute("INSERT INTO simulated_trades (ticker, shares, price) VALUES (%s, %s, %s);", (ticker, shares, price))
            conn.commit()
            last_write_query = query
    finally:
        cur.close()
        conn.close()

async def generate_load_task(worker_id):
    global load_running, tqf_enabled, active_reads, active_writes
    while load_running:
        try:
            if random.random() < 0.7:
                run_read = True
                run_write = False
            else:
                run_read = False
                run_write = True
                
            try:
                if run_read: active_reads += 1
                if run_write: active_writes += 1
                
                await asyncio.to_thread(db_worker, tqf_enabled, run_read, run_write)
                
                # Increment cumulative counters
                global total_reads, total_writes
                if run_read: total_reads += 1
                if run_write: total_writes += 1
            finally:
                if run_read: active_reads -= 1
                if run_write: active_writes -= 1
        except Exception as e:
            print(f"Worker {worker_id} error: {e}")
            
        await asyncio.sleep(random.uniform(0.2, 0.8))

@app.get("/api/search")
def search(query: str, mode: str = "hybrid", vectorIndex: str = "scann", ftsIndex: str = "rum", reranker: str = "none", explain: bool = False):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    results = []
    executed_sql = ""
    
    try:
        params = ()
        fts_index_name = "idx_sec_chunks_rum" if ftsIndex == "rum" else "idx_sec_chunks_fts"
        fts_hint_type = "BitmapScan" if ftsIndex == "gin" else "IndexScan"
        fts_hint = f"/*+ {fts_hint_type}(sec_document_chunks {fts_index_name}) */"
        
        if ftsIndex == "rum":
            fts_score_expr = "(1 / (1 + (fts_document <=> plainto_tsquery('english', %s))))"
        else:
            fts_score_expr = "ts_rank(fts_document, plainto_tsquery('english', %s))"

        if mode == "fulltext":
            sql = f"""
            {fts_hint}
            SELECT ticker, accession_number, chunk_index, chunk_text,
                   {fts_score_expr} as score
            FROM sec_document_chunks
            WHERE fts_document @@ plainto_tsquery('english', %s)
            ORDER BY score DESC
            LIMIT 10;
            """
            params = (query, query)
            
        elif mode == "vector":
            if vectorIndex == "hnsw":
                sql = """
                WITH e AS (
                    SELECT ai.embedding('text-embedding-005', %s)::vector AS query_embedding
                ),
                vector_search AS (
                    SELECT
                      s.id, 
                      s.embedding_hnsw <=> e.query_embedding AS distance
                    FROM
                      sec_document_chunks s,
                      e
                    WHERE
                      s.embedding_hnsw <=> e.query_embedding < 0.5 
                    ORDER BY
                      distance
                    LIMIT 50
                )
                SELECT
                  (1 - vs.distance) AS score,
                  s.ticker,
                  s.accession_number,
                  s.chunk_index,
                  s.chunk_text
                FROM
                  vector_search vs
                  JOIN sec_document_chunks s ON vs.id = s.id
                ORDER BY
                  vs.distance
                LIMIT 10;
                """
            else:
                sql = """
                WITH e AS (
                    SELECT ai.embedding('gemini-embedding-001', %s)::vector AS query_embedding
                ),
                vector_search AS (
                    SELECT
                      s.id, 
                      s.embedding <=> e.query_embedding AS distance
                    FROM
                      sec_document_chunks s,
                      e
                    WHERE
                      s.embedding <=> e.query_embedding < 0.5 
                    ORDER BY
                      distance
                    LIMIT 50
                )
                SELECT
                  (1 - vs.distance) AS score,
                  s.ticker,
                  s.accession_number,
                  s.chunk_index,
                  s.chunk_text
                FROM
                  vector_search vs
                  JOIN sec_document_chunks s ON vs.id = s.id
                ORDER BY
                  vs.distance
                LIMIT 10;
                """
            params = (query,)
            
        elif mode == "hybrid":
            if reranker == "rrf":
                if vectorIndex == "hnsw":
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_hnsw)
                     */
                    WITH e AS (
                        SELECT ai.embedding('text-embedding-005', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, RANK() OVER (ORDER BY {fts_score_expr} DESC) AS rank
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 20
                    ),
                    vec AS (
                        SELECT id, RANK() OVER (ORDER BY embedding_hnsw <=> e.query_embedding) AS rank
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding_hnsw <=> e.query_embedding < 0.5
                        ORDER BY embedding_hnsw <=> e.query_embedding
                        LIMIT 20
                    ),
                    ranked AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0) AS combined_score,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY combined_score DESC
                        LIMIT 10
                    )
                    SELECT 
                        r.combined_score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        r.retrieval_method
                    FROM ranked r
                    JOIN sec_document_chunks s ON r.id = s.id
                    ORDER BY r.combined_score DESC;
                    """
                else:
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_scann)
                     */
                    WITH e AS (
                        SELECT ai.embedding('gemini-embedding-001', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, RANK() OVER (ORDER BY {fts_score_expr} DESC) AS rank
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 20
                    ),
                    vec AS (
                        SELECT id, RANK() OVER (ORDER BY embedding <=> e.query_embedding) AS rank
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding <=> e.query_embedding < 0.5
                        ORDER BY embedding <=> e.query_embedding
                        LIMIT 20
                    ),
                    ranked AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0) AS combined_score,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY combined_score DESC
                        LIMIT 10
                    )
                    SELECT 
                        r.combined_score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        r.retrieval_method
                    FROM ranked r
                    JOIN sec_document_chunks s ON r.id = s.id
                    ORDER BY r.combined_score DESC;
                    """
                params = (query, query, query)
            elif reranker == "vertex":
                if vectorIndex == "hnsw":
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_hnsw)
                     */
                    WITH e AS (
                        SELECT ai.embedding('text-embedding-005', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, RANK() OVER (ORDER BY {fts_score_expr} DESC) AS rank
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 100
                    ),
                    vec AS (
                        SELECT id, RANK() OVER (ORDER BY embedding_hnsw <=> e.query_embedding) AS rank
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding_hnsw <=> e.query_embedding < 0.5
                        ORDER BY embedding_hnsw <=> e.query_embedding
                        LIMIT 100
                    ),
                    hybrid_candidates AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0) AS rrf_score,
                            ROW_NUMBER() OVER (ORDER BY (COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0)) DESC) AS rank_id,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY rrf_score DESC
                        LIMIT 100
                    ),
                    reranked_results AS (
                        SELECT index, score
                        FROM ai.rank(
                            model_id => 'semantic-ranker-512',
                            search_string => %s,
                            documents => (SELECT ARRAY_AGG(s.chunk_text ORDER BY hc.rank_id) FROM hybrid_candidates hc JOIN sec_document_chunks s ON hc.id = s.id),
                            top_n => 10
                        )
                    )
                    SELECT 
                        r.score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        hc.retrieval_method
                    FROM reranked_results r
                    JOIN hybrid_candidates hc ON r.index = hc.rank_id
                    JOIN sec_document_chunks s ON hc.id = s.id
                    ORDER BY r.score DESC;
                    """
                    params = (query, query, query, query)
                else:
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_scann)
                     */
                    WITH e AS (
                        SELECT ai.embedding('gemini-embedding-001', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, RANK() OVER (ORDER BY {fts_score_expr} DESC) AS rank
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 100
                    ),
                    vec AS (
                        SELECT id, RANK() OVER (ORDER BY embedding <=> e.query_embedding) AS rank
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding <=> e.query_embedding < 0.5
                        ORDER BY embedding <=> e.query_embedding
                        LIMIT 100
                    ),
                    hybrid_candidates AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0) AS rrf_score,
                            ROW_NUMBER() OVER (ORDER BY (COALESCE(1.0 / (60 + vec.rank), 0.0) + COALESCE(1.0 / (60 + fts.rank), 0.0)) DESC) AS rank_id,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY rrf_score DESC
                        LIMIT 100
                    ),
                    reranked_results AS (
                        SELECT index, score
                        FROM ai.rank(
                            model_id => 'semantic-ranker-512',
                            search_string => %s,
                            documents => (SELECT ARRAY_AGG(s.chunk_text ORDER BY hc.rank_id) FROM hybrid_candidates hc JOIN sec_document_chunks s ON hc.id = s.id),
                            top_n => 10
                        )
                    )
                    SELECT 
                        r.score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        hc.retrieval_method
                    FROM reranked_results r
                    JOIN hybrid_candidates hc ON r.index = hc.rank_id
                    JOIN sec_document_chunks s ON hc.id = s.id
                    ORDER BY r.score DESC;
                    """
                    params = (query, query, query, query)
            else:
                if vectorIndex == "hnsw":
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_hnsw)
                     */
                    WITH e AS (
                        SELECT ai.embedding('text-embedding-005', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, {fts_score_expr} as score
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 20
                    ),
                    vec AS (
                        SELECT id, (embedding_hnsw <=> e.query_embedding) AS distance
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding_hnsw <=> e.query_embedding < 0.5
                        ORDER BY embedding_hnsw <=> e.query_embedding
                        LIMIT 20
                    ),
                    ranked AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(fts.score, 0) + COALESCE(1 - vec.distance, 0) AS combined_score,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY combined_score DESC
                        LIMIT 10
                    )
                    SELECT 
                        r.combined_score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        r.retrieval_method
                    FROM ranked r
                    JOIN sec_document_chunks s ON r.id = s.id
                    ORDER BY r.combined_score DESC;
                    """
                else:
                    sql = f"""
                    /*+
                        {fts_hint_type}(fts_table {fts_index_name})
                        IndexScan(vec_table idx_sec_chunks_scann)
                     */
                    WITH e AS (
                        SELECT ai.embedding('gemini-embedding-001', %s)::vector AS query_embedding
                    ),
                    fts AS (
                        SELECT id, {fts_score_expr} as score
                        FROM sec_document_chunks fts_table
                        WHERE fts_document @@ plainto_tsquery('english', %s)
                        LIMIT 20
                    ),
                    vec AS (
                        SELECT id, (embedding <=> e.query_embedding) AS distance
                        FROM sec_document_chunks vec_table, e
                        WHERE embedding <=> e.query_embedding < 0.5
                        ORDER BY embedding <=> e.query_embedding
                        LIMIT 20
                    ),
                    ranked AS (
                        SELECT 
                            COALESCE(fts.id, vec.id) AS id,
                            COALESCE(fts.score, 0) + COALESCE(1 - vec.distance, 0) AS combined_score,
                            CONCAT_WS('+', 
                                CASE WHEN vec.id IS NOT NULL THEN 'VECTOR' ELSE NULL END,
                                CASE WHEN fts.id IS NOT NULL THEN 'FTS' ELSE NULL END
                            ) AS retrieval_method
                        FROM fts
                        FULL OUTER JOIN vec ON fts.id = vec.id
                        ORDER BY combined_score DESC
                        LIMIT 10
                    )
                    SELECT 
                        r.combined_score AS score,
                        s.ticker,
                        s.accession_number,
                        s.chunk_index,
                        s.chunk_text,
                        r.retrieval_method
                    FROM ranked r
                    JOIN sec_document_chunks s ON r.id = s.id
                    ORDER BY r.combined_score DESC;
                    """
                params = (query, query, query)
            
        sql = textwrap.dedent(sql)
        if explain:
            sql = "EXPLAIN ANALYZE " + sql
            
        executed_sql = sql
        cur.execute(sql, params)
        
        if explain:
            plan_rows = cur.fetchall()
            explain_plan = "\n".join([list(row.values())[0] for row in plan_rows])
            return {"results": [], "sql": executed_sql, "explain_plan": explain_plan}
            
        results = cur.fetchall()
            
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()
        
    # Map to frontend structure
    mapped_results = []
    for r in results:
        # Determine type based on accession number (mock logic)
        doc_type = "Form 10-K"
        if r.get("accession_number") and "13f" in r["accession_number"].lower():
            doc_type = "Form 13F"
            
        score_val = r.get("score") or r.get("combined_score") or 0
        
        mapped_results.append({
            "id": r.get("id") or f"{r['ticker']}-{r['chunk_index']}",
            "ticker": r["ticker"],
            "type": doc_type,
            "text": r["chunk_text"],
            "score": round(float(score_val), 4),
            "accession_number": r.get("accession_number"),
            "chunk_index": r.get("chunk_index"),
            "retrieval_method": r.get("retrieval_method")
        })
        
    return {"results": mapped_results, "sql": executed_sql}

@app.get("/api/analyze-chunk")
def analyze_chunk(ticker: str, chunk_index: int, query: str):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        sql = """SELECT 
    ai.summarize(chunk_text) AS summary,
    ai.generate('Explain why the following text chunk is related to the search query: \n\nQuery: ' || %s || '\n\nChunk Text: ' || chunk_text) AS explanation
FROM sec_document_chunks
WHERE ticker = %s AND chunk_index = %s;"""
        
        cur.execute(sql, (query, ticker, chunk_index))
        res = cur.fetchone()
        
        display_sql = sql % (f"'{query}'", f"'{ticker}'", chunk_index)
        
        if res:
            return {
                "summary": res["summary"],
                "explanation": res["explanation"],
                "sql": display_sql
            }
        else:
            return {"error": "Chunk not found"}
            
    except Exception as e:
        print(f"Error in analyze-chunk: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/ticker-exposure")
def ticker_exposure(ticker: str):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Check if mapping exists
        cur.execute("SELECT 1 FROM sec_to_iceberg_mapping WHERE ticker = %s LIMIT 1", (ticker,))
        has_mapping = cur.fetchone() is not None
        
        sql = """SELECT manager_name, shares, value_usd 
FROM ext_sec_13f_holdings 
WHERE ticker = %s 
ORDER BY value_usd DESC 
LIMIT 5;"""
        
        cur.execute(sql, (ticker,))
        results = cur.fetchall()
        
        return {"results": results, "has_mapping": has_mapping}
        
    except Exception as e:
        print(f"Error in ticker-exposure: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/company-overview")
def company_overview(ticker: str):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        sql = """
        SELECT "Security_Name", 
               ai.generate('Provide a Company Overview for the following company, including its primary lines of business, location, and other relevant facts: ' || "Security_Name" || '(' || "Symbol" || ')') as overview
        FROM public.ext_stock_metadata 
        WHERE "Symbol" = %s;
        """
        
        cur.execute(sql, (ticker,))
        result = cur.fetchone()
        
        if not result:
            return {"error": "Ticker not found in metadata"}
            
        return result
        
    except Exception as e:
        print(f"Error in company-overview: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/lakehouse-search")
def lakehouse_search(ticker: str, explain: bool = False):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        is_semantic = " " in ticker or any(c.islower() for c in ticker)
        
        if not is_semantic:
            sql = """
            SELECT 
                "Symbol" as ticker,
                "Security_Name" as security_name,
                "iceberg_company_name" as iceberg_company,
                NULL::text as remote_item_1,
                f_1_day_return,
                date,
                f_40_day_return,
                f_100_day_return
            FROM ext_vw_stock_10k_holdings
            WHERE "Symbol" = %s
            ORDER BY date DESC
            LIMIT 5;
            """
            executed_sql = textwrap.dedent(sql) % f"'{ticker}'"
            if explain:
                sql = "EXPLAIN ANALYZE " + sql
            cur.execute(sql, (ticker,))
        else:
            sql = """
            WITH embedding AS (
              SELECT ai.embedding('gemini-embedding-001', %s)::vector AS search_embed
            ),
            vector_search AS (
              SELECT ticker, chunk_text 
              FROM sec_document_chunks 
              ORDER BY embedding <=> (SELECT search_embed FROM embedding)::vector 
              LIMIT 5
            ),
            company_financials AS (
              SELECT t.ticker, c.val as revenue, c.fy
              FROM public.ext_company_concepts c
              JOIN public.ext_company_tickers t ON c.cik = t.cik
              WHERE c.tag = 'Revenues' AND c.fp = 'FY'
            )
            SELECT 
              v.ticker,
              NULL::text as remote_item_1,
              f.revenue as f_1_day_return,
              f.fy::float8 as f_40_day_return,
              NULL::float8 as f_100_day_return,
              NULL::timestamp as date
            FROM vector_search v
            LEFT JOIN company_financials f ON v.ticker = f.ticker
            ORDER BY f.revenue DESC NULLS LAST;
            """
            executed_sql = textwrap.dedent(sql) % f"'{ticker}'"
            if explain:
                sql = "EXPLAIN ANALYZE " + sql
            cur.execute(sql, (ticker,))
        if explain:
            plan_rows = cur.fetchall()
            explain_plan = "\\n".join([list(row.values())[0] for row in plan_rows])
            return {"results": [], "sql": executed_sql, "explain_plan": explain_plan}
            
        results = cur.fetchall()
        
        return {"results": results, "sql": executed_sql}
        
    except Exception as e:
        print(f"Error in lakehouse-search: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/lakehouse-advanced-search")
def lakehouse_advanced_search(
    query: str,
    explain: bool = False,
    assets: str = None,
    liabilities: str = None,
    equity: str = None,
    cash: str = None,
    inventories: str = None,
    revenues: str = None,
    net_income: str = None,
    operating_income: str = None,
    gross_profit: str = None,
    use_reverse_etl: bool = False
):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        filters = []
        filter_map = {
            "assets": "f.assets",
            "liabilities": "f.liabilities",
            "equity": "f.equity",
            "cash": "f.cash",
            "inventories": "f.inventories",
            "revenues": "f.revenues",
            "net_income": "f.net_income",
            "operating_income": "f.operating_income",
            "gross_profit": "f.gross_profit"
        }
        
        provided = {
            "assets": assets,
            "liabilities": liabilities,
            "equity": equity,
            "cash": cash,
            "inventories": inventories,
            "revenues": revenues,
            "net_income": net_income,
            "operating_income": operating_income,
            "gross_profit": gross_profit
        }
        
        for key, val in provided.items():
            if not val or val.lower() == "none":
                continue
            col = filter_map[key]
            if val.lower() == "low":
                filters.append(f"{col} < 100000000")
            elif val.lower() == "medium":
                filters.append(f"{col} BETWEEN 100000000 AND 1000000000")
            elif val.lower() == "high":
                filters.append(f"{col} > 1000000000")
                
        where_clause = "WHERE " + " AND ".join(filters) if filters else "WHERE 1=1"
        
        concepts_table = "public.retl_company_concepts" if use_reverse_etl else "public.ext_company_concepts"
        tickers_table = "public.retl_company_tickers" if use_reverse_etl else "public.ext_company_tickers"
        
        sql = f"""
        WITH
          e AS (
            SELECT
              embedding ('gemini-embedding-001', %s)::vector AS query_embedding
          ),
          vector_search AS (
            SELECT
              p.id,
              p.embedding <=> e.query_embedding AS distance
            FROM
              sec_document_chunks p,
              e
            WHERE
              p.embedding <=> e.query_embedding < 0.5
            ORDER BY
              distance
            LIMIT
              50
          ),
          latest_financials AS (
            SELECT 
              t.ticker,
              MAX(CASE WHEN c.tag = 'Assets' THEN c.val END) as assets,
              MAX(CASE WHEN c.tag = 'Liabilities' THEN c.val END) as liabilities,
              MAX(CASE WHEN c.tag = 'StockholdersEquity' THEN c.val END) as equity,
              MAX(CASE WHEN c.tag = 'CashAndCashEquivalentsAtCarryingValue' THEN c.val END) as cash,
              MAX(CASE WHEN c.tag = 'Inventories' THEN c.val END) as inventories,
              MAX(CASE WHEN c.tag = 'Revenues' THEN c.val END) as revenues,
              MAX(CASE WHEN c.tag = 'NetIncomeLoss' THEN c.val END) as net_income,
              MAX(CASE WHEN c.tag = 'OperatingIncomeLoss' THEN c.val END) as operating_income,
              MAX(CASE WHEN c.tag = 'GrossProfit' THEN c.val END) as gross_profit,
              MAX(CASE WHEN c.tag = 'NetCashProvidedByUsedInOperatingActivities' THEN c.val END) as operating_cash_flow
            FROM {concepts_table} c
            JOIN {tickers_table} t ON c.cik = t.cik
            WHERE c.fy = 2025 AND c.fp = 'FY'
            GROUP BY t.ticker
          )
        SELECT 
          vs.distance,
          p.ticker,
          p.chunk_index,
          p.chunk_text as remote_item_1,
          f.assets,
          f.liabilities,
          f.equity,
          f.cash,
          f.inventories,
          f.revenues,
          f.net_income,
          f.operating_income,
          f.gross_profit,
          f.operating_cash_flow
        FROM vector_search vs
        JOIN sec_document_chunks p ON vs.id = p.id
        LEFT JOIN latest_financials f ON p.ticker = f.ticker
        {where_clause}
        ORDER BY vs.distance
        LIMIT 24;
        """
        
        import textwrap
        executed_sql = textwrap.dedent(sql) % f"'{query}'"
        if explain:
            sql = "EXPLAIN ANALYZE " + sql
            
        cur.execute(sql, (query,))
        
        if explain:
            plan_rows = cur.fetchall()
            explain_plan = "\\n".join([list(row.values())[0] for row in plan_rows])
            return {"results": [], "sql": executed_sql, "explain_plan": explain_plan}
            
        results = cur.fetchall()
        
        return {"results": results, "sql": executed_sql}
        
    except Exception as e:
        print(f"Error in lakehouse-advanced-search: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/lakehouse-ticker-details")
def lakehouse_ticker_details(ticker: str, date: str):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Query 1: Iceberg data filtered by ticker and date
        iceberg_sql = """
        SELECT * 
        FROM ext_vw_stock_10k_holdings
        WHERE "Symbol" = %s AND date = %s;
        """
        cur.execute(iceberg_sql, (ticker, date))
        iceberg_results = cur.fetchall()
        
        # Query 2: 13F data filtered by ticker
        holdings_sql = """
        SELECT manager_name, ticker, investment_discretion, title_of_class, SUM(shares) as shares, SUM(value_usd) as value_usd 
        FROM ext_sec_13f_holdings 
        WHERE ticker = %s
        GROUP BY manager_name, ticker, investment_discretion, title_of_class
        ORDER BY SUM(value_usd) DESC;
        """
        cur.execute(holdings_sql, (ticker,))
        holdings_results = cur.fetchall()
        
        return {
            "iceberg": iceberg_results,
            "holdings": holdings_results,
            "iceberg_sql": textwrap.dedent(iceberg_sql) % (f"'{ticker}'", f"'{date}'"),
            "holdings_sql": textwrap.dedent(holdings_sql) % f"'{ticker}'"
        }
        
    except Exception as e:
        print(f"Error in lakehouse-ticker-details: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/fraud-stream")
def fraud_stream():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("""
            SELECT t.id, t.client_id, t.amount, t.transaction_description, t.merchant_city, true as is_fraud
            FROM fraud_labels f
            JOIN transactions_25_26 t ON f.transaction_id = t.id
            WHERE f.is_fraud = true AND t.amount > 0
            LIMIT 15;
        """)
        fraud_txs = cur.fetchall()
        
        cur.execute("""
            SELECT t.id, t.client_id, t.amount, t.transaction_description, t.merchant_city, false as is_fraud
            FROM fraud_labels f
            JOIN transactions_25_26 t ON f.transaction_id = t.id
            WHERE f.is_fraud = false AND t.date::date = CURRENT_DATE
            LIMIT 100;
        """)
        non_fraud_txs = cur.fetchall()
        
        import datetime
        base_time = datetime.datetime.utcnow() - datetime.timedelta(hours=4)
        
        interleaved = []
        f_idx = 0
        nf_idx = 0
        tx_count = 0
        
        while nf_idx < len(non_fraud_txs):
            for _ in range(6):
                if nf_idx < len(non_fraud_txs):
                    tx = dict(non_fraud_txs[nf_idx])
                    tx_time = base_time + datetime.timedelta(minutes=tx_count * 2)
                    tx['date'] = tx_time.strftime('%Y-%m-%dT%H:%M:%SZ')
                    interleaved.append(tx)
                    nf_idx += 1
                    tx_count += 1
            
            if f_idx < len(fraud_txs):
                tx = dict(fraud_txs[f_idx])
                tx_time = base_time + datetime.timedelta(minutes=tx_count * 2)
                tx['date'] = tx_time.strftime('%Y-%m-%dT%H:%M:%SZ')
                interleaved.append(tx)
                f_idx += 1
                tx_count += 1
                
        return interleaved
        
    except Exception as e:
        print(f"Error in fraud-stream: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/fraud-detection")
def fraud_detection(client_id: int = 0, transaction_id: int = None):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        current_tx = None
        
        if transaction_id is not None:
            # Fetch specific transaction
            current_sql = """
            SELECT id, client_id, date, amount, transaction_description
            FROM transactions_25_26
            WHERE id = %s;
            """
            cur.execute(current_sql, (transaction_id,))
            current_tx = cur.fetchone()
            
            if not current_tx:
                return {"error": f"Transaction ID {transaction_id} not found."}
                
            client_id = current_tx['client_id']
        else:
            # Fetch the latest transaction for the client
            current_sql = """
            SELECT id, client_id, date, amount, transaction_description
            FROM transactions_25_26
            WHERE client_id = %s
            ORDER BY date DESC
            LIMIT 1;
            """
            cur.execute(current_sql, (client_id,))
            current_tx = cur.fetchone()
            
            if not current_tx:
                return {"error": f"No transactions found for client {client_id}."}
            
        
        # 2. Fetch 10 nearest neighbors in history using on-the-fly embedding
        history_sql = """
        WITH
          e AS (
            SELECT
              embedding ('text-embedding-005', %s)::vector AS query_embedding
          ),
          vector_search AS (
            SELECT
              t.id,
              t.embedding <=> e.query_embedding AS distance
            FROM
              transactions_25_26 t,
              e
            WHERE
              t.client_id = %s AND t.id != %s
            ORDER BY
              t.embedding <=> e.query_embedding ASC
            LIMIT
              10
          )
        SELECT
          vs.distance,
          t.id, t.date, t.amount, t.transaction_description,
          c.card_brand, c.card_type, c.card_on_dark_web, t.merchant_city, m.description as mcc_description
        FROM
          vector_search vs
          JOIN transactions_25_26 t ON vs.id = t.id
          JOIN cards c ON t.card_id = c.id
          JOIN mcc_codes m ON t.mcc = m.mcc
        ORDER BY
          vs.distance;
        """
        cur.execute(history_sql, (current_tx['transaction_description'], client_id, current_tx['id']))
        history = cur.fetchall()
        
        # Calculate average distance
        avg_distance = sum(tx['distance'] for tx in history) / len(history) if history else 0
        
        # Threshold for anomaly
        threshold = 0.011
        is_anomalous = avg_distance > threshold
        
        # Remove embedding from current_tx for JSON response (if it exists)
        if 'embedding' in current_tx:
            del current_tx['embedding']
        
        # Also remove embedding from history items (if they exist)
        for tx in history:
            if 'embedding' in tx:
                del tx['embedding']
        
        import textwrap
        
        # Safeguard string formatting for the response SQL display
        display_desc = current_tx['transaction_description'].replace("'", "''")
        
        return {
            "current_transaction": current_tx,
            "history": history,
            "avg_distance": avg_distance,
            "threshold": threshold,
            "is_anomalous": bool(is_anomalous),
            "current_sql": textwrap.dedent(current_sql) % (transaction_id if transaction_id is not None else client_id),
            "history_sql": textwrap.dedent(history_sql) % (f"'{display_desc}'", client_id, current_tx['id'])
        }
        
    except Exception as e:
        print(f"Error in fraud-detection: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/api/fraud-enhance")
def fraud_enhance(transaction_id: str):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Fetch transaction description
        cur.execute("SELECT transaction_description FROM transactions_25_26 WHERE id = %s", (transaction_id,))
        res = cur.fetchone()
        if not res:
            return {"error": "Transaction not found"}
            
        description = res['transaction_description']
        
        # Run AI questions using ai.if with an array of prompts
        prompts = [
            f"Is this transaction likely a 'card testing' attempt, characterized by a low monetary value at an online merchant or automated service, used by fraudsters to verify card validity? Transaction Description: {description}",
            f"Does the transaction amount seem disproportionately large or out of character when compared to the user's reported yearly income or credit score, suggesting potential account takeover? Transaction Description: {description}",
            f"Does the transaction amount exhibit suspicious patterns, such as being a perfectly round number or falling just below common detection thresholds, which might suggest structured fraud or money laundering? Transaction Description: {description}"
        ]
        
        sql = """
        SELECT ai.if(
          prompts => ARRAY[%s, %s, %s],
          model_id => 'gemini-3.1-flash-lite-preview'
        ) AS result;
        """
        
        import textwrap
        cur.execute(textwrap.dedent(sql), prompts)
        ai_res = cur.fetchone()
        
        if ai_res and ai_res['result']:
            verdicts = ai_res['result']
            
            def map_verdict(v):
                if v is True or v == 't' or v == 'Yes':
                    return 'Yes'
                return 'No'
                
            results = {
                "Q1": map_verdict(verdicts[0]) if len(verdicts) > 0 else "No",
                "Q2": map_verdict(verdicts[1]) if len(verdicts) > 1 else "No",
                "Q3": map_verdict(verdicts[2]) if len(verdicts) > 2 else "No",
                "prompts": {
                    "Q1": prompts[0],
                    "Q2": prompts[1],
                    "Q3": prompts[2]
                }
            }
            
            # Construct full SQL for display
            escaped_prompts = [p.replace("'", "''") for p in prompts]
            display_sql = """
            SELECT ai.if(
              prompts => ARRAY[
                '{}',
                '{}',
                '{}'
              ],
              model_id => 'gemini-3.1-flash-lite-preview'
            ) AS result;
            """.format(*escaped_prompts)
            
            results["sql"] = textwrap.dedent(display_sql)
            return results

        else:
            return {"error": "AI failed to generate response"}
            
    except Exception as e:
        print(f"Error in fraud-enhance: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()


@app.get("/api/tqf/start-load")
async def start_load():
    global load_running, load_tasks, total_reads, total_writes
    if not load_running:
        load_running = True
        total_reads = 0
        total_writes = 0
        
        # Ensure simulated_trades table exists
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simulated_trades (
                trade_id SERIAL PRIMARY KEY,
                ticker VARCHAR(10),
                shares INT,
                price DECIMAL(10,2),
                executed_at TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute("SELECT g_reset_poq_stats();")
        conn.commit()
        cur.close()
        conn.close()
        
        load_tasks = []
        for i in range(5): # Spawn 5 workers
            load_tasks.append(asyncio.create_task(generate_load_task(i)))
        return {"status": "Load started"}
    return {"status": "Load already running"}

@app.get("/api/tqf/stop-load")
async def stop_load():
    global load_running, load_tasks
    if load_running:
        load_running = False
        if load_tasks:
            for t in load_tasks:
                t.cancel()
            load_tasks = []
            

            
        return {"status": "Load stopped"}
    return {"status": "Load not running"}

@app.get("/api/tqf/toggle")
async def toggle_tqf(enabled: bool):
    global tqf_enabled
    tqf_enabled = enabled
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("SELECT g_reset_poq_stats();")
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Failed to reset stats on toggle: {e}")
    return {"tqf_enabled": tqf_enabled}

@app.get("/api/tqf/reset")
async def reset_tqf():
    global total_reads, total_writes, tqf_enabled
    total_reads = 0
    total_writes = 0
    tqf_enabled = False
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        # Reset stats
        cur.execute("SELECT g_reset_poq_stats();")
        
        # Drop and recreate table
        cur.execute("DROP TABLE IF EXISTS simulated_trades;")
        cur.execute("""
            CREATE TABLE simulated_trades (
                trade_id SERIAL PRIMARY KEY,
                ticker VARCHAR(10),
                shares INT,
                price DECIMAL(10,2),
                executed_at TIMESTAMP DEFAULT NOW()
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "Reset complete"}
    except Exception as e:
        print(f"Failed to reset: {e}")
        return {"status": "Reset failed", "error": str(e)}



@app.get("/api/tqf/stats")
def get_stats():
    global tqf_enabled, active_reads, active_writes, total_reads, total_writes, last_read_query, last_write_query
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Check if extension exists
        cur.execute("CREATE EXTENSION IF NOT EXISTS g_distributed_exec;")
        conn.commit()
        
        cur.execute("SELECT * FROM g$poq_stats;")
        results = cur.fetchall()
        
        cur.execute("SELECT count(*) FROM pg_stat_activity;")
        total_connections = cur.fetchone()['count']
        
        cur.execute("SELECT count(*) FROM pg_stat_activity WHERE state = 'active';")
        active_connections = cur.fetchone()['count']
            
        return {
            "stats": results,
            "total_connections": total_connections,
            "active_connections": active_connections,
            "active_reads": active_reads,
            "active_writes": active_writes,
            "total_reads": total_reads,
            "total_writes": total_writes,
            "last_read_query": last_read_query,
            "last_write_query": last_write_query
        }
        
    except Exception as e:
        print(f"Error in get_stats: {e}")
        return {"error": str(e)}
    finally:
        cur.close()
        conn.close()

app.mount("/", StaticFiles(directory="dist", html=True), name="static")
