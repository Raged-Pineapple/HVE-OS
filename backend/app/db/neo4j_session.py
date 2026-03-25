from neo4j import GraphDatabase, AsyncGraphDatabase
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

class Neo4jManager:
    def __init__(self):
        self.driver = None

    def connect(self):
        try:
            self.driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI, 
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
            )
            logger.info(f"Connected to Neo4j at {settings.NEO4J_URI}")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")

    async def close(self):
        if self.driver:
            await self.driver.close()
            logger.info("Closed Neo4j connection")

neo4j_manager = Neo4jManager()
