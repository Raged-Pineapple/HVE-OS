from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from app.services.ontology_service import ontology_service

router = APIRouter()

class UpdateEntityPayload(BaseModel):
    labels: List[str]
    properties: Dict[str, Any]

@router.get("/entity/{entity_id}")
async def get_entity(entity_id: str):
    data = await ontology_service.get_entity(entity_id)
    if not data:
        raise HTTPException(status_code=404, detail="Entity not found")
    return data

@router.get("/entity/{entity_id}/relations")
async def get_entity_relations(entity_id: str, depth: int = 1):
    paths = await ontology_service.get_relations(entity_id, depth)
    return {"entity_id": entity_id, "paths": paths}

@router.post("/entity/{entity_id}/update")
async def update_entity(entity_id: str, payload: UpdateEntityPayload):
    updated = await ontology_service.update_entity(entity_id, payload.labels, payload.properties)
    return {"status": "success", "entity": updated}
