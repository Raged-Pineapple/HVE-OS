"""
inference_service.py — Blueprint Recommender Engine
Analyzes raw Bronze records and recommends flattening schemas for the Control Plane.
"""
import logging
from typing import List, Dict, Any
from .minio_service import BRONZE_BUCKET, peek_latest_objects

logger = logging.getLogger(__name__)

def infer_blueprint(source_id: str) -> List[Dict[str, Any]]:
    """
    Look at the latest Bronze raw data and recommend a Mapping Blueprint.
    """
    records = peek_latest_objects(BRONZE_BUCKET, source_id, limit=3)
    if not records:
        return []

    # Get the inner payload
    sample = records[0].get("payload", records[0])
    blueprints = []
    
    # ── Level 1: Flat fields ──
    for key, value in sample.items():
        if key in ("hve_id", "source_id", "ingest_timestamp"):
            continue
            
        if isinstance(value, (str, int, float, bool)) or value is None:
            blueprints.append({
                "target_field": key.lower(),
                "jmes_path": f"{key}",
                "data_type": _map_type(value),
                "is_primary_key": key.lower() in ("id", "guid", "uuid", "icao24"),
                "is_required": False
            })
        
        # ── Level 2: Simple nesting ──
        elif isinstance(value, dict):
            for sub_key, sub_val in value.items():
                if isinstance(sub_val, (str, int, float, bool)) or sub_val is None:
                    blueprints.append({
                        "target_field": f"{key}_{sub_key}".lower(),
                        "jmes_path": f"{key}.{sub_key}",
                        "data_type": _map_type(sub_val),
                        "is_primary_key": False,
                        "is_required": False
                    })

    return blueprints

def _map_type(value: Any) -> str:
    """Map Python type to Iceberg/SQL data type."""
    if isinstance(value, bool):
        return "BOOLEAN"
    if isinstance(value, int):
        return "BIGINT"  # Default to 64-bit safety
    if isinstance(value, float):
        return "DOUBLE"  # Default to 64-bit safety
    return "STRING"
