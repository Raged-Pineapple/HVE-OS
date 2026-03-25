from fastapi import APIRouter, HTTPException
from app.governance.registry import provenance_tracker

router = APIRouter()

@router.get("/audit/{prediction_id}")
async def fetch_audit_record(prediction_id: str):
    """
    Retrieve the immutable provenance fingerprint and semantic version manifest
    associated with a specific prediction execution.
    """
    record = provenance_tracker.get_audit_record(prediction_id)
    if not record:
        raise HTTPException(status_code=404, detail="Audit Record not found")
        
    return record
