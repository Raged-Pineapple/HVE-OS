import logging
from typing import Dict, Any
from app.actions.base import BaseAction

logger = logging.getLogger(__name__)

class AlertAction(BaseAction):
    """Executes an internal alerting sequence (simulating Slack/Email)"""
    
    async def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        alert_msg = payload.get("message")
        level = payload.get("level", "INFO")
        
        if not alert_msg:
            return {"status": "failed", "error": "Missing alert message"}
            
        # Simulate pushing to an external human-in-the-loop system
        logger.info(f"*** ALERT ISSUED [{level}] *** | Message: {alert_msg}")
        
        # We could store this in the DB to represent an Inbox for the user
        return {"status": "success", "response": "Alert logged internally"}
