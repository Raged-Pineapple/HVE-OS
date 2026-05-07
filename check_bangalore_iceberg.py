import os
import sys
import json

# Add src and src/gateway to path
sys.path.insert(0, os.path.abspath("src"))
sys.path.insert(0, os.path.abspath(os.path.join("src", "gateway")))

from gateway.services import iceberg_service

def check_snapshots():
    source_id = "bangalore"
    print(f"Checking snapshots for {source_id}...")
    try:
        snapshots = iceberg_service.get_snapshots(source_id)
        print(f"Found {len(snapshots)} snapshots.")
        for s in snapshots:
            print(f"Snapshot ID: {s['snapshot_id']}, Timestamp: {s['timestamp_ms']}")
            
        if snapshots:
            latest = iceberg_service.scan_latest(source_id)
            print(f"\nLatest data row count: {latest.num_rows}")
            print(f"Schema: {latest.schema}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_snapshots()
