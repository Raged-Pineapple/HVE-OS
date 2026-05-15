"""
risk_scoring_node.py — Risk Scoring Node
Analyzes entities and separates them into High, Medium, and Low risk buckets.
"""
import logging
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

logger = logging.getLogger(__name__)

@register_node
class RiskCalculatorNode(BaseNode):
    """
    Risk Calculator Node - Evaluates data and segments into risk tiers.
    """

    metadata = NodeMetadata(
        type="riskCalculator",
        category="logic",
        label="Risk Calculator",
        color="#EF4444",
        input_handles=["data"],
        output_handles=["data", "high_risk", "medium_risk", "low_risk", "pinned"],
        description="Analyzes Risk Exposure"
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("============== RISK CALCULATOR NODE EXECUTION STARTED ==============")
        logger.info(f"RiskCalculatorNode received inputs keys: {list(inputs.keys())}")
        logger.info(f"RiskCalculatorNode received config keys: {list(config.keys())}")

        input_data = inputs.get('data')
        if input_data is None:
            input_data = inputs.get('default')
        if input_data is None:
            input_data = inputs.get(None)
        if input_data is None and inputs:
            input_data = list(inputs.values())[0]
        if input_data is None:
            input_data = config.get("previewInput")

        entities = input_data if isinstance(input_data, list) else ([input_data] if input_data else [])
        
        logger.info(f"RiskCalculatorNode resolved entities: {len(entities)} items. Type: {type(input_data)}")
        if entities:
            logger.info(f"RiskCalculatorNode first entity payload preview: {str(entities[0])[:500]}")

        high_risk = []
        medium_risk = []
        low_risk = []
        
        target_field = config.get("targetField", "risk_score")

        # Collect all unique target pairs from incoming entities
        target_pairs = set()
        for e in entities:
            if isinstance(e, dict):
                rt = e.get("relation_type", "UNKNOWN")
                tt = e.get("target_text", "Unknown")
                if rt != "UNKNOWN" and tt != "Unknown":
                    target_pairs.add((rt, tt))

        if not target_pairs:
            # Try to recover from cached previous run stored in node config
            cached_buckets = (
                config.get("high_risk", []) +
                config.get("medium_risk", []) +
                config.get("low_risk", [])
            )
            for cached in cached_buckets:
                if isinstance(cached, dict):
                    rt = cached.get("_relation_type", "")
                    tt = cached.get("_target_concept", "")
                    if rt and tt:
                        target_pairs.add((rt, tt))
            
            if target_pairs:
                logger.info(f"RiskCalculator recovered {len(target_pairs)} targets from cache.")

        if not target_pairs:
            logger.warning(
                "RiskCalculator has no valid relationship data from upstream "
                "and no cached results to fall back to. "
                "Connect a RelationshipMappingNode and run the full pipeline."
            )
            outputs = {
                "data": [], "high_risk": [], "medium_risk": [], "low_risk": [], "pinned": [], "resolvedEntity": []
            }
            return NodeResult(success=True, outputs=outputs, metadata={"total": 0})

        logger.info(f"RiskCalculator preparing to query DB for {len(target_pairs)} relationship targets.")

        from gateway.services.neo4j_service import get_neo4j_service
        neo4j = get_neo4j_service()
        max_hops = int(config.get("maxHops", 3))

        all_records = []

        for rel_type, target_text in target_pairs:
            cypher = f"""
            MATCH (concept {{_source_id: 'user_string', text: $usertext}})
            MATCH p=(concept)<-[:{rel_type}*1..{max_hops}]-(prev)
            WITH prev, nodes(p) AS path_nodes, relationships(p) AS rels, length(p) AS hops
            WITH prev, path_nodes, hops,
                 [r IN rels | {{score: coalesce(r.score, 1.0), reason: coalesce(r.reason, ''), type: type(r)}}] AS rel_details
            WITH prev, path_nodes, hops, rel_details,
                 reduce(s = 1.0, r IN rel_details | s * r.score) AS path_score
            RETURN prev, path_nodes, hops, rel_details, path_score, '{target_text}' AS target_concept, '{rel_type}' AS rel_type
            ORDER BY path_score DESC, hops ASC
            """
            
            try:
                records = neo4j.execute_query(cypher, {"usertext": target_text})
                all_records.extend(records or [])
            except Exception as e:
                logger.error(f"RiskCalculator DB Query Error for {rel_type} -> {target_text}: {e}")

        # ── Deduplicate: keep best path per entity ──────────────────────────────
        best_per_entity = {}
        for record in all_records:
            prev       = dict(record.get("prev", {}))
            eid        = prev.get("_hve_id", id(prev))
            path_score = float(record.get("path_score") or 0.0)
            hops       = record.get("hops", max_hops)
            path_nodes = [dict(n) for n in (record.get("path_nodes") or [])]
            rel_details = list(record.get("rel_details") or [])
            target_concept = record.get("target_concept", "")
            rel_type   = record.get("rel_type", "")

            # Keep the path with the highest score for each entity
            if eid not in best_per_entity or path_score > best_per_entity[eid]["path_score"]:
                best_per_entity[eid] = {
                    "entity":         prev,
                    "hops":           hops,
                    "path_score":     path_score,
                    "path_nodes":     path_nodes,
                    "rel_details":    rel_details,
                    "target_concept": target_concept,
                    "rel_type":       rel_type,
                }

        scored_entities = list(best_per_entity.values())
        raw_scores = [s["path_score"] for s in scored_entities]

        # Log overall statistics of the pulled graph paths
        max_score = max(raw_scores) if raw_scores else 0.0
        min_score = min(raw_scores) if raw_scores else 0.0
        logger.info(
            f"RiskCalculator absolute path confidence range: min={min_score:.3f} max={max_score:.3f} "
            f"across {len(scored_entities)} unique entities."
        )

        # ── Real-World Absolute Threat Scoring ──────────────────────────────────
        # Batch-relative normalization destroys real-world meaning (e.g. mapping an 81% 
        # confidence path to 0 risk just because another path scored 90%).
        # In real-world intelligence, absolute compound path confidence directly drives risk.
        high_risk_thresh   = float(config.get("highRiskThreshold",   70.0))
        medium_risk_thresh = float(config.get("mediumRiskThreshold", 35.0))

        for item in scored_entities:
            hops        = item["hops"]
            path_score  = item["path_score"]
            prev        = item["entity"]
            path_nodes  = item["path_nodes"]
            rel_details = item["rel_details"]
            target_concept = item["target_concept"]
            rel_type    = item["rel_type"]

            # Absolute base score maps directly to mathematical path probability (0–100)
            base_score  = path_score * 100.0
            
            # Structural attenuation: additional hops are already naturally penalized 
            # via probability multiplication. We add a modest structural distance penalty 
            # (-10 pts per extra hop) to reflect indirect/contextual separation.
            hop_penalty = (hops - 1) * 10.0
            final_score = max(0.0, round(base_score - hop_penalty, 1))

            # Assign risk level category
            if final_score >= high_risk_thresh:
                risk_level = "HIGH"
            elif final_score >= medium_risk_thresh:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            # Build a human-readable path trace
            path_trace = []
            display_prop = config.get("displayNameProperty")
            
            def get_node_name(n_dict):
                return n_dict.get(display_prop) or n_dict.get("name") or n_dict.get("title") or n_dict.get("text") or n_dict.get("_hve_id", "?")
                
            # nodes(p) returns [concept, intermediate, ..., prev] based on our MATCH pattern
            # To show from Source -> Concept, we reverse the iteration.
            num_rels = len(rel_details)
            for i in range(num_rels):
                # nodes[num_rels - i] is the source side of this specific edge
                # nodes[num_rels - i - 1] is the target side of this specific edge
                src_node_dict = dict(path_nodes[num_rels - i])
                tgt_node_dict = dict(path_nodes[num_rels - i - 1])
                rel_dict = rel_details[num_rels - i - 1]
                
                src_name = get_node_name(src_node_dict)
                tgt_name = get_node_name(tgt_node_dict)
                
                path_trace.append({
                    "step":        i + 1,
                    "from":        f"{src_name} → {tgt_name}",
                    "src_node":    src_node_dict,
                    "tgt_node":    tgt_node_dict,
                    "relation":    rel_dict.get("type", rel_type),
                    "score":       round(float(rel_dict.get("score", 1.0)) * 100, 1),
                    "reason":      rel_dict.get("reason", ""),
                })

            entity_record = {
                **prev,
                "_risk_score":    final_score,
                "_risk_level":    risk_level,
                "_hops":          hops,
                "_path_score":    round(path_score * 100, 1),
                "_base_score":    round(base_score, 1),
                "_hop_penalty":   hop_penalty,
                "_target_concept": target_concept,
                "_relation_type": rel_type,
                "_path_trace":    path_trace,
            }

            logger.info(
                f"  🔗 [{hops} hop{'s' if hops > 1 else ''}] [{risk_level}] "
                f"{prev.get('_hve_id', 'unknown')} | "
                f"base={round(base_score,1)} penalty={hop_penalty} → risk={final_score}"
            )

            if risk_level == "HIGH":
                high_risk.append(entity_record)
            elif risk_level == "MEDIUM":
                medium_risk.append(entity_record)
            else:
                low_risk.append(entity_record)


        all_enriched_entities = high_risk + medium_risk + low_risk
        logger.info(f"RiskCalculator scored {len(all_enriched_entities)} entities from DB paths.")

        pinned_names = config.get("pinnedEntities", [])
        display_prop = config.get("displayNameProperty")
        
        pinned = []
        if pinned_names:
            for e in all_enriched_entities:
                if isinstance(e, dict):
                    name = e.get(display_prop) if display_prop else e.get("name", e.get("title", e.get("_hve_id")))
                    if name in pinned_names:
                        pinned.append(e)

        outputs = {
            "data": all_enriched_entities,
            "high_risk": high_risk,
            "medium_risk": medium_risk,
            "low_risk": low_risk,
            "pinned": pinned,
            "resolvedEntity": all_enriched_entities
        }

        logger.info(f"RiskCalculator outputs: high({len(high_risk)}), medium({len(medium_risk)}), low({len(low_risk)})")
        logger.info("============== RISK CALCULATOR NODE EXECUTION FINISHED ==============")

        return NodeResult(
            success=True,
            outputs=outputs,
            metadata={
                "total": len(entities),
                "high_count": len(high_risk),
                "medium_count": len(medium_risk),
                "low_count": len(low_risk)
            }
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
