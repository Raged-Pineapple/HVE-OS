from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from app.simulation.engine import simulation_engine

router = APIRouter()

class ScenarioPayload(BaseModel):
    target_entity_id: str
    changes: Dict[str, Any]

@router.post("/simulate")
async def run_scenario_simulation(payload: ScenarioPayload):
    """
    Branch the ontology timeline, apply hypothetical changes, and evaluate outcomes.
    """
    result = await simulation_engine.run_scenario(
        hypothetical_target=payload.target_entity_id,
        hypothetical_changes=payload.changes
    )
    return result
