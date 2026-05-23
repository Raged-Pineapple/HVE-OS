"""
he_compute_node.py — HE Compute Node
Performs homomorphic computations (sum, multiply) on encrypted fields via a security provider.
"""
import logging
import json
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node
from ...security.registry import registry
from gateway.services import minio_service

logger = logging.getLogger(__name__)

@register_node
class HEComputeNode(BaseNode):
    """
    HE Compute Node - performs homomorphic computation on encrypted fields using a security provider.
    """

    metadata = NodeMetadata(
        type="heComputeNode",
        category="security",
        label="HE Compute",
        color="#3b82f6",
        input_handles=["data", "default", "target"],
        output_handles=["data"],
        description="Performs homomorphic operations (sum, multiply) on encrypted fields."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== HE COMPUTE NODE EXECUTION STARTED ==============")
        
        # Get input data from various possible sources
        input_val = None
        if inputs:
            for key in ["data", "default", "target", "source", "rows"]:
                if inputs.get(key) is not None:
                    input_val = inputs.get(key)
                    break
            if input_val is None:
                for val in inputs.values():
                    if val is not None:
                        input_val = val
                        break

        # Extract snapshot data from input_val or config
        snapshot_path = None
        if isinstance(input_val, dict) and input_val.get("snapshotPath"):
            snapshot_path = input_val.get("snapshotPath")
        elif config.get("inputSnapshotPath"):
            snapshot_path = config.get("inputSnapshotPath")
            
        if snapshot_path and snapshot_path.startswith(f"{minio_service.SILVER_BUCKET}/"):
            snapshot_path = snapshot_path[len(minio_service.SILVER_BUCKET) + 1:]

        if snapshot_path:
            logger.info(f"[HEComputeNode] Detected snapshotPath: {snapshot_path}. Fetching JSONL data from MinIO...")
            try:
                data_bytes = minio_service.read_object(minio_service.SILVER_BUCKET, snapshot_path)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines():
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                input_val = snapshot_rows
                logger.info(f"[HEComputeNode] Successfully loaded {len(input_val)} rows from snapshot.")
            except Exception as e:
                logger.error(f"[HEComputeNode] Failed to load snapshot data from {snapshot_path}: {e}")
                
        elif isinstance(input_val, dict) and "rows" in input_val and isinstance(input_val["rows"], list):
            input_val = input_val["rows"]
        elif config.get("rows") and isinstance(config.get("rows"), list):
            input_val = config.get("rows")

        # Fallback to UI preview input
        if input_val is None:
            input_val = config.get("previewInput")

        provider_id = config.get("provider", "tenseal")
        operation = config.get("operation", "sum")
        field_a = config.get("field_a")
        field_b = config.get("field_b")
        target_field = config.get("target_field", f"encrypted_{operation}_result")
        comp_params = config.get("params", {})

        try:
            provider = registry.get_provider(provider_id)
        except ValueError:
            logger.warning(f"Security provider '{provider_id}' not found. Cannot compute.")
            provider = None

        def _process(item: Any) -> Any:
            if not provider: return item
            if not isinstance(item, dict):
                return item

            new_item = dict(item)
            val_a = new_item.get(field_a) if field_a else None
            val_b = new_item.get(field_b) if field_b else None

            if val_a is not None and val_b is not None:
                try:
                    result = provider.compute(operation, [val_a, val_b], comp_params)
                    new_item[target_field] = result
                except Exception as e:
                    logger.warning(f"HE compute '{operation}' failed: {e}")
            return new_item

        if isinstance(input_val, list):
            result_payload = [_process(item) for item in input_val]
        elif isinstance(input_val, dict):
            result_payload = _process(input_val)
        else:
            result_payload = _process(input_val)

        def _clean_for_preview(data_val):
            if isinstance(data_val, dict):
                if data_val.get("__type__") == "tenseal_encrypted" and "data" in data_val:
                    preview_dict = dict(data_val)
                    if isinstance(preview_dict["data"], str):
                        preview_dict["data"] = preview_dict["data"][:40] + "... [TRUNCATED FOR UI]"
                    return preview_dict
                return {k: _clean_for_preview(v) for k, v in data_val.items()}
            elif isinstance(data_val, list):
                return [_clean_for_preview(item) for item in data_val]
            return data_val

        if isinstance(result_payload, list):
            preview_payload = _clean_for_preview(result_payload[:10])
        elif isinstance(result_payload, dict):
            preview_payload = _clean_for_preview(result_payload)
        else:
            preview_payload = {"result": _clean_for_preview(result_payload)}
        
        logger.info("============== HE COMPUTE NODE EXECUTION FINISHED ==============")
        return NodeResult(
            success=True,
            outputs={
                "data": result_payload,
                "resolvedEntity": preview_payload
            },
            metadata={"config_used": config}
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        if not config.get("provider"):
            return False, "A Security Engine provider is required."
        if not config.get("field_a") or not config.get("field_b"):
            return False, "Both Field A and Field B are required for computation."
        return True, None
