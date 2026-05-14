"""
relationship_mapping_node.py — AI Relationship Mapping Node
Uses AI to map relationships between entities based on their attributes.
"""
from typing import Any, Dict
import json
import random
import threading
import requests
import logging
import hashlib
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node
from gateway.services.neo4j_service import get_neo4j_service

logger = logging.getLogger(__name__)

# In-memory storage for AI evaluations to prevent DB bloat
# Structure: { execution_hash: { "mapped": set(), "unmapped": set() } }
_local_evaluation_cache = {}


def _interruptible_post(url: str, headers: dict, data: dict, cancel_event: threading.Event, timeout: int = 60):
    """
    Run requests.post() in a daemon thread and poll cancel_event every 500 ms.

    If cancel_event is set while the HTTP call is in-flight, the underlying
    Session is closed, which causes requests to raise a ConnectionError in the
    sub-thread.  We catch that and return (None, True) so the caller knows it
    was cancelled rather than a real network error.

    Returns:
        (response, cancelled: bool)
        response is None when cancelled or when a network error occurred.
    """
    session = requests.Session()
    result_holder = [None]   # [response | None]
    error_holder  = [None]   # [Exception | None]

    def _do_post():
        try:
            result_holder[0] = session.post(url, headers=headers, json=data, timeout=timeout)
        except Exception as exc:
            error_holder[0] = exc

    thread = threading.Thread(target=_do_post, daemon=True)
    thread.start()

    # Poll until the thread finishes or we're told to cancel
    while thread.is_alive():
        if cancel_event.is_set():
            logger.warning("[RelationshipMappingNode] 🛑 Cancel event fired — closing HTTP session to abort in-flight AI call.")
            try:
                session.close()
            except Exception:
                pass
            thread.join(timeout=5)   # give the thread a moment to notice the closed socket
            return None, True        # (response=None, cancelled=True)
        cancel_event.wait(0.5)       # block for at most 500 ms, then re-check

    # Thread finished normally
    if error_holder[0] is not None:
        # Re-raise so the caller's existing except block handles it
        raise error_holder[0]

    return result_holder[0], False   # (response, cancelled=False)


@register_node
class RelationshipMappingNode(BaseNode):
    metadata = NodeMetadata(
        type="relationshipMappingNode",
        category="ai",
        label="Relationship Mapping",
        color="#8B5CF6",
        input_handles=["source_entity", "target_entity"],
        output_handles=["data"],
        description="Uses AI to map relationships from source entities to target entities based on their attributes."
    )

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        logger.info("[RelationshipMappingNode] Node triggered. Execution started!")

        # ── Cancellation handle injected by the engine ────────────────────────
        # The engine calls cancel_event.set() the moment this node is re-triggered
        # while already running. Every blocking section checks / respects it.
        cancel_event: threading.Event = config.get("_cancel_event") or threading.Event()

        source_val = inputs.get("source_entity")
        target_val = inputs.get("target_entity")
        
        is_ui_preview = False
        # Handle isolated UI preview runs
        if source_val is None and target_val is None and not inputs:
            source_val = config.get("previewInput")
            target_val = config.get("previewInput")
            is_ui_preview = True
            
        source_fields = config.get("sourceFields", [])
        target_fields = config.get("targetFields", [])
        relation_type = config.get("relationType", "RELATES_TO")
        inter_relationship = config.get("interRelationship", False)
        min_score = float(config.get("minScore", 0.7))
        ignore_exact_matches = config.get("ignoreExactMatches", False)
        logger.info("[RelationshipMappingNode] Configured relation_type: %s, source_fields: %s, target_fields: %s", relation_type, source_fields, target_fields)
        source_entities = source_val if isinstance(source_val, list) else ([source_val] if source_val else [])
        
        if inter_relationship:
            target_entities = source_entities
        else:
            target_entities = target_val if isinstance(target_val, list) else ([target_val] if target_val else [])
        
        # Validate required conditions before proceeding
        ai_provider = config.get("aiProvider", "gemini")
        api_key = config.get("mistralApiKey") if ai_provider == "mistral" else config.get("geminiApiKey")

        is_valid = True
        if not api_key:
            logger.warning(f"[RelationshipMappingNode] Missing {ai_provider.capitalize()} API Key. Skipping execution.")
            is_valid = False
        elif not source_fields:
            logger.warning("[RelationshipMappingNode] Missing source attributes. Skipping execution.")
            is_valid = False
        elif not source_entities:
            logger.warning("[RelationshipMappingNode] No source entities provided. Skipping execution.")
            is_valid = False
        elif not target_entities:
            logger.warning("[RelationshipMappingNode] No target entities provided. Skipping execution.")
            is_valid = False

        if not is_valid or is_ui_preview:
            preview_payload = source_val if isinstance(source_val, (dict, list)) else {"result": source_val}
            if is_ui_preview:
                logger.info("[RelationshipMappingNode] UI Preview mode detected. Skipping Neo4j and AI execution.")
            return NodeResult(
                success=True, 
                outputs={"data": source_val, "resolvedEntity": preview_payload}, 
                metadata={"config_used": config, "skipped": True, "reason": "UI Preview or Invalid Config"}
            )

        # 1. Query Neo4j to find entities lacking this outgoing relationship
        neo4j = get_neo4j_service()
        # Sanitize the relation type to prevent Cypher injection
        safe_rel_type = "".join(c for c in relation_type if c.isalnum() or c == '_')
        
        # Attempt to extract the source_id from the incoming entities to scope the query
        source_id = source_entities[0].get("_source_id") if source_entities and isinstance(source_entities[0], dict) else None
        
        missing_count = 0
        missing_ids = []
        processed_count = 0
        
        # --- Context-Aware Re-evaluation (Cache Invalidation) ---
        # Generate a deterministic hash of the current node settings and target entities.
        # If any of these change (e.g. new targets, different prompt/model), it automatically re-evaluates.
        is_string_target = len(target_entities) == 1 and isinstance(target_entities[0], dict) and "text" in target_entities[0] and "_hve_id" not in target_entities[0]
        
        if is_string_target:
            target_signature = [target_entities[0].get("text", "")]
        else:
            # Hash the unique Source IDs of the targets, NOT the individual row IDs.
            # This prevents infinite cache-clearing loops when streaming data arrives,
            # while still re-evaluating if the user connects an entirely different target node.
            target_signature = sorted(list(set([str(t.get("_source_id", "unknown")) for t in target_entities if isinstance(t, dict)])))
            
        exec_signature = {
            "relationType": relation_type,
            "sourceFields": sorted(source_fields),
            "targetFields": sorted(target_fields),
            "aiProvider": config.get("aiProvider", "gemini"),
            "model": config.get("mistralModel") if config.get("aiProvider") == "mistral" else config.get("geminiModel"),
            "minScore": min_score,
            "ignoreExactMatches": ignore_exact_matches,
            "targetSources": target_signature
        }
        
        execution_hash = hashlib.md5(json.dumps(exec_signature, sort_keys=True).encode("utf-8")).hexdigest()

        # Initialize or reset local cache for this configuration if it doesn't exist
        if execution_hash not in _local_evaluation_cache:
            if _local_evaluation_cache:
                logger.info("[RelationshipMappingNode] " + "="*65)
                logger.info("[RelationshipMappingNode] 🔄 CONFIGURATION CHANGED — clearing evaluation cache.")
                logger.info(f"[RelationshipMappingNode] New active hash: {execution_hash}")
                logger.info(f"[RelationshipMappingNode] Applied Settings: {json.dumps(exec_signature, default=str)}")
                logger.info("[RelationshipMappingNode] " + "="*65)
                _local_evaluation_cache.clear()
            _local_evaluation_cache[execution_hash] = {"mapped": set(), "unmapped": set()}
            
        current_cache = _local_evaluation_cache[execution_hash]
        already_evaluated = current_cache["mapped"].union(current_cache["unmapped"])

        # We collect the IDs to have a list, and count them to know how many
        if source_id:
            query = f"""
            MATCH (e:Entity)-[:PART_OF_SOURCE]->(s:Source {{source_id: $source_id}})
            WHERE NOT (e)-[:{safe_rel_type}]->()
            RETURN count(e) AS missing_count, collect(e._hve_id) AS missing_ids
            """
            
            try:
                db_results = neo4j.execute_query(query, {"source_id": source_id})
                if db_results:
                    missing_count = db_results[0].get("missing_count", 0)
                    missing_ids = db_results[0].get("missing_ids", [])
                    
                    logger.info("[RelationshipMappingNode] Neo4j query results: missing_count=%d, missing_ids_sample=%s", missing_count, missing_ids[:5])
                    
                        
                logger.info(f"[RelationshipMappingNode] Found {missing_count} entities missing the '{safe_rel_type}' relationship in Neo4j.")
            except Exception as e:
                logger.error(f"Failed to query Neo4j in RelationshipMappingNode: {e}")
        else:
            logger.warning("[RelationshipMappingNode] No '_source_id' found in source entities. Cannot scope Neo4j query. Skipping database lookup.")

        # =========================================================================
        # AI Relationship Evaluation
        # =========================================================================
        
        # Filter source entities that are actually missing the relationship AND haven't been locally evaluated yet
        if source_id and missing_ids:
            missing_sources = [e for e in source_entities if isinstance(e, dict) and e.get("_hve_id") in missing_ids and e.get("_hve_id") not in already_evaluated]
        else:
            missing_sources = [e for e in source_entities if isinstance(e, dict) and e.get("_hve_id") not in already_evaluated]

        total_sources = len([e for e in source_entities if isinstance(e, dict)])
        evaluated_count = len([e for e in source_entities if isinstance(e, dict) and e.get("_hve_id") in already_evaluated])
        to_process_count = len(missing_sources)

        logger.info("[RelationshipMappingNode] " + "-"*65)
        logger.info(f"[RelationshipMappingNode] 📊 ITERATION STATUS REPORT")
        logger.info(f"[RelationshipMappingNode] Total source entities received: {total_sources}")
        logger.info(f"[RelationshipMappingNode] Entities already evaluated (in cache): {evaluated_count}")
        logger.info(f"[RelationshipMappingNode] Entities remaining to process: {to_process_count}")
        logger.info("[RelationshipMappingNode] " + "-"*65)

        if to_process_count == 0:
            logger.info("[RelationshipMappingNode] 🛑 ITERATION STOPPED: No entities left to process.")

        ai_responses = []
        ai_inputs = []
        mapped_count = 0
        cancelled = False
        if missing_sources and target_entities:
            logger.info(f"[RelationshipMappingNode] 🚀 STARTING BATCH: Evaluating {to_process_count} entities...")
            ai_provider = config.get("aiProvider", "gemini")
            mistral_api_key = config.get("mistralApiKey")
            mistral_model = config.get("mistralModel", "mistral-large-latest")
            gemini_api_key = config.get("geminiApiKey")
            gemini_model = config.get("geminiModel", "gemini-2.5-flash")

            for idx, source_entity in enumerate(missing_sources, 1):
                # ── Pre-call cancellation check ───────────────────────────────────
                # The engine sets cancel_event the moment this node is re-triggered
                # while already running. Abort before starting a new AI call.
                if cancel_event.is_set():
                    logger.warning(
                        f"[RelationshipMappingNode] 🛑 Cancelled at entity {idx}/{to_process_count} "
                        "(engine re-triggered node). Stopping batch."
                    )
                    cancelled = True
                    break

                logger.info(f"[RelationshipMappingNode] ⏳ Processing entity {idx}/{to_process_count} (ID: {source_entity.get('_hve_id')})...")
                source_entity["_ai_mapped_targets"] = source_entity.get("_ai_mapped_targets", [])
                has_mapped = False
                
                def extract_fields(ent, fields):
                    if not fields:
                        # If no fields are specified, send the entire payload to the AI
                        return ent
                    return {k: v for k, v in ent.items() if k in fields or k == "_hve_id"}
                    
                source_payload = extract_fields(source_entity, source_fields)
                
                if is_string_target:
                    target_payloads = target_entities[0]["text"]
                else:
                    # 2. Select up to 50 target entities
                    valid_targets = [t for t in target_entities if isinstance(t, dict) and t.get("_hve_id") != source_entity.get("_hve_id")]
                    sample_size = min(50, len(valid_targets))
                    sample_targets = random.sample(valid_targets, sample_size)
                    
                    # 3. Extract requested fields to limit token usage and isolate context
                    target_payloads = [extract_fields(t, target_fields) for t in sample_targets]
                
                # 4. Construct System Prompt & Payload
                system_prompt = f"""You are an expert data analyst AI.
Your task is to determine the likelihood of a '{relation_type}' relationship between a Source Entity and a list of Target Entities based on their attributes.
For each Target Entity, provide a relationship score between 0.0 and 1.0 (where 1.0 is extremely likely) and a single-line reason.
IMPORTANT: The "target_id" in your response MUST be the exact "_hve_id" value from the provided Target Entities. Do not use any other ID field.
Output strictly in JSON format as a list of dictionaries with keys: "target_id", "score", "reason"."""

                user_prompt = f"Source Entity:\n{json.dumps(source_payload, indent=2)}\n\nTarget Entities:\n{json.dumps(target_payloads, indent=2)}"
                ai_input = user_prompt
                ai_inputs.append(ai_input)
                
                ai_response = None
                
                if ai_provider == "mistral":
                    if mistral_api_key:
                        logger.info(f"[RelationshipMappingNode] Sending source {source_entity.get('_hve_id')} to Mistral {mistral_model}...")
                        try:
                            url = "https://api.mistral.ai/v1/chat/completions"
                            headers = {
                                "Content-Type": "application/json",
                                "Authorization": f"Bearer {mistral_api_key}"
                            }
                            data = {
                                "model": mistral_model,
                                "messages": [
                                    {"role": "system", "content": system_prompt},
                                    {"role": "user", "content": user_prompt}
                                ]
                            }
                            
                            resp, cancelled = _interruptible_post(url, headers, data, cancel_event)
                            if cancelled:
                                logger.warning(f"[RelationshipMappingNode] 🛑 Mistral call cancelled for entity {source_entity.get('_hve_id')}. Aborting batch.")
                                break
                            if resp and resp.ok:
                                ai_text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "[]")
                                if ai_text.startswith("```json"):
                                    ai_text = ai_text.strip("`").strip().removeprefix("json").strip()
                                elif ai_text.startswith("```"):
                                    ai_text = ai_text.strip("`").strip()
                                ai_response = json.loads(ai_text)
                                ai_responses.append(ai_response)
                                logger.info(f"[RelationshipMappingNode] AI Output:\n{json.dumps(ai_response, indent=2)}")
                            elif resp:
                                logger.error(f"[RelationshipMappingNode] Mistral API Error: {resp.text}")
                        except Exception as e:
                            logger.error(f"[RelationshipMappingNode] Exception calling Mistral: {e}", exc_info=True)
                    else:
                        logger.warning("[RelationshipMappingNode] No Mistral API Key provided. Skipping AI call.")
                else:
                    if gemini_api_key:
                        logger.info(f"[RelationshipMappingNode] Sending source {source_entity.get('_hve_id')} to {gemini_model}...")
                        try:
                            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
                            headers = {"Content-Type": "application/json"}
                            data = {"system_instruction": {"parts": [{"text": system_prompt}]}, "contents": [{"parts": [{"text": user_prompt}]}], "generationConfig": {"response_mime_type": "application/json"}}
                            
                            resp, cancelled = _interruptible_post(url, headers, data, cancel_event)
                            if cancelled:
                                logger.warning(f"[RelationshipMappingNode] 🛑 Gemini call cancelled for entity {source_entity.get('_hve_id')}. Aborting batch.")
                                break
                            if resp and resp.ok:
                                ai_text = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "[]")
                                ai_response = json.loads(ai_text)
                                ai_responses.append(ai_response)
                                logger.info(f"[RelationshipMappingNode] AI Output:\n{json.dumps(ai_response, indent=2)}")
                            elif resp:
                                logger.error(f"[RelationshipMappingNode] Gemini API Error: {resp.text}")
                        except Exception as e:
                            logger.error(f"[RelationshipMappingNode] Exception calling Gemini: {e}", exc_info=True)
                    else:
                        logger.warning("[RelationshipMappingNode] No Gemini API Key provided. Skipping AI call.")
                        
                # ── Post-call cancellation check ──────────────────────────────────
                # The AI call may have taken 10-30s. If the engine signalled cancel
                # during that time and _interruptible_post didn't catch it (e.g. the
                # event was set exactly at the moment the response arrived), drop the
                # result here before writing anything to Neo4j.
                if cancel_event.is_set():
                    logger.warning(
                        f"[RelationshipMappingNode] 🛑 Cancel detected after AI response for entity "
                        f"{source_entity.get('_hve_id')}. Discarding result — not writing to Neo4j."
                    )
                    cancelled = True
                    break

                # =========================================================================
                # Write high-scoring relationships back to Neo4j
                # =========================================================================
                if ai_response and isinstance(ai_response, list):
                    for item in ai_response:
                        target_id = item.get("target_id")
                        score = item.get("score", 0.0)
                        reason = item.get("reason", "")
                        
                        try:
                            score_val = float(score)
                            if score_val < 0.0 or score_val > 1.0:
                                score_val = 0.0
                        except (ValueError, TypeError):
                            score_val = 0.0
                            
                        # Create the edge if the AI is confident enough based on settings (and check exact match rule)
                        is_exact_match = (score_val == 1.0)
                        should_create = (score_val >= min_score) and not (ignore_exact_matches and is_exact_match)
                        
                        if is_string_target and should_create:
                            target_text = target_entities[0].get("text", "")
                            cypher = f"""
                            MATCH (s:Entity {{ _hve_id: $source_id }})
                            MERGE (t:Entity:Concept {{ text: $target_text }})
                            ON CREATE SET t._hve_id = randomUUID(), t._source_id = 'user_string'
                            WITH s, t
                            MERGE (src:Source {{ source_id: 'user_string' }})
                            MERGE (t)-[:PART_OF_SOURCE]->(src)
                            MERGE (s)-[r:{safe_rel_type}]->(t)
                            SET r.score = $score, r.reason = $reason, r.ai_generated = true
                            """
                            try:
                                summary = neo4j.execute_write(cypher, {
                                    "source_id": source_entity.get("_hve_id"),
                                    "target_text": target_text,
                                    "score": score_val,
                                    "reason": reason
                                })
                                if summary and getattr(summary.counters, 'relationships_created', 0) > 0:
                                    mapped_count += 1
                                    has_mapped = True
                                    source_entity["_ai_mapped_targets"].append({
                                        "target_text": target_text,
                                        "score": score_val,
                                        "reason": reason
                                    })
                                    logger.info(f"  [+] DB CONFIRMED -> Linked '{source_entity.get('_hve_id')}' to Concept '{target_text}' (Score: {score_val}). Nodes created: {getattr(summary.counters, 'nodes_created', 0)}")
                                else:
                                    logger.warning(f"  [!] DB FAILED -> 0 relationships created! Could not find source '{source_entity.get('_hve_id')}' in Neo4j.")
                            except Exception as e:
                                logger.error(f"[RelationshipMappingNode] Failed to write string relationship to Neo4j: {e}")
                        elif not is_string_target and target_id and should_create:
                            cypher = f"""
                            MATCH (s:Entity {{ _hve_id: $source_id }})
                            MATCH (t:Entity {{ _hve_id: $target_id }})
                            MERGE (s)-[r:{safe_rel_type}]->(t)
                            SET r.score = $score, r.reason = $reason, r.ai_generated = true
                            """
                            try:
                                summary = neo4j.execute_write(cypher, {
                                    "source_id": source_entity.get("_hve_id"),
                                    "target_id": target_id,
                                    "score": score_val,
                                    "reason": reason
                                })
                                if summary and getattr(summary.counters, 'relationships_created', 0) > 0:
                                    mapped_count += 1
                                    has_mapped = True
                                    source_entity["_ai_mapped_targets"].append({
                                        "target_id": target_id,
                                        "score": score_val,
                                        "reason": reason
                                    })
                                    logger.info(f"  [+] DB CONFIRMED -> Linked '{source_entity.get('_hve_id')}' to target '{target_id}' (Score: {score_val})")
                                else:
                                    logger.warning(f"  [!] DB FAILED -> 0 relationships created! Could not match IDs: '{source_entity.get('_hve_id')}' -> '{target_id}'")
                            except Exception as e:
                                logger.error(f"[RelationshipMappingNode] Failed to write relationship to Neo4j: {e}")
                                
                # Maintain local storage for mapped and unmapped entities to prevent infinite loops
                # without modifying the underlying Neo4j nodes.
                if has_mapped:
                    current_cache["mapped"].add(source_entity.get("_hve_id"))
                else:
                    current_cache["unmapped"].add(source_entity.get("_hve_id"))
                
                processed_count += 1

            if cancelled:
                logger.info("[RelationshipMappingNode] " + "-"*65)
                logger.info(f"[RelationshipMappingNode] ⚡ BATCH CANCELLED: Processed {processed_count}/{to_process_count} entities before cancel signal. Engine will re-run with updated settings.")
                logger.info("[RelationshipMappingNode] " + "-"*65)
            else:
                logger.info("[RelationshipMappingNode] " + "-"*65)
                logger.info(f"[RelationshipMappingNode] ✅ BATCH COMPLETE: Evaluated {processed_count} entities, created {mapped_count} '{safe_rel_type}' relationships.")
                logger.info("[RelationshipMappingNode] " + "-"*65)

        else:
            logger.warning("[RelationshipMappingNode] Missing valid source or target entities. Skipping AI evaluation.")
            
        # Output the source_entities carrying the newly appended relationships forward
        result_payload = source_entities if isinstance(source_val, list) else (source_entities[0] if source_entities else None)
            
        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}
        
        return NodeResult(
            success=True,
            outputs={
                "data": result_payload,             # MUST be "data" for downstream
                "resolvedEntity": preview_payload   # MUST exist for UI properties panel
            },
            metadata={
                "config_used": config,
                "neo4j_missing_relations_count": missing_count,
                "neo4j_missing_relations_list": missing_ids,
                "processed_source_id": source_id,
                "processed_count": processed_count,
                "mapped_count": mapped_count,
                "cancelled": cancelled,
                "ai_input_prompt": ai_inputs,
                "ai_output_response": ai_responses
            }
        )