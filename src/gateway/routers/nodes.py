"""
nodes.py — Node Functions API
Exposes node registry and graph execution endpoints.
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from Logic.nodes import (
    get_all_metadata,
    get_nodes_by_category,
    execute_node,
    get_node
)
from Logic.nodes.executor import GraphExecutor

router = APIRouter(prefix="/api/v1/nodes", tags=["Node Functions"])

from gateway.services import minio_service

@router.get("/models")
async def list_trained_models():
    """
    List all trained model checkpoints from MinIO S3 Silver bucket under 'models/'.
    """
    try:
        objects = minio_service.minio_client.list_objects(
            minio_service.SILVER_BUCKET,
            prefix="models/",
            recursive=True
        )
        models = []
        for obj in objects:
            path = obj.object_name
            name = path[len("models/"):] if path.startswith("models/") else path
            if name.endswith(".pt") or name.endswith(".pth"):
                models.append({
                    "name": name,
                    "path": f"{minio_service.SILVER_BUCKET}/{path}",
                    "size_bytes": obj.size,
                    "last_modified": obj.last_modified.isoformat() if obj.last_modified else None
                })
        return models
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to list trained models: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class NodeExecuteRequest(BaseModel):
    """Request body for executing a single node."""
    inputs: Dict[str, Any] = {}
    config: Dict[str, Any] = {}


class GraphExecuteRequest(BaseModel):
    """Request body for executing a full graph."""
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]] = []


@router.get("/types")
async def list_node_types():
    """
    List all available node types with their metadata.
    
    Returns metadata for each node including:
    - type: Unique identifier
    - label: Display name
    - category: Grouping (input, logic, security, etc.)
    - color: UI color
    - input_handles: Required inputs
    - output_handles: Produced outputs
    """
    metadata = get_all_metadata()
    return {
        "count": len(metadata),
        "nodes": metadata
    }


@router.get("/categories")
async def list_nodes_by_category():
    """
    List all node types grouped by category.
    """
    return get_nodes_by_category()


@router.get("/type/{node_type}")
async def get_node_type_info(node_type: str):
    """
    Get detailed information about a specific node type.
    """
    node_class = get_node(node_type)
    if not node_class:
        raise HTTPException(status_code=404, detail=f"Node type '{node_type}' not found")

    meta = node_class.metadata
    return {
        "type": meta.type,
        "label": meta.label,
        "category": meta.category,
        "color": meta.color,
        "input_handles": meta.input_handles,
        "output_handles": meta.output_handles,
        "description": meta.description,
    }


@router.post("/execute/{node_type}")
async def execute_single_node(node_type: str, request: NodeExecuteRequest):
    """
    Execute a single node with given inputs and configuration.
    
    Useful for testing individual nodes.
    """
    result = execute_node(node_type, request.inputs, request.config)
    
    return {
        "node_type": node_type,
        "success": result.success,
        "outputs": result.outputs,
        "error": result.error,
        "metadata": result.metadata
    }


@router.post("/graph/execute")
async def execute_graph(request: GraphExecuteRequest):
    """
    Execute a complete flow graph.
    
    The graph consists of:
    - nodes: List of node definitions with id, type, and data (config)
    - edges: List of connections between nodes
    
    The executor will:
    1. Determine execution order (topological sort)
    2. Execute each node in order
    3. Pass outputs to connected inputs
    4. Return results for all nodes
    """
    if not request.nodes:
        raise HTTPException(status_code=400, detail="No nodes provided")

    executor = GraphExecutor()
    result = executor.execute(request.nodes, request.edges)

    return result


@router.get("/health")
async def nodes_health():
    """
    Health check for node system.
    """
    metadata = get_all_metadata()
    return {
        "status": "healthy",
        "node_count": len(metadata),
        "categories": list(get_nodes_by_category().keys())
    }