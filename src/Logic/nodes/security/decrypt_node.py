"""
decrypt_node.py — Decrypt Node
Decrypts target fields using a security provider (e.g. TenSEAL).
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
class DecryptNode(BaseNode):
    """
    Decrypt Node - passes data to a selected security provider to decrypt homomorphically encrypted fields.
    """

    metadata = NodeMetadata(
        type="decryptNode",
        category="security",
        label="Decrypt",
        color="#10b981",
        input_handles=["data", "default", "target"],
        output_handles=["data"],
        description="Decrypts target fields using a security provider."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== DECRYPT NODE EXECUTION STARTED ==============")
        
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
            logger.info(f"[DecryptNode] Detected snapshotPath: {snapshot_path}. Fetching JSONL data from MinIO...")
            try:
                data_bytes = minio_service.read_object(minio_service.SILVER_BUCKET, snapshot_path)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines():
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                input_val = snapshot_rows
                logger.info(f"[DecryptNode] Successfully loaded {len(input_val)} rows from snapshot.")
            except Exception as e:
                logger.error(f"[DecryptNode] Failed to load snapshot data from {snapshot_path}: {e}")
                
        elif isinstance(input_val, dict) and "rows" in input_val and isinstance(input_val["rows"], list):
            input_val = input_val["rows"]
        elif config.get("rows") and isinstance(config.get("rows"), list):
            input_val = config.get("rows")

        # Fallback to UI preview input
        if input_val is None:
            input_val = config.get("previewInput")

        provider_id = config.get("provider", "tenseal")
        target_field = config.get("field")
        target_output_field = config.get("target_field", target_field)
        dec_params = config.get("params", {})

        try:
            provider = registry.get_provider(provider_id)
        except ValueError:
            logger.warning(f"Security provider '{provider_id}' not found. Passing data through unencrypted.")
            provider = None

        def _process(item: Any) -> Any:
            if not provider: return item

            if not isinstance(item, dict):
                if target_field: return item
                return item

            new_item = dict(item)
            if target_field and target_field in new_item:
                try:
                    decrypted = provider.decrypt(new_item[target_field], dec_params)
                    new_item[target_output_field] = decrypted
                    if target_output_field != target_field:
                        del new_item[target_field]
                except Exception as e:
                    logger.warning(f"Decrypt failed for field '{target_field}': {e}")
            return new_item

        if isinstance(input_val, list):
            result_payload = [_process(item) for item in input_val]
        elif isinstance(input_val, dict):
            result_payload = _process(input_val)
        else:
            result_payload = _process(input_val)

        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
        
        logger.info("============== DECRYPT NODE EXECUTION FINISHED ==============")
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
        if not config.get("field"):
            return False, "A target field to decrypt is required."
        return True, None
