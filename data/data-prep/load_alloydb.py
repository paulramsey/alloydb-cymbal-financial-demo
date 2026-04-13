import os
import sys
import psycopg2
import requests

# AlloyDB Connection Parameters (should be passed or read from env/terraform output)
# For now, we will use environment variables or hardcoded for the demo if safe.
# We will use variables that the user can set, or read from terraform outputs if we run in a context where we can parse them.

DB_HOST = os.environ.get("ALLOYDB_IP")
DB_PASSWORD = os.environ.get("ALLOYDB_PASSWORD")
DB_NAME = os.environ.get("ALLOYDB_DATABASE", os.environ.get("DB_DATABASE", "postgres"))
DB_USER = os.environ.get("ALLOYDB_USER", os.environ.get("DB_USER", "postgres"))

def connect():
    if not DB_HOST:
        print("Error: ALLOYDB_IP environment variable not set.", file=sys.stderr)
        sys.exit(1)
    
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD
        )
        return conn
    except Exception as e:
        print(f"Error connecting to AlloyDB: {e}", file=sys.stderr)
        sys.exit(1)

def create_schema(conn):
    with conn.cursor() as cur:
        # Create table for 13F holdings
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sec_13f_holdings (
                id SERIAL PRIMARY KEY,
                manager_name TEXT NOT NULL,
                ticker TEXT,
                cusip TEXT,
                shares BIGINT,
                value_usd NUMERIC,
                put_call TEXT,
                investment_discretion TEXT,
                title_of_class TEXT,
                period_of_report DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        # Alter table to add columns if table existed previously without them
        cur.execute("ALTER TABLE sec_13f_holdings ADD COLUMN IF NOT EXISTS put_call TEXT;")
        cur.execute("ALTER TABLE sec_13f_holdings ADD COLUMN IF NOT EXISTS investment_discretion TEXT;")
        cur.execute("ALTER TABLE sec_13f_holdings ADD COLUMN IF NOT EXISTS title_of_class TEXT;")
        # Create index on ticker for search
        cur.execute("CREATE INDEX IF NOT EXISTS idx_13f_ticker ON sec_13f_holdings(ticker);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_13f_manager ON sec_13f_holdings(manager_name);")
        conn.commit()
    print("Schema created or verified.")

def process_zip():
    import zipfile
    
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    zip_files = [f for f in os.listdir(data_dir) if f.endswith(".zip")] if os.path.exists(data_dir) else []
    
    if not zip_files:
        print("\n" + "="*60)
        print("ERROR: No SEC 13F ZIP file found in 'data/' directory.")
        print("Please download the raw ZIP from SEC.gov:")
        print("  https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01dec2025-28feb2026_form13f.zip")
        print("Place the ZIP file in the 'data/' directory and run this script again.")
        print("="*60 + "\n")
        sys.exit(1)
    
    zip_path = os.path.join(data_dir, zip_files[0])
    print(f"Found ZIP file: {zip_path}")
    
    extract_dir = os.path.join(data_dir, "extracted_13f")
    os.makedirs(extract_dir, exist_ok=True)
    
    print(f"Extracting to {extract_dir}...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_dir)
    
    extracted_files = os.listdir(extract_dir)
    print(f"Extracted files: {extracted_files}")
    
    # Check for the TSV format found in recent SEC downloads
    if "INFOTABLE.tsv" in extracted_files and "COVERPAGE.tsv" in extracted_files:
        print("Detected standard SEC TSV format (INFOTABLE.tsv, COVERPAGE.tsv).")
        return extract_dir, "standard_sec"
    
    for f in extracted_files:
        if f.endswith(".jsonl") or f.endswith(".csv"):
            return os.path.join(extract_dir, f), "single_file"
            
    print("\n" + "="*60)
    print("ERROR: Unrecognized format in ZIP.")
    print(f"Extracted files: {extracted_files}")
    print("Please ensure the ZIP contains standard SEC dataset files (INFOTABLE.tsv) or a JSONL/CSV file.")
    print("="*60 + "\n")
    sys.exit(1)

def load_data(conn, info):
    path, format_type = info
    import csv
    with conn.cursor() as cur:
        if format_type == "single_file":
            import json
            print(f"Loading from single file {path}...")
            if path.endswith(".jsonl"):
                with open(path, 'r') as f:
                    for line in f:
                        data = json.loads(line)
                        cur.execute("""
                            INSERT INTO sec_13f_holdings (manager_name, ticker, shares, value_usd, period_of_report, put_call, investment_discretion, title_of_class)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """, (data['manager_name'], data.get('ticker'), data.get('shares'), data.get('value_usd'), data.get('period_of_report'), data.get('put_call'), data.get('investment_discretion'), data.get('title_of_class')))
            elif path.endswith(".csv"):
                with open(path, 'r') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        cur.execute("""
                            INSERT INTO sec_13f_holdings (manager_name, ticker, shares, value_usd, period_of_report, put_call, investment_discretion, title_of_class)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """, (row['manager_name'], row.get('ticker'), row.get('shares'), row.get('value_usd'), row.get('period_of_report'), row.get('put_call'), row.get('investment_discretion'), row.get('title_of_class')))
        elif format_type == "standard_sec":
            print("Parsing standard SEC TSV format (INFOTABLE.tsv + COVERPAGE.tsv)...")
            coverpage_path = os.path.join(path, "COVERPAGE.tsv")
            infotable_path = os.path.join(path, "INFOTABLE.tsv")
            
            # 1. Load COVERPAGE into dict
            manager_map = {}
            with open(coverpage_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f, delimiter='\t')
                for row in reader:
                    manager_map[row['ACCESSION_NUMBER']] = row.get('FILINGMANAGER_NAME') or row.get('FILING_MANAGER_NAME') or "Unknown Manager"
            
            print(f"Loaded {len(manager_map)} managers from COVERPAGE.tsv")
            
            # 0. Load fallback ticker mappings from CSV
            ticker_map = {}
            mapping_csv = "scratch/ticker_mappings.csv"
            if os.path.exists(mapping_csv):
                print("Loading fallback ticker mappings from CSV...")
                with open(mapping_csv, 'r', encoding='utf-8') as f:
                    m_reader = csv.DictReader(f)
                    for m_row in m_reader:
                        ticker_map[(m_row['manager_name'], m_row['cusip'])] = m_row['ticker']
                print(f"Loaded {len(ticker_map)} ticker mappings.")

            # 2. Iterate INFOTABLE and insert
            print("Streaming INFOTABLE.tsv...")
            from psycopg2.extras import execute_values
            
            batch_size = 5000
            batch = []
            
            with open(infotable_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f, delimiter='\t')
                
                # Check column names
                fields = reader.fieldnames
                print(f"INFOTABLE Columns: {fields}")
                
                for row in reader:
                    acc_num = row['ACCESSION_NUMBER']
                    manager = manager_map.get(acc_num, "Unknown Manager")
                    
                    cusip = row.get('CUSIP')
                    ticker = ticker_map.get((manager, cusip))
                    shares = row.get('SSHPRNAMT')
                    value = row.get('VALUE')
                    put_call = row.get('PUTCALL')
                    investment_discretion = row.get('INVESTMENTDISCRETION')
                    title_of_class = row.get('TITLEOFCLASS')
                    
                    try:
                        shares = int(float(shares)) if shares else None
                    except:
                        shares = None
                    try:
                        value = float(value) if value else None
                    except:
                        value = None
                        
                    batch.append((manager, ticker, cusip, shares, value, put_call, investment_discretion, title_of_class))
                    
                    if len(batch) >= batch_size:
                        execute_values(cur, """
                            INSERT INTO sec_13f_holdings (manager_name, ticker, cusip, shares, value_usd, put_call, investment_discretion, title_of_class)
                            VALUES %s
                        """, batch)
                        conn.commit()
                        batch = []
                        print(".", end="", flush=True)
            
            if batch:
                execute_values(cur, """
                    INSERT INTO sec_13f_holdings (manager_name, ticker, cusip, shares, value_usd, put_call, investment_discretion, title_of_class)
                    VALUES %s
                """, batch)
                conn.commit()
            print("\nDone parsing INFOTABLE.tsv")
            
        conn.commit()
    print("Data load process finished (or halted if unimplemented).")

def main():
    conn = connect()
    create_schema(conn)
    info = process_zip()
    load_data(conn, info)
    conn.close()

if __name__ == "__main__":
    main()
