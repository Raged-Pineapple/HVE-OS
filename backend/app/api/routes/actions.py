from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Dict, Any

from app.actions.api_action import APIAction
from app.actions.alert_action import AlertAction

router = APIRouter()

class ActionPayload(BaseModel):
    action_type: str # e.g., "webhook" or "alert"
    payload: Dict[str, Any]

@router.post("/execute")
async def execute_action(action_req: ActionPayload):
    """
    Dynamically routes to the correct executor.
    Supports "webhook" for APIAction or "alert" for AlertAction.
    """
    
    executor = None
    if action_req.action_type == "webhook":
        executor = APIAction()
    elif action_req.action_type == "alert":
        executor = AlertAction()
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action_type: {action_req.action_type}")
        
    result = await executor.execute(action_req.payload)
    
    if result.get("status") == "failed":
        raise HTTPException(status_code=500, detail=result)
        
    return result
