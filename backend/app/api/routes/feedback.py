from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any, Optional

from app.feedback.loop import feedback_manager
from app.ai.learning.active_loop import active_learning
import asyncio

router = APIRouter()

class FeedbackPayload(BaseModel):
    entity_id: str
    feedback_type: str
    value: Any
    comments: Optional[str] = ""

@router.post("/submit")
async def submit_feedback(payload: FeedbackPayload):
    """
    Submit ground-truth corrections or manual supervision data.
    """
    result = await feedback_manager.record_feedback(
        entity_id=payload.entity_id,
        feedback_type=payload.feedback_type,
        value=payload.value,
        comments=payload.comments
    )
    
    # --- Phase 15 ---
    # Pipe the new ground-truth data into the Active Learning monitor
    await active_learning.evaluate_drift(payload.model_dump())
    
    return result
