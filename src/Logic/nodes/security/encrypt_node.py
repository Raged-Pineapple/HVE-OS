"""
encrypt_node.py — Encrypt Node
Applies homomorphic encryption (via TenSEAL) to target fields within data snapshots.
"""
import logging
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

# Dynamically access the security engine registry
from ...security.registry import registry

logger = logging.getLogger(__name__)

@register_node
class EncryptNode(BaseNode):
    """
    Encrypt Node - passes data to a selected security provider (e.g. TenSEAL) to apply Homomorphic Encryption.
    """

    metadata = NodeMetadata(
        type="encryptNode",
        category="security",
        label="Encrypt",
        color="#ef4444",
        input_handles=["data", "default", "target"],
        output_handles=["data"],
        description="Encrypts target fields using Homomorphic Encryption."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== ENCRYPT NODE EXECUTION STARTED ==============")
        
        input_val = inputs.get("data")
        if input_val is None: input_val = inputs.get("default")
        if input_val is None: input_val = inputs.get("target")
        
        # Handle isolated UI preview runs
        if input_val is None and not inputs:
            input_val = config.get("previewInput")
        elif input_val is None and inputs:
            input_val = list(inputs.values())[0]

        provider_id = config.get("provider", "tenseal")
        target_field = config.get("field")
        enc_params = config.get("params", {})

        try:
            provider = registry.get_provider(provider_id)
        except ValueError:
            logger.warning(f"Security provider '{provider_id}' not found. Passing data through unencrypted.")
            provider = None

        def _process(item: Any) -> Any:
            if not provider: return item
            
            if not isinstance(item, dict):
                if target_field: return item # Explicit targeting skips scalars
                return provider.encrypt(item, enc_params)
                
            new_item = dict(item)
            if target_field and target_field in new_item:
                new_item[target_field] = provider.encrypt(new_item[target_field], enc_params)
            return new_item

        # Smart Bulk & Scalar Application
        if isinstance(input_val, list):
            result_payload = [_process(item) for item in input_val]
        elif isinstance(input_val, dict):
            result_payload = _process(input_val)
        else:
            result_payload = _process(input_val)

        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
        
        logger.info("============== ENCRYPT NODE EXECUTION FINISHED ==============")
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
        return True, None