import requests
import logging
import json
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8012" 

def test_advanced_ai():
    # 1. Establish the Target Airport
    requests.post(f"{API_URL}/ontology/entity/AIRPORT_LAX/update", json={
        "labels": ["Airport"], "properties": {"id": "AIRPORT_LAX", "risk_score": 0.05} # Baseline very safe
    })
    
    # 2. Establish 3 Neighboring Weather Events with extremely bad risk scores
    requests.post(f"{API_URL}/ontology/entity/WEATHER_1/update", json={
        "labels": ["WeatherEvent"], "properties": {"id": "WEATHER_1", "risk_score": 0.85}
    })
    requests.post(f"{API_URL}/ontology/entity/WEATHER_2/update", json={
        "labels": ["WeatherEvent"], "properties": {"id": "WEATHER_2", "risk_score": 0.90}
    })
    
    # 3. Create relationships in Neo4j (using raw Cypher since our API is simplified)
    logger.info("Building interconnected graph structure in Ontology...")
    from app.db.neo4j_session import neo4j_manager
    import asyncio
    
    async def build_rels():
        neo4j_manager.connect()
        async with neo4j_manager.driver.session() as session:
            await session.run("MATCH (a:Airport {id:'AIRPORT_LAX'}), (w:WeatherEvent {id:'WEATHER_1'}) MERGE (w)-[:AFFECTS]->(a)")
            await session.run("MATCH (a:Airport {id:'AIRPORT_LAX'}), (w:WeatherEvent {id:'WEATHER_2'}) MERGE (w)-[:AFFECTS]->(a)")
        time.sleep(1) # wait for settling
            
    asyncio.run(build_rels())

    # 4. Trigger Advanced AI Evaluation
    logger.info("Triggering Advanced AI Graph + Temporal Evaluation for LAX...")
    res = requests.get(f"{API_URL}/ai/evaluate/AIRPORT_LAX")
    
    if res.status_code == 200:
        data = res.json()
        logger.info(f"Advanced Feature Aggregation Results:\n{json.dumps(data, indent=2)}")
        
        node_risk = data["advanced_features"]["node_risk"]
        avg_neighbor = data["advanced_features"]["avg_neighbor_risk"]
        composite = data["advanced_features"]["calculated_composite_score"]
        
        if composite > node_risk:
            logger.info(f"SUCCESS: The base risk was only {node_risk}, but the surrounding topographic risk ({avg_neighbor}) correctly spiked the composite score to {composite}!")
    else:
        logger.error(f"Advanced AI evaluation failed: {res.text}")

if __name__ == "__main__":
    test_advanced_ai()
