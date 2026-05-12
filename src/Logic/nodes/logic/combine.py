"""
combine.py — Combine Node
Combines multiple incoming attributes into customizable output slots.
"""
import logging
from typing import Any, Dict, List
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

def check_condition(value: Any, condition: str) -> bool:
    if condition == 'always': 
        return True
    if condition == '!null': 
        return value not in (None, 'null', 'None')
    
    try:
        v = float(value)
        if condition == '>0': 
            return v > 0
        if condition == '!=0': 
            return v != 0
    except (ValueError, TypeError):
        pass
        
    return True

@register_node
class CombineNode(BaseNode):
    metadata = NodeMetadata(
        type="combine",
        category="logic",
        label="Combine",
        color="#a855f7",
        input_handles=["data-target"],
        output_handles=[], 
        description="Combines and transforms data into defined slots",
        hide_in_sidebar=False
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== COMBINE NODE EXECUTION STARTED ==============")
        logger.info(f"CombineNode received inputs keys: {list(inputs.keys())}")

        slots = config.get("slots", [])
        logger.info(f"CombineNode processing {len(slots)} slots.")
        outputs = {}

        # Find the primary bulk entity list, if one exists
        bulk_entities = None
        scalar_inputs = {}
        for handle, val in inputs.items():
            if isinstance(val, list) and all(isinstance(x, dict) for x in val):
                if bulk_entities is None: # Prioritize the first bulk list found
                    bulk_entities = val
            else:
                scalar_inputs[handle] = val

        for idx, slot in enumerate(slots):
            assignments = slot.get('assignments', {})
            slot_name = slot.get('name', f'slot_{idx}')
            
            logger.info(f"CombineNode - Slot '{slot_name}': evaluating {len(assignments)} assignments.")
            
            def process_entity(base_entity: Optional[Dict]) -> Dict:
                """Applies slot logic to a single entity or scalar inputs."""
                result = {}
                for row_key, asgn in assignments.items():
                    if not asgn.get('included', True):
                        continue
                    
                    attr_key = row_key.split('-')[-1] if '-' in row_key else row_key
                    value = None

                    # Priority 1: Value from the base entity (in a bulk run)
                    if base_entity and attr_key in base_entity:
                        value = base_entity[attr_key]
                    # Priority 2: Value from scalar inputs
                    else:
                        for handle, input_val in scalar_inputs.items():
                            if isinstance(input_val, dict) and attr_key in input_val:
                                value = input_val[attr_key]
                                break
                            elif isinstance(input_val, list): # list of scalars
                                for item in input_val:
                                    if handle == attr_key:
                                        value = item; break
                            elif attr_key == handle:
                                value = input_val
                                break
                        
                    if value is not None:
                        break
                
                    if value is None or not check_condition(value, asgn.get('condition', 'always')):
                        continue
                        
                    output_key = asgn.get('outputKey') if slot.get('strategy') == 'rename' and asgn.get('outputKey') else attr_key
                    result[output_key] = value
                return result

            if bulk_entities is not None:
                slot_results = [process_entity(entity) for entity in bulk_entities]
                outputs[f"combine-out-{slot_name}"] = slot_results
                if idx == 0: outputs["resolvedEntity"] = slot_results
                else: outputs[f"resolvedEntity_{slot_name}"] = slot_results
            else:
                result = process_entity(None)
                outputs[f"combine-out-{slot_name}"] = result
                if idx == 0: outputs["resolvedEntity"] = result
                else: outputs[f"resolvedEntity_{slot_name}"] = result
            
            logger.info(f"CombineNode - Slot '{slot_name}' produced output of type: {type(outputs.get(f'combine-out-{slot_name}'))}")

        logger.info(f"CombineNode outputs generated: {list(outputs.keys())}")
        logger.info("============== COMBINE NODE EXECUTION FINISHED ==============")

        return NodeResult(
            success=True,
            outputs=outputs,
            metadata={"slots_processed": len(slots)}
        )