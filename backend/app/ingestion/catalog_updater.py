import logging
import asyncio
from typing import Dict, Any
from app.ingestion.bus import message_bus
from app.db.neo4j_session import neo4j_manager

logger = logging.getLogger(__name__)

class CatalogUpdater:
    """
    Sub-layer 6: The Data Catalog and Lineage Store.
    """
    async def run(self):
        # Listens to ingest.validated and translates schema metadata to the Lineage Graph
        consumer = message_bus.get_consumer("ingest.validated", group_id="catalog_updater_group")
        await consumer.start()
        logger.info("📡 KAFKA DAEMON: Started Catalog & Lineage Consumer (Sub-layer 6)")
        try:
            async for msg in consumer:
                payload = msg.value
                await self.update_lineage_graph(payload)
        except asyncio.CancelledError:
            pass
        finally:
            await consumer.stop()
            
    async def update_lineage_graph(self, canonical_record: dict):
        source_id = canonical_record.get("source_id")
        batch_id = canonical_record.get("batch_id")
        row_hash = canonical_record.get("row_hash")
        
        # We hook into Neo4j to plot exactly:
        # (DataSource)-[:PRODUCED]->(DataBatch)-[:CONTAINS]->(DataRecord)
        # Any downstream AI transformation traces backward through these nodes.
        query = """
        MERGE (s:DataSource {id: $source_id})
        MERGE (b:DataBatch {id: $batch_id})
        MERGE (s)-[:PRODUCED]->(b)
        MERGE (r:DataRecord {id: $row_hash})
        SET r.version = $version, r.ingested_at = $ts
        MERGE (b)-[:CONTAINS]->(r)
        """
        async with neo4j_manager.driver.session() as session:
            await session.run(query, 
                source_id=source_id, 
                batch_id=batch_id, 
                row_hash=row_hash,
                version=canonical_record.get("connector_version"),
                ts=canonical_record.get("ingest_timestamp")
            )
        
catalog_updater = CatalogUpdater()
