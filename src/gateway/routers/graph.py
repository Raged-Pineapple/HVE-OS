"""
graph.py — Graph Mapping API
Handles CRUD for Graph Blueprints and triggering manual Graph Syncs.
"""
from fastapi import APIRouter, HTTPException, status, BackgroundTasks
from typing import List, Dict, Any
from models import GraphBlueprintCreate, GraphBlueprintInfo, GoldRegistryInfo
from services import db_service
from Logic import graph_processor

router = APIRouter(tags=["Graph Mapping Blueprints"])

@router.post("/blueprints/{source_id}", response_model=GraphBlueprintInfo)
async def set_graph_blueprint(source_id: str, blueprint: GraphBlueprintCreate):
    """
    **Set a Graph Mapping Blueprint**
    Define exactly how records from a Silver Table should be inserted into the Neo4j Knowledge Graph.
    You MUST use `UNWIND $rows AS row` as the first line of your Cypher template.
    """
    source = db_service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found.")
    
    try:
        res = db_service.upsert_graph_blueprint(source_id, blueprint.cypher_template)
        for key in ['created_at', 'updated_at']:
            if res.get(key):
                res[key] = str(res[key])
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/blueprints/{source_id}", response_model=GraphBlueprintInfo)
async def get_graph_blueprint(source_id: str):
    """Get the Graph Mapping Blueprint for a source."""
    res = db_service.get_graph_blueprint(source_id)
    if not res:
        raise HTTPException(status_code=404, detail="Graph Blueprint not found.")
    for key in ['created_at', 'updated_at']:
        if res.get(key):
            res[key] = str(res[key])
    return res

@router.get("/registry", response_model=List[GoldRegistryInfo])
async def get_gold_registry(source_id: str = None):
    """Get Gold Registry materialization state."""
    res = db_service.get_gold_registry(source_id)
    for r in res:
        for key in ['created_at', 'updated_at']:
            if r.get(key):
                r[key] = str(r[key])
    return res

@router.post("/sync/{source_id}", status_code=status.HTTP_202_ACCEPTED)
async def sync_graph(source_id: str, background_tasks: BackgroundTasks):
    """
    **Trigger Background Sync**
    Pumps data from the Silver Lakehouse into Neo4j using the assigned Graph Blueprint.
    """
    source = db_service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found.")
        
    bp = db_service.get_graph_blueprint(source_id)
    if not bp:
        raise HTTPException(status_code=400, detail="No Graph Blueprint defined for this source.")

    process = graph_processor.get_graph_processor()
    background_tasks.add_task(process.sync_table_to_graph, source_id)
    return {
        "status": "ACCEPTED",
        "message": f"Graph Sync triggered for {source_id}."
    }
