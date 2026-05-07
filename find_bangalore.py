import os
import sys

# Add src to path
sys.path.insert(0, os.path.abspath("src"))

from gateway.services import db_service

def find_bangalore():
    with db_service.get_cursor() as cur:
        # Search in source_registry
        print("Searching in source_registry...")
        cur.execute("SELECT * FROM source_registry WHERE source_id ILIKE '%bangalore%'")
        sources = cur.fetchall()
        for s in sources:
            print(f"Source: {s}")

        # Search in silver_registry
        print("\nSearching in silver_registry...")
        cur.execute("SELECT * FROM silver_registry WHERE table_name ILIKE '%bangalore%' OR source_id ILIKE '%bangalore%'")
        silver = cur.fetchall()
        for t in silver:
            print(f"Silver Table: {t}")

if __name__ == "__main__":
    find_bangalore()
