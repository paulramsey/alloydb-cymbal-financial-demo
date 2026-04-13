import pandas as pd
import os
import requests

def download_file(url, out_path):
    print(f"Downloading {url} to {out_path}...")
    try:
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with open(out_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print("Download complete.")
            return True
        else:
            print(f"Failed to download. Status code: {response.status_code}")
            return False
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return False

def main():
    years = list(range(2010, 2023))
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../risk_factors")
    os.makedirs(out_dir, exist_ok=True)
    
    temp_dir = "temp_hf_data"
    os.makedirs(temp_dir, exist_ok=True)
    
    for year in years:
        url = f"https://huggingface.co/datasets/jlohding/sp500-edgar-10k/resolve/main/data/{year}.parquet?download=true"
        local_parquet = os.path.join(temp_dir, f"{year}.parquet")
        
        if not os.path.exists(local_parquet):
            success = download_file(url, local_parquet)
            if not success:
                continue
                
        print(f"Processing {local_parquet}...")
        try:
            df = pd.read_parquet(local_parquet)
            print(f"DataFrame shape: {df.shape}")
            print(f"Columns: {df.columns.tolist()}")
            
            # Find text column
            text_col = None
            for col in ['item_1A', 'item_1', 'text', 'content', 'narrative']:
                if col in df.columns:
                    text_col = col
                    break
            
            if not text_col:
                # Fallback to largest text column
                for col in df.columns:
                    try:
                        if df[col].dtype == 'object' and df[col].astype(str).str.len().mean() > 1000:
                            text_col = col
                            break
                    except:
                        continue
                        
            if not text_col:
                print(f"Could not find text column in {year}.parquet")
                continue
                
            print(f"Using text column: {text_col}")
            
            # Find symbol column
            sym_col = 'symbol' if 'symbol' in df.columns else 'ticker'
            if sym_col not in df.columns:
                 sym_col = df.columns[0]
                 
            for index, row in df.iterrows():
                symbol = str(row.get(sym_col, f"doc_{index}"))
                text = str(row.get(text_col, ""))
                
                if text.strip():
                    clean_sym = "".join(x for x in symbol if x.isalnum())
                    filename = f"{clean_sym}_{year}_{index}.txt"
                    filepath = os.path.join(out_dir, filename)
                    
                    with open(filepath, "w") as f:
                        f.write(text)
                    
            print(f"Finished processing {year}.parquet")
            
        except Exception as e:
            print(f"Error processing {year}.parquet: {e}")

if __name__ == "__main__":
    main()
