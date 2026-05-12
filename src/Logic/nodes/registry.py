"""
registry.py — Node Registry
Manages registration and discovery of all node types.
"""
import logging
from typing import Dict, List, Type, Optional, Any, Callable
from .base import BaseNode, NodeMetadata, NodeResult

logger = logging.getLogger(__name__)

NODE_REGISTRY: Dict[str, Type[BaseNode]] = {}


def register_node(node_class: Type[BaseNode]) -> Type[BaseNode]:
    """
    Decorator to register a node class.
    Usage:
        @register_node
        class MyNode(BaseNode):
            ...
    """
    node_type = node_class.metadata.type
    NODE_REGISTRY[node_type] = node_class
    logger.info(f"Registered node: {node_type} ({node_class.metadata.label})")
    return node_class


def node_function(
    type: str,
    label: str,
    category: str,
    color: str,
    input_handles: List[str] = None,
    output_handles: List[str] = None,
    description: str = "",
    hide_in_sidebar: bool = False
):
    """
    Decorator to create and register a node from a simple Python function.
    The wrapped function should accept (inputs: Dict, config: Dict) and return a Dict of outputs.
    """
    if input_handles is None:
        input_handles = []
    if output_handles is None:
        output_handles = []

    def decorator(func: Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]]) -> Type[BaseNode]:
        class FunctionalNode(BaseNode):
            metadata = NodeMetadata(
                type=type,
                label=label,
                category=category,
                color=color,
                input_handles=input_handles,
                output_handles=output_handles,
                description=description,
                hide_in_sidebar=hide_in_sidebar
            )

            def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
                try:
                    outputs = func(inputs, config)
                    return NodeResult(success=True, outputs=outputs)
                except Exception as e:
                    logger.error(f"Error executing functional node {type}: {e}", exc_info=True)
                    return NodeResult(success=False, outputs={}, error=str(e))
        
        FunctionalNode.__name__ = "".join(word.capitalize() for word in type.split("_")) + "Node"
        return register_node(FunctionalNode)
    return decorator


def get_node(node_type: str) -> Optional[Type[BaseNode]]:
    """Get a node class by type identifier."""
    return NODE_REGISTRY.get(node_type)


def get_all_nodes() -> Dict[str, Type[BaseNode]]:
    """Get all registered nodes."""
    return NODE_REGISTRY.copy()


def get_all_metadata() -> List[Dict[str, Any]]:
    """Get metadata for all registered nodes."""
    return [
        {
            "type": node_class.metadata.type,
            "label": node_class.metadata.label,
            "category": node_class.metadata.category,
            "color": node_class.metadata.color,
            "input_handles": node_class.metadata.input_handles,
            "output_handles": node_class.metadata.output_handles,
            "description": node_class.metadata.description,
            "hide_in_sidebar": node_class.metadata.hide_in_sidebar,
        }
        for node_class in NODE_REGISTRY.values()
    ]


def get_nodes_by_category() -> Dict[str, List[Dict[str, Any]]]:
    """Group nodes by category."""
    categories: Dict[str, List[Dict[str, Any]]] = {}
    for node_class in NODE_REGISTRY.values():
        cat = node_class.metadata.category
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "type": node_class.metadata.type,
            "label": node_class.metadata.label,
            "color": node_class.metadata.color,
            "input_handles": node_class.metadata.input_handles,
            "output_handles": node_class.metadata.output_handles,
        })
    return categories


def execute_node(node_type: str, inputs: Dict[str, Any], config: Dict[str, Any]) -> "NodeResult":
    """
    Execute a node by type.

    Args:
        node_type: The type identifier of the node
        inputs: Dictionary of input values
        config: Node configuration

    Returns:
        NodeResult from execution
    """
    node_class = get_node(node_type)
    if not node_class:
        from .base import NodeResult
        return NodeResult(
            success=False,
            outputs={},
            error=f"Unknown node type: {node_type}"
        )

    node = node_class()
    return node.execute(inputs, config)