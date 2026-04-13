import os
import json
import urllib.request
import pandas as pd
from google.cloud import bigquery

URL = "https://www.sec.gov/files/company_tickers.json"
PROJECT_ID = os.environ.get("PROJECT_ID")
DATASET_ID = "cymbal_reference"

def main():
    client = bigquery.Client(project=PROJECT_ID)
    tickers_table = client.dataset(DATASET_ID).table("company_tickers")
    
    print("Fetching mappings from SEC REST endpoint...")
    req = urllib.request.Request(URL, headers={"User-Agent": "Antigravity admin@cymbal.com"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        
    print(f"Retrieved mappings. Reformatting dictionary arrays...")
    rows = []
    for key, val in data.items():
        rows.append({
            "cik": int(val.get("cik_str")),
            "ticker": val.get("ticker"),
            "title": val.get("title")
        })
        
    df = pd.DataFrame(rows)
    
    schema = [
        bigquery.SchemaField("cik", "INTEGER"),
        bigquery.SchemaField("ticker", "STRING"),
        bigquery.SchemaField("title", "STRING"),
    ]
    
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_TRUNCATE",
        schema=schema,
    )
    
    print(f"Flushing {len(df)} distinct mappings iteratively iterative to company_tickers BigQuery relational table...")
    client.load_table_from_dataframe(df, tickers_table, job_config=job_config).result()
    print("Company tickers loaded securely and successfully!")

if __name__ == "__main__":
    main()
