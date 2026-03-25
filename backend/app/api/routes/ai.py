from fastapi import APIRouter, HTTPException
from app.ai.features.aggregator import feature_aggregator

router = APIRouter()

@router.get("/evaluate/{entity_id}")
async def evaluate_advanced_risk(entity_id: str):
    """
    Computes a composite Risk Vector based on Graph Topology and Time-Series trends.
    """
    result = await feature_aggregator.compute_advanced_features(entity_id)
    return {"entity_id": entity_id, "advanced_features": result}
