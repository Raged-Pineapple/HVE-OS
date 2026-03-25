import hashlib
import json

class DiffEngine:
    """
    Stage 10: Diff on Re-import.
    Isolates NEW and CHANGED rows to prevent redundant history writes.
    """
    def hash_row(self, row: dict) -> str:
        return hashlib.sha256(json.dumps(row, sort_keys=True).encode('utf-8')).hexdigest()

    def compute_diff(self, new_records: list[dict], existing_records: list[dict], pk_col: str) -> dict:
        existing_map = {str(r.get(pk_col)): r for r in existing_records if r.get(pk_col) is not None}
        
        stats = {"NEW": 0, "CHANGED": 0, "DELETED": 0, "UNCHANGED": 0}
        diff_preview = {"NEW": [], "CHANGED": [], "UNCHANGED_COUNT": 0}
        
        new_pk_seen = set()
        
        for row in new_records:
            pk_val = str(row.get(pk_col))
            if not pk_val or pk_val == "None": continue
            
            new_pk_seen.add(pk_val)
            row_hash = self.hash_row(row)
            
            if pk_val not in existing_map:
                stats["NEW"] += 1
                if len(diff_preview["NEW"]) < 5: diff_preview["NEW"].append(row)
            else:
                existing_hash = self.hash_row(existing_map[pk_val])
                if row_hash != existing_hash:
                    stats["CHANGED"] += 1
                    if len(diff_preview["CHANGED"]) < 5: 
                        diff_preview["CHANGED"].append({"old": existing_map[pk_val], "new": row})
                else:
                    stats["UNCHANGED"] += 1
                    diff_preview["UNCHANGED_COUNT"] += 1
                    
        stats["DELETED"] = len(set(existing_map.keys()) - new_pk_seen)
        
        return {
            "stats": stats,
            "preview": diff_preview
        }

diff_engine = DiffEngine()
