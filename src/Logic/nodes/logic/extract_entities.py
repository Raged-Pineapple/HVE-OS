"""
extract_entities.py — Extract Entities Node
Filters and extracts entities from incoming data based on strategy and criteria.
"""
import re
import logging
from typing import Any, Dict, List, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)


def parse_nested_value(value: Any) -> Any:
    """Parse stringified JSON values."""
    if isinstance(value, str):
        if value.strip().startswith('{') or value.strip().startswith('['):
            try:
                import json
                return json.loads(value)
            except Exception:
                pass
    return value


def _encrypt_entity_numericals(entity: Dict[str, Any], tenseal_provider) -> Dict[str, Any]:
    """Encrypt top-level and one-level nested numeric attributes for UI-routed entity outputs."""
    encrypted_entity = entity.copy()

    for key, value in encrypted_entity.items():
        parsed_value = parse_nested_value(value)

        if isinstance(parsed_value, bool):
            encrypted_entity[key] = parsed_value
            continue

        if isinstance(parsed_value, (int, float)):
            try:
                encrypted_entity[key] = tenseal_provider.encrypt(
                    float(parsed_value),
                    {"scheme": "CKKS", "context_id": "default"}
                )
            except Exception as e:
                logger.warning(f"ExtractEntities: Failed to auto-encrypt field '{key}': {e}")
                encrypted_entity[key] = parsed_value
            continue

        if isinstance(parsed_value, dict) and parsed_value.get("__type__") != "tenseal_encrypted":
            nested = parsed_value.copy()
            for nested_key, nested_value in nested.items():
                if isinstance(nested_value, bool):
                    continue
                if isinstance(nested_value, (int, float)):
                    try:
                        nested[nested_key] = tenseal_provider.encrypt(
                            float(nested_value),
                            {"scheme": "CKKS", "context_id": "default"}
                        )
                    except Exception as e:
                        logger.warning(f"ExtractEntities: Failed to auto-encrypt nested field '{key}.{nested_key}': {e}")
            encrypted_entity[key] = nested
            continue

        encrypted_entity[key] = parsed_value

    return encrypted_entity


def extract_by_key_path(data: List[Dict], key_path: str) -> List[Dict]:
    """Extract nested values using dot notation path."""
    if not key_path:
        return data
    
    parts = key_path.split('.')
    results = []
    
    for item in data:
        current = item
        for part in parts:
            if current is None:
                break
            current = parse_nested_value(current)
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list):
                break
        
        if current is not None:
            if isinstance(current, list):
                results.extend(current)
            else:
                results.append(current)
    
    return results


def extract_by_label(data: List[Dict], label: str) -> List[Dict]:
    """Filter entities by label (e.g., 'PERSON', 'LOCATION')."""
    if not label:
        return data
    
    results = []
    for item in data:
        if isinstance(item, dict):
            entity_label = item.get('label') or item.get('type') or item.get('_label')
            if entity_label and label.upper() in str(entity_label).upper():
                results.append(item)
        elif isinstance(item, str):
            if label.upper() in item.upper():
                results.append(item)
    
    return results


def extract_by_regex(data: List[Dict], pattern: str) -> List[Dict]:
    """Filter entities using regex pattern matching."""
    if not pattern:
        return data
    
    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error:
        logger.warning(f"Invalid regex pattern: {pattern}")
        return data
    
    results = []
    for item in data:
        if isinstance(item, dict):
            for value in item.values():
                str_val = str(value) if value is not None else ''
                if regex.search(str_val):
                    results.append(item)
                    break
        elif isinstance(item, str):
            if regex.search(item):
                results.append(item)
    
    return results


@register_node
class ExtractEntitiesNode(BaseNode):
    """
    Extract Entities Node - filters and extracts entities from input data.
    
    Supports multiple extraction strategies:
    - KeyPath: Extract nested values using dot notation
    - Label: Filter by entity label/type
    - Regex: Pattern match using regular expressions
    """

    metadata = NodeMetadata(
        type="extractEntities",
        category="logic",
        label="Extract Entities",
        color="#3B82F6",
        input_handles=["data", "default"],
        output_handles=["extracted", "pinned", "unpinned"],
        description="Filter and extract entities from input data"
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        """
        Execute entity extraction.
        
        Args:
            inputs:
                - entities: List of entity dictionaries from source
                - default: Alternative input key
            config:
                - strategy: 'KeyPath', 'Label', 'Regex', or 'NER' (default: 'NER')
                - keyPath: Dot-notation path for KeyPath extraction
                - label: Target label for Label extraction
                - regexPattern: Pattern for Regex extraction
                - selectedFields: List of fields to include
                - pinnedEntities: List of pinned entity names to always include
                - displayNameProperty: Property to use for entity names
        """
        strategy = config.get('strategy', 'NER')
        key_path = config.get('keyPath', config.get('label', ''))
        regex_pattern = config.get('regexPattern', config.get('label', ''))
        selected_fields = config.get('selectedFields', [])
        pinned_names = config.get('pinnedEntities', [])
        display_property = config.get('displayNameProperty', '')
        
        input_entities = inputs.get('data') or inputs.get('default') or []
        
        if not isinstance(input_entities, list):
            if input_entities:
                input_entities = [input_entities]
            else:
                input_entities = []
        
        logger.info(f"ExtractEntities: Processing {len(input_entities)} entities with strategy: {strategy}")
        
        extracted = []
        
        if strategy == 'KeyPath' and key_path:
            extracted = extract_by_key_path(input_entities, key_path)
        elif strategy == 'Label' and regex_pattern:
            extracted = extract_by_label(input_entities, regex_pattern)
        elif strategy == 'Regex' and regex_pattern:
            extracted = extract_by_regex(input_entities, regex_pattern)
        else:
            extracted = input_entities
        
        if selected_fields:
            extracted = [
                {k: v for k, v in item.items() if k in selected_fields}
                for item in extracted if isinstance(item, dict)
            ]
        
        pinned_entities = []
        unpinned_entities = []
        dynamic_outputs = {}
        
        auto_encrypt = config.get("autoEncryptConnected", True)
        connected_handles = config.get("connectedHandles", [])
        tenseal_provider = None

        try:
            from Logic.security.registry import registry
            tenseal_provider = registry.get_provider("tenseal")
            logger.info("ExtractEntities: Loaded TenSEAL provider.")
        except Exception as e:
            logger.warning(f"ExtractEntities: Failed to load TenSEAL provider: {e}")
        
        for idx, entity in enumerate(extracted):
            name = self._get_entity_name(entity, display_property)
            
            if entity.get('_hve_id') is not None:
                unique_id = f"hve_{entity['_hve_id']}"
            elif entity.get('hve_id') is not None:
                unique_id = f"hve_{entity['hve_id']}"
            elif entity.get('id') is not None:
                unique_id = f"id_{entity['id']}"
            else:
                unique_id = f"idx_{idx}"
            
            is_pinned = name in pinned_names
            out_handle = f"entity-out-pinned-{name}" if is_pinned else f"entity-out-{name}"
            
            out_entity = entity
            is_connected = out_handle in connected_handles
            if tenseal_provider and is_connected:
                out_entity = _encrypt_entity_numericals(entity, tenseal_provider)
                            
            if is_pinned:
                pinned_entities.append(out_entity)
                dynamic_outputs[out_handle] = out_entity
            else:
                unpinned_entities.append(out_entity)
                dynamic_outputs[out_handle] = out_entity
        
        logger.info(f"ExtractEntities: Extracted {len(extracted)} entities, {len(pinned_entities)} pinned, {len(unpinned_entities)} unpinned")
        
        base_outputs = {
            "extracted": extracted,
            "pinned": pinned_entities,
            "unpinned": unpinned_entities,
            "count": len(extracted),
            "pinned_count": len(pinned_entities),
            "unpinned_count": len(unpinned_entities)
        }
        base_outputs.update(dynamic_outputs)

        return NodeResult(
            success=True,
            outputs=base_outputs,
            metadata={
                "strategy": strategy,
                "total_input": len(input_entities),
                "total_extracted": len(extracted)
            }
        )

    def _get_entity_name(self, entity: Dict, display_property: str) -> str:
        """Get the display name for an entity."""
        
        def _get_fallback_name(ent: Dict) -> str:
            for k in ['name', 'title', 'id', '_hve_id']:
                val = ent.get(k)
                if val is not None and str(val).strip():
                    return str(val).strip()
            return 'Unknown'

        if not display_property:
            return _get_fallback_name(entity)
        
        parts = display_property.split('.')
        current = entity
        
        for part in parts:
            if current is None:
                break
            current = parse_nested_value(current)
            if isinstance(current, dict):
                current = current.get(part)
        
        if current is not None and not isinstance(current, (dict, list)):
            str_val = str(current).strip()
            if str_val:
                return str_val
        
        return _get_fallback_name(entity)

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """Validate configuration."""
        strategy = config.get('strategy', 'NER')
        
        if strategy == 'KeyPath' and not config.get('keyPath'):
            return False, "keyPath is required for KeyPath strategy"
        if strategy == 'Regex' and not config.get('regexPattern'):
            return False, "regexPattern is required for Regex strategy"
        
        return True, None
