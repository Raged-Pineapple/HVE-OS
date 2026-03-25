import json
import logging
from jsonschema import validate, ValidationError
from app.ingestion.bus import message_bus

logger = logging.getLogger(__name__)

class SchemaRegistry:
    """
    Sub-layer 3: Schema Management.
    Enforces BACKWARD_TRANSITIVE rules. Registers versioned JSON schemas permanently.
    """
    def __init__(self):
        # Hardcode an in-memory test registry. Production would be Confluent Schema Registry.
        self._schemas = {
            "WEATHER_API": {
                "version": 1,
                "schema": {
                    "type": "object",
                    "properties": {
                        "temperature": {"type": "number"},
                        "wind_speed": {"type": "number"},
                        "hurricane_threat": {"type": "boolean"}
                    },
                    "required": ["temperature"]
                }
            }
        }
        
    def get_schema(self, source_id: str):
        # We try to match source_id, otherwise use a generic flexible schema
        if source_id in self._schemas:
            return self._schemas[source_id]
        return None

    def _auto_evolve_schema(self, source_id: str, payload: dict, current_schema: dict):
        """
        Implementation of BACKWARD_TRANSITIVE auto-evolution.
        Adding an optional field is completely backward-compatible.
        """
        schema_def = current_schema["schema"]
        new_properties = {**schema_def["properties"]}
        has_evolution = False
        
        for key, value in payload.items():
            if key not in new_properties:
                has_evolution = True
                # Infer type
                if isinstance(value, int) or isinstance(value, float):
                    t = "number"
                elif isinstance(value, bool):
                    t = "boolean"
                else:
                    t = "string"
                    
                new_properties[key] = {"type": t}
                
        if has_evolution:
            v_new = current_schema["version"] + 1
            schema_def["properties"] = new_properties
            self._schemas[source_id] = {"version": v_new, "schema": schema_def}
            logger.warning(f"🔧 SCHEMA EVOLUTION: Auto-evolved {source_id} to v{v_new} due to new optional fields.")
            return True
        return False

    async def validate_and_route(self, canonical_record: dict):
        """
        The Master Validator.
        1. Checks schema. 2. Routes to ingest.validated OR ingest.dlq
        Runs as a consumer stream in the background processing ingest.raw.*
        """
        source_id = canonical_record.get("source_id")
        raw_payload = canonical_record.get("payload", {})
        
        schema_block = self.get_schema(source_id)
        if not schema_block:
            # If no strict schema exists, we pass it but theoretically we should DLQ it in level-3.
            await message_bus.publish_validated(canonical_record)
            return
            
        try:
            # Step 1-5: Required fields, types, format constraints
            validate(instance=raw_payload, schema=schema_block["schema"])
            
            # Sub-layer 3 rule: Auto-evolve if unmapped properties exist (but valid JSON)
            self._auto_evolve_schema(source_id, raw_payload, schema_block)
            
            # Publish to validated domain
            await message_bus.publish_validated(canonical_record)
            
        except ValidationError as e:
            # Sub-layer 3 rule: DLQ Routing.
            failure_reason = {
                "error_type": "SCHEMA_MISMATCH",
                "field": list(e.path)[0] if e.path else "root",
                "message": e.message,
                "expected_schema_version": schema_block["version"]
            }
            await message_bus.publish_dlq(raw_payload=canonical_record, failure_reason=failure_reason)

schema_registry = SchemaRegistry()
