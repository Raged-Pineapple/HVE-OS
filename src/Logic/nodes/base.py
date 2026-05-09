"""
base.py — Base classes for Node Functions
Defines the interface that all node implementations must follow.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class NodeMetadata:
    """Metadata describing a node's type, category, and handles."""
    type: str
    label: str
    category: str
    color: str
    input_handles: List[str] = field(default_factory=list)
    output_handles: List[str] = field(default_factory=list)
    description: str = ""
    hide_in_sidebar: bool = False


@dataclass
class NodeResult:
    """Result returned from node execution."""
    success: bool
    outputs: Dict[str, Any]
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class BaseNode(ABC):
    """
    Abstract base class for all node functions.
    All node implementations must inherit from this and implement execute().
    """
    metadata: NodeMetadata

    @abstractmethod
    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        """
        Execute the node logic.

        Args:
            inputs: Dict mapping handle names to values from connected nodes
            config: Node configuration (user-provided settings)

        Returns:
            NodeResult with success status and output values
        """
        pass

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validate node configuration before execution.
        Override in subclasses to add custom validation.

        Returns:
            (is_valid, error_message)
        """
        return True, None


class InputNode(BaseNode):
    """Base class for nodes that are data sources (no inputs required)."""
    pass


class TransformNode(BaseNode):
    """Base class for nodes that transform input data."""
    pass


class OutputNode(BaseNode):
    """Base class for nodes that produce final output."""
    pass