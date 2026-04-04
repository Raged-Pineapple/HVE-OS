"""
control_plane.py — CRUD Router for the HVE-OS Control Plane
Manages Sources, Mapping Blueprints, and Data Quality Rules.
"""
from fastapi import APIRouter, HTTPException, status
from typing import List
from models import (
    SourceRegistration, SourceInfo, 
    MappingBlueprintCreate, MappingBlueprintInfo,
    DQRuleCreate, DQRuleInfo,
    APISourceConfig
)
from services import db_service

router = APIRouter(prefix="/api/v1/sources", tags=["Control Plane"])


# ============================================================
# SOURCE MANAGEMENT
# ============================================================

@router.post("/register", response_model=SourceInfo, status_code=status.HTTP_201_CREATED)
async def register_source(request: SourceRegistration):
    """Register a new data source in the HVE-OS Control Plane."""
    try:
        result = db_service.register_source(
            source_id=request.source_id,
            source_type=request.source_type.value,
            protocol=request.protocol,
            description=request.description
        )
        # Convert datetime objects to strings for serialization
        for key in ['created_at', 'updated_at']:
            if result.get(key):
                result[key] = str(result[key])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to register source: {str(e)}")


@router.get("", response_model=List[SourceInfo])
async def list_sources():
    """List all registered data sources."""
    try:
        sources = db_service.get_all_sources()
        for s in sources:
            for key in ['created_at', 'updated_at']:
                if s.get(key):
                    s[key] = str(s[key])
        return sources
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{source_id}", response_model=SourceInfo)
async def get_source(source_id: str):
    """Get details for a specific source."""
    result = db_service.get_source(source_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    for key in ['created_at', 'updated_at']:
        if result.get(key):
            result[key] = str(result[key])
    return result


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_source(source_id: str):
    """Delete a source and all associated blueprints, rules, and configs."""
    deleted = db_service.delete_source(source_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return None


# ============================================================
# MAPPING BLUEPRINTS
# ============================================================

@router.post("/{source_id}/blueprints", response_model=List[MappingBlueprintInfo],
             status_code=status.HTTP_201_CREATED)
async def set_blueprints(source_id: str, blueprints: List[MappingBlueprintCreate]):
    """
    Set mapping blueprints for a source.
    Replaces all existing blueprints for this source.
    """
    source = db_service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found. Register it first.")
    
    try:
        bp_dicts = [bp.model_dump() for bp in blueprints]
        results = db_service.upsert_blueprints(source_id, bp_dicts)
        for r in results:
            if r.get('created_at'):
                r['created_at'] = str(r['created_at'])
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{source_id}/blueprints", response_model=List[MappingBlueprintInfo])
async def get_blueprints(source_id: str):
    """Get all mapping blueprints for a source."""
    blueprints = db_service.get_blueprints(source_id)
    for bp in blueprints:
        if bp.get('created_at'):
            bp['created_at'] = str(bp['created_at'])
    return blueprints


# ============================================================
# DATA QUALITY RULES
# ============================================================

@router.post("/{source_id}/dq-rules", response_model=DQRuleInfo,
             status_code=status.HTTP_201_CREATED)
async def add_dq_rule(source_id: str, rule: DQRuleCreate):
    """Add a data quality rule for a source."""
    source = db_service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found. Register it first.")
    
    try:
        result = db_service.add_dq_rule(
            source_id=source_id,
            rule_name=rule.rule_name,
            rule_logic=rule.rule_logic,
            action_on_fail=rule.action_on_fail.value,
            severity=rule.severity.value
        )
        if result.get('created_at'):
            result['created_at'] = str(result['created_at'])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{source_id}/dq-rules", response_model=List[DQRuleInfo])
async def get_dq_rules(source_id: str):
    """Get all data quality rules for a source."""
    rules = db_service.get_dq_rules(source_id)
    for r in rules:
        if r.get('created_at'):
            r['created_at'] = str(r['created_at'])
    return rules
