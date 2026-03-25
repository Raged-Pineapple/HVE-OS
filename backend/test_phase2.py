import requests
import json
import logging
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8001" # Assume user restarted server or we test against the running one (tables created above)

def test_pipeline():
    logger.info("Defining datasets...")
    # 1. Provide raw data (simulating Phase 1)
    
    # 2. Define clean_weather dataset
    ds1 = {
        "name": "clean_weather",
        "inputs": ["weather_test_1"], # Takes data from the API connector
        "transform_script": "clean_weather"
    }
    requests.post(f"{API_URL}/pipelines/dataset/create", json=ds1)
    
    # 3. Define risk_score dataset
    ds2 = {
        "name": "risk_score",
        "inputs": ["clean_weather"],
        "transform_script": "compute_risk"
    }
    requests.post(f"{API_URL}/pipelines/dataset/create", json=ds2)
    
    logger.info("Triggering pipeline execution...")
    # 4. Trigger DAG run
    res = requests.post(f"{API_URL}/pipelines/run")
    if res.status_code == 200:
        logger.info(f"Pipeline executed successfully. Node order: {res.json()['executed_nodes']}")
    else:
        logger.error(f"Pipeline execution failed: {res.text}")
        
    logger.info("Checking lineage...")
    # 5. Check lineage for risk_score
    res = requests.get(f"{API_URL}/pipelines/lineage/risk_score")
    if res.status_code == 200:
        logger.info(f"Lineage for risk_score:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error("Failed to get lineage.")

if __name__ == "__main__":
    test_pipeline()
