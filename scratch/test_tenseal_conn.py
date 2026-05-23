import requests
import sys

url = "http://localhost:8001/health"
print(f"Testing GET {url}...")
try:
    resp = requests.get(url, timeout=5)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.json()}")
except Exception as e:
    print(f"Error connecting to TenSEAL: {e}")
    sys.exit(1)
