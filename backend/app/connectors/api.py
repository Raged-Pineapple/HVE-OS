import httpx
import logging
from typing import Any
from app.connectors.base import BaseConnector
from app.db.session import SessionLocal
from app.models.raw_data import RawData

logger = logging.getLogger(__name__)

class APIConnector(BaseConnector):
    def __init__(self, connector_id: str, url: str):
        super().__init__(connector_id)
        self.url = url
        
    async def run(self) -> Any:
        logger.info(f"API Connector {self.connector_id} fetching data from {self.url}")
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(self.url)
                response.raise_for_status()
                payload = response.json()
                
                # PHASE 17 OVERHAUL: Sub-layer 1 strictly routes all ingress data 
                # to the Canonical Payload wrapper before dropping it on the Kafka message bus
                from app.ingestion.standardizer import standardizer
                from datetime import datetime
                batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                
                # Make sure the payload is a dictionary
                safe_payload = payload if isinstance(payload, dict) else {"items": payload}
                
                await standardizer.standardize_and_publish(
                    source_id=self.connector_id,
                    raw_payload=safe_payload,
                    batch_id=batch_id
                )
                    
                logger.info(f"API Connector {self.connector_id} published RAW canonical payload to Message Bus.")
                return safe_payload
        except Exception as e:
            logger.error(f"Error in API Connector {self.connector_id}: {str(e)}")
            raise
            
    async def stop(self) -> None:
        pass # API simply closes when done
