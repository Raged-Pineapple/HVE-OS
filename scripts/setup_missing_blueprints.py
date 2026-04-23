import requests

BASE_URL = "http://127.0.0.1:8000/api/v1"

def register_and_add_blueprints(source_id, description, blueprints):
    # Register source
    source_payload = {
        "source_id": source_id,
        "source_type": "STREAM",
        "protocol": "HTTP",
        "description": description
    }
    requests.post(f"{BASE_URL}/sources/register", json=source_payload)
    
    # Add blueprints
    response = requests.post(f"{BASE_URL}/sources/{source_id}/blueprints", json=blueprints)
    if response.status_code == 200:
        print(f"✅ Blueprints added for {source_id}")
    else:
        print(f"❌ Failed to add blueprints for {source_id}: {response.text}")

def main():
    blueprints_map = {
        "context_military_bases": {
            "description": "Daily pull of Military Bases",
            "blueprints": [
                {"target_field": "node_id", "json_path": "$.id", "data_type": "STRING", "is_primary_key": True},
                {"target_field": "lat", "json_path": "$.lat", "data_type": "FLOAT", "is_primary_key": False},
                {"target_field": "lon", "json_path": "$.lon", "data_type": "FLOAT", "is_primary_key": False},
                {"target_field": "tags", "json_path": "$.tags", "data_type": "STRING", "is_primary_key": False}
            ]
        },
        "overpass_military": {
            "description": "Overpass Military feed",
            "blueprints": [
                {"target_field": "node_id", "json_path": "$.id", "data_type": "STRING", "is_primary_key": True},
                {"target_field": "lat", "json_path": "$.lat", "data_type": "FLOAT", "is_primary_key": False},
                {"target_field": "lon", "json_path": "$.lon", "data_type": "FLOAT", "is_primary_key": False},
                {"target_field": "tags", "json_path": "$.tags", "data_type": "STRING", "is_primary_key": False}
            ]
        },
        "news_tech_stream": {
            "description": "Tech News stream",
            "blueprints": [
                {"target_field": "article_id", "json_path": "$.id", "data_type": "STRING", "is_primary_key": True},
                {"target_field": "title", "json_path": "$.title", "data_type": "STRING", "is_primary_key": False},
                {"target_field": "author", "json_path": "$.author", "data_type": "STRING", "is_primary_key": False},
                {"target_field": "url", "json_path": "$.url", "data_type": "STRING", "is_primary_key": False}
            ]
        },
        "finnhub_market_news": {
            "description": "Finnhub Market Data",
            "blueprints": [
                {"target_field": "news_id", "json_path": "$.id", "data_type": "STRING", "is_primary_key": True},
                {"target_field": "headline", "json_path": "$.headline", "data_type": "STRING", "is_primary_key": False},
                {"target_field": "datetime", "json_path": "$.datetime", "data_type": "INT", "is_primary_key": False},
                {"target_field": "source", "json_path": "$.source", "data_type": "STRING", "is_primary_key": False}
            ]
        }
    }

    for source_id, data in blueprints_map.items():
        register_and_add_blueprints(source_id, data["description"], data["blueprints"])

if __name__ == "__main__":
    main()
