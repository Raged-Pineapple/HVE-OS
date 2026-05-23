import logging
from typing import Dict, Any, Optional

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node

logger = logging.getLogger(__name__)

@register_node
class GraphVisualizationNode(BaseNode):
    metadata = NodeMetadata(
        type="graphVisualizationNode",
        label="Graph Visualization",
        category="logic",
        color="#8B5CF6",
        input_handles=["data"],
        output_handles=["data"],
        description="Visualizes node connections and relationships in a graph format."
    )
        
    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("[GraphVisualizationNode] ================== EXECUTION STARTED ==================")
        
        entities = []
        for key, value in inputs.items():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                entities.extend(value)
            elif isinstance(value, dict):
                entities.append(value)
                
        logger.info(f"[GraphVisualizationNode] Received {len(entities)} entities for visualization.")
        
        # Pass-through for now. Frontend will handle the D3/VisJS rendering
        outputs = {
            "data": entities
        }
        
        logger.info("[GraphVisualizationNode] ================== EXECUTION FINISHED ==================")
        return NodeResult(success=True, outputs=outputs)

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
