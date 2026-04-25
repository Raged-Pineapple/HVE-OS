import json
import uuid
import jmespath
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

def apply_blueprints(payload: dict, source_id: str, blueprints: list, ingest_ts: str = None, base_hve_id: str = None) -> list:
    """
    Core mapping logic: extracts fields via JMESPath and performs Array Explosion.
    Used by both DebugPipeline (preview) and StreamProcessor (production).
    
    :param payload: The raw data dictionary.
    :param source_id: ID of the data source.
    :param blueprints: List of mapping blueprint dicts or objects.
    :param ingest_ts: Optional ISO timestamp.
    :param base_hve_id: Optional UUID to use for the first row.
    :return: List of flat row dictionaries.
    """
    if ingest_ts is None:
        ingest_ts = datetime.utcnow().isoformat()
        
    extracted = {}
    max_list_len = 1
    
    for bp in blueprints:
        # Support both dicts (from DB/models) and objects (Pydantic)
        if hasattr(bp, "get"):
            path = bp.get("jmes_path") or bp.get("json_path") or ""
            target = bp.get("target_field", "unknown")
            dtype = bp.get("data_type", "STRING").upper()
            default = bp.get("default_value")
            should_explode = bp.get("should_explode", True)
        else:
            path = getattr(bp, "jmes_path", "") or getattr(bp, "json_path", "") or ""
            target = getattr(bp, "target_field", "unknown")
            dtype = getattr(bp, "data_type", "STRING").upper()
            default = getattr(bp, "default_value", None)
            should_explode = getattr(bp, "should_explode", True)

        # Strip legacy JSONPath prefix if present
        if path.startswith("$."):
            path = path[2:]

        val = None
        if path:
            try:
                val = jmespath.search(path, payload)
            except Exception as e:
                logger.debug(f"JMESPath error for {target}: {e}")

        # ── Leaf Array vs Explodable Array Logic ──
        if isinstance(val, list):
            # User explicitly requested NO explosion: serialize to string
            if not should_explode:
                val = json.dumps(val)
            else:
                # It's a list and we should explode it (regardless of [*] wildcard presence)
                max_list_len = max(max_list_len, len(val))
        
        extracted[target] = (val, dtype, default)

    # 2. Zip extracted arrays into flat rows (The Explosion)
    rows = []
    for i in range(max_list_len):
        # Use provided base_hve_id for the first row only, otherwise generate new ones
        row_id = base_hve_id if (i == 0 and base_hve_id) else str(uuid.uuid4())
        
        row = {
            "_hve_id": row_id,
            "_source_id": source_id,
            "_ingest_ts": ingest_ts,
        }
        
        for target, (val, dtype, default) in extracted.items():
            # Pick index i if it's an explodable list, else duplicate the scalar/serialized value
            if isinstance(val, list):
                v = val[i] if i < len(val) else None
            else:
                v = val
            
            if v is None:
                v = default
            
            # Type coercion
            if v is not None:
                try:
                    if dtype == "INT":
                        v = int(v)
                    elif dtype in ["FLOAT", "DOUBLE"]:
                        v = float(v)
                    elif dtype == "BOOLEAN":
                        v = bool(v)
                    elif dtype == "BIGINT":
                        v = int(v)
                    else:
                        v = str(v)
                except (ValueError, TypeError):
                    v = default
            
            row[target] = v
        rows.append(row)

    return rows
