import redis.asyncio as redis
import json
import logging
from typing import Dict, Any, Optional
from app.core.config import settings
from app.services.ontology_service import ontology_service

logger = logging.getLogger(__name__)

class WorldStateManager:
    """
    Ultra-fast Level 2 caching layer for Real-Time World State telemetry.
    Backed by Redis for O(1) read/writes of entity drift.
    """
    
    def __init__(self):
        self.redis_client = None
        
    async def connect(self):
        if not self.redis_client:
            self.redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
            logger.info("Connected to Real-Time World State Engine (Redis).")
            
    async def disconnect(self):
        if self.redis_client:
            await self.redis_client.close()
            
    async def update_state(self, entity_id: str, new_props: Dict[str, Any]):
        """
        Instantly updates the micro-state of an entity in Redis.
        """
        if not self.redis_client:
            return
            
        key = f"entity:{entity_id}"
        # Convert all props to strings since Redis HSET accepts strings/bytes
        stringified_props = {k: str(v) for k, v in new_props.items()}
        
        await self.redis_client.hset(key, mapping=stringified_props)
        # Note: In a production system, a background Celery task would stream these
        # batch updates silently to Neo4j to keep structure intact without bottlenecking ingestion.
        
    async def sync_to_neo4j(self, entity_id: str, labels: list):
        """
        Sync the current fast-state of Redis down into the structural Neo4j graph.
        """
        fast_state = await self.get_state(entity_id)
        if fast_state:
            await ontology_service.update_entity(entity_id, labels, fast_state)
            
    async def get_state(self, entity_id: str) -> Dict[str, str]:
        if not self.redis_client:
            return {}
        key = f"entity:{entity_id}"
        return await self.redis_client.hgetall(key)

world_state = WorldStateManager()
