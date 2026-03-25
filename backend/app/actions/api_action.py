import httpx
import logging
from typing import Dict, Any
from app.actions.base import BaseAction

logger = logging.getLogger(__name__)

class APIAction(BaseAction):
    """Executes a webhook to an external service."""
    
    async def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        target_url = payload.get("target_url")
        if not target_url:
            return {"status": "failed", "error": "Missing target_url"}
            
        logger.info(f"Executing API Action to webhook: {target_url}")
        
        # We strip non-data payload fields for the external system
        data_to_send = {k: v for k, v in payload.items() if k not in ["action", "target_url"]}
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(target_url, json=data_to_send)
                response.raise_for_status()
                logger.info(f"Webhook Success: {response.status_code}")
                return {"status": "success", "response": response.text}
        except Exception as e:
            logger.error(f"Webhook Failed: {e}")
            return {"status": "failed", "error": str(e)}
