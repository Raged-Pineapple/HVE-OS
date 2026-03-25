import requests
import logging
import json
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8011" 

def test_simulation():
    # 1. Establish Baseline World State in Neo4j
    logger.info("Injecting stable World State into Neo4j Ontology...")
    flight_payload = {"labels": ["Flight"], "properties": {"id": "FLIGHT_SIM", "capacity_needed": 1}}
    # Safe route with 0 risk and fast time
    route_primary = {"labels": ["Route"], "properties": {"id": "ROUTE_PRIMARY", "delay_mins": 10, "risk_score": 0.05, "capacity": 5}}
    # Backup route with higher time
    route_backup = {"labels": ["Route"], "properties": {"id": "ROUTE_BACKUP", "delay_mins": 45, "risk_score": 0.01, "capacity": 5}}
    
    requests.post(f"{API_URL}/ontology/entity/FLIGHT_SIM/update", json=flight_payload)
    requests.post(f"{API_URL}/ontology/entity/ROUTE_PRIMARY/update", json=route_primary)
    requests.post(f"{API_URL}/ontology/entity/ROUTE_BACKUP/update", json=route_backup)
    
    time.sleep(1) # Allow Neo4j to settle
    
    # 2. Trigger "What-If" Simulation (What if ROUTE_PRIMARY gets hit by a blizzard?)
    logger.info("Triggering What-If Simulation: Injecting critical weather failure into ROUTE_PRIMARY...")
    
    sim_payload = {
        "target_entity_id": "ROUTE_PRIMARY",
        "changes": {
            "risk_score": 0.99, # Extreme risk
            "delay_mins": 300   # Massive delay
        }
    }
    
    res = requests.post(f"{API_URL}/simulation/simulate", json=sim_payload)
    
    if res.status_code == 200:
        logger.info(f"Simulation Engine results:\n{json.dumps(res.json(), indent=2)}")
        
        # Verify the Baseline vs Simulation routing choices
        data = res.json()
        
        logger.info("\n--- Branching Reality Comparison ---")
        try:
            baseline_route = data["baseline"]["assignments"][0]["route_id"]
            sim_route = data["simulation"]["assignments"][0]["route_id"]
            
            logger.info(f"Baseline Engine chose: {baseline_route} (Based on actual live Neo4j data)")
            logger.info(f"Simulated Alternate Future chose: {sim_route} (Based on projected storm impact)")
            
            if sim_route != baseline_route:
                logger.info("SUCCESS: The Simulation Engine successfully ran isolated routing branches!")
            else:
                logger.warning("FAILED: The Simulation Engine did not branch away from the danger route.")
                
        except Exception as e:
            logger.error(f"Could not parse routing assignments: {e}")
    else:
        logger.error(f"Simulation execution failed: {res.text}")

if __name__ == "__main__":
    test_simulation()
