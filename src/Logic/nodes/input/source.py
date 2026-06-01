"""
source.py — Source Node
Fetches all entities from a Neo4j source for use in downstream nodes.
Tracks entity changes across fetches and annotates each entity with
position change metadata so downstream nodes see live deltas.
"""
import logging
import json
import ast
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

# ── Module-level cache: persists across execute_node() calls ──────────────
# Key: source_id → dict of { entity_key → entity_dict }
_entity_snapshot_cache: Dict[str, Dict[str, dict]] = {}

# Fields to watch for changes. Coordinates + velocity + heading.
TRACKED_FIELDS = ["latitude", "longitude", "lat", "lon", "velocity", "true_track", "geo_altitude", "baro_altitude"]
# Primary identity key candidates (in priority order)
IDENTITY_KEYS = ["_hve_id", "icao24", "callsign", "id", "name", "_source_id"]


def _deserialize_props(props: dict) -> dict:
    """Parse stringified JSON/Python objects back into native dicts/lists."""
    if not props:
        return props
    for k, v in list(props.items()):
        if isinstance(v, str) and (v.strip().startswith('{') or v.strip().startswith('[')):
            try:
                props[k] = json.loads(v)
            except Exception:
                try:
                    props[k] = ast.literal_eval(v)
                except Exception:
                    pass
    return props


def _entity_key(entity: dict) -> str:
    """Return a stable unique key for an entity, trying identity fields in order."""
    for k in IDENTITY_KEYS:
        v = entity.get(k)
        if v is not None and str(v).strip():
            return f"{k}:{v}"
    # Fallback: first 3 values stringified
    return str(list(entity.values())[:3])


def _safe_float(val) -> Optional[float]:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _diff_entity(prev: dict, curr: dict) -> dict:
    """
    Compare two entity snapshots. Returns a dict of changed fields with
    old → new values. Only tracks TRACKED_FIELDS.
    """
    changes = {}
    for field in TRACKED_FIELDS:
        pv = _safe_float(prev.get(field))
        cv = _safe_float(curr.get(field))
        if pv is None or cv is None:
            continue
        if abs(cv - pv) > 1e-6:  # floating-point safe comparison
            changes[field] = (pv, cv)
    return changes


@register_node
class SourceNode(BaseNode):
    """
    Source Node - fetches all entities from a Neo4j source.

    Tracks changes between fetches: if an entity's position or velocity
    has changed since the last execution, it is annotated with:
      - _position_changed: True
      - _prev_lat / _prev_lon  (previous coordinates)
      - _delta_lat / _delta_lon (signed coordinate delta)
      - _changed_fields: comma-separated list of changed field names

    These annotations flow naturally into SplitNode, MapNode, etc.
    """

    metadata = NodeMetadata(
        type="source",
        category="input",
        label="Source",
        color="#3B82F6",
        input_handles=[],
        output_handles=["data"],
        description="Fetch all entities from a Neo4j source",
        hide_in_sidebar=False
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        source_id = config.get("source_id")

        if not source_id:
            return NodeResult(
                success=False,
                outputs={},
                error="No source_id configured. Please specify a source in the node settings."
            )

        try:
            from services.neo4j_service import get_neo4j_service
            neo4j = get_neo4j_service()

            if not neo4j:
                return NodeResult(
                    success=False,
                    outputs={},
                    error="Neo4j service not available"
                )

            query = """
            MATCH (e)-[:PART_OF_SOURCE]->(s:Source {source_id: $source_id})
            RETURN properties(e) as entity
            """

            results = neo4j.execute_query(query, {"source_id": source_id})

            if not results:
                logger.info(f"No entities found for source: {source_id}")
                return NodeResult(
                    success=True,
                    outputs={"data": [], "count": 0},
                    metadata={"source_id": source_id}
                )

            entities = [_deserialize_props(dict(r["entity"])) for r in results]

            # ── Change Detection ──────────────────────────────────────────
            global _entity_snapshot_cache
            prev_snapshot = _entity_snapshot_cache.get(source_id, {})
            new_snapshot: Dict[str, dict] = {}

            updated_count = 0
            new_count = 0
            annotated_entities = []

            for entity in entities:
                key = _entity_key(entity)
                new_snapshot[key] = entity

                # Build display label for logs
                display = (
                    entity.get("callsign") or
                    entity.get("name") or
                    entity.get("icao24") or
                    key
                )
                display = str(display).strip()

                if key not in prev_snapshot:
                    # First time we see this entity
                    annotated = {
                        **entity,
                        "_position_changed": False,
                        "_is_new_entity": True,
                        "_changed_fields": "",
                    }
                    new_count += 1
                else:
                    prev = prev_snapshot[key]
                    changes = _diff_entity(prev, entity)

                    if changes:
                        # Build annotation fields
                        annotated = dict(entity)
                        annotated["_position_changed"] = True
                        annotated["_changed_fields"] = ",".join(changes.keys())
                        annotated["_is_new_entity"] = False

                        # Attach per-field prev/delta for lat and lon
                        lat_change = changes.get("latitude") or changes.get("lat")
                        lon_change = changes.get("longitude") or changes.get("lon")
                        if lat_change:
                            annotated["_prev_lat"] = lat_change[0]
                            annotated["_delta_lat"] = round(lat_change[1] - lat_change[0], 6)
                        if lon_change:
                            annotated["_prev_lon"] = lon_change[0]
                            annotated["_delta_lon"] = round(lon_change[1] - lon_change[0], 6)

                        updated_count += 1

                        # Log each changed entity clearly
                        parts = []
                        for field, (old_v, new_v) in changes.items():
                            parts.append(f"{field}: {old_v:.4f} → {new_v:.4f}")
                        logger.info(
                            f"[SourceNode:{source_id}] UPDATED {display!r:12s} | "
                            + "  ".join(parts)
                        )
                    else:
                        annotated = {
                            **entity,
                            "_position_changed": False,
                            "_is_new_entity": False,
                            "_changed_fields": "",
                        }

                annotated_entities.append(annotated)

            # Persist new snapshot for next call
            _entity_snapshot_cache[source_id] = new_snapshot

            # Summary log
            total = len(annotated_entities)
            if updated_count > 0:
                logger.info(
                    f"[SourceNode:{source_id}] Fetch complete — "
                    f"{updated_count} UPDATED  |  {new_count} new  |  {total - updated_count - new_count} unchanged  |  total={total}"
                )
            else:
                logger.info(
                    f"[SourceNode:{source_id}] Fetched {total} entities — no position changes detected"
                )

            all_keys = set()
            for e in annotated_entities:
                all_keys.update(e.keys())
            keys = sorted(list(all_keys))

            return NodeResult(
                success=True,
                outputs={
                    "data": annotated_entities,
                    "keys": keys,
                    "count": total
                },
                metadata={
                    "source_id": source_id,
                    "entity_count": total,
                    "updated_count": updated_count,
                    "new_count": new_count,
                    "key_count": len(keys),
                    "available_keys": keys
                }
            )

        except Exception as e:
            logger.error(f"SourceNode execution failed: {e}")
            return NodeResult(
                success=False,
                outputs={},
                error=f"Failed to fetch entities: {str(e)}"
            )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate that source_id is provided."""
        if not config.get("source_id"):
            return False, "source_id is required"
        return True, None