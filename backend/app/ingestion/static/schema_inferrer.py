import re

class SchemaInferrer:
    """
    Stage 3: Statistical Type Inference Cascade
    """
    def strip_val(self, v):
        if v is None: return None
        v = str(v).strip()
        if v.lower() in ["null", "n/a", "-", "", "nan"]: return None
        return v
        
    def infer_type(self, values: list) -> str:
        clean_vals = [self.strip_val(v) for v in values]
        valid_vals = [v for v in clean_vals if v is not None]
        if not valid_vals: return "TEXT" # Unknown default
        
        # 1. BOOLEAN 
        bool_set = {"true", "false", "yes", "no", "1", "0", "y", "n", "t", "f"}
        if all(v.lower() in bool_set for v in valid_vals):
            return "BOOLEAN"
            
        # 2. INTEGER
        def is_int(x):
            try: int(x.replace(",", "")); return True
            except: return False
        if all(is_int(v) for v in valid_vals):
            return "INTEGER"
            
        # 3. FLOAT
        def is_float(x):
            try: float(x.replace(",", ".")); return True
            except: return False
        if all(is_float(v) for v in valid_vals):
            return "FLOAT"
            
        # 4. TIMESTAMP (10 digit unix, 13 digit unix, or ISO)
        def is_ts(x):
            # rudimentary fast check, user specifically asked for fast 10/13 unix
            if x.isdigit() and (len(x) == 10 or len(x) == 13): return True
            if "T" in x and str(x).endswith("Z"): return True
            return False
            
        if all(is_ts(v) for v in valid_vals):
            return "TIMESTAMP"
            
        return "TEXT"
        
    def infer_column_schema(self, col_name: str, values: list) -> dict:
        clean = [self.strip_val(v) for v in values]
        non_nulls = [v for v in clean if v is not None]
        
        total = len(values) or 1
        fill_rate = len(non_nulls) / total
        unique_count = len(set(non_nulls))
        uniqueness = unique_count / len(non_nulls) if non_nulls else 0
        
        col_type = self.infer_type(values)
        avg_len = sum(len(v) for v in non_nulls) / len(non_nulls) if non_nulls else 0
        
        return {
            "name": col_name,
            "sample": non_nulls[:5],
            "fill_rate": round(fill_rate, 4),
            "uniqueness": round(uniqueness, 4),
            "type": col_type,
            "avg_length": round(avg_len, 2)
        }

    def infer_schema(self, records: list[dict]) -> list[dict]:
        """
        Takes raw dictionaries from Stage 2. Computes independent schema per column spanning 1000 rows.
        """
        if not records: return []
        # Sample first 1000
        sample = records[:1000]
        keys = list(sample[0].keys())
        
        schema = []
        for k in keys:
            vals = [r.get(k) for r in sample]
            schema.append(self.infer_column_schema(k, vals))
            
        return schema

schema_inferrer = SchemaInferrer()
