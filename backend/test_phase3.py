import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8002"

def test_graph():
    # 1. Provide a dummy raw input just so the graph has data to fetch
    requests.post(f"{API_URL}/connectors/create", json={
        "id": "weather_test_3",
        "type": "api",
        "url": "https://jsonplaceholder.typicode.com/todos/2",
        "frequency": "manual"
    })
    
    # 2. Define clean_weather and risk_score (if not already existing in the DB)
    requests.post(f"{API_URL}/pipelines/dataset/create", json={
        "name": "clean_weather",
        "inputs": ["weather_test_3"],
        "transform_script": "clean_weather"
    })
    
    requests.post(f"{API_URL}/pipelines/dataset/create", json={
        "name": "risk_score",
        "inputs": ["clean_weather"],
        "transform_script": "compute_risk"
    })
    
    # 3. Define the graph sink node
    ds_graph = {
        "name": "graph_injection",
        "inputs": ["clean_weather", "risk_score"],
        "transform_script": "graph_sink"
    }
    logger.info("Creating graph_sink dataset node...")
    res = requests.post(f"{API_URL}/pipelines/dataset/create", json=ds_graph)
    logger.info(res.text)
    
    # 4. Run the pipeline
    logger.info("Triggering pipeline run...")
    res = requests.post(f"{API_URL}/pipelines/run")
    if res.status_code == 200:
        logger.info(f"Pipeline executed successfully. Node order: {res.json().get('executed_nodes')}")
    else:
        logger.error(f"Pipeline failed: {res.text}")

if __name__ == "__main__":
    test_graph()
