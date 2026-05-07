import os
import sys
import json

# Add src and src/gateway to path
sys.path.insert(0, os.path.abspath("src"))
sys.path.insert(0, os.path.abspath(os.path.join("src", "gateway")))

from gateway.services import query_service

def query_bangalore():
    sql = "SELECT * FROM bangalore LIMIT 5"
    print(f"Executing query: {sql}")
    try:
        result = query_service.execute_query(sql)
        print(f"Row count: {result['row_count']}")
        print(f"Execution time: {result['execution_time_ms']} ms")
        print("\nResults:")
        for row in result['rows']:
            print(json.dumps(row, indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    query_bangalore()
