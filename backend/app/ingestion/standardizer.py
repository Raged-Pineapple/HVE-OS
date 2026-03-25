import hashlib
import json
import time
from typing import Dict, Any
from app.ingestion.bus import message_bus
import logging

logger = logging.getLogger(__name__)

class PayloadStandardizer:
    """
    Sub-layer 1: Source Connectivity.
    Every connector, regardless of type, produces the same raw ingestion record structure.
    """
    
    def apply_mapping(self, raw_payload: Dict[str, Any], field_mapping: Dict[str, str]) -> list[Dict[str, Any]]:
        """
        Takes raw API payload and unrolls it based on Zapier-style field mappings.
        Handles nested arrays by exploding them into separate canonical records.
        Example mapping: {"states[*][0]": "icao_hex", "states[*][1]": "callsign", "time": "ts"}
        """
        def get_value_by_path(data, path):
            if not path: return data
            val = data
            for k in path.split('.'):
                if isinstance(val, dict) and k in val: val = val[k]
                else: return None
            return val

        base_array_path = next((p.split("[*]")[0] for p in field_mapping if "[*]" in p), None)
        
        # 1. Direct 1-to-1 Mapping (No explosive arrays)
        if not base_array_path:
            out = {target: get_value_by_path(raw_payload, path) for path, target in field_mapping.items()}
            return [out]
            
        # 2. Array Explosion Mapping (e.g. OpenSky iterating over states)
        array_data = get_value_by_path(raw_payload, base_array_path)
        if not isinstance(array_data, list): return []
            
        results = []
        for item in array_data:
            out = {}
            for path, target_name in field_mapping.items():
                if path.startswith(base_array_path + "[*]"):
                    sub_path = path[len(base_array_path + "[*]"):]
                    if sub_path.startswith("[") and sub_path.endswith("]"):  # Primitive Array index like [0]
                        idx = int(sub_path[1:-1])
                        out[target_name] = item[idx] if isinstance(item, list) and len(item) > idx else None
                    elif sub_path.startswith("."):  # Dict object path like .icao24
                        out[target_name] = get_value_by_path(item, sub_path[1:])
                    elif not sub_path:  # Just the raw item
                        out[target_name] = item
                else:
                    # Root-level constant field (like "time")
                    out[target_name] = get_value_by_path(raw_payload, path)
            results.append(out)
        return results

    def generate_canonical(self, source_id: str, mapped_payload: Dict[str, Any], batch_id: str) -> Dict[str, Any]:
        # Hash the actual payload bytes deterministically
        payload_bytes = json.dumps(mapped_payload, sort_keys=True).encode('utf-8')
        row_hash = hashlib.sha256(payload_bytes).hexdigest()
        
        # Determine source_ts
        source_ts = mapped_payload.get("timestamp") or mapped_payload.get("created_at") or mapped_payload.get("updated_at")
        if not source_ts:
            source_ts = int(time.time() * 1000)
            
        canonical = {
            "source_id": source_id,
            "connector_version": "v2.0-palantir",
            "ingest_timestamp": int(time.time() * 1000),
            "source_ts": source_ts,
            "row_hash": row_hash,
            "batch_id": batch_id,
            "payload": mapped_payload
        }
        return canonical

    async def standardize_and_publish(self, source_id: str, raw_payload: Dict[str, Any], batch_id: str, partition_key: str = None, field_mapping: dict = None):
        """
        Receives raw data from any source.
        If a field_mapping is provided (e.g. from the React Settings Canvas), it unrolls arrays
        and extracts exactly the Zapier paths before publishing to the Message Bus.
        """
        if field_mapping:
            extracted_records = self.apply_mapping(raw_payload, field_mapping)
        else:
            extracted_records = [raw_payload]
            
        published = []
        for record in extracted_records:
            canonical_record = self.generate_canonical(source_id, record, batch_id)
            
            # Publish exactly to ingest.raw.{source_id}
            await message_bus.publish_raw(
                source_id=source_id, 
                payload=canonical_record, 
                partition_key=partition_key or canonical_record.get('row_hash')
            )
            published.append(canonical_record)
            
        return published

standardizer = PayloadStandardizer()
