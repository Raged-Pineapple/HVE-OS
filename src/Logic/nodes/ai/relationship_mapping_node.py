"""
relationship_mapping_node.py — AI Relationship Mapping Node
Uses AI to map relationships between entities based on their attributes.
"""
from typing import Any, Dict, List, Optional, Tuple
import json
import random
import threading
import requests
import logging
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node
from gateway.services.neo4j_service import get_neo4j_service

logger = logging.getLogger(__name__)

# In-memory storage for AI evaluations to prevent DB bloat
# Structure: { execution_hash: { "mapped": set(), "unmapped": set() } }
_local_evaluation_cache = {}

# Default parallelism — up to this many AI calls fire simultaneously.
# Keep conservative (3-5) to avoid rate-limiting from API providers.
_DEFAULT_WORKERS = 5


def _interruptible_post(url: str, headers: dict, data: dict,
                        cancel_event: threading.Event, timeout: int = 60):
    """
    Run requests.post() in a daemon thread and poll cancel_event every 500 ms.

    If cancel_event is set while the HTTP call is in-flight, the underlying
    Session is closed, which causes requests to raise a ConnectionError in the
    sub-thread. We catch that and return (None, True) so the caller knows it
    was cancelled rather than a real network error.

    Returns:
        (response, cancelled: bool)
        response is None when cancelled or when a network error occurred.
    """
    session = requests.Session()
    result_holder = [None]
    error_holder  = [None]

    def _do_post():
        try:
            result_holder[0] = session.post(url, headers=headers, json=data, timeout=timeout)
        except Exception as exc:
            error_holder[0] = exc

    thread = threading.Thread(target=_do_post, daemon=True)
    thread.start()

    while thread.is_alive():
        if cancel_event.is_set():
            logger.warning("[RelationshipMappingNode] 🛑 Cancel event fired — closing HTTP session to abort in-flight AI call.")
            try:
                session.close()
            except Exception:
                pass
            thread.join(timeout=5)
            return None, True
        cancel_event.wait(0.5)

    if error_holder[0] is not None:
        raise error_holder[0]

    return result_holder[0], False


def _evaluate_entity(
    source_entity: dict,
    target_entities: list,
    target_fields: list,
    source_fields: list,
    is_string_target: bool,
    relation_type: str,
    safe_rel_type: str,
    min_score: float,
    ignore_exact_matches: bool,
    ai_provider: str,
    mistral_api_key: Optional[str],
    mistral_model: str,
    gemini_api_key: Optional[str],
    gemini_model: str,
    cancel_event: threading.Event,
) -> Tuple[dict, bool, bool, Optional[list], Optional[str]]:
    """
    Evaluate a single source entity against all targets.

    Runs entirely in a worker thread. Thread-safe: no shared mutable state is
    written here — Neo4j writes happen on a dedicated write-back thread after
    this returns.

    Returns:
        (source_entity, has_mapped, cancelled, ai_response, ai_input_prompt)
    """
    if cancel_event.is_set():
        return source_entity, False, True, None, None

    def extract_fields(ent, fields):
        if not fields:
            return ent
        # Ensure _hve_id and text are always preserved for AI reference
        return {k: v for k, v in ent.items() if k in fields or k == "_hve_id" or k == "text"}

    source_payload = extract_fields(source_entity, source_fields)

    valid_targets = [t for t in target_entities if isinstance(t, dict) and t.get("_hve_id") != source_entity.get("_hve_id")]
    
    # Guarantee that string/user targets are always included in the evaluation sample
    guaranteed_targets = [t for t in valid_targets if str(t.get("_hve_id")).startswith("__string_target_")]
    peer_targets = [t for t in valid_targets if not str(t.get("_hve_id")).startswith("__string_target_")]
    
    sample_size = min(50 - len(guaranteed_targets), len(peer_targets))
    sample_size = max(0, sample_size)
    sample_targets = guaranteed_targets + (random.sample(peer_targets, sample_size) if sample_size > 0 else [])
    
    logger.info(f"[RelationshipMappingNode] [{source_entity.get('_hve_id')}] Guaranteed targets count: {len(guaranteed_targets)}. Sample targets total: {len(sample_targets)}.")
    
    target_payloads = [extract_fields(t, target_fields) for t in sample_targets]

    system_prompt = f"""You are an expert data analyst AI.
Your task is to determine the likelihood of a '{relation_type}' relationship between a Source Entity and a list of Target Entities based on their attributes.
For each Target Entity, provide a relationship score between 0.0 and 1.0 (where 1.0 is extremely likely) and a single-line reason.
IMPORTANT: The "target_id" in your response MUST be the exact "_hve_id" value from the provided Target Entities. Do not use any other ID field.
Output strictly in JSON format as a list of dictionaries with keys: "target_id", "score", "reason"."""

    user_prompt = f"Source Entity:\n{json.dumps(source_payload, indent=2)}\n\nTarget Entities:\n{json.dumps(target_payloads, indent=2)}"

    ai_response = None

    try:
        if ai_provider == "mistral":
            if not mistral_api_key:
                logger.warning("[RelationshipMappingNode] No Mistral API Key provided. Skipping AI call.")
                return source_entity, False, False, None, user_prompt

            logger.info(f"[RelationshipMappingNode] ⏳ [{source_entity.get('_hve_id')}] → Mistral {mistral_model}...")
            url = "https://api.mistral.ai/v1/chat/completions"
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {mistral_api_key}"}
            data = {
                "model": mistral_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            }
            resp, cancelled = _interruptible_post(url, headers, data, cancel_event)
            if cancelled:
                return source_entity, False, True, None, user_prompt
            if resp and resp.ok:
                ai_text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "[]")
                if ai_text.startswith("```json"):
                    ai_text = ai_text.strip("`").strip().removeprefix("json").strip()
                elif ai_text.startswith("```"):
                    ai_text = ai_text.strip("`").strip()
                if cancel_event.is_set():
                    return source_entity, False, True, None, user_prompt
                ai_response = json.loads(ai_text)
                logger.info(f"[RelationshipMappingNode] ✅ [{source_entity.get('_hve_id')}] AI response received ({len(ai_response)} items).")
            elif resp:
                logger.error(f"[RelationshipMappingNode] Mistral API Error for {source_entity.get('_hve_id')}: {resp.text}")

        else:  # gemini
            if not gemini_api_key:
                logger.warning("[RelationshipMappingNode] No Gemini API Key provided. Skipping AI call.")
                return source_entity, False, False, None, user_prompt

            logger.info(f"[RelationshipMappingNode] ⏳ [{source_entity.get('_hve_id')}] → {gemini_model}...")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_api_key}"
            headers = {"Content-Type": "application/json"}
            data = {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": user_prompt}]}],
                "generationConfig": {"response_mime_type": "application/json"}
            }
            resp, cancelled = _interruptible_post(url, headers, data, cancel_event)
            if cancelled:
                return source_entity, False, True, None, user_prompt
            if resp and resp.ok:
                ai_text = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "[]")
                if cancel_event.is_set():
                    return source_entity, False, True, None, user_prompt
                ai_response = json.loads(ai_text)
                logger.info(f"[RelationshipMappingNode] ✅ [{source_entity.get('_hve_id')}] AI response received ({len(ai_response)} items).")
            elif resp:
                logger.error(f"[RelationshipMappingNode] Gemini API Error for {source_entity.get('_hve_id')}: {resp.text}")

    except Exception as e:
        logger.error(f"[RelationshipMappingNode] Exception evaluating {source_entity.get('_hve_id')}: {e}", exc_info=True)
        return source_entity, False, False, None, user_prompt

    return source_entity, False, False, ai_response, user_prompt


def _write_relationships(
    source_entity: dict,
    ai_response: list,
    target_entities: list,
    safe_rel_type: str,
    min_score: float,
    ignore_exact_matches: bool,
    neo4j,
) -> Tuple[int, bool]:
    """
    Write AI-scored relationships to Neo4j for a single source entity.
    Returns (relationships_created, has_mapped).
    Thread-safe: each call uses its own Neo4j session from the shared pool.
    """
    mapped_count = 0
    has_mapped = False

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

        is_exact_match = (score_val == 1.0)
        should_create = (score_val >= min_score) and not (ignore_exact_matches and is_exact_match)
        
        target_display = str(target_id)
        target_text = ""
        if str(target_id).startswith("__string_target_"):
            for t in target_entities:
                if t.get("_hve_id") == target_id:
                    target_text = t.get("text", "")
                    target_display = f'Concept: "{target_text}"'
                    break

        status_emoji = "✅ APPROVED" if should_create else "❌ REJECTED"
        logger.info(
            f"[RelationshipMappingNode] 🧠 AI Score: {score_val:.2f} | {status_emoji} | "
            f"[{source_entity.get('_hve_id')}] → [{target_display}] | Reason: {reason}"
        )

        if str(target_id).startswith("__string_target_") and should_create:
                    
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
                    source_entity.setdefault("_ai_mapped_targets", []).append({
                        "target_text": target_text, "score": score_val, "reason": reason
                    })
                    logger.info(f"  [+] DB CONFIRMED -> Linked '{source_entity.get('_hve_id')}' to Concept '{target_text}' (Score: {score_val})")
                else:
                    logger.warning(f"  [!] DB FAILED -> 0 rels created for '{source_entity.get('_hve_id')}' → '{target_text}'")
            except Exception as e:
                logger.error(f"[RelationshipMappingNode] Write error (string target): {e}")

        elif target_id and should_create:
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
                    source_entity.setdefault("_ai_mapped_targets", []).append({
                        "target_id": target_id, "score": score_val, "reason": reason
                    })
                    logger.info(f"  [+] DB CONFIRMED -> Linked '{source_entity.get('_hve_id')}' → '{target_id}' (Score: {score_val})")
                else:
                    logger.warning(f"  [!] DB FAILED -> 0 rels: '{source_entity.get('_hve_id')}' → '{target_id}'")
            except Exception as e:
                logger.error(f"[RelationshipMappingNode] Write error: {e}")

    return mapped_count, has_mapped


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

        # ── Cancellation handle injected by the engine ─────────────────────────
        cancel_event: threading.Event = config.get("_cancel_event") or threading.Event()

        # ── Parallelism ────────────────────────────────────────────────────────
        # Controls how many entities are evaluated concurrently.
        # Increase cautiously — higher values risk AI provider rate limits.
        max_workers = int(config.get("parallelWorkers", _DEFAULT_WORKERS))

        source_val = inputs.get("source_entity")
        target_val = inputs.get("target_entity")

        is_ui_preview = False
        if source_val is None and target_val is None and not inputs:
            logger.warning("[RelationshipMappingNode] Running in isolation without incoming execution payload. Database writes may fail if using un-ingested data.")

        source_fields = config.get("sourceFields", [])
        target_fields = config.get("targetFields", [])
        relation_type = config.get("relationType", "RELATES_TO")
        inter_relationship = config.get("interRelationship", False)
        min_score = float(config.get("minScore", 0.7))
        ignore_exact_matches = config.get("ignoreExactMatches", False)

        logger.info("[RelationshipMappingNode] Configured relation_type: %s, source_fields: %s, target_fields: %s",
                    relation_type, source_fields, target_fields)

        source_entities = source_val if isinstance(source_val, list) else ([source_val] if source_val else [])

        if inter_relationship:
            target_entities = source_entities.copy()
            # If inter-relationship is ON but a target was also provided (e.g. a string target),
            # combine them so the AI evaluates against BOTH peers and the explicit target.
            if target_val:
                t_val_list = target_val if isinstance(target_val, list) else [target_val]
                target_entities.extend(t_val_list)
        else:
            target_entities = target_val if isinstance(target_val, list) else ([target_val] if target_val else [])
            
        # Ensure all targets have an _hve_id for the AI to reference in its JSON response.
        # This is crucial for "string targets" that only have { "text": "..." }.
        for idx, t in enumerate(target_entities):
            if isinstance(t, dict) and "_hve_id" not in t and "text" in t:
                t["_hve_id"] = f"__string_target_{idx}__"

        ai_provider = config.get("aiProvider", "gemini")
        api_key = config.get("mistralApiKey") if ai_provider == "mistral" else config.get("geminiApiKey")

        is_valid = True
        if not api_key:
            logger.warning(f"[RelationshipMappingNode] Missing {ai_provider.capitalize()} API Key. Skipping.")
            is_valid = False
        elif not source_fields:
            logger.warning("[RelationshipMappingNode] Missing source attributes. Skipping.")
            is_valid = False
        elif not source_entities:
            logger.warning("[RelationshipMappingNode] No source entities. Skipping.")
            is_valid = False
        elif not target_entities:
            logger.warning("[RelationshipMappingNode] No target entities. Skipping.")
            is_valid = False

        if not is_valid or is_ui_preview:
            preview_payload = source_val if isinstance(source_val, (dict, list)) else {"result": source_val}
            if is_ui_preview:
                logger.info("[RelationshipMappingNode] UI Preview mode. Skipping Neo4j and AI execution.")
            return NodeResult(
                success=True,
                outputs={"data": source_val, "resolvedEntity": preview_payload},
                metadata={"config_used": config, "skipped": True, "reason": "UI Preview or Invalid Config"}
            )

        neo4j = get_neo4j_service()
        safe_rel_type = "".join(c for c in relation_type if c.isalnum() or c == '_')
        source_id = source_entities[0].get("_source_id") if source_entities and isinstance(source_entities[0], dict) else None

        missing_count = 0
        missing_ids = []
        processed_count = 0

        # ── Cache / signature ──────────────────────────────────────────────────
        target_signature = []
        for t in target_entities:
            if isinstance(t, dict):
                if str(t.get("_hve_id")).startswith("__string_target_"):
                    target_signature.append(t.get("text", ""))
                else:
                    target_signature.append(str(t.get("_source_id", "unknown")))
        target_signature = sorted(list(set(target_signature)))

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
        execution_hash = hashlib.md5(json.dumps(exec_signature, sort_keys=True).encode()).hexdigest()

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

        # ── Build the work queue ───────────────────────────────────────────────
        missing_sources = [
            e for e in source_entities
            if isinstance(e, dict) and e.get("_hve_id") not in already_evaluated
        ]

        total_sources = len([e for e in source_entities if isinstance(e, dict)])
        evaluated_count = len([e for e in source_entities if isinstance(e, dict) and e.get("_hve_id") in already_evaluated])
        to_process_count = len(missing_sources)

        logger.info("[RelationshipMappingNode] " + "-"*65)
        logger.info(f"[RelationshipMappingNode] 📊 ITERATION STATUS REPORT")
        logger.info(f"[RelationshipMappingNode] Total source entities       : {total_sources}")
        logger.info(f"[RelationshipMappingNode] Already evaluated (cache)   : {evaluated_count}")
        logger.info(f"[RelationshipMappingNode] Remaining to process        : {to_process_count}")
        logger.info(f"[RelationshipMappingNode] Parallel workers            : {max_workers}")
        logger.info("[RelationshipMappingNode] " + "-"*65)

        if to_process_count == 0:
            logger.info("[RelationshipMappingNode] 🛑 ITERATION STOPPED: No entities left to process.")

        ai_responses = []
        ai_inputs = []
        mapped_count = 0
        cancelled = False

        if missing_sources and target_entities:
            logger.info(
                f"[RelationshipMappingNode] 🚀 STARTING PARALLEL BATCH: "
                f"{to_process_count} entities × {max_workers} workers"
            )
            mistral_api_key = config.get("mistralApiKey")
            mistral_model   = config.get("mistralModel", "mistral-large-latest")
            gemini_api_key  = config.get("geminiApiKey")
            gemini_model    = config.get("geminiModel", "gemini-2.5-flash")

            # ── Shared kwargs for every worker ─────────────────────────────────
            eval_kwargs = dict(
                target_entities=target_entities,
                target_fields=target_fields,
                source_fields=source_fields,
                is_string_target=False,  # Unused legacy parameter, left for backwards compat in signature
                relation_type=relation_type,
                safe_rel_type=safe_rel_type,
                min_score=min_score,
                ignore_exact_matches=ignore_exact_matches,
                ai_provider=ai_provider,
                mistral_api_key=mistral_api_key,
                mistral_model=mistral_model,
                gemini_api_key=gemini_api_key,
                gemini_model=gemini_model,
                cancel_event=cancel_event,
            )

            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="rm_worker") as executor:
                # Submit all entities at once; the pool throttles to max_workers active at a time
                future_to_entity = {
                    executor.submit(_evaluate_entity, entity, **eval_kwargs): entity
                    for entity in missing_sources
                }

                completed = 0
                for future in as_completed(future_to_entity):
                    completed += 1
                    entity, _has_mapped, was_cancelled, ai_response, ai_input = future.result()

                    if was_cancelled:
                        # Cancel all still-pending futures so idle workers don't start new calls
                        cancelled = True
                        for f in future_to_entity:
                            f.cancel()
                        logger.warning(
                            f"[RelationshipMappingNode] 🛑 Cancel received — "
                            f"stopped after {completed}/{to_process_count} entities completed."
                        )
                        break

                    if ai_input:
                        ai_inputs.append(ai_input)

                    if ai_response and isinstance(ai_response, list):
                        ai_responses.append(ai_response)
                        # ── Write results to Neo4j immediately (don't batch wait) ──
                        rel_count, has_mapped = _write_relationships(
                            source_entity=entity,
                            ai_response=ai_response,
                            target_entities=target_entities,
                            safe_rel_type=safe_rel_type,
                            min_score=min_score,
                            ignore_exact_matches=ignore_exact_matches,
                            neo4j=neo4j,
                        )
                        mapped_count += rel_count

                        if has_mapped:
                            current_cache["mapped"].add(entity.get("_hve_id"))
                        else:
                            current_cache["unmapped"].add(entity.get("_hve_id"))
                    else:
                        current_cache["unmapped"].add(entity.get("_hve_id"))

                    processed_count += 1

            if cancelled:
                logger.info("[RelationshipMappingNode] " + "-"*65)
                logger.info(
                    f"[RelationshipMappingNode] ⚡ BATCH CANCELLED: "
                    f"Processed {processed_count}/{to_process_count} entities. "
                    "Engine will re-run with updated settings."
                )
                logger.info("[RelationshipMappingNode] " + "-"*65)
            else:
                logger.info("[RelationshipMappingNode] " + "-"*65)
                logger.info(
                    f"[RelationshipMappingNode] ✅ BATCH COMPLETE: "
                    f"Evaluated {processed_count} entities, "
                    f"created {mapped_count} '{safe_rel_type}' relationships."
                )
                logger.info("[RelationshipMappingNode] " + "-"*65)

        else:
            logger.warning("[RelationshipMappingNode] Missing valid source or target entities. Skipping AI evaluation.")

        result_payload = source_entities if isinstance(source_val, list) else (source_entities[0] if source_entities else None)
        preview_payload = result_payload if isinstance(result_payload, (dict, list)) else {"result": result_payload}

        return NodeResult(
            success=True,
            outputs={
                "data": result_payload,
                "resolvedEntity": preview_payload
            },
            metadata={
                "config_used": config,
                "neo4j_missing_relations_count": missing_count,
                "neo4j_missing_relations_list": missing_ids,
                "processed_source_id": source_id,
                "processed_count": processed_count,
                "mapped_count": mapped_count,
                "cancelled": cancelled,
                "parallel_workers": max_workers,
                "ai_input_prompt": ai_inputs,
                "ai_output_response": ai_responses
            }
        )