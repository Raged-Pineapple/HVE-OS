import requests

def test_route(method, url, **kwargs):
    try:
        r = requests.request(method, url, **kwargs)
        print(f"{method} {url} -> {r.status_code}")
    except Exception as e:
        print(f"Error: {e}")

test_route("GET", "http://localhost:8000/api/v1/sources")
test_route("POST", "http://localhost:8000/api/v1/sources/preview-recipe", json={"record":{}, "recipe":{"operations":[]}})
test_route("POST", "http://localhost:8000/api/v1/sources/foo/recipe", json={"operations":[]})

# Let's inspect the openapi.json to see what is registered!
try:
    openapi = requests.get("http://localhost:8000/openapi.json").json()
    paths = openapi.get("paths", {})
    if "/api/v1/sources/preview-recipe" in paths:
        print("preview-recipe is registered!")
        print("methods:", paths["/api/v1/sources/preview-recipe"].keys())
    else:
        print("preview-recipe is NOT in openapi.json!")
except Exception as e:
    print("Failed to get openapi.json:", e)
