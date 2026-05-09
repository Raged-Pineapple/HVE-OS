import urllib.request
import json

def fetch_json(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return []

print("Fetching Silver Tables...")
tables = fetch_json("http://localhost:8000/api/v1/silver/tables")

if not tables:
    print("No tables found.")
else:
    for table in tables:
        t_name = table.get("table_name")
        print(f"\nTable: {t_name}")
        snaps = fetch_json(f"http://localhost:8000/api/v1/iceberg/{t_name}/snapshots")
        if not snaps:
            print("  No snapshots.")
        else:
            for s in snaps:
                print(f"  - ID: {s.get('snapshot_id')} | Time: {s.get('timestamp_ms')} | Committed: {s.get('committed_at')}")
