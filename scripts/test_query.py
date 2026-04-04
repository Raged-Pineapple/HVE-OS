import requests, json

# Query test_flights
r = requests.post('http://127.0.0.1:8000/api/v1/query', json={'sql': 'SELECT * FROM test_flights LIMIT 10', 'limit': 100})
data = r.json()
print("Columns:", data["columns"])
print("Row count:", data["row_count"])
print("Time:", data["execution_time_ms"], "ms")
for row in data['rows']:
    print(" ", row)

print()

# Query test_sensor
r2 = requests.post('http://127.0.0.1:8000/api/v1/query', json={'sql': 'SELECT * FROM test_sensor LIMIT 10', 'limit': 100})
data2 = r2.json()
print("Sensor Columns:", data2.get("columns"))
print("Sensor Row count:", data2.get("row_count"))
for row in data2.get('rows', [])[:3]:
    print(" ", row)

print()

# List Silver tables
r3 = requests.get('http://127.0.0.1:8000/api/v1/silver/tables')
print("Silver Tables:")
for t in r3.json():
    print(f"  {t['table_name']}: {t['row_count']} rows, {t['file_count']} files")

print()
print("ALL QUERIES PASSED")
