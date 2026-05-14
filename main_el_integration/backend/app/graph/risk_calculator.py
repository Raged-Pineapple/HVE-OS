"""
risk_calculator.py — Risk Calculator Node
Calculates risk scores for incoming entities and routes them via severity handles.
"""
from typing import Any, Dict
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node


@register_node
class RiskCalculatorNode(BaseNode):
    """ 
    Calculates risk scores for individual entities and provides split output routing.
    """

    metadata = NodeMetadata(
        type="riskCalculator",
        category="logic",
        label="Risk Calculator",
        color="#EF4444",  # Red for risk indication
        input_handles=["data", "default", "target"],
        output_handles=["data", "high_risk", "medium_risk", "low_risk"],
        description="Computes risk scores and splits entities into severity pipelines.",
        hide_in_sidebar=False
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        # 1. Input Resolution (The Golden Boilerplate)
        input_val = inputs.get("data")
        if input_val is None: input_val = inputs.get("default")
        if input_val is None: input_val = inputs.get("target")
        
        # Handle isolated UI preview runs
        if input_val is None and not inputs:
            input_val = config.get("previewInput")
        elif input_val is None and inputs:
            input_val = list(inputs.values())[0] # Aggressive fallback to whatever wire is connected

        # Node Config targeting
        target_field = config.get("targetField", "risk_score")
        
        # Routing buckets
        high_risk, medium_risk, low_risk = [], [], []

        def _process(item: Any) -> Any:
            if not isinstance(item, dict):
                return item
                
            # Principle 2: Explicit Data Lineage. Copy entity to preserve original schema.
            processed = item.copy()
            
            # Dummy extraction logic (Extensible via GraphService)
            # Default to 0.5; if source has a 'severity' use that
            base_risk = 0.5
            if "severity" in processed:
                try:
                    base_risk = float(processed["severity"])
                except (ValueError, TypeError):
                    pass
                    
            processed[target_field] = base_risk
            
            # Route to respective subset arrays
            if base_risk >= 0.7:
                high_risk.append(processed)
            elif base_risk >= 0.4:
                medium_risk.append(processed)
            else:
                low_risk.append(processed)
                
            return processed

        # 3. Smart Bulk & Scalar Fallbacks
        if isinstance(input_val, list):
            result_payload = [_process(item) for item in input_val]
        elif isinstance(input_val, dict):
            result_payload = _process(input_val)
        else:
            result_payload = input_val

        # 4. Output Formatting & Envelope
        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
        
        return NodeResult(
            success=True,
            outputs={
                "data": result_payload,             # Complete payload
                "high_risk": high_risk,             # Subset routing
                "medium_risk": medium_risk,
                "low_risk": low_risk,
                "resolvedEntity": preview_payload   # UI properties panel requirement
            },
            metadata={"processed_count": len(result_payload) if isinstance(result_payload, list) else 1}
        )