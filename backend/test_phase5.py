import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8004" # Use port 8004 to avoid conflicts

def test_optimization():
    # 1. Define dummy flights and alternative routes with delays and risk scores
    payload = {
        "flights": [
            {"id": "FLIGHT_123", "capacity_needed": 1},
            {"id": "FLIGHT_456", "capacity_needed": 1}
        ],
        "routes": [
            {"id": "ROUTE_A", "delay_mins": 0, "risk_score": 0.9, "capacity": 5},   # Fast but risky
            {"id": "ROUTE_B", "delay_mins": 30, "risk_score": 0.1, "capacity": 1},  # Slow but safe, capacity 1
            {"id": "ROUTE_C", "delay_mins": 45, "risk_score": 0.2, "capacity": 5}   # Very slow
        ],
        "risk_weight": 100 # Risk is heavily penalized
    }
    
    logger.info("Sending rerouting optimization request...")
    res = requests.post(f"{API_URL}/optimization/reroute", json=payload)
    if res.status_code == 200:
        logger.info(f"Optimization successful:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error(f"Optimization failed: {res.text}")

if __name__ == "__main__":
    test_optimization()
