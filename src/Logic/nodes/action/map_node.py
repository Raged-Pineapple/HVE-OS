"""
map_node.py — Map Node
Action node that maps coordinates from incoming payloads to Geospatial Map format.
"""
import logging
from typing import Dict, Any, List, Optional
import hashlib
import json

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node

logger = logging.getLogger(__name__)

@register_node
class MapNode(BaseNode):
    metadata = NodeMetadata(
        type="mapNode",
        label="Geospatial Map",
        category="action",
        color="#2563EB",
        input_handles=["data", "default", "target"],
        output_handles=["data"],
        description=(
            "Extracts and formats geographical coordinates (latitude, longitude, status, value, label) "
            "from incoming entities and updates the Geospatial Map."
        )
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("[MapNode] ================== EXECUTION STARTED ==================")
        
        # 1. Resolve inputs
        input_val = inputs.get("data")
        if input_val is None: input_val = inputs.get("default")
        if input_val is None: input_val = inputs.get("target")
        
        # Handle isolated UI preview runs
        if input_val is None and not inputs:
            input_val = config.get("previewInput")
        elif input_val is None and inputs:
            input_val = list(inputs.values())[0]  # Aggressive fallback to whatever wire is connected

        # 2. Extract configuration fields
        lat_field = config.get("latField", "latitude").strip()
        lon_field = config.get("lonField", "longitude").strip()
        label_field = config.get("labelField", "name").strip()
        value_field = config.get("valueField", "value").strip()
        status_field = config.get("statusField", "status").strip()

        # 3. Collect entities (ensure we handle single dict or list of dicts)
        entities = []
        if isinstance(input_val, list):
            entities = [e for e in input_val if isinstance(e, dict)]
        elif isinstance(input_val, dict):
            entities = [input_val]
        else:
            # Fallback to scanning all inputs dict values
            for val in inputs.values():
                if isinstance(val, list):
                    entities.extend([e for e in val if isinstance(e, dict)])
                elif isinstance(val, dict):
                    entities.append(val)

        logger.info(f"[MapNode] Received {len(entities)} entities for mapping.")
        
        mapped_points = []
        
        # Helper to safely extract nested or simple dictionary keys
        def get_field_value(item: dict, field_path: str, default: Any = None) -> Any:
            if not field_path:
                return default
            parts = field_path.split(".")
            curr = item
            for p in parts:
                if isinstance(curr, dict) and p in curr:
                    curr = curr[p]
                else:
                    return default
            return curr

        for idx, entity in enumerate(entities):
            try:
                # Resolve coordinates
                lat_raw = get_field_value(entity, lat_field)
                if lat_raw is None:
                    # Check lowercase/common fallbacks
                    for fallback in ["latitude", "lat", "coordinate_y"]:
                        lat_raw = get_field_value(entity, fallback)
                        if lat_raw is not None:
                            break
                            
                lon_raw = get_field_value(entity, lon_field)
                if lon_raw is None:
                    # Check lowercase/common fallbacks
                    for fallback in ["longitude", "lon", "lng", "coordinate_x"]:
                        lon_raw = get_field_value(entity, fallback)
                        if lon_raw is not None:
                            break

                if lat_raw is None or lon_raw is None:
                    logger.debug(f"[MapNode] Entity at index {idx} missing lat/lon. Skipping.")
                    continue

                lat = float(lat_raw)
                lon = float(lon_raw)
                
                # Resolve other fields
                label = str(get_field_value(entity, label_field) or get_field_value(entity, "title") or get_field_value(entity, "_hve_id") or f"Point {idx}")
                val = str(get_field_value(entity, value_field) or get_field_value(entity, "_risk_score") or "Active")
                
                # Status: Map to standard 'healthy', 'warning', 'critical'
                status_raw = str(get_field_value(entity, status_field) or get_field_value(entity, "_risk_level") or "healthy").lower()
                if any(x in status_raw for x in ["critical", "error", "high", "fail"]):
                    status = "critical"
                elif any(x in status_raw for x in ["warning", "medium", "amber", "alert"]):
                    status = "warning"
                else:
                    status = "healthy"

                # Generate a unique ID
                hve_id = entity.get("_hve_id") or entity.get("id") or entity.get("name") or f"pt_{idx}"
                unique_id = f"node_map_{idx}_{hashlib.md5(str(hve_id).encode()).hexdigest()[:6]}"
                
                mapped_point = {
                    "id": unique_id,
                    "label": label,
                    "lat": lat,
                    "lon": lon,
                    "status": status,
                    "value": val,
                    "details": f"Dynamically mapped by MapNode logic pathway. Origin payload: {json.dumps(entity, default=str)}"
                }
                mapped_points.append(mapped_point)
                
            except Exception as e:
                logger.warning(f"[MapNode] Failed to map entity at index {idx}: {e}")

        logger.info(f"[MapNode] Successfully mapped {len(mapped_points)} points to map overlay format.")
        
        preview_payload = mapped_points if mapped_points else [{"message": "No coordinates mapped"}]

        return NodeResult(
            success=True,
            outputs={
                "data": mapped_points,
                "resolvedEntity": preview_payload
            },
            metadata={"mapped_count": len(mapped_points)}
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        # Map fields validation
        return True, None
