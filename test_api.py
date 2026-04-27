import urllib.request
import urllib.error
import json

req = urllib.request.Request(
    'http://localhost:8000/api/v1/sources/preview-recipe',
    data=json.dumps({"record": {"elements": [{"id":1}]}, "recipe": {"operations": [{"op": "flatten", "field": "elements"}]}}).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    with urllib.request.urlopen(req) as f:
        print("SUCCESS:", f.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("ERROR:", e.code, e.read().decode('utf-8'))
