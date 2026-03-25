import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8007" # Use port 8007 to avoid conflicts

def test_feedback():
    # 1. Test Feedback Submission
    payload_feedback = {
        "entity_id": "WEATHER_EVENT_NY",
        "feedback_type": "risk_prediction",
        "value": 1.0, 
        "comments": "The AI predicted a low risk of 0.1, but ground truth severe flooding occurred."
    }
    
    logger.info("Submitting ground truth feedback to the Intelligence Layer...")
    res = requests.post(f"{API_URL}/feedback/submit", json=payload_feedback)
    if res.status_code == 200:
        logger.info(f"Feedback successfully captured:\n{json.dumps(res.json(), indent=2)}")
    else:
        logger.error(f"Feedback capture failed: {res.text}")

if __name__ == "__main__":
    test_feedback()
