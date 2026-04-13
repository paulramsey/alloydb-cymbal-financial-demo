# Cymbal Investments Demo - Data Summary

This document summarizes the real-world datasets loaded into the Cymbal Investments demonstration environment, replacing all original synthetic data placeholders.

---

## 📋 Business & Reference Data

### **SEC Form 13F Holdings**
-   **Source:** [SEC Form 13F Data Sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets)
-   **Description:** Official quarterly reports listing the equity holdings of institutional managers with over $100M AUM.
-   **Structure:** TSV relational join (COVERPAGE & INFOTABLE).
-   **Usage Rights:** **Public Domain** (US Federal Government Work).
-   **Data Repair Note:** The raw TSV data lacks ticker symbols (only contains CUSIPs). The `ticker` column is backfilled using the OpenFIGI API via the `scripts/patch_openfigi.py` repair utility suite.
-   **Missing Tickers Note:** OpenFIGI only found matches for ~50% of the CUSIPs. Many instruments in 13F filings are options, corporate bonds, or non-traded entities that do not have standard stock tickers, leaving a significant number of rows without tickers.

-   **Example Query (AlloyDB psql):**
    ```sql
    -- Discover top manager holdings
    SELECT manager_name, ticker, shares, value_usd 
    FROM ext_sec_13f_holdings 
    WHERE manager_name LIKE '%BERKSHIRE HATHAWAY%' 
    ORDER BY value_usd DESC LIMIT 5;
    ```

### **Stock Market Metadata**
-   **Source:** [Kaggle: Stock Market Dataset (jacksoncrow)](https://www.kaggle.com/datasets/jacksoncrow/stock-market-dataset)
-   **Description:** Nasdaq direct directory listing symbols, company names, exchanges, and financial classifications.
-   **Volume:** **8,049 rows** loaded into BigQuery.
-   **Usage Rights:** Public market data listing. Suitable for reference in demonstration environments.
-   **Example Query (BigQuery Standard SQL):**
    ```sql
    -- List NASDAQ listed securities
    SELECT Symbol, Security_Name 
    FROM cymbal_reference.stock_metadata 
    WHERE Listing_Exchange = 'NASDAQ' LIMIT 5;
    ```

### **Historical Currency Exchange Rates**
-   **Source:** Fetched via Yahoo Finance (`yfinance`).
-   **Description:** 1-year historical daily rates (relative to USD) for the top 48 global currencies.
-   **Volume:** **12,382 rows** loaded into BigQuery.
-   **Usage Rights:** Publicly accessible historical pricing. Intended for demonstration and analysis.
-   **Example Query (BigQuery Standard SQL):**
    ```sql
    -- Get latest exchange rates relative to USD
    SELECT Date, From_Currency, Rate 
    FROM cymbal_reference.currency_exchange_rates 
    WHERE To_Currency = 'USD' ORDER BY Date DESC LIMIT 5;
    ```

### **TradingView Advanced Chart Widget**
-   **Source:** [TradingView Widgets](https://www.tradingview.com/widgets/)
-   **Description:** Inline modal chart displaying market data for selected tickers within the search results.
-   **Usage Rights:** **Free to use** with attribution. TradingView allows embedding their widgets for free on public and private sites, making them suitable for demonstration purposes, provided the branding is not removed.

### **SEC 10-K Historical Analytics (BigLake Iceberg)**
-   **Source:** Aggregated S&P 500 financial features derived from [Hugging Face (jlohding/sp500-edgar-10k)](https://huggingface.co/datasets/jlohding/sp500-edgar-10k).
-   **Description:** Cleaned tabular representation of SEC 10-K filings (Years 2010-2022) with text items and financial return features, managed in Apache Iceberg format directly over Cloud Storage.
-   **Volume:** **6,282 rows** supporting ACID-compliant warehouse analytics and time travel.
-   **Usage Rights:** Derived from public government SEC archives; source dataset licensed under **MIT License**.
-   **Example Query (BigQuery Standard SQL):**
    ```sql
    -- Locate positive return outliers
    SELECT company, date, f_1_day_return 
    FROM cymbal_reference.sec_10k_iceberg 
    WHERE f_1_day_return > 0.10 LIMIT 5;
    ```

---

## 🔍 Text & Document Data (Vector Search)

### **SEC 10-K Risk Factors**
-   **Source:** Derived from [Hugging Face (jlohding/sp500-edgar-10k)](https://huggingface.co/datasets/jlohding/sp500-edgar-10k)
-   **Description:** Raw text extracted from corporate annual reports (Item 1A: Risk Factors) for S&P 500 companies (Years 2010-2022).
-   **Volume:** **~6,240 individual text files** uploaded to the GCS bucket.
-   **Usage Rights:** The source dataset is licensed under the **MIT License**. The underlying narrative text is derived from public SEC filings.
-   **Example Usage (Python GCS Client):**
    ```python
    from google.cloud import storage
    client = storage.Client()
    bucket = client.bucket("<YOUR_GCS_BUCKET_NAME>")
    blob = bucket.blob("sec_10k_text/2022/AAPL.txt")
    print(blob.download_as_text()[:500])
    ```

### **SEC 10-K Chunked Vectors (AlloyDB)**
-   **Source:** Fetched directly from SEC EDGAR (raw submissions staged in GCS) and chunked via `scripts/chunk_and_embed.py`.
-   **Description:** Entire 10-K document corpuses (narrative items and disclosures) split into semantic fragments with 3072-dimension vector embeddings.
-   **Chunking Strategy:** Clean text (extracted from raw HTML filings by BeautifulSoup) split using a fixed character window: **1500 character window size** with a **300 character overlap**.
-   **Volume:** **3,276,634 chunks** covering **510 companies** (S&P 500 cohort) derived from the most recent 10-K filings (Years 2025/2026).
-   **Target Table:** `public.sec_document_chunks`
-   **Structure:** Relational layout utilizing the `vector` type extension.
-   **Deduplication Note:** Potential duplicate chunks should be removed by keeping the row with the minimal `id` for each `(accession_number, chunk_index)` tuple.
-   **Example Usage (AlloyDB pgvector):**
    ```sql
    -- Perform Vector Similarity Search (HNSW or flat)
    -- Assumes a generated query embedding [0.01, -0.02, ...]
    SELECT ticker, chunk_index, chunk_text 
    FROM sec_document_chunks 
    ORDER BY embedding <=> '[0.01, -0.02, ...]'::vector 
    LIMIT 3;
    ```


### **SEC EDGAR Company Facts**
-   **Source:** [SEC EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
-   **Description:** Historical company facts and disclosures containing deeply nested structures flattened into a relational format.
-   **Volume:** Processed from local JSON files into `cymbal_reference.company_facts`.
-   **Usage Rights:** Public Domain (SEC public data).

### **SEC EDGAR Company Tickers**
-   **Source:** [SEC Company Tickers JSON](https://www.sec.gov/files/company_tickers.json)
-   **Description:** Mapping of CIKs to Ticker symbols for all publicly traded companies.
-   **Volume:** ~10,400 rows loaded into `cymbal_reference.company_tickers`.
-   **Usage Rights:** Public Domain.

### **SEC EDGAR Company Concepts**
-   **Source:** [SEC EDGAR XBRL Company Concept REST API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
-   **Description:** Core fundamental accounting concepts (e.g., Assets, Revenues) fetched dynamically via REST API for tickers matching `stock_metadata`.
-   **Volume:** Filtered to 10 core fundamental metrics for ~3,750 companies, loaded into `cymbal_reference.company_concepts`.
-   **Usage Rights:** Public Domain.

### **Reverse ETL Tables (AlloyDB)**
-   **Description:** Replicated versions of BigQuery EDGAR concept and ticker tables brought closer to the application for faster execution.
-   **Tables:** `retl_company_concepts`, `retl_company_tickers`
-   **Usage Rights:** Public Domain.
-   **DDL:**
    ```sql
    CREATE TABLE IF NOT exists retl_company_concepts_staging AS (SELECT * FROM ext_company_concepts);
    DROP TABLE IF EXISTS retl_company_concepts;
    ALTER TABLE retl_company_concepts_staging RENAME TO retl_company_concepts;
    SELECT COUNT(*) FROM retl_company_concepts;

    CREATE TABLE IF NOT exists retl_company_tickers_staging AS (SELECT * FROM ext_company_tickers);
    DROP TABLE IF EXISTS retl_company_tickers;
    ALTER TABLE retl_company_tickers_staging RENAME TO retl_company_tickers;
    SELECT COUNT(*) FROM retl_company_tickers;
    ```

---

> [!IMPORTANT]
> All raw data files (`data/*.zip`, `data/*.csv`, `data/risk_factors/*.txt`) and temporary processing caches (`temp_hf_data/`) have been added to `.gitignore` to prevent repository bloat and comply with best practices for infrastructure repositories.
