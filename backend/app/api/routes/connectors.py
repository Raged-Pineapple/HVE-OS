from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from typing import Optional
import httpx

from app.db.session import get_db
from app.models.connector import Connector
from app.schemas.connector import ConnectorCreate, ConnectorResponse, ConnectorRunResponse

from app.ingestion.static.reception import reception_service
from app.ingestion.static.format_detector import format_detector
from app.ingestion.static.format_parser import format_parser
from app.ingestion.static.schema_inferrer import schema_inferrer
from app.ingestion.static.semantic_labeller import semantic_labeller
from app.ingestion.static.pk_scorer import pk_scorer
from app.ingestion.static.name_deriver import name_deriver
from app.ingestion.static.fingerprint_store import fingerprint_store
from app.ingestion.static.confidence_scorer import confidence_scorer
from app.ingestion.static.data_class_router import data_class_router

from app.services.connector_manager import connector_manager

router = APIRouter()

class IntrospectRequest(BaseModel):
    url: str
    auth_header: Optional[str] = None

@router.post("/introspect")
async def introspect_api(request: IntrospectRequest):
    """
    Sub-layer 1.5: The Dry-Run API Mapper. 
    Recursively flattens massive API responses into a flat array of real sample values
    with precise JSON Paths (e.g. `states[*][0]`) just like Zapier and Make.
    """
    headers = {}
    if request.auth_header:
        headers["Authorization"] = request.auth_header
        
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(request.url, headers=headers, timeout=15.0)
            resp.raise_for_status()
            data = resp.json()
            
            def flatten_json(item, path=""):
                extracted = []
                if isinstance(item, dict):
                    for k, v in item.items():
                        new_path = f"{path}.{k}" if path else k
                        extracted.extend(flatten_json(v, new_path))
                elif isinstance(item, list) and len(item) > 0:
                    first = item[0]
                    if isinstance(first, dict):
                        # List of Objects: use [*] and parse the first object as the schema layout
                        extracted.extend(flatten_json(first, f"{path}[*]" if path else "[*]"))
                    elif isinstance(first, list):
                        # List of Lists (OpenSky style): dive deeper
                        extracted.extend(flatten_json(first, f"{path}[*]" if path else "[*]"))
                    else:
                        # List of Primitives (leaves)
                        # We map the indexes (up to 20 elements to show the schema)
                        for i, val in enumerate(item[:20]):
                            idx_path = f"{path}[{i}]" if path else f"[{i}]"
                            extracted.extend(flatten_json(val, idx_path))
                else:
                    # Primitive Terminals
                    val_type = type(item).__name__
                    if val_type == "str": val_type = "Text"
                    elif val_type in ["int", "float"]: val_type = "Number"
                    elif val_type == "bool": val_type = "True/False"
                    elif val_type == "NoneType": val_type = "Null"
                    
                    extracted.append({
                        "path": path,
                        "sample_value": item,
                        "type": val_type
                    })
                return extracted
                
            # Generate the flattened Zapier-style schema array
            extractables = flatten_json(data)
            
            # Truncate the original JSON for the preview window if needed
            preview_sample = data
            if isinstance(data, dict):
                preview_sample = {
                    k: (v[:3] if isinstance(v, list) and len(v) > 3 else v)
                    for k, v in data.items()
                }
            elif isinstance(data, list) and len(data) > 3:
                preview_sample = data[:3]
                
            return {
                "status": "success",
                "schema": extractables,
                "raw_sample": preview_sample
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"API Introspection Failed: {str(e)}")

@router.post("/create", response_model=ConnectorResponse)
async def create_connector(
    connector_in: ConnectorCreate,
    db: AsyncSession = Depends(get_db)
):
    # Check if exists
    result = await db.execute(select(Connector).where(Connector.id == connector_in.id))
    db_connector = result.scalars().first()
    if db_connector:
        raise HTTPException(status_code=400, detail="Connector ID already registered")
        
    db_connector = Connector(
        id=connector_in.id,
        type=connector_in.type,
        url=connector_in.url,
        frequency=connector_in.frequency
    )
    db.add(db_connector)
    await db.commit()
    await db.refresh(db_connector)
    
    # Start the connector in the manager
    await connector_manager.start_connector(db_connector)
    
    return db_connector

@router.get("/", response_model=list[ConnectorResponse])
async def read_connectors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Connector))
    return result.scalars().all()

@router.post("/{connector_id}/run", response_model=ConnectorRunResponse)
async def run_connectors(connector_id: str = "all", db: AsyncSession = Depends(get_db)):
    # Trigger all active API connectors
    await connector_manager.run_all_apis()
    return {"status": "success", "message": "Triggered all active API connectors"}

@router.post("/upload-static-dryrun")
async def upload_static_dryrun(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """
    Phase 25-29 Unit Test: Upload a raw file to test the AI Cascades.
    Automatically sniffs format, routes to Document vs Tabular vs Timeseries,
    applies Type Coercion & Semantic aliases, picks a Primary Key mathematically,
    and returns the UI Confidence decision without dropping database tables.
    """
    # Stage 1: Reception & Deduplication
    reception = await reception_service.receive_file(file, db)
    if reception.get("status") == "duplicate":
        # Remove binary bytes that crash FastAPI's jsonable_encoder
        reception.pop("head", None)
        return {"status": "success", "routing": "SILENT_IMPORT (Deduplicated)", "details": reception}
        
    filepath = reception["filepath"]
    head_bytes = reception["head"]
    dataset_name = name_deriver.derive(file.filename)
    
    # Stage 2: Sniffing bytes
    fmt = format_detector.detect(head_bytes, filepath=file.filename)
    
    if fmt.endswith("REJECT") or fmt == "ZIP_CONTAINER":
        return {
            "status": "success", "dataset_name": dataset_name, "format": fmt,
            "data_class": "binary", "routing": "OBJECT_STORAGE_DIRECT (MinIO Bypass)"
        }
        
    try:
        raw_dicts = format_parser.parse(filepath, fmt)
    except Exception as e:
        return {"status": "error", "format_detected": fmt, "message": f"Parse failed: {str(e)}"}
        
    # Phase 29: Data Class Routing
    data_class = data_class_router.route(raw_dicts, fmt)
    
    if data_class in ["document", "binary"]:
        return {
            "status": "success", "dataset_name": dataset_name, "format": fmt,
            "data_class": data_class, "routing": f"BYPASS_SCHEMA -> {data_class.upper()}_HANDLER (JSONB/NLP)"
        }
        
    # Stage 3-6: Tabular Introspection Cascade
    raw_schema = schema_inferrer.infer_schema(raw_dicts)
    semantic_schema = semantic_labeller.apply_labels(raw_schema)
    pk_column = pk_scorer.select_pk(semantic_schema)
    
    # Stage 7-8: Fingerprint & Decision Scoring
    fingerprint = fingerprint_store.compute_fingerprint(semantic_schema)
    confidence = confidence_scorer.compute_confidence(semantic_schema, fingerprint_matched=False)
    decision = confidence_scorer.get_decision(confidence)
    
    return {
        "status": "success",
        "dataset_name": dataset_name,
        "format_sniffed": fmt,
        "data_class": data_class,
        "row_count": len(raw_dicts),
        "intelligence_metrics": {
            "confidence_score": confidence,
            "decision": decision,
            "primary_key": pk_column,
            "schema_fingerprint": fingerprint
        },
        "inferred_schema": semantic_schema,
        "data_preview": raw_dicts[:2]
    }
