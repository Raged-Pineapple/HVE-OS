import json
import uuid
import jmespath
import logging
import traceback
from datetime import datetime
from typing import Any, Dict, List

import io
import contextlib
import ast
import pprint
import time

logger = logging.getLogger(__name__)

def _execute_with_repl_semantics(script: str, exec_globals: dict) -> Any:
    """
    Executes Python code with Jupyter/REPL semantics:
    If the last statement is an expression, it evaluates and returns it.
    """
    parsed = ast.parse(script)
    if not parsed.body:
        return None
    
    last_node = parsed.body[-1]
    if isinstance(last_node, ast.Expr):
        exec_body = parsed.body[:-1]
        if exec_body:
            mod = ast.Module(body=exec_body, type_ignores=[])
            compiled_mod = compile(mod, filename="<ast>", mode="exec")
            exec(compiled_mod, exec_globals)
        
        expr = ast.Expression(body=last_node.value)
        compiled_expr = compile(expr, filename="<ast>", mode="eval")
        return eval(compiled_expr, exec_globals)
    else:
        compiled = compile(parsed, filename="<ast>", mode="exec")
        exec(compiled, exec_globals)
        return None

def run_script(payload: Any, source_id: str, script: str, ingest_ts: str | None = None, base_hve_id: str | None = None) -> Dict[str, Any]:
    """
    Runs a custom Python mapping script with full REPL capabilities.
    Returns a dict with 'rows', 'logs', and 'error'.
    """
    rows = []
    log_capture = io.StringIO()
    
    def get(path, data=payload):
        return jmespath.search(path, data)

    exec_globals = {
        "payload": payload,
        "rows": rows,
        "uuid": uuid,
        "json": json,
        "jmespath": jmespath,
        "datetime": datetime,
        "get": get,
    }

    try:
        t0 = time.time()
        with contextlib.redirect_stdout(log_capture):
            last_val = _execute_with_repl_semantics(script, exec_globals)
            if last_val is not None:
                # Pretty-print the last evaluated expression (Jupyter style)
                pprint.pprint(last_val, stream=log_capture, indent=2, width=100)
        
        exec_duration = (time.time() - t0) * 1000
        rows = exec_globals["rows"]
        
        # Add execution metrics to the end of the logs
        log_capture.write(f"\n[Execution Completed in {exec_duration:.2f}ms | Rows Extracted: {len(rows)}]")
        
    except Exception as e:
        error_msg = f"Script Error: {str(e)}\n{traceback.format_exc()}"
        logger.error(f"[{source_id}] {error_msg}")
        return {"rows": [], "logs": log_capture.getvalue(), "error": error_msg}

    # Stamp HVE metadata onto every row (Prepend them so they appear first in UI)
    final = []
    for i, row in enumerate(rows):
        meta = {
            "_hve_id": f"{base_hve_id}_{i}" if base_hve_id else str(uuid.uuid4()),
            "_source_id": source_id,
            "_ingest_ts": ingest_ts or datetime.utcnow().isoformat()
        }
        # Merge the user's row data after the metadata
        final.append({**meta, **row})

    return {"rows": final, "logs": log_capture.getvalue(), "error": None}

def _coerce_type(v, dtype, default):
    if v is None:
        return default
    try:
        if dtype == "INT": return int(v)
        elif dtype in ["FLOAT", "DOUBLE"]: return float(v)
        elif dtype == "BOOLEAN": return bool(v)
        elif dtype == "BIGINT": return int(v)
        else: return str(v)
    except (ValueError, TypeError):
        return default

def apply_blueprints(payload: dict, source_id: str, blueprints: list, ingest_ts: str = None, base_hve_id: str = None) -> list:
    """
    Advanced Record-Oriented Mapping:
    1. Parallel Zip: Extracts fields (scalars, lists, or objects) and zips them into 'records'.
    2. Object Unpacking: If a field is an object, its keys are unpacked into the record.
    3. Row Explosion: If any field (or unpacked sub-field) is a list and 'should_explode' is True, 
       expands the record into multiple rows.
    """
    if ingest_ts is None:
        ingest_ts = datetime.utcnow().isoformat()
        
    extracted = {}
    max_list_len = 1
    
    # Track metadata for each target field
    field_meta = {} # target -> (dtype, default, should_explode)
    
    for bp in blueprints:
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

        if path.startswith("$."):
            path = path[2:]

        val = None
        if path:
            try:
                val = jmespath.search(path, payload)
            except Exception as e:
                logger.debug(f"JMESPath error for {target}: {e}")

        if isinstance(val, list):
            max_list_len = max(max_list_len, len(val))
        
        field_meta[target] = (dtype, default, should_explode)
        extracted[target] = val

    # 2. Stage 1: Zip into 'Base Records' and Unpack Objects
    base_records = []
    for i in range(max_list_len):
        record = {}
        for target, val in extracted.items():
            dtype, default, should_explode = field_meta[target]
            v = val[i] if isinstance(val, list) else val
            
            # UNPACKING: If the value is a dict, merge its keys into the record
            if isinstance(v, dict):
                for k, inner_v in v.items():
                    # Preserve metadata for inner fields (inherit from parent blueprint)
                    record[k] = (inner_v, dtype, default, should_explode)
            else:
                record[target] = (v, dtype, default, should_explode)
        base_records.append(record)

    # 3. Stage 2: Explode Records into Rows
    final_rows = []
    for record in base_records:
        
        # Determine the maximum inner list length for this specific record
        inner_max = 1
        for target, (v, _, _, should_explode) in record.items():
            if should_explode and isinstance(v, list):
                inner_max = max(inner_max, len(v))
        
        # Create 'inner_max' rows for this one record
        for j in range(inner_max):
            row_id = base_hve_id if (len(final_rows) == 0 and base_hve_id) else str(uuid.uuid4())
            row = {
                "_hve_id": row_id,
                "_source_id": source_id,
                "_ingest_ts": ingest_ts,
            }
            
            for target, (v, dtype, default, should_explode) in record.items():
                # If this column is being exploded, pick index j
                if should_explode and isinstance(v, list):
                    cell_val = v[j] if j < len(v) else None
                else:
                    cell_val = v
                
                row[target] = _coerce_type(cell_val, dtype, default)
                
            final_rows.append(row)

    return final_rows

