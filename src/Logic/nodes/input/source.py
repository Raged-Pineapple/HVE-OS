"""
source.py — Source Node
Fetches all entities from a Neo4j source for use in downstream nodes.
"""
import logging
import json
import ast
from typing import Any, Dict,Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

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


@register_node
class SourceNode(BaseNode):
    """
    Source Node - fetches all entities from a Neo4j source.

    This is the entry point node that provides data to the graph.
    It queries Neo4j for all entities belonging to a specific source
    and returns them for processing by downstream nodes.
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
        """
        Execute the Source node - fetch all entities from Neo4j.

        Args:
            inputs: Empty dict (source nodes have no inputs)
            config: Must contain 'source_id' - the Neo4j source identifier

        Returns:
            NodeResult with:
                - entities: List of all entity dictionaries
                - keys: List of all unique property keys
                - count: Number of entities
        """
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
                    outputs={
                        "data": [],
                        "count": 0
                    },
                    metadata={"source_id": source_id}
                )

            entities = [_deserialize_props(dict(r["entity"])) for r in results]

            all_keys = set()
            for entity in entities:
                all_keys.update(entity.keys())

            keys = sorted(list(all_keys))

            logger.info(f"SourceNode: Fetched {len(entities)} entities with {len(keys)} keys from source '{source_id}'")

            return NodeResult(
                success=True,
                outputs={
                    "data": entities,
                    "keys": keys,
                    "count": len(entities)
                },
                metadata={
                    "source_id": source_id,
                    "entity_count": len(entities),
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