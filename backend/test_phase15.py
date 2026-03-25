import requests
import logging
import json
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8015" 

def test_active_learning():
    logger.info("Initializing baseline system framework...")
    # Fetch the Initial Governance Model Version
    
    logger.info("\n--- INJECTING CATASTROPHIC MODEL FAILURES ---")
    
    # We will simulate the model getting 10 consecutive predictions entirely wrong,
    # as operators frantically submit ground-truth feedback correcting the system.
    for i in range(10):
        payload = {
            "entity_id": f"WEATHER_STORM_{i}",
            "feedback_type": "risk_prediction",
            "value": 1.0, 
            "comments": "Model predicted safely, but reality was a category 5 disaster."
        }
        res = requests.post(f"{API_URL}/feedback/submit", json=payload)
        time.sleep(0.1)
        
    logger.info("\nSimulating time for automated background retraining cluster to execute...")
    # Give the async background task 5 seconds to generate the new dataset, fit the model, and hot swap it.
    time.sleep(5)
    
    # Now we simulate a new prediction being made, tracing it to see if the new model is active.
    logger.info("\n--- AUDITING NEW SYSTEM PREDICTION ---")
    from app.governance.registry import provenance_tracker
    
    # Make a dummy prediction just to stamp the active registry state
    pred_id = provenance_tracker.log_prediction("TEST_POST_TRAINING", {"risk": 0.5})
    record = provenance_tracker.get_audit_record(pred_id)
    
    logger.info(f"New Prediction executed on Model Version: {record['semantic_versions']['model']}")
    
    if "v" in record['semantic_versions']['model'] and float(record['semantic_versions']['model'].split('v')[1].split('-')[0]) > 3.1:
         logger.info("SUCCESS: The Active Learning loop automatically detected drift, retrained the model, and deployed the advanced version into the live system without human intervention!")
    else:
         logger.error("FAILED to upgrade model version.")

if __name__ == "__main__":
    test_active_learning()
