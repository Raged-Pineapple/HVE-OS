"""Quick E2E test script for HVE-OS Phase 1"""
import requests
import json
import time

BASE = "http://127.0.0.1:8000"

def test_health():
    r = requests.get(f"{BASE}/health")
    print("=== HEALTH ===")
    print(json.dumps(r.json(), indent=2))
    assert r.json()["status"] == "healthy"

def test_stream():
    print("\n=== STREAM INGEST ===")
    r = requests.post(f"{BASE}/api/v1/ingest/stream", json={
        "source_id": "test_sensor",
        "data": {"temperature": 25.3, "humidity": 60, "location": "hangar_a"}
    })
    print(f"Status: {r.status_code}")
    print(json.dumps(r.json(), indent=2))
    assert r.status_code == 202

def test_upload_static():
    print("\n=== STATIC FILE UPLOAD ===")
    csv_content = "id,name,latitude,longitude,altitude,speed\n"
    csv_content += "A001,FlightAlpha,28.6139,77.2090,35000,450.5\n"
    csv_content += "A002,FlightBeta,19.0760,72.8777,28000,520.3\n"
    csv_content += "A003,FlightGamma,13.0827,80.2707,42000,380.1\n"
    csv_content += "A004,FlightDelta,22.5726,88.3639,-100,600.0\n"
    csv_content += "A005,FlightEpsilon,12.9716,77.5946,15000,410.7\n"
    
    files = {"file": ("test_flights.csv", csv_content.encode(), "text/csv")}
    data = {"source_id": "test_flights"}
    
    r = requests.post(f"{BASE}/api/v1/ingest/upload-static", files=files, data=data)
    print(f"Status: {r.status_code}")
    print(json.dumps(r.json(), indent=2))
    assert r.status_code == 201

def test_list_sources():
    print("\n=== LIST SOURCES ===")
    r = requests.get(f"{BASE}/api/v1/sources")
    print(f"Status: {r.status_code}")
    for s in r.json():
        print(f"  [{s['source_type']}] {s['source_id']} - {s['status']}")

def test_silver_tables():
    print("\n=== SILVER TABLES ===")
    r = requests.get(f"{BASE}/api/v1/silver/tables")
    print(f"Status: {r.status_code}")
    for t in r.json():
        print(f"  {t['table_name']}: {t['row_count']} rows, {t.get('file_count',0)} files")

def test_query():
    print("\n=== QUERY SILVER ===")
    r = requests.post(f"{BASE}/api/v1/query", json={
        "sql": "SELECT * FROM test_flights LIMIT 10",
        "limit": 100
    })
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"Columns: {data['columns']}")
        print(f"Rows: {data['row_count']}")
        print(f"Execution time: {data['execution_time_ms']}ms")
        for row in data['rows'][:3]:
            print(f"  {row}")
    else:
        print(r.text)

def test_stream_wait_and_query():
    print("\n=== STREAM → WAIT → QUERY ===")
    # Send several stream events
    for i in range(5):
        requests.post(f"{BASE}/api/v1/ingest/stream", json={
            "source_id": "test_sensor",
            "data": {"temperature": 20 + i, "humidity": 50 + i, "location": f"zone_{i}"}
        })
    
    print("Waiting 20s for stream processor to batch and process...")
    time.sleep(20)
    
    r = requests.post(f"{BASE}/api/v1/query", json={
        "sql": "SELECT * FROM test_sensor LIMIT 10",
        "limit": 100
    })
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"Columns: {data['columns']}")
        print(f"Rows returned: {data['row_count']}")
        for row in data['rows'][:3]:
            print(f"  {row}")
    else:
        print(f"Query response: {r.text[:500]}")

if __name__ == "__main__":
    test_health()
    test_stream()
    test_upload_static()
    test_list_sources()
    test_silver_tables()
    test_query()
    test_stream_wait_and_query()
    print("\n✅ ALL TESTS PASSED")
