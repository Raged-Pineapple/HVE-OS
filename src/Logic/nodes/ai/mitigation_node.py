import logging
from typing import Dict, Any, Optional

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node

logger = logging.getLogger(__name__)

@register_node
class MitigationNode(BaseNode):
    metadata = NodeMetadata(
        type="mitigationNode",
        label="Mitigation Strategies",
        category="ai",
        color="#3B82F6",
        input_handles=["data"],
        output_handles=["data"],
        description="Generates mitigation strategies for high-risk entities."
    )
        
    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("[MitigationNode] ================== EXECUTION STARTED ==================")
        
        entities = []
        for key, value in inputs.items():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                entities.extend(value)
            elif isinstance(value, dict):
                entities.append(value)
                
        logger.info(f"[MitigationNode] Received {len(entities)} entities for mitigation analysis.")
        
        import requests
        import json
        
        provider = config.get("aiProvider", "gemini")
        api_key = config.get("geminiApiKey") if provider == "gemini" else config.get("mistralApiKey")
        display_prop = config.get("displayNameProperty")
        selected_names = config.get("selectedEntities", [])

        # Filter entities to just the selected ones
        selected_entities = []
        for e in entities:
            name = e.get(display_prop) if display_prop else e.get("name", e.get("title", e.get("_hve_id", "Unknown")))
            if name in selected_names:
                selected_entities.append(e)

        if not selected_entities:
            logger.warning("[MitigationNode] No entities selected for mitigation. Passing through raw data.")
            return NodeResult(success=True, outputs={"data": entities})

        auto_generate = config.get("autoGenerate", False)
        if not auto_generate:
            logger.info("[MitigationNode] Auto-generation is disabled. Skipping AI strategy generation.")
            # Still attach selected entities as the main output, but don't modify them
            return NodeResult(success=True, outputs={"data": selected_entities})

        if not api_key:
            logger.error("[MitigationNode] No API key provided for the selected AI provider.")
            return NodeResult(success=False, outputs={"data": entities}, error="API Key missing")

        logger.info(f"[MitigationNode] Generating AI mitigation strategies for {len(selected_entities)} entities via {provider}...")

        mitigated_entities = []
        for e in selected_entities:
            # We must make an AI call for each entity
            name = e.get(display_prop) if display_prop else e.get("name", e.get("title", e.get("_hve_id", "Unknown")))
            risk_score = e.get("_risk_score", "Unknown")
            path_trace = e.get("_path_trace", [])

            prompt = f"Analyze the following high-risk entity and its path trace. Provide a clear, actionable mitigation strategy to reduce its risk.\n\nEntity Name: {name}\nRisk Score: {risk_score}\n\nPath Trace:\n{json.dumps(path_trace, indent=2)}\n\nOutput only the mitigation strategy as plain text. Do not use markdown."

            strategy = "AI strategy generation failed."
            try:
                if provider == "mistral":
                    model = config.get("mistralModel", "mistral-large-latest")
                    url = "https://api.mistral.ai/v1/chat/completions"
                    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    data = {
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.2
                    }
                    res = requests.post(url, headers=headers, json=data, timeout=30)
                    if res.ok:
                        strategy = res.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                    else:
                        err_msg = res.text
                        logger.error(f"[MitigationNode] Mistral API error: {err_msg}")
                        strategy = f"**API Error {res.status_code}**: {err_msg}"
                elif provider == "gemini":
                    model = config.get("geminiModel", "gemini-2.5-flash")
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    headers = {"Content-Type": "application/json"}
                    data = {
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.2}
                    }
                    res = requests.post(url, headers=headers, json=data, timeout=30)
                    if res.ok:
                        strategy = res.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                    else:
                        err_msg = res.text
                        logger.error(f"[MitigationNode] Gemini API error: {err_msg}")
                        strategy = f"**API Error {res.status_code}**: {err_msg}"
            except Exception as ex:
                logger.error(f"[MitigationNode] AI error for entity {name}: {ex}")
                strategy = f"**Execution Error**: {ex}"

            # Append the mitigation strategy to the entity
            e["_mitigation_strategy"] = strategy
            mitigated_entities.append(e)

        outputs = {
            "data": mitigated_entities
        }
        
        logger.info("[MitigationNode] ================== EXECUTION FINISHED ==================")
        return NodeResult(success=True, outputs=outputs)

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
