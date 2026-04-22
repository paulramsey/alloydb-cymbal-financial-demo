## Overview

This demo showcases how AlloyDB combines the best of Google innovation with PostgreSQL for high-performance financial and AI workloads. You will walk through four main features:
1.  **Transparent Query Forwarding (TQF)**: Automatic rerouting of expensive read queries to the read pool.
2.  **Lakehouse Federation**: Direct querying of BigQuery and Iceberg data from AlloyDB.
3.  **Hybrid Search**: Combining keyword precision with semantic vector search.
4.  **Fraud Detection**: Real-time high-velocity vector search combined with Gemini reasoning.

---

## Prerequisites

Ensure the demo application is running and accessible. (This guide assumes you've completed the setup instructions in the main [README](../README.md).)

---

## Step-by-Step Guide

### 1. Transparent Query Forwarding (TQF)

This feature shows how AlloyDB manages high-frequency write traffic while offloading heavy read queries without application changes.

**Steps:**
1.  Navigate to the **TQF Interface** in the demo application.
2.  Locate the **Load Generator** settings.
3.  Click **Start Load Generator** to simulate market open traffic (mix of 30% Writes and 70% Reads).
    *   *Initial State*: With TQF disabled, observe that **100%** of the traffic pressure hits the Primary Instance.
4.  Toggle the switch to **Enable TQF**.

**Expected Outcome:**
*   You will see the read transaction load actively begin to shift away from the Primary Instance.
*   The read transactions will be redirected to the **Read Pool**.

> AlloyDB handles replication up to 25x faster than standard PostgreSQL, supporting read-after-write consistency so applications don't read stale data.

---

### 2. Lakehouse Federation

This section demonstrates querying federated data across BigQuery and Google Cloud Lakehouse through a unified interface.

**Steps:**
1.  Navigate to the **Lakehouse** interface.
2.  In the search bar, type in a semantic query like: `Geopolitical instability and manufacturing relocation`.
3.  Click **Search** to view matching text chunks from indexed 10K filings.
4.  Expand the section labeled **"Show Lakehouse Filters"**.
5.  Apply filters such as high revenue or specific assets (this performs a live join against BigQuery data).
6.  To compare against past filings, locate a listed security (like `CDNS`) and click **"Prev 10K's"**.

**Expected Outcome:**
*   Search results show semantic relevance beyond exact keywords.
*   The interface instantly displays data derived by combining AlloyDB vector data and BigQuery analytical data through pushdown queries.
*   Clicking "Prev 10K's" reads external Parquet data directly from the Lakehouse via a seamless query.

---

### 3. Hybrid Search

Compare standard keyword searches with state-of-the-art semantic and hybrid search capabilities.

**Steps:**
1.  Open the **Hybrid Search** interface.
2.  Perform a standard **Full-Text Search** for the term: `Exposure to Middle East shipping`.
    *   *Observe*: Only a few (or zero) exact keyword matches may return.
3.  Toggle the search type to **Vector Search** using the same phrase.
    *   *Observe*: Many more conceptually relevant results are returned due to ScaNN's sub-second semantic search power.
4.  Select **Hybrid Search** to combine both mechanisms.
5.  Click the **Gemini** icon next to the result to see reasoning.
6.  Click a ticker in the result set to see recent performance of the stock. 
7.  Click `Explore Lakehouse` to pivot over to the Lakehouse view and do a deeper dive on this stock. 
    > NOTE: If you don't see the `Explore Lakehouse` button, that's because there's no data in the Lakehouse for this stock. Try another stock from the results.

**Expected Outcome:**
*   Hybrid search merges precision and depth seamlessly.
*   Using built-in AI functions like `ai.summarize` generates a concise narrative of risks or overviews for the selected securities without custom external pipelines.

---

### 4. Fraud Detection

Demonstrate high-velocity, real-time fraud monitoring by leveraging embeddings and AI reasoning logic.

**Steps:**
1.  Open the **Fraud Detection** interface. You will see a live streaming graph/list of incoming transactions.
2.  Observe a flagged transaction on the live stream. Click on it to review details.
3.  Find the slider or input for the **Vector Distance Threshold**. Experiment with these threshold values:
    *   Set to `0.021` (initial default).
    *   Set to `0.011` (reduces false negatives but increases false positives).
    *   Set to `0.031` (increases missed fraud).
4.  Reset the threshold back to `0.021`.
5.  Click `Use Example`, and select the second transaction (transaction ID `10777802`) designated as a false negative (fraudulent but below the current detection distance).
6.  Click the action button labeled **"Enhance with AI.IF()"**. Notice that ai.if() will execute a Gemini-based semantic reasoning step to determine if the transaction is fraudulent.

**Expected Outcome:**
*   Initial vector-based metrics change dynamically with standard distance adjustments.
*   Applying the `ai.if()` function queries Gemini using natural language prompts regarding user spending patterns. This should successfully flag the difficult transaction, showing a boost in model recall.

---

## Wrap-up

### Product Insights
*   **Unified Access**: AlloyDB acts as a high-speed inference engine and unified access layer across live transactions and historical data lakes.
*   **Performance**: Features like ScaNN vector search and TQF deliver production-grade performance at scale without complex architecture changes.
*   **AI Power**: Native AI functions bring Google Gemini's capabilities directly into SQL queries, drastically reducing development time.

### Next Steps
*   **Try Different Queries**: Explore the search interfaces by entering your own custom search strings and filtering criteria to test the speed and accuracy.
*   **Build Your Own**: Use the design patterns shown here -— such as real-time fraud detection and hybrid search —- to build intelligent, data-rich applications in your own environment.
