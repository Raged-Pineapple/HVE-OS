import asyncio
import logging
from app.ingestion.standardizer import standardizer
from app.db.neo4j_session import neo4j_manager
from app.ingestion.bus import message_bus

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_integration_test():
    neo4j_manager.connect()
    await message_bus.connect()
    
    source_id = "WEATHER_API"
    batch_id = "test_batch_001"
    
    # 1. Fire a valid payload that aligns with the Schema Registry
    valid_payload = {
        "temperature": 75.5,
        "wind_speed": 12.0,
        "hurricane_threat": False
    }
    
    logger.info("\n--- FIRING VALID PAYLOAD TO STANDARDIZER (Sub-layer 1 & 2) ---")
    canonical_1 = await standardizer.standardize_and_publish(source_id, valid_payload, batch_id)
    logger.info(f"Row Hash Generated: {canonical_1['row_hash']}")
    
    # 2. Fire an EXACT duplicate payload (should be dropped by Redis O(1) deduplicator)
    logger.info("\n--- FIRING EXACT DUPLICATE TO TEST DEDUPLICATOR (Sub-layer 4) ---")
    await standardizer.standardize_and_publish(source_id, valid_payload, batch_id)
    
    # 3. Fire a bad payload (should trigger DLQ)
    logger.info("\n--- FIRING BAD PAYLOAD TO TEST SCHEMA DLQ (Sub-layer 3) ---")
    # Temperature is required, we omit it.
    bad_payload = {"wind_speed": "very fast"}
    await standardizer.standardize_and_publish(source_id, bad_payload, batch_id)
    
    # Wait for the async Kafka consumers to process the messages
    logger.info("\n⏳ Waiting 5 seconds for Kafka Consumers (Validation, Archive, Lineage) to process...")
    await asyncio.sleep(5)
    
    # Verify Lineage Graph in Neo4j (Sub-layer 6)
    logger.info("\n--- VERIFYING SUB-LAYER 6 LINEAGE GRAPH ---")
    query = """
    MATCH (s:DataSource {id: $source_id})-[:PRODUCED]->(b:DataBatch)-[:CONTAINS]->(r:DataRecord {id: $row_hash})
    RETURN s.id, b.id, r.id
    """
    async with neo4j_manager.driver.session() as session:
        result = await session.run(query, 
            source_id=source_id,
            row_hash=canonical_1["row_hash"]
        )
        records = await result.data()
        
    if records:
        logger.info(f"✅ SUCCESS! Lineage Graph correctly plotted DataRecord {canonical_1['row_hash']} back to Source {source_id}.")
    else:
        logger.error("❌ FAILED: Record was not found in the Neo4j Lineage Graph.")
    
    await message_bus.close()
    await neo4j_manager.close()

if __name__ == "__main__":
    asyncio.run(run_integration_test())
