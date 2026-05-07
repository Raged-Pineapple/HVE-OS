from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
import sys
import os

# Add Logic to path if needed
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
try:
    from Logic.security.registry import registry
except ImportError:
    registry = None

router = APIRouter(prefix="/api/v1/security", tags=["Security"])

@router.get("/discovery", response_model=Dict[str, Any])
async def discover_capabilities():
    """
    Returns available security providers and their capabilities.
    Used by the frontend to dynamically build configuration UI.
    """
    if not registry:
        raise HTTPException(status_code=500, detail="Security registry not initialized.")
    return registry.get_all_capabilities()

@router.post("/execute")
async def execute_operation(payload: Dict[str, Any]):
    """
    Execute a security operation (encrypt, decrypt, compute) for UI preview or testing.
    Payload should match recipe engine operation schema.
    """
    if not registry:
        raise HTTPException(status_code=500, detail="Security registry not initialized.")
        
    provider_name = payload.get("provider")
    action = payload.get("action")
    data = payload.get("data")
    params = payload.get("params", {})
    
    if not provider_name or not action or data is None:
        raise HTTPException(status_code=400, detail="Missing required fields: provider, action, data")
        
    try:
        provider = registry.get_provider(provider_name)
        if action == "encrypt":
            result = provider.encrypt(data, params)
        elif action == "decrypt":
            result = provider.decrypt(data, params)
        elif action == "compute":
            operation = payload.get("operation")
            result = provider.compute(operation, data, params)
        else:
            raise ValueError(f"Unknown action: {action}")
            
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
