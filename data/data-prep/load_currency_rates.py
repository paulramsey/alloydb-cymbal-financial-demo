import yfinance as yf
import pandas as pd
import os
from google.cloud import bigquery
from google.api_core.exceptions import GoogleAPIError

# Currencies vs USD. Top 50 approximate list.
CURRENCIES = [
    "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD", "SEK",
    "KRW", "SGD", "NOK", "MXN", "INR", "RUB", "ZAR", "TRY", "BRL", "TWD",
    "DKK", "PLN", "THB", "IDR", "HUF", "CZK", "ILS", "CLP", "PHP", "AED",
    "COP", "SAR", "MYR", "RON", "PEN", "BHD", "KWD", "BND", "DOP",
    "EGP", "ISK", "JOD", "LKR", "MAD", "OMR", "QAR", "UAH", "VND"
]

def main():
    project_id = os.environ.get("PROJECT_ID", os.environ.get("GCP_PROJECT_ID"))
    dataset_id = "cymbal_reference"
    table_id = "currency_exchange_rates"
    
    print(f"Fetching currency data for {len(CURRENCIES)} currencies...")
    
    all_data = []
    
    for cur in CURRENCIES:
        ticker = f"{cur}USD=X"
        print(f"Fetching {ticker}...")
        try:
            t = yf.Ticker(ticker)
            df = t.history(period="1y")
            if not df.empty:
                # We need Date, From_Currency, To_Currency, Rate
                # df index is Date
                df = df.reset_index()
                df['From_Currency'] = cur
                df['To_Currency'] = "USD"
                # If Close is missing, try Open. If both missing, skip.
                if 'Close' in df.columns:
                    df['Rate'] = df['Close']
                elif 'Open' in df.columns:
                    df['Rate'] = df['Open']
                else:
                    print(f"No Close or Open rate found for {ticker}")
                    continue
                    
                # Select columns
                df = df[['Date', 'From_Currency', 'To_Currency', 'Rate']]
                all_data.append(df)
            else:
                print(f"No data for {ticker}")
        except Exception as e:
            print(f"Error fetching {ticker}: {e}")

    if not all_data:
        print("No currency data fetched. Exiting.")
        return

    # Combine all data
    final_df = pd.concat(all_data, ignore_index=True)
    print(f"Total rows to load: {len(final_df)}")

    # Initialize BigQuery client
    client = bigquery.Client(project=project_id)
    table_ref = client.dataset(dataset_id).table(table_id)

    print(f"Dropping existing table {dataset_id}.{table_id} if exists...")
    client.delete_table(table_ref, not_found_ok=True)

    # Configure job
    job_config = bigquery.LoadJobConfig(
        write_disposition="WRITE_TRUNCATE", # Overwrite if exists
        source_format=bigquery.SourceFormat.PARQUET if hasattr(bigquery.SourceFormat, 'PARQUET') else bigquery.SourceFormat.CSV, # BigQuery client can handle DataFrames via Parquet or Arrow serialization automatically
        time_partitioning=bigquery.TimePartitioning(field="Date")
    )

    print(f"Loading data to {dataset_id}.{table_id}...")
    try:
        # load_table_from_dataframe is very efficient and handles types!
        job = client.load_table_from_dataframe(final_df, table_ref, job_config=job_config)
        job.result() # Wait for job to complete
        print(f"Loaded {job.output_rows} rows into {dataset_id}.{table_id}.")
    except GoogleAPIError as e:
        print(f"BigQuery API Error: {e}")
    except Exception as e:
        print(f"Error loading to BigQuery: {e}")

if __name__ == "__main__":
    main()
