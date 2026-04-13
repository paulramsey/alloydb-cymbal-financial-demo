import os
import sys
import time
import json
import requests
import psycopg2
from psycopg2.extras import execute_values

DB_HOST = os.environ.get("ALLOYDB_IP", "34.136.5.146")
DB_PASSWORD = os.environ.get("ALLOYDB_PASSWORD")
DB_NAME = os.environ.get("ALLOYDB_DATABASE", os.environ.get("DB_DATABASE", "postgres"))
DB_USER = os.environ.get("ALLOYDB_USER", os.environ.get("DB_USER", "postgres"))

OPENFIGI_KEY = os.environ.get("OPENFIGI_API_KEY")
OPENFIGI_URL = "https://api.openfigi.com/v3/mapping"

BATCH_SIZE = 10 # OpenFIGI max batch size for unkeyed requests
RATE_LIMIT_SLEEP = 1.0 # default sleep between batches if rate limited or unkeyed

def connect():
    if not DB_HOST:
        print("Error: ALLOYDB_IP environment variable not set.", file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD)

def get_unique_cusips(conn):
    with conn.cursor() as cur:
        # We only need CUSIPs where ticker is null or empty
        cur.execute("SELECT DISTINCT cusip FROM sec_13f_holdings WHERE ticker IS NULL OR ticker = '';")
        rows = cur.fetchall()
        return [r[0] for r in rows if r[0] and len(r[0]) >= 8] # CUSIPs are typically 8 or 9 chars

def update_tickers(conn, updates):
    """updates is a list of tuples (ticker, cusip)"""
    with conn.cursor() as cur:
        # We update by CUSIP. Note that multiple rows might have the same CUSIP.
        # execute_values is faster than individual updates if we use a temp table or batch.
        # Individual updates in a loop might be slow if many updates.
        # Let's use individual updates for simplicity first, or batch if possible.
        # But UPDATE iterates. Batch update is tricky in psycopg2 without temp table.
        # Let's just run them in a loop, but commit at the end.
        for ticker, cusip in updates:
            cur.execute("UPDATE sec_13f_holdings SET ticker = %s WHERE cusip = %s;", (ticker, cusip))
        conn.commit()

def fetch_figi_batch(cusips):
    payload = [{"idType": "ID_CUSIP", "idValue": c} for c in cusips]
    headers = {"Content-Type": "application/json"}
    if OPENFIGI_KEY:
        headers["X-OPENFIGI-APIKEY"] = OPENFIGI_KEY

    try:
        response = requests.post(OPENFIGI_URL, headers=headers, data=json.dumps(payload), timeout=30)
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 429:
            print(f"\nRate limited (429). Sleeping for 5s...", file=sys.stderr)
            time.sleep(5)
            return None
        else:
            print(f"\nAPI Error: {response.status_code} - {response.text}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"\nRequest failed: {e}", file=sys.stderr)
        return None

def main():
    conn = connect()
    cusips = get_unique_cusips(conn)
    print(f"Found {len(cusips)} unique CUSIPs lacking tickers.")

    if not cusips:
        print("Done. No missing tickers to repair.")
        conn.close()
        return

    updates = []
    processed = 0
    success_count = 0

    print("Iterating mappings with OpenFIGI...")
    for i in range(0, len(cusips), BATCH_SIZE):
        batch = cusips[i:i + BATCH_SIZE]
        print(f"\rMapping Batch {i//BATCH_SIZE + 1}/{(len(cusips)-1)//BATCH_SIZE + 1} ({len(batch)} jobs)...", end="", flush=True)

        results = fetch_figi_batch(batch)
        time.sleep(RATE_LIMIT_SLEEP) # Respect rate limits

        if not results:
            continue

        for idx, result in enumerate(results):
            current_cusip = batch[idx]
            if 'data' in result:
                # Find the best ticker. Often there are multiple entries if listed on multiple exchanges.
                # We prefer US exchanges or just the first one.
                # Kaggle reference data uses standard symbols like 'AAPL'.
                # Let's find one with a ticker.
                best_ticker = None
                for entry in result['data']:
                    ticker = entry.get('ticker')
                    if ticker:
                        # Strip exchange suffixes if any (e.g. AAPL UW -> AAPL)
                        # OpenFIGI ticker might be just AAPL or AAPL UW depending on lookup.
                        # Kaggle Symbol directory uses plain tickers.
                        # Let's use the ticker as provided, or strip if space.
                        best_ticker = ticker.split()[0]
                        break
                if best_ticker:
                    updates.append((best_ticker, current_cusip))
                    success_count += 1

        processed += len(batch)

        # Periodically commit updates to avoid massive memory accumulation or lost work
        if len(updates) >= 500:
            print(f"\nCommitting {len(updates)} matched ticker sweeps...", end="", flush=True)
            update_tickers(conn, updates)
            updates = []
            print("OK", flush=True)

    # Final sweep
    if updates:
        print(f"\nCommitting final {len(updates)} matched ticket sweeps...", end="", flush=True)
        update_tickers(conn, updates)
        print("OK", flush=True)

    print(f"\nFinished. Processed {processed} CUSIPs, matched {success_count} authentic tickers.")
    conn.close()

if __name__ == "__main__":
    main()
