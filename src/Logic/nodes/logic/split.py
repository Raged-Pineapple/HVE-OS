"""
split.py — Explode Attributes Node
Takes a single entity and splits its attributes into individual output data streams.
"""
import logging
import json
import ast
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

def _parse_nested_literal(val: Any) -> Any:
    if isinstance(val, str) and (val.strip().startswith('{') or val.strip().startswith('[')):
        try:
            return json.loads(val)
        except Exception:
            try:
                return ast.literal_eval(val)
            except Exception:
                pass
    return val


def _explode_entity_attributes(entity: Dict[str, Any], auto_encrypt: bool = False, auto_decrypt: bool = False, tenseal_provider = None) -> Dict[str, Any]:
    outputs: Dict[str, Any] = {}

    for k, v in entity.items():
        parsed_val = _parse_nested_literal(v)

        # Auto-decrypt if enabled and it's an encrypted value
        if auto_decrypt and tenseal_provider and isinstance(parsed_val, dict) and parsed_val.get("__type__") == "tenseal_encrypted":
            try:
                logger.info(f"SplitNode: Sending data for decrypt on field '{k}': {parsed_val}")
                parsed_val = tenseal_provider.decrypt(parsed_val, {"context_id": parsed_val.get("context_id", "default")})
                logger.info(f"SplitNode: Auto-decrypted field '{k}'")
            except Exception as e:
                logger.warning(f"SplitNode: Failed to auto-decrypt field '{k}': {e}")

        if auto_encrypt and tenseal_provider and isinstance(parsed_val, (int, float)):
            try:
                parsed_val = tenseal_provider.encrypt(
                    float(parsed_val),
                    {"scheme": "CKKS", "context_id": "default"}
                )
            except Exception as e:
                logger.warning(f"SplitNode: Failed to auto-encrypt field '{k}': {e}")

        entity[k] = parsed_val
        outputs[f"attr-out-{k}"] = {k: parsed_val}

        if isinstance(parsed_val, dict) and parsed_val.get("__type__") != "tenseal_encrypted":
            for sub_k, sub_v in parsed_val.items():
                sub_parsed = _parse_nested_literal(sub_v)
                if auto_encrypt and tenseal_provider and isinstance(sub_parsed, (int, float)):
                    try:
                        sub_parsed = tenseal_provider.encrypt(
                            float(sub_parsed),
                            {"scheme": "CKKS", "context_id": "default"}
                        )
                    except Exception as e:
                        logger.warning(f"SplitNode: Failed to auto-encrypt nested field '{sub_k}': {e}")
                outputs[f"attr-out-{k}.{sub_k}"] = {sub_k: sub_parsed}

    return outputs

@register_node
class SplitNode(BaseNode):
    """
    Explode Attributes Node - breaks down an entity into individual property outputs.
    """

    metadata = NodeMetadata(
        type="split",
        category="logic",
        label="Explode Attributes",
        color="#3B82F6",
        input_handles=["data", "default"],
        output_handles=[],  # Dynamically generated at runtime
        description="Splits an entity into individual attribute handles",
        hide_in_sidebar=False
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== SPLIT NODE EXECUTION STARTED ==============")
        logger.info(f"SplitNode received inputs keys: {list(inputs.keys())}")
        logger.info(f"SplitNode received config keys: {list(config.keys())}")

        # 1. Resolve which data we are working with
        input_data = inputs.get('data')
        if input_data is None:
            input_data = inputs.get('default')
        if input_data is None:
            input_data = inputs.get('target')

        logger.info(f"SplitNode resolved input_data type: {type(input_data)}")

        entity = {}
        
        # The React UI pushes the fully resolved entity into the config block
        resolved_entity = config.get("resolvedEntity")
        
        if input_data is not None:
            # Priority 1: Direct reactive dictionary from an upstream Extract node
            if isinstance(input_data, dict):
                entity = input_data
                logger.info(f"SplitNode Priority 1: Picked direct dictionary with {len(entity)} keys")
            # Priority 2: A list of entities passed down, filtered by UI selection
            elif isinstance(input_data, list) and len(input_data) > 0:
                selected_idx = config.get("selectedEntityIndex")
                logger.info(f"SplitNode Priority 2: Received list of {len(input_data)} items. UI selected_idx: {selected_idx}")
                if selected_idx is not None:
                    try:
                        idx = int(selected_idx)
                        if 0 <= idx < len(input_data):
                            entity = input_data[idx]
                            logger.info(f"SplitNode: Picked entity at index {idx}")
                    except (ValueError, TypeError):
                        pass
                if not entity:
                    entity = input_data[0]
                    logger.info("SplitNode: Defaulted to index 0")
            elif isinstance(input_data, list) and len(input_data) == 0:
                logger.info("SplitNode: Received empty list. Nothing to explode.")
            else:
                logger.warning(f"SplitNode: Received non-explodable data type: {type(input_data)}")
                
        # Priority 3: Fallback to the UI-resolved entity state ONLY if no input_data was provided at all
        elif resolved_entity and isinstance(resolved_entity, dict):
            entity = resolved_entity
            logger.info(f"SplitNode Priority 3: Fell back to UI resolvedEntity with {len(entity)} keys")
        else:
            logger.warning("SplitNode: No valid entity could be resolved from inputs or config!")

        logger.info(f"SplitNode processing entity: {entity}")

        outputs = {"data": entity, "resolvedEntity": entity}   # Provide fallback raw pass-through and UI preview

        # 2. Explode attributes dynamically for the graph engine routing
        auto_encrypt = config.get("autoEncryptNumericals", False)
        auto_decrypt = config.get("autoDecryptValues", False)
        tenseal_provider = None
        if auto_encrypt or auto_decrypt:
            try:
                from Logic.security.registry import registry
                tenseal_provider = registry.get_provider("tenseal")
                logger.info("SplitNode: Auto-encrypt enabled. Loaded TenSEAL provider.")
            except Exception as e:
                logger.error(f"SplitNode: Failed to load TenSEAL provider for auto-encrypt: {e}")

        if isinstance(entity, dict):
            outputs.update(_explode_entity_attributes(entity, auto_encrypt, auto_decrypt, tenseal_provider))

        logger.info(f"SplitNode outputs generated: {list(outputs.keys())}")
        logger.info(f"SplitNode: Exploded entity into {len(outputs) - 2} dynamic attribute streams.")
        logger.info("============== SPLIT NODE EXECUTION FINISHED ==============")

        return NodeResult(
            success=True,
            outputs=outputs,
            metadata={"exploded_attributes": len(outputs) - 1}
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
