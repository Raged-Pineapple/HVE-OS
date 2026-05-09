"""
executor.py — Graph Executor
Executes a complete flow graph by running nodes in topological order.
"""
import logging
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from .base import NodeResult
from .registry import get_node, execute_node

logger = logging.getLogger(__name__)


@dataclass
class GraphEdge:
    """Represents a connection between two nodes."""
    source: str
    target: str
    source_handle: str = "default"
    target_handle: str = "default"


@dataclass
class GraphNode:
    """Represents a node in the graph."""
    id: str
    type: str
    config: Dict[str, Any]


class GraphExecutor:
    """
    Executes a flow graph by running nodes in topological order.
    
    The executor:
    1. Validates the graph structure
    2. Performs topological sort to determine execution order
    3. Executes each node, passing outputs to connected inputs
    4. Returns results for all nodes
    """

    def __init__(self):
        self.results: Dict[str, NodeResult] = {}

    def execute(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        initial_config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute a graph.

        Args:
            nodes: List of node definitions [{"id": "...", "type": "...", "data": {...}}]
            edges: List of edge definitions [{"source": "...", "target": "...", ...}]
            initial_config: Optional global config

        Returns:
            Dictionary with execution results and metadata
        """
        if not nodes:
            return {
                "success": False,
                "error": "No nodes in graph",
                "results": {}
            }

        try:
            graph_nodes = [GraphNode(n["id"], n["type"], n.get("data", {})) for n in nodes]
            graph_edges = [
                GraphEdge(
                    source=e["source"],
                    target=e["target"],
                    source_handle=e.get("sourceHandle", "default"),
                    target_handle=e.get("targetHandle", "default")
                )
                for e in edges
            ]

            execution_order = self._topological_sort(graph_nodes, graph_edges)

            logger.info(f"Graph execution order: {execution_order}")

            self.results = {}

            for node_id in execution_order:
                node = next(n for n in graph_nodes if n.id == node_id)
                inputs = self._gather_inputs(node_id, graph_edges)

                logger.info(f"Executing node {node_id} (type: {node.type}) with inputs: {list(inputs.keys())}")

                result = execute_node(node.type, inputs, node.config)

                self.results[node_id] = result

                if not result.success:
                    logger.warning(f"Node {node_id} failed: {result.error}")

            return self._format_results(execution_order)

        except Exception as e:
            logger.error(f"Graph execution failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "results": {}
            }

    def _gather_inputs(
        self,
        node_id: str,
        edges: List[GraphEdge]
    ) -> Dict[str, Any]:
        """
        Gather all inputs for a node from connected edges.
        
        Maps source node outputs to target node inputs based on handle connections.
        """
        inputs = {}

        for edge in edges:
            if edge.target != node_id:
                continue

            source_result = self.results.get(edge.source)
            if not source_result:
                continue

            if not source_result.success:
                continue

            target_handle = edge.target_handle
            source_handle = edge.source_handle
            
            logger.info(f"  Edge: source={edge.source} -> target={edge.target}")
            logger.info(f"    sourceHandle='{source_handle}', targetHandle='{target_handle}'")
            logger.info(f"  Source outputs keys: {list(source_result.outputs.keys())}")
            logger.info(f"  Source 'data' type: {type(source_result.outputs.get('data'))}")
            
            # First, try to get exact output matching the source handle
            if source_handle and source_handle in source_result.outputs:
                inputs[target_handle] = source_result.outputs[source_handle]
                logger.info(f"  ✓ Mapped by source_handle '{source_handle}' -> target '{target_handle}'")
                logger.info(f"    value type: {type(inputs[target_handle])}")
            # Fallback: try to use 'data' output
            elif "data" in source_result.outputs:
                inputs[target_handle] = source_result.outputs["data"]
                logger.info(f"  ✓ Fallback: mapped 'data' -> target '{target_handle}'")
                logger.info(f"    value type: {type(inputs[target_handle])}")
            # Fallback: use any available output
            elif source_result.outputs:
                first_output_key = list(source_result.outputs.keys())[0]
                inputs[target_handle] = source_result.outputs[first_output_key]
                logger.info(f"  ✓ Fallback2: mapped '{first_output_key}' -> target '{target_handle}'")
            else:
                logger.warning(f"  ✗ No outputs to map from source {edge.source}")

        return inputs

    def _topological_sort(
        self,
        nodes: List[GraphNode],
        edges: List[GraphEdge]
    ) -> List[str]:
        """
        Perform topological sort on the graph to determine execution order.
        
        Uses Kahn's algorithm for topological sorting.
        """
        node_ids = {n.id for n in nodes}
        in_degree = {nid: 0 for nid in node_ids}
        adjacency = {nid: [] for nid in node_ids}

        for edge in edges:
            if edge.source in node_ids and edge.target in node_ids:
                adjacency[edge.source].append(edge.target)
                in_degree[edge.target] += 1

        queue = [nid for nid in node_ids if in_degree[nid] == 0]
        result = []

        while queue:
            current = queue.pop(0)
            result.append(current)

            for neighbor in adjacency[current]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(result) != len(node_ids):
            logger.warning("Graph has cycles, executing with available order")
            remaining = [n.id for n in nodes if n.id not in result]
            result.extend(remaining)

        return result

    def _format_results(self, execution_order: List[str]) -> Dict[str, Any]:
        """Format execution results for API response."""
        node_results = {}

        for node_id in execution_order:
            result = self.results.get(node_id)
            if result:
                node_results[node_id] = {
                    "success": result.success,
                    "outputs": result.outputs,
                    "error": result.error,
                    "metadata": result.metadata
                }

        all_success = all(r.success for r in self.results.values())

        return {
            "success": all_success,
            "node_count": len(self.results),
            "results": node_results
        }


def execute_graph(
    nodes: List[Dict[str, Any]],
    edges: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Convenience function to execute a graph.
    
    Args:
        nodes: List of node definitions
        edges: List of edge definitions
        
    Returns:
        Execution results
    """
    executor = GraphExecutor()
    return executor.execute(nodes, edges)