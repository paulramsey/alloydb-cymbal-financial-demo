import sys
import os
import pandas as pd
import glob

def clean_column_name(name):
    if name[0].isdigit():
        return f"f_{name}"
    return name

def clean_parquet(source_dir, target_dir):
    os.makedirs(target_dir, exist_ok=True)
    parquet_files = glob.glob(os.path.join(source_dir, "*.parquet"))
    
    if not parquet_files:
        print(f"No parquet files found in {source_dir}")
        return

    for file_path in parquet_files:
        basename = os.path.basename(file_path)
        target_path = os.path.join(target_dir, basename)
        print(f"Processing {basename}...")
        
        df = pd.read_parquet(file_path)
        
        # Rename columns that start with numbers
        new_columns = {col: clean_column_name(col) for col in df.columns}
        df = df.rename(columns=new_columns)
        
        # Verify
        bad_cols = [col for col in df.columns if col[0].isdigit()]
        if bad_cols:
             print(f"Warning: {basename} still has invalid columns: {bad_cols}")
        
        df.to_parquet(target_path, index=False)
        print(f"Saved cleaned file to {target_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/clean_parquet.py <SOURCE_DIR> <TARGET_DIR>")
        sys.exit(1)
        
    source = sys.argv[1]
    target = sys.argv[2]
    clean_parquet(source, target)
