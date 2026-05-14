"""
string_node.py — String Node
Provides a simple user-defined string for the graph.
"""
import json
from typing import Any, Dict
import logging
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

@register_node
class StringNode(BaseNode):
    metadata = NodeMetadata(
        type="stringNode",
        category="logic",
        label="String",
        color="#3B82F6",
        input_handles=["data"],
        output_handles=["data"],
        description="Outputs a simple user-defined string."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        string_value = config.get("stringValue", "")
        
        # Try to parse as JSON to support rich entity structures natively
        try:
            parsed_value = json.loads(string_value)
            result_payload = parsed_value
        except Exception:
            # Fallback to an Entity-like structure for seamless pipeline integration
            result_payload = {"text": string_value}
            
        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}

        return NodeResult(
            success=True,
            outputs={
                "data": result_payload,
                "resolvedEntity": preview_payload
            },
            metadata={"config_used": config}
        )