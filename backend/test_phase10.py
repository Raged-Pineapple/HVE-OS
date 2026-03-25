import asyncio
import time
import logging
from app.services.world_state import world_state

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_world_state():
    await world_state.connect()
    
    logger.info("Injecting 1,000 rapid telemetry updates into Redis World State Engine...")
    
    start_time = time.time()
    
    # Simulate a stream of 1000 fast GPS coordinate pings for a flight
    for i in range(1000):
        await world_state.update_state("FLIGHT_123", {
            "lat": 40.7128 + (i * 0.0001),
            "lon": -74.0060 + (i * 0.0001),
            "alt": 30000,
            "heading": 270
        })
        
    duration = time.time() - start_time
    logger.info(f"Successfully processed 1,000 micro-state updates in {duration:.3f} seconds!")
    
    # Retrieve the final state
    final_state = await world_state.get_state("FLIGHT_123")
    logger.info(f"Final State in Redis: {final_state}")
    
    # Sync to Neo4j
    logger.info("Committing final fast-state to Neo4j Graph Ontology...")
    await world_state.sync_to_neo4j("FLIGHT_123", ["Flight"])
    logger.info("World State successfully synced.")
    
    await world_state.disconnect()

if __name__ == "__main__":
    asyncio.run(test_world_state())
