"""
math_node.py — Math Node
Performs basic mathematical operations on incoming numeric values.
"""
import logging
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

@register_node
class MathNode(BaseNode):
    """
    Math Node - applies an arithmetic operation (+, -, *, /) using a configured constant.
    """

    metadata = NodeMetadata(
        type="math",
        category="logic",
        label="Math Operation",
        color="#fbbf24",
        input_handles=["data", "default", "target"],
        output_handles=["data"],
        description="Applies a mathematical operation to an input value."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== MATH NODE EXECUTION STARTED ==============")
        logger.info(f"MathNode received inputs: {list(inputs.keys())}")
        logger.info(f"MathNode config: {config}")

        # Extract configuration
        math_operations = config.get("mathOperations", [])
        
        # Fallback for old/legacy config
        if not math_operations:
            op = config.get("operation", "add")
            try:
                constant = float(config.get("constant", 0.0))
            except (ValueError, TypeError):
                constant = 0.0

            target_fields_str = config.get("targetFields", "")
            target_fields = [f.strip() for f in target_fields_str.split(",") if f.strip()]
            
            if target_fields:
                for tf in target_fields:
                    math_operations.append({"field": tf, "operation": op, "constant": constant})
            else:
                math_operations.append({"field": None, "operation": op, "constant": constant})
        else:
            # Ensure float parsing for newer config array
            for mop in math_operations:
                try:
                    mop["constant"] = float(mop.get("constant", 0.0))
                except (ValueError, TypeError):
                    mop["constant"] = 0.0

        # 1. Atomic generic operation
        def _apply_math(val: Any, op: str, constant: float) -> Any:
            if val is None: return val
            try:
                num = float(val)
                if op == 'add': num += constant
                elif op == 'subtract': num -= constant
                elif op == 'multiply': num *= constant
                elif op == 'divide':
                    if constant != 0: num /= constant
                    else: return val
                return int(num) if num.is_integer() else num
            except (ValueError, TypeError):
                return val

        # 2. Field applicator
        def _apply_operations(item: Any) -> Any:
            if not isinstance(item, dict):
                # scalar fallback
                for mop in math_operations:
                    if not mop.get("field"):
                        item = _apply_math(item, mop.get("operation", "add"), mop.get("constant", 0.0))
                return item
            
            new_item = dict(item)
            for mop in math_operations:
                field = mop.get("field")
                if field and field in new_item:
                    new_item[field] = _apply_math(new_item[field], mop.get("operation", "add"), mop.get("constant", 0.0))
            return new_item

        # 3. Explicit targeted routing
        input_val = inputs.get("data")
        if input_val is None:
            input_val = inputs.get("default")
        if input_val is None:
            input_val = inputs.get("target")
        if input_val is None and not inputs:
            # Isolated UI preview run: grab the sample input provided by the frontend
            input_val = config.get("previewInput")
        elif input_val is None and inputs:
            input_val = list(inputs.values())[0]
        
        if isinstance(input_val, list):
            result_payload = [_apply_operations(item) for item in input_val]
        elif isinstance(input_val, dict):
            # Special fallback for single attribute dicts routed from Split Node
            if len(input_val) == 1 and not any(mop.get("field") for mop in math_operations):
                k = list(input_val.keys())[0]
                result_payload = dict(input_val)
                for mop in math_operations:
                    if not mop.get("field"):
                        result_payload[k] = _apply_math(result_payload[k], mop.get("operation", "add"), mop.get("constant", 0.0))
            else:
                result_payload = _apply_operations(input_val)
        else:
            result_payload = _apply_operations(input_val)
        
        logger.info(f"MathNode applied operations. Configuration: {math_operations}")

        # The UI needs to see 'resolvedEntity' for previews
        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
        outputs = {
            "data": result_payload,
            "resolvedEntity": preview_payload
        }

        logger.info(f"MathNode outputs generated: {list(outputs.keys())}")
        logger.info("============== MATH NODE EXECUTION FINISHED ==============")

        return NodeResult(
            success=True,
            outputs=outputs,
            metadata={"operations": math_operations}
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None