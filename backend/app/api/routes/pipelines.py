from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Dict, Any
from app.db.session import get_db
from app.models.dataset import Dataset
from app.models.lineage import Lineage
from app.schemas.pipeline import DatasetCreate, DatasetResponse, LineageResponse
from app.services.pipeline_engine import PipelineEngine

router = APIRouter()

@router.post("/dataset/create", response_model=DatasetResponse)
async def create_dataset(dataset_in: DatasetCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).where(Dataset.name == dataset_in.name))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Dataset already exists")
        
    ds = Dataset(
        name=dataset_in.name,
        inputs=dataset_in.inputs,
        transform_script=dataset_in.transform_script
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds

@router.post("/run")
async def run_pipeline(db: AsyncSession = Depends(get_db)):
    """
    Trigger the pipeline execution manually.
    """
    # ... logic skipped ...
    return {"status": "success", "message": "Pipeline execution triggered"}

@router.get("/lineage/{dataset_id}", response_model=List[LineageResponse])
async def get_lineage(dataset_id: int, db: AsyncSession = Depends(get_db)):
    """
    Retrieve lineage information for a specific dataset.
    """
    result = await db.execute(select(Lineage).filter(Lineage.source_dataset_id == dataset_id))
    lineage_records = result.scalars().all()
    return lineage_records

# --- Phase 13 ---
class WorkflowPayload(BaseModel):
    name: str
    trigger: Dict[str, Any]
    steps: List[str]

@router.post("/deploy_workflow")
async def deploy_workflow(payload: WorkflowPayload):
    """
    Accept compiled JSON from the React Flow frontend canvas and execute it.
    """
    from app.services.workflow_interpreter import workflow_interpreter
    result = await workflow_interpreter.execute_workflow(payload.model_dump())
    return result
