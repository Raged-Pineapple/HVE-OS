import asyncio
import logging
from app.db.session import SessionLocal
from app.models.connector import Connector
from app.connectors.api import APIConnector
from app.connectors.mqtt import MQTTConnector
from sqlalchemy.future import select

logger = logging.getLogger(__name__)

class ConnectorManager:
    def __init__(self):
        self.active_connectors = {}
        
    async def initialize_from_db(self):
        # Called during FastAPI startup, starts all long-running connectors
        async with SessionLocal() as db:
            result = await db.execute(select(Connector))
            connectors = result.scalars().all()
            for c in connectors:
                await self.start_connector(c)
                
    async def start_connector(self, db_connector: Connector):
        if db_connector.id in self.active_connectors:
            return
            
        instance = None
        if db_connector.type == "api":
            if not db_connector.url:
                logger.error(f"API connector {db_connector.id} missing url")
                return
            instance = APIConnector(connector_id=db_connector.id, url=db_connector.url)
            # Normally we might schedule a cron job for API polling,
            # but for manual/trigger runs, we just keep the instance.
            
        elif db_connector.type == "mqtt":
            if not db_connector.url: # assuming url is broker:port/topic for simplicity or keep it simple parsing
                # for now simplified setup: e.g. tcp://localhost:1883/topic
                logger.error(f"MQTT connector {db_connector.id} missing configuration")
                return
            # Assuming url format for mqtt: topic name, and broker comes from settings
            from app.core.config import settings
            instance = MQTTConnector(
                connector_id=db_connector.id, 
                broker=settings.MQTT_BROKER,
                port=settings.MQTT_PORT,
                topic=db_connector.url
            )
            await instance.run() # This starts the mqtt loop thread
            
        if instance:
            self.active_connectors[db_connector.id] = instance
            logger.info(f"Initialized connector {db_connector.id}")
            
    async def run_all_apis(self):
        """Trigger one-off run for all API connectors"""
        tasks = []
        for cid, instance in self.active_connectors.items():
            if isinstance(instance, APIConnector):
                tasks.append(instance.run())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
            
    async def stop_all(self):
        for cid, instance in self.active_connectors.items():
            await instance.stop()
        self.active_connectors.clear()

connector_manager = ConnectorManager()
