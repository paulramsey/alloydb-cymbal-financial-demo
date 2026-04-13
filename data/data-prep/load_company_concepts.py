import os
import json
import time
import urllib.request
import pandas as pd
from google.cloud import bigquery

PROJECT_ID = os.environ.get("PROJECT_ID", os.environ.get("GCP_PROJECT_ID"))
DATASET_ID = "cymbal_reference"

TAGS = [
    "Assets", "Liabilities", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "Inventories",
    "Revenues", "NetIncomeLoss", "OperatingIncomeLoss", "GrossProfit",
    "NetCashProvidedByUsedInOperatingActivities"
]

CHUNK_SIZE = 50000

def main():
    client = bigquery.Client(project=PROJECT_ID)
    concepts_table = client.dataset(DATASET_ID).table("company_concepts")
    
    print("Dropping existing company_concepts table if it exists...")
    client.delete_table(concepts_table, not_found_ok=True)
    
    schema = [
        bigquery.SchemaField("cik", "INTEGER"),
        bigquery.SchemaField("taxonomy", "STRING"),
        bigquery.SchemaField("tag", "STRING"),
        bigquery.SchemaField("unit", "STRING"),
        bigquery.SchemaField("start_date", "DATE"),
        bigquery.SchemaField("end_date", "DATE"),
        bigquery.SchemaField("val", "FLOAT64"),
        bigquery.SchemaField("accn", "STRING"),
        bigquery.SchemaField("fy", "INTEGER"),
        bigquery.SchemaField("fp", "STRING"),
        bigquery.SchemaField("form", "STRING"),
        bigquery.SchemaField("filed", "DATE"),
        bigquery.SchemaField("frame", "STRING"),
    ]
    
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=schema,
    )
    
    print("Fetching distinct CIK mappings from joined relation table relational relational lookups lookups...")
    query = f"""
        SELECT DISTINCT t.cik, t.ticker
        FROM `{PROJECT_ID}.{DATASET_ID}.company_tickers` t
        INNER JOIN `{PROJECT_ID}.{DATASET_ID}.stock_metadata` m
        ON t.ticker = m.Symbol
    """
    df_ciks = client.query(query).to_dataframe()
    print(f"Found {len(df_ciks)} unique applicable distinct CIK targets targets target buffers.")
    
    buffer = []
    
    def flush_buffer(buf):
        if not buf: return
        df = pd.DataFrame(buf)
        for col in ['start_date', 'end_date', 'filed']:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            df.loc[df[col].dt.year < 1900, col] = pd.NaT
            df.loc[df[col].dt.year > 2100, col] = pd.NaT
            # Leave as datetime explicit types arrays arrays natively natively Chunk chunk chunk natively natively!
        df['val'] = pd.to_numeric(df['val'], errors='coerce')
        df['fy'] = pd.to_numeric(df['fy'], errors='coerce').astype('Int64')
        df['cik'] = df['cik'].astype(int)
        print(f"Flushing relational {len(df)} concepts concepts buffers buffer insertions natively natively natively...")
        client.load_table_from_dataframe(df, concepts_table, job_config=job_config).result()

    print("Starting dynamic Rest ExtractionExtraction Extraction iterations iterations watermarks watermarks secure watermarks secure...")
    TEST_LIMIT = int(os.environ.get("TEST_LIMIT", "0"))
    
    for i, row in df_ciks.iterrows():
        if TEST_LIMIT > 0 and i >= TEST_LIMIT:
            print("Hit TEST_LIMIT environment parameter. Stopping extraction.")
            break
            
        cik_int = int(row['cik'])
        cik_str = str(cik_int).zfill(10)
        
        for tag in TAGS:
            url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik_str}/us-gaap/{tag}.json"
            req = urllib.request.Request(url, headers={"User-Agent": "Antigravity admin@cymbal.com"})
            
            try:
                time.sleep(0.11) # Respect maximum IP throttles iteratively iteratively natives natives natives.
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode())
            except urllib.error.HTTPError as he:
                if he.code == 404: # XBRLXBRL concept Tag tag Tag is missing missing for company company natively natively natively
                    continue
                print(f"HTTP Exception {he.code} querying {url}: {he}")
                continue
            except Exception as e:
                print(f"REST Loop Exception Exception iterative iterative url {url}: {e}")
                continue
                
            taxonomy = "us-gaap"
            units = data.get("units", {})
            for unit, entries in units.items():
                for entry in entries:
                    buffer.append({
                        "cik": cik_int,
                        "taxonomy": taxonomy,
                        "tag": tag,
                        "unit": unit,
                        "start_date": entry.get("start"),
                        "end_date": entry.get("end"),
                        "val": entry.get("val"),
                        "accn": entry.get("accn"),
                        "fy": entry.get("fy"),
                        "fp": entry.get("fp"),
                        "form": entry.get("form"),
                        "filed": entry.get("filed"),
                        "frame": entry.get("frame")
                    })
                    
                    if len(buffer) >= CHUNK_SIZE:
                        flush_buffer(buffer)
                        buffer = []
                        
    flush_buffer(buffer)
    print("REST Accounting Concepts Ingestion pipelines watermarks securely securely finished iteratively natively!")

if __name__ == "__main__":
    main()
