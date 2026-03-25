import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8003" # we'll use 8003 for testing Phase 4

def test_ai():
    # 1. Provide noisy raw input
    requests.post(f"{API_URL}/connectors/create", json={
        "id": "noisy_sensor_4",
        "type": "api",
        "url": "https://jsonplaceholder.typicode.com/todos/3", # dummy payload
        "frequency": "manual"
    })
    
    # 2. Add AI Kalman Filter dataset node
    requests.post(f"{API_URL}/pipelines/dataset/create", json={
        "name": "clean_weather_ai",
        "inputs": ["noisy_sensor_4"],
        "transform_script": "ai_kalman"
    })
    
    # 3. Add AI Predictor dataset node
    requests.post(f"{API_URL}/pipelines/dataset/create", json={
        "name": "ai_risk_score",
        "inputs": ["clean_weather_ai"],
        "transform_script": "ai_predict"
    })
    
    # 4. Trigger pipeline
    logger.info("Triggering AI pipeline run...")
    res = requests.post(f"{API_URL}/pipelines/run")
    if res.status_code == 200:
        logger.info(f"AI Pipeline executed. Node order: {res.json().get('executed_nodes')}")
    else:
        logger.error(f"Pipeline failed: {res.text}")
        
if __name__ == "__main__":
    test_ai()
