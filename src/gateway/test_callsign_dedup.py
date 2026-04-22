import os
import sys
import uuid
from datetime import datetime

# Add src and gateway to path
_src_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src"))
_gateway_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src", "gateway"))
for _d in [_src_dir, _gateway_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from Logic.graph_processor import get_graph_processor
from services import neo4j_service

def test_deduplication():
    processor = get_graph_processor()
    neo4j = neo4j_service.get_neo4j_service()
    
    # Manually attach service since we aren't running the background thread
    processor._neo4j = neo4j
    
    # Use a unique test callsign
    test_callsign = f"TEST{uuid.uuid4().hex[:4].upper()}"
    source_id = "test_flights"
    
    print(f"Testing deduplication for callsign: {test_callsign}")
    
    # 1. First observation
    row1 = {
        "_hve_id": str(uuid.uuid4()),
        "_source_id": source_id,
        "_ingest_ts": datetime.utcnow().isoformat(),
        "callsign": test_callsign,
        "latitude": 10.5,
        "longitude": 75.1,
        "icao24": "abc123"
    }
    
    print("Sending first row...")
    processor._process_row(row1)
    
    # 2. Second observation (same callsign, different data)
    row2 = {
        "_hve_id": str(uuid.uuid4()), # New row ID
        "_source_id": source_id,
        "_ingest_ts": datetime.utcnow().isoformat(),
        "callsign": test_callsign,
        "latitude": 11.0,
        "longitude": 76.0,
        "icao24": "abc123"
    }
    
    print("Sending second row (same callsign)...")
    processor._process_row(row2)
    
    # 3. Verify in Neo4j
    query = "MATCH (n:TestFlights { callsign: $callsign }) RETURN count(n) AS count, n.latitude AS lat"
    res = neo4j.execute_query(query, {"callsign": test_callsign})
    
    if res and res[0]['count'] == 1:
        print(f"SUCCESS: Only 1 node exists for {test_callsign}")
        if res[0]['lat'] == 11.0:
            print("SUCCESS: Node was updated with latest latitude (11.0)")
        else:
            print(f"FAILURE: Node has wrong latitude: {res[0]['lat']}")
    else:
        count = res[0]['count'] if res else 0
        print(f"FAILURE: Node count is {count} (expected 1)")

if __name__ == "__main__":
    test_deduplication()
