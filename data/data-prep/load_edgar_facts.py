import os
import json
import pandas as pd
from google.cloud import bigquery
from google.api_core.exceptions import GoogleAPIError

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../companyfacts")
PROJECT_ID = os.environ.get("PROJECT_ID", os.environ.get("GCP_PROJECT_ID"))
DATASET_ID = "cymbal_reference"

CHUNK_SIZE = 100000  # Flush after 100,000 fact rows to avoid memory blowups

def iter_json_files(directory):
    for entry in os.scandir(directory):
        if entry.is_file() and entry.name.endswith('.json'):
            yield entry.path

def main():
    client = bigquery.Client(project=PROJECT_ID)
    
    companies_table = client.dataset(DATASET_ID).table("companies")
    facts_table = client.dataset(DATASET_ID).table("company_facts")
    
    print("Dropping existing tables if they exist...")
    client.delete_table(companies_table, not_found_ok=True)
    client.delete_table(facts_table, not_found_ok=True)
    
    fact_schema = [
        bigquery.SchemaField("cik", "INTEGER"),
        bigquery.SchemaField("taxonomy", "STRING"),
        bigquery.SchemaField("fact_name", "STRING"),
        bigquery.SchemaField("label", "STRING"),
        bigquery.SchemaField("description", "STRING"),
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

    comp_schema = [
        bigquery.SchemaField("cik", "INTEGER"),
        bigquery.SchemaField("entity_name", "STRING"),
    ]
    
    fact_job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=fact_schema,
    )
    
    comp_job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND",
        schema=comp_schema,
    )
    
    facts_buffer = []
    companies_buffer = []
    loaded_ciks = set()
    
    def flush_facts(buf):
        if not buf: return
        df = pd.DataFrame(buf)
        # Format dates
        for col in ['start_date', 'end_date', 'filed']:
            df[col] = pd.to_datetime(df[col], errors='coerce')
            # Filter out invalid years
            df.loc[df[col].dt.year < 1900, col] = pd.NaT
            df.loc[df[col].dt.year > 2100, col] = pd.NaT
            df[col] = df[col].dt.strftime('%Y-%m-%d')
            df[col] = df[col].replace('NaT', None)
        # val column as float64
        df['val'] = pd.to_numeric(df['val'], errors='coerce')
        df['fy'] = pd.to_numeric(df['fy'], errors='coerce').astype('Int64')
        print(f"Flushing {len(df)} rows to company_facts...")
        client.load_table_from_dataframe(df, facts_table, job_config=fact_job_config).result()
        
    def flush_companies(buf):
        if not buf: return
        df = pd.DataFrame(buf)
        print(f"Flushing {len(df)} rows to companies...")
        client.load_table_from_dataframe(df, companies_table, job_config=comp_job_config).result()

    TEST_LIMIT = int(os.environ.get("TEST_LIMIT", "0"))

    print("Beginning JSON extraction loops...")
    for i, path in enumerate(iter_json_files(DATA_DIR)):
        if TEST_LIMIT > 0 and i >= TEST_LIMIT:
            print(f"Hit TEST_LIMIT of {TEST_LIMIT} files. Stopping.")
            break
        if i > 0 and i % 500 == 0:
            print(f"Processed {i} files...")
        try:
            with open(path, 'r') as jf:
                data = json.load(jf)
        except Exception as e:
            print(f"Error reading {path}: {e}")
            continue
            
        cik = data.get("cik")
        entityName = data.get("entityName")
        if cik is None:
            continue
        cik = int(cik)
            
        if cik not in loaded_ciks:
            companies_buffer.append({"cik": cik, "entity_name": entityName})
            loaded_ciks.add(cik)
            
        facts = data.get("facts", {})
        for namespace, taxonomy_facts in facts.items():
            for fact_name, fact_data in taxonomy_facts.items():
                label = fact_data.get("label")
                description = fact_data.get("description")
                units = fact_data.get("units", {})
                for unit, entries in units.items():
                    for entry in entries:
                        facts_buffer.append({
                            "cik": cik,
                            "taxonomy": namespace,
                            "fact_name": fact_name,
                            "label": label,
                            "description": description,
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
                        
                        if len(facts_buffer) >= CHUNK_SIZE:
                            flush_facts(facts_buffer)
                            facts_buffer = []
                            
        if len(companies_buffer) >= 1000:
            flush_companies(companies_buffer)
            companies_buffer = []

    # Final flushes
    flush_facts(facts_buffer)
    flush_companies(companies_buffer)
    print("Load completed successfully!")

if __name__ == "__main__":
    main()
