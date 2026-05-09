"""
nodes/__init__.py — Node Functions Registry
Auto-discovers and registers all node implementations.
"""
import logging
import importlib
import pkgutil

logger = logging.getLogger(__name__)

from .base import BaseNode, NodeMetadata, NodeResult
from .registry import (
    register_node,
    get_node,
    get_all_nodes,
    get_all_metadata,
    get_nodes_by_category,
    execute_node,
    NODE_REGISTRY
)


def discover_nodes():
    """
    Auto-discover and import all node modules.
    This scans subdirectories and imports any nodes defined there.
    """
    import os
    nodes_dir = os.path.dirname(__file__)

    for category in ["input", "logic", "security", "database", "ai", "action"]:
        category_path = os.path.join(nodes_dir, category)
        if os.path.isdir(category_path):
            try:
                module = importlib.import_module(f".{category}", package="Logic.nodes")
                logger.info(f"Discovered nodes in category: {category}")
            except ImportError as e:
                logger.debug(f"No nodes in category {category}: {e}")


discover_nodes()

__all__ = [
    "BaseNode",
    "NodeMetadata", 
    "NodeResult",
    "register_node",
    "get_node",
    "get_all_nodes",
    "get_all_metadata",
    "get_nodes_by_category",
    "execute_node",
    "NODE_REGISTRY",
]