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
from processors.api_poller import get_poller

router = APIRouter(prefix="/api/v1/sources", tags=["Control Plane"])


# ============================================================
# SOURCE MANAGEMENT
# ============================================================

@router.post("/register", response_model=SourceInfo, status_code=status.HTTP_201_CREATED)
async def register_source(request: SourceRegistration):
    """
    **Register a Data Source**
    
    Tells the Control Plane that a new data pipeline is being established. This is the first step before configuring Mapping Blueprints or Data Quality rules.
    
    * **source_id**: Must be a unique snake_case identifier (e.g. `opensky_network`).
    * **source_type**: Identifies how data physically arrives (`API_POLL`, `STREAM`, `STATIC_FILE`).
    * **protocol**: The transport layer (e.g. `HTTP`, `MQTT`).
    """
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


@router.get("/with-status")
async def list_sources_with_status():
    """List all sources with their API polling health status."""
    try:
        sources = db_service.get_all_sources()
        result = []
        for s in sources:
            for key in ['created_at', 'updated_at']:
                if s.get(key):
                    s[key] = str(s[key])
            cfg = db_service.get_api_config(s['source_id'])
            s['poll_status'] = None
            if cfg:
                s['poll_status'] = {
                    'is_polling': cfg.get('is_polling', False),
                    'last_status': cfg.get('last_status'),
                    'last_error': cfg.get('last_error'),
                    'last_polled_at': str(cfg['last_polled_at']) if cfg.get('last_polled_at') else None,
                }
            result.append(s)
        return result
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
    """Delete a source and all associated blueprints, rules, configs, and data."""
    # Instantly kill the background API poller task if it exists
    try:
        await get_poller().stop_polling_source(source_id)
    except Exception:
        pass
        
    deleted = db_service.delete_source(source_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")
    return None


@router.delete("/{source_id}/data", status_code=status.HTTP_200_OK)
async def purge_source_data(source_id: str):
    """
    **Purge Table Data (Keep Configuration)**

    Wipes all ingested data for a source — the Iceberg table and Silver registry entry —
    without touching your source registration, blueprints, or polling config.

    Use this when you want a clean slate (e.g. schema changed, bad data accumulated)
    and plan to re-register or trigger a fresh poll immediately after.

    * **Iceberg Table**: Dropped from the catalog and all Parquet files removed.
    * **Silver Registry**: Entry cleared so the table list is clean.
    * **Source Config / Blueprints**: ✅ Preserved — no need to re-enter them.
    """
    source = db_service.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found.")

    from services import iceberg_service
    dropped = iceberg_service.drop_table(source_id)
    db_service.purge_silver_entry(source_id)

    return {
        "status": "purged",
        "source_id": source_id,
        "iceberg_table_dropped": dropped,
        "message": "Data cleared. Source config and blueprints are intact. Re-register or wait for next poll."
    }


# ============================================================
# MAPPING BLUEPRINTS
# ============================================================

@router.post("/{source_id}/blueprints", response_model=List[MappingBlueprintInfo],
             status_code=status.HTTP_201_CREATED)
async def set_blueprints(source_id: str, blueprints: List[MappingBlueprintCreate]):
    """
    **Configure Pipeline Mapping Blueprints (The Data Scalpel)**
    
    Raw data from the internet (especially from OpenStreetMap or generic APIs) is often messy and deeply nested with arrays and dictionaries. If you dump that straight into your analytical database, your queries will be slow and complex.
    
    This endpoint allows you to define exactly how HVE-OS extracts the hidden gold from the noise. You are telling the system: *"Go into the raw JSON payload, find this exactly formatted string, pull it out, cast it as a FLOAT, and make it a primary, top-level column in my Iceberg table."*
    
    ### 📝 Parameters & Tutorial
    You must submit a JSON Array (`[...]`) containing one or more blueprint objects. Use this structure to map your data:
    
    * **`target_field`** *(string)*: The final mathematical column name you want in your Iceberg Lakehouse (e.g. `latitude` or `base_name`).
    * **`json_path`** *(string)*: The JSONPath syntax used to hunt down the value inside the raw payload. 
        * *Example 1:* Raw payload is `{"user": {"id": 5}}` -> Enter `$.user.id`.
        * *Example 2:* Array element `{"tags": ["military", "base"]}` -> `$.tags[0]`.
    * **`data_type`** *(string)*: Forces the system to cast the extracted string into a strict Database Schema type before saving it to Parquet. Valid options: `STRING`, `INT`, `FLOAT`, `BOOLEAN`, `BIGINT`, `TIMESTAMP`.
    * **`is_primary_key`** *(boolean)*: If true, tells the system this row is unique (e.g., `base_id`).
    * **`is_required`** *(boolean)*: **Powerful Gatekeeper.** If true, and the `json_path` extracts a `null` or missing value, the system will instantly reject and quarantine the row!
    * **`default_value`** *(string, optional)*: If the extraction fails but `is_required` is false, it uses this safely.
    
    ### ⚠️ Warnings & Constraints
    **Destructive Update:** Submitting a payload here completely eradicates and **replaces** any previous blueprints for this `source_id`. You must always submit your *complete* list of mapped fields.
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
    """
    **Inject a Data Quality Filter Rule (The Python Firewall)**
    
    This is the ultimate anomaly detection and spam filtering gate. It allows you to dynamically inject pure Python execution barriers directly into the center of the telemetry ingest stream, filtering millions of records per second without database lock-ups.
    
    Instead of writing SQL queries later to filter out bad data, you filter it out *before* it physically enters the data warehouse.
    
    ### 📝 Parameters & Tutorial
    * **`rule_name`** *(string)*: A human-readable name describing the firewall rule (e.g. `Must be a military base`).
    * **`rule_logic`** *(string)*: Pure Python math and logic! The engine evaluates this string directly against the mapped Iceberg columns you generated via your Blueprints. 
        * *Example 1 (Basic Math):* `speed_mph > 0 and speed_mph < 800`
        * *Example 2 (String matching):* `category == 'base'`
        * *Example 3 (Null checks):* `name is not None`
        * *Example 4 (Lists):* `base_name.lower() not in ['classified', 'redacted']`
    * **`action_on_fail`** *(enum)*: What physical action the system takes when your Python `rule_logic` evaluates to `False`.
        * `QUARANTINE`: Bumps the raw payload out of the pipeline and saves it to a special "DLQ" (Dead Letter Queue) bucket in MinIO so you can inspect *why* it failed later. Recommended.
        * `DROP`: Instantly eradicates the payload from RAM. No trace left behind.
        * `FLAG`: Allows the row to pass perfectly into Iceberg, but attaches a red flag metadata tag for downstream warnings.
    * **`severity`** *(enum)*: Defines how loud the alarm bells ring. Must strictly be exactly `ERROR`, `WARNING`, or `INFO`.
    
    ### 🛡️ Why use this instead of Blueprints?
    Blueprints define the *shape* (`latitude` must exist). DQ Rules define the *reality* (`latitude` must exist AND be within Texas boundaries).
    """
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
