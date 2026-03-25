import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8006" # Use port 8006 to avoid conflicts

def test_actions():
    # 1. Test Webhook Action
    payload_webhook = {
        "action_type": "webhook",
        "payload": {
            "action": "reroute_flight",
            "flight_id": "FLIGHT_123",
            "target_url": "https://jsonplaceholder.typicode.com/posts" # dummy url that accepts POST
        }
    }
    
    logger.info("Sending Webhook Action request...")
    res = requests.post(f"{API_URL}/actions/execute", json=payload_webhook)
    if res.status_code == 200:
        logger.info(f"Webhook Action successful:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error(f"Webhook Action failed: {res.text}")

    # 2. Test Alert Action
    payload_alert = {
        "action_type": "alert",
        "payload": {
            "message": "Flight FLIGHT_123 has been rerouted due to severe weather risk.",
            "level": "CRITICAL"
        }
    }
    
    logger.info("Sending Alert Action request...")
    res = requests.post(f"{API_URL}/actions/execute", json=payload_alert)
    if res.status_code == 200:
        logger.info(f"Alert Action successful:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error(f"Alert Action failed: {res.text}")

if __name__ == "__main__":
    test_actions()
