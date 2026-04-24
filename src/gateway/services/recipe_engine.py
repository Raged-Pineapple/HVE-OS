import logging
from datetime import datetime

logger = logging.getLogger(__name__)

def _resolve_path(obj: dict, path: str):
    """Safely get a value from a nested dict using a dot-path."""
    if not isinstance(obj, dict):
        return None
    keys = path.split('.')
    val = obj
    for k in keys:
        if isinstance(val, dict):
            val = val.get(k)
        else:
            return None
    return val

def _set_path(obj: dict, path: str, value):
    """Set a value in a nested dict using a dot-path, modifying obj in place."""
    keys = path.split('.')
    curr = obj
    for i, k in enumerate(keys[:-1]):
        if k not in curr or not isinstance(curr[k], dict):
            curr[k] = {}
        curr = curr[k]
    curr[keys[-1]] = value

def _flatten(record: dict, field: str) -> dict:
    """Flatten a nested object into multiple columns: field.key -> value."""
    val = _resolve_path(record, field)
    if not isinstance(val, dict):
        return record
    
    new_record = dict(record)
    # Remove the original nested object
    keys = field.split('.')
    if len(keys) == 1:
        new_record.pop(field, None)
    else:
        # Shallow copy to avoid mutating original, but we only go 1 level deep for deletion
        # Realistically, it's safer to just set it to None or leave it if we flatten,
        # but let's do a simple pop if it's top level.
        pass # For deeper nested, we might just leave the parent dict but add flat keys.
             # Actually, best is to just add the flat keys and optionally delete the old.
             # Let's delete the old field to keep it clean.
             
    # A robust way to delete the old field
    _del_path(new_record, field)

    for k, v in val.items():
        new_record[f"{field}.{k}"] = v
    return new_record

def _del_path(obj: dict, path: str):
    keys = path.split('.')
    curr = obj
    for i, k in enumerate(keys[:-1]):
        if isinstance(curr, dict) and k in curr:
            curr = curr[k]
        else:
            return
    if isinstance(curr, dict) and keys[-1] in curr:
        del curr[keys[-1]]

def _explode_all(rows: list, field: str) -> list:
    """Explode an array field. 1 row with array[N] -> N rows."""
    new_rows = []
    for row in rows:
        arr = _resolve_path(row, field)
        if not isinstance(arr, list):
            new_rows.append(row)
            continue
            
        for item in arr:
            new_row = dict(row)
            _del_path(new_row, field)
            
            if isinstance(item, dict):
                # If array of objects, merge child keys into row
                for k, v in item.items():
                    new_row[k] = v
            else:
                # If array of primitives, just put it under the field name
                new_row[field] = item
                
            new_rows.append(new_row)
    return new_rows

def _cast_field(record: dict, field: str, type_str: str) -> dict:
    val = record.get(field)
    if val is None:
        return record
        
    try:
        new_val = val
        if type_str == 'INT' or type_str == 'BIGINT':
            new_val = int(float(val)) if isinstance(val, (str, float)) else int(val)
        elif type_str == 'FLOAT':
            new_val = float(val)
        elif type_str == 'STRING':
            if isinstance(val, (dict, list)):
                import json
                new_val = json.dumps(val)
            else:
                new_val = str(val)
        elif type_str == 'BOOLEAN':
            new_val = str(val).lower() in ('true', '1', 't', 'y', 'yes')
        
        record[field] = new_val
    except Exception as e:
        logger.debug(f"Failed to cast {field}={val} to {type_str}: {e}")
        # Keep original if cast fails
    return record

def _eval_filter(record: dict, expr: str) -> bool:
    try:
        safe_globals = {"__builtins__": {
            "None": None, "True": True, "False": False,
            "abs": abs, "len": len, "str": str, "int": int, "float": float
        }}
        return bool(eval(expr, safe_globals, dict(record)))
    except Exception as e:
        logger.debug(f"Filter eval failed: {expr} on {record}: {e}")
        return False # Drop row if filter evaluation fails

def execute_recipe(record: dict, recipe: dict) -> list[dict]:
    """Apply a sequence of operations to a raw record, returning a list of flat rows."""
    if not recipe or "operations" not in recipe:
        return [record]

    rows = [record]
    
    for op in recipe["operations"]:
        op_type = op.get("op")
        
        if op_type == "flatten":
            rows = [_flatten(r, op["field"]) for r in rows]
            
        elif op_type == "explode":
            rows = _explode_all(rows, op["field"])
            
        elif op_type == "rename":
            new_rows = []
            for r in rows:
                new_r = dict(r)
                if op["from"] in new_r:
                    val = new_r.pop(op["from"])
                    new_r[op["to"]] = val
                new_rows.append(new_r)
            rows = new_rows
            
        elif op_type == "delete":
            new_rows = []
            for r in rows:
                new_r = dict(r)
                new_r.pop(op["field"], None)
                new_rows.append(new_r)
            rows = new_rows
            
        elif op_type == "cast":
            rows = [_cast_field(r, op["field"], op["type"]) for r in rows]
            
        elif op_type == "filter":
            rows = [r for r in rows if _eval_filter(r, op["expr"])]
            
    return rows
