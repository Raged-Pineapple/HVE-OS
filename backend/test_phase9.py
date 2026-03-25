import requests
import logging
import json
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8008" # Use port 8008 to avoid conflicts

def test_ontology_first():
    # 1. Update/Create Ontology Nodes
    flight_payload = {
        "labels": ["Flight"],
        "properties": {"id": "FLIGHT_999", "capacity_needed": 1}
    }
    route_payload = {
        "labels": ["Route"],
        "properties": {"id": "ROUTE_X", "delay_mins": 10, "risk_score": 0.05, "capacity": 5}
    }
    
    logger.info("Injecting World State into Neo4j Ontology...")
    requests.post(f"{API_URL}/ontology/entity/FLIGHT_999/update", json=flight_payload)
    requests.post(f"{API_URL}/ontology/entity/ROUTE_X/update", json=route_payload)
    
    # Give neo4j a tiny moment to settle (though it's synchronous)
    time.sleep(0.5)
    
    # 2. Trigger Optimization (with EMPTY payload) to force it to read from Neo4j
    logger.info("Triggering Optimizer (Reading directly from Ontology Graph)...")
    res = requests.post(f"{API_URL}/optimization/reroute", json={"flights": [], "routes": []})
    
    if res.status_code == 200:
        logger.info(f"Ontology-First Optimization successful:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error(f"Ontology-First Optimization failed: {res.text}")

if __name__ == "__main__":
    test_ontology_first()
