import requests
import logging
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8013" 

def test_workflow_execution():
    logger.info("Faking a React Flow JSON Compilation...")
    
    # Simulating what the frontend would send when hitting the "Deploy Pipeline" button
    compiled_ui_payload = {
        "name": "Storm Risk Rapid Response Protocol",
        "trigger": {
            "type": "Manual",
            "target_entity_id": "WEATHER_HURRICANE"
        },
        "steps": [
            "predict_risk",
            "run_optimization",
            "trigger_webhook"
        ]
    }
    
    logger.info("Deploying compiled React Flow Workflow to the Interpreter Engine...")
    res = requests.post(f"{API_URL}/pipelines/deploy_workflow", json=compiled_ui_payload)
    
    if res.status_code == 200:
        logger.info(f"Workflow Interpreter Results:\n{json.dumps(res.json(), indent=2)}")
        logger.info("SUCCESS: The Backend Interpreter dynamically executed the arbitrary UI layout!")
    else:
        logger.error(f"Workflow compilation failed: {res.text}")

if __name__ == "__main__":
    test_workflow_execution()
