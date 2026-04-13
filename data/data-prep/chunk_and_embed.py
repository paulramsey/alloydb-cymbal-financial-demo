import os
import subprocess
import psycopg2
from bs4 import BeautifulSoup

BUCKET = os.environ.get("GCS_BUCKET_NAME")
DB_HOST = os.environ.get("ALLOYDB_IP", os.environ.get("DB_HOST"))
DB_USER = os.environ.get("ALLOYDB_USER", os.environ.get("DB_USER", "postgres"))
DB_PASS = os.environ.get("ALLOYDB_PASSWORD", os.environ.get("DB_PASSWORD"))
DB_NAME = os.environ.get("ALLOYDB_DATABASE", os.environ.get("ALLOYDB_DATABASE", "postgres"))

def get_file_list():
    """Recursively list all full-submission.txt folders footprints in GCS."""
    cmd = ["gcloud", "storage", "ls", "-R", f"gs://{BUCKET}/sec-raw/"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error listing bucket: {result.stderr}")
        return []
        
    files = []
    for line in result.stdout.split('\n'):
        if line.endswith('full-submission.txt'):
            files.append(line)
    return files

def parse_metadata(url):
    """Extract ticker and accession from gcs path URI wrapper.
    Format: gs://.../sec-raw/TICKER/10-K/ACCESSION/full-submission.txt
    """
    parts = url.replace(f"gs://{BUCKET}/sec-raw/", "").split('/')
    if len(parts) >= 4:
        return parts[0], parts[2]
    return "UNKNOWN", "UNKNOWN"

def chunk_text(text, window=1500, overlap=300):
    """Iterative fixed block segmenting iteration."""
    step = window - overlap
    chunks = []
    for i in range(0, len(text), step):
        chunks.append(text[i:i + window])
    return chunks

def main():
    files = get_file_list()
    print(f"Discovered {len(files)} landed document fingerprints in GCS staging.")
    
    conn = psycopg2.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME)
    cursor = conn.cursor()
    
    for idx, file_url in enumerate(files):
        ticker, accession = parse_metadata(file_url)
        
        # Skip already processed accessions to make script resumable
        cursor.execute("SELECT 1 FROM sec_document_chunks WHERE accession_number = %s LIMIT 1", (accession,))
        if cursor.fetchone():
            print(f"Skipping {accession} (Already processed)")
            continue
            
        print(f"[{idx+1}/{len(files)}] Processing {ticker} (Acc: {accession})...")
        
        # Stream blob fragment
        cat_result = subprocess.run(["gcloud", "storage", "cat", file_url], capture_output=True, text=True)
        if cat_result.returncode != 0:
            print(f"Failed to fetch {file_url}")
            continue
            
        # Strip soup
        soup = BeautifulSoup(cat_result.stdout, 'lxml')
        clean_text = soup.get_text(separator=' ', strip=True)
        
        # Segment sharding
        chunks = chunk_text(clean_text)
        print(f"  Generated {len(chunks)} shards.")
        
        # Hydrate Ledger
        for c_idx, chunk in enumerate(chunks):
            cursor.execute(
                "INSERT INTO sec_document_chunks (ticker, accession_number, chunk_index, chunk_text) VALUES (%s, %s, %s, %s)",
                (ticker, accession, c_idx, chunk)
            )
        conn.commit()
        

    cursor.close()
    conn.close()
    print("Wholesale extraction loop expansion complete! 🚀")

if __name__ == "__main__":
    main()
