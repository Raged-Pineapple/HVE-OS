"""
encrypt_node.py — Encrypt Node
Applies homomorphic encryption (via TenSEAL) to target fields within data snapshots.
"""
import logging
import json
import hashlib
from typing import Any, Dict, Optional
from ..base import BaseNode, NodeMetadata, NodeResult
from ..registry import register_node

# Dynamically access the security engine registry
from ...security.registry import registry
from gateway.services import minio_service

logger = logging.getLogger(__name__)

def _truncate_str(s: str, max_len: int = 100) -> str:
    """Truncate string for logging."""
    if isinstance(s, str) and len(s) > max_len:
        return s[:max_len] + "..."
    return str(s)

def _safe_repr(val: Any, max_len: int = 200) -> str:
    """Safe representation of value for logging."""
    try:
        s = repr(val)
        if len(s) > max_len:
            return s[:max_len] + "..."
        return s
    except Exception:
        return str(type(val))

def _clean_for_preview(data_val):
    if isinstance(data_val, dict):
        if data_val.get("__type__") == "tenseal_encrypted" and "data" in data_val:
            preview_dict = dict(data_val)
            if isinstance(preview_dict["data"], str):
                preview_dict["data"] = preview_dict["data"][:40] + "... [TRUNCATED FOR UI]"
            return preview_dict
        return {k: _clean_for_preview(v) for k, v in data_val.items()}
    elif isinstance(data_val, list):
        return [_clean_for_preview(item) for item in data_val]
    return data_val

def _get_columns(payload, config) -> list:
    if isinstance(payload, list) and payload:
        if isinstance(payload[0], dict):
            return list(payload[0].keys())
    if config and config.get("columns"):
        return config.get("columns")
    return []

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

    _exec_cache = {}  # Caches execution signatures to prevent redundant MinIO snapshots
    _processed_triggers = set()  # Track manual execution triggers to prevent automatic/reactive runs

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        # Check if this is a fresh manual button trigger
        execute_trigger = config.get("_execute_trigger")
        is_manual_trigger = False
        if execute_trigger and execute_trigger not in self.__class__._processed_triggers:
            is_manual_trigger = True
            self.__class__._processed_triggers.add(execute_trigger)
            
        if is_manual_trigger:
            logger.info("============================================================")
            logger.info("                    ENCRYPT NODE STARTED                    ")
            logger.info("============================================================")
            logger.info(f"[EncryptNode] New manual trigger detected: {execute_trigger}. Performing Homomorphic Encryption.")
        
        # Log configuration
        provider_id = config.get("provider", "tenseal")
        
        target_field_legacy = config.get("field")
        target_fields = config.get("fields", [])
        if target_field_legacy and target_field_legacy not in target_fields:
            target_fields.append(target_field_legacy)
            
        enc_params = config.get("params", {})
        
        if is_manual_trigger:
            logger.info(f"[EncryptNode] Configuration:")
            logger.info(f"  - Provider: {provider_id}")
            logger.info(f"  - Target fields to encrypt: {target_fields}")
            logger.info(f"  - Encryption params: {enc_params}")
        
        # Get input data from various possible sources
        input_val = None
        if inputs:
            for key in ["data", "default", "target", "source", "rows"]:
                if inputs.get(key) is not None:
                    input_val = inputs.get(key)
                    break
            if input_val is None:
                for val in inputs.values():
                    if val is not None:
                        input_val = val
                        break

        # Extract snapshot data from input_val or config
        snapshot_path = None
        if isinstance(input_val, dict) and input_val.get("snapshotPath"):
            snapshot_path = input_val.get("snapshotPath")
        elif config.get("inputSnapshotPath"):
            snapshot_path = config.get("inputSnapshotPath")
            
        if snapshot_path and snapshot_path.startswith(f"{minio_service.SILVER_BUCKET}/"):
            snapshot_path = snapshot_path[len(minio_service.SILVER_BUCKET) + 1:]

        if not snapshot_path:
            if isinstance(input_val, dict) and "rows" in input_val and isinstance(input_val["rows"], list):
                if is_manual_trigger:
                    logger.info("[EncryptNode] Detected 'rows' array in input dict. Extracting rows for encryption...")
                input_val = input_val["rows"]
            elif config.get("rows") and isinstance(config.get("rows"), list):
                if is_manual_trigger:
                    logger.info("[EncryptNode] Detected 'rows' array in config. Extracting rows for encryption...")
                input_val = config.get("rows")
            if input_val is None:
                input_val = config.get("previewInput")
                
        # Create an execution signature BEFORE fetching data to avoid redundant HE encryptions and MinIO downloads
        sig_parts = [
            str(snapshot_path),
            str(sorted(target_fields)),
            str(provider_id),
            json.dumps(enc_params, sort_keys=True)
        ]
        
        if not snapshot_path:
            # If raw rows are passed, hash the length and first item to detect changes
            if isinstance(input_val, list) and input_val:
                sig_parts.append(str(len(input_val)))
                if isinstance(input_val[0], dict):
                    sig_parts.append(str(input_val[0].get("_hve_id", "")))
                    for tf in target_fields:
                        sig_parts.append(str(input_val[0].get(tf)))
            else:
                sig_parts.append(str(type(input_val)))
                
        exec_signature = hashlib.md5("|".join(sig_parts).encode("utf-8")).hexdigest()
        
        if exec_signature in self.__class__._exec_cache:
            if is_manual_trigger:
                logger.info("[EncryptNode] Inputs and config unchanged. Returning cached encrypted snapshot to prevent MinIO spam.")
            else:
                logger.info(f"[EncryptNode] ⏩ Skipping Homomorphic Encryption (automatic run). Returning cached encrypted snapshot.")
                
            cached_result, cached_preview, cached_out_path, cached_stats = self.__class__._exec_cache[exec_signature]
            return NodeResult(
                success=True,
                outputs={
                    "data": cached_result,
                    "resolvedEntity": cached_preview,
                    "snapshotPath": cached_out_path,
                    "columns": _get_columns(cached_preview, config)
                },
                metadata={
                    "config_used": config,
                    "stats": cached_stats,
                    "snapshot_path": cached_out_path,
                    "is_manual_trigger": is_manual_trigger
                }
            )
        
        # Proactively check if the target field is ALREADY encrypted in the current input OR in an existing MinIO snapshot
        existing_encrypted_snapshot = None
        
        # A) Check if current input preview already has it encrypted
        if target_fields:
            preview_data = config.get("previewInput")
            if isinstance(preview_data, list) and preview_data:
                first_item = preview_data[0]
                if isinstance(first_item, dict):
                    all_encrypted = True
                    for tf in target_fields:
                        val = first_item.get(tf)
                        if not (isinstance(val, dict) and val.get("__type__") == "tenseal_encrypted"):
                            all_encrypted = False
                            break
                    if all_encrypted:
                        existing_encrypted_snapshot = snapshot_path
                        logger.info(f"[EncryptNode] Preview data indicates {target_fields} are ALREADY ENCRYPTED in the input snapshot.")

        # B) Scan MinIO for an existing encrypted snapshot matching this execution signature (survives container restarts)
        if not existing_encrypted_snapshot:
            table_name = "encrypted_data"
            if snapshot_path:
                parts = snapshot_path.split("/")
                table_name = parts[1] if len(parts) >= 2 else "encrypted_data"
            
            logger.info(f"[EncryptNode] Scanning MinIO for existing encrypted snapshot matching signature '{exec_signature}' for table '{table_name}'...")
            try:
                client = getattr(minio_service, 'client', None)
                if not client and hasattr(minio_service, 'get_client'):
                    client = minio_service.get_client()
                    
                if client:
                    prefix = f"custom_snapshots/{table_name}/"
                    objects = client.list_objects(minio_service.SILVER_BUCKET, prefix=prefix, recursive=True)
                    for obj in objects:
                        if f"_{exec_signature}_encrypted_temp.jsonl" in obj.object_name:
                            existing_encrypted_snapshot = obj.object_name
                            logger.info(f"[EncryptNode] Found EXISTING encrypted snapshot matching signature: {obj.object_name}")
                            break
            except Exception as e:
                logger.debug(f"[EncryptNode] Could not scan for existing signature snapshots: {e}")

        if existing_encrypted_snapshot:
            logger.info("[EncryptNode] Bypassing encryption entirely and returning the existing encrypted snapshot.")
            try:
                data_bytes = minio_service.read_object(minio_service.SILVER_BUCKET, existing_encrypted_snapshot)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines()[:10]:
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                        
                preview_payload = _clean_for_preview(snapshot_rows)
                
                self.__class__._exec_cache[exec_signature] = (preview_payload, preview_payload, existing_encrypted_snapshot, {"passed_through_existing": True})
                
                return NodeResult(
                    success=True,
                    outputs={
                        "data": preview_payload,
                        "resolvedEntity": preview_payload,
                        "snapshotPath": existing_encrypted_snapshot,
                        "columns": _get_columns(preview_payload, config)
                    },
                    metadata={
                        "config_used": config,
                        "stats": {"passed_through_existing": True},
                        "snapshot_path": existing_encrypted_snapshot,
                        "is_manual_trigger": is_manual_trigger
                    }
                )
            except Exception as e:
                logger.error(f"[EncryptNode] Failed to load existing encrypted snapshot {existing_encrypted_snapshot}: {e}")

        if not is_manual_trigger:
            logger.info(f"[EncryptNode] ⏩ Skipping Homomorphic Encryption (automatic run). Passing through input snapshot: {snapshot_path or 'raw_data'}")
            preview_payload = config.get("previewInput") or []
            if isinstance(preview_payload, dict) and "rows" in preview_payload:
                preview_payload = preview_payload["rows"]
                
            return NodeResult(
                success=True,
                outputs={
                    "data": preview_payload,
                    "resolvedEntity": preview_payload,
                    "snapshotPath": snapshot_path,
                    "columns": _get_columns(preview_payload, config)
                },
                metadata={
                    "config_used": config,
                    "stats": {
                        "total_items": len(preview_payload) if isinstance(preview_payload, list) else 0,
                        "encrypted_fields": 0,
                        "passed_through": len(preview_payload) if isinstance(preview_payload, list) else 0,
                        "skipped": True
                    },
                    "snapshot_path": snapshot_path,
                    "is_manual_trigger": is_manual_trigger
                }
            )

        if snapshot_path:
            logger.info(f"[EncryptNode] Detected snapshotPath: {snapshot_path}. Fetching JSONL data from MinIO...")
            try:
                data_bytes = minio_service.read_object(minio_service.SILVER_BUCKET, snapshot_path)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines():
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                input_val = snapshot_rows
                logger.info(f"[EncryptNode] Successfully loaded {len(input_val)} rows from snapshot.")
            except Exception as e:
                logger.error(f"[EncryptNode] Failed to load snapshot data from {snapshot_path}: {e}")

        # Log input data summary
        if input_val is None:
            logger.warning("[EncryptNode] No input data received!")
            return NodeResult(
                success=False,
                outputs={},
                error="No input data to encrypt"
            )
            
        if isinstance(input_val, list):
            logger.info(f"[EncryptNode] Input data: list with {len(input_val)} items")
            if input_val:
                sample_keys = list(input_val[0].keys()) if isinstance(input_val[0], dict) else []
                logger.info(f"[EncryptNode] Sample item keys: {sample_keys}")
        elif isinstance(input_val, dict):
            logger.info(f"[EncryptNode] Input data: dict with keys: {list(input_val.keys())}")
        else:
            logger.info(f"[EncryptNode] Input data: {type(input_val).__name__}")
        
        # Get provider
        try:
            if is_manual_trigger:
                provider = registry.get_provider(provider_id)
                logger.info(f"[EncryptNode] Provider '{provider_id}' loaded successfully")
            else:
                logger.info("[EncryptNode] Bypassing TenSEAL encryption because this is not a new manual trigger. Data will pass through unencrypted.")
                provider = None
        except ValueError:
            logger.warning(f"[EncryptNode] Security provider '{provider_id}' not found. Passing data through unencrypted.")
            provider = None
            
        if not target_fields:
            logger.warning("[EncryptNode] No target fields configured. Passing data through unencrypted.")
            provider = None  # Force pass-through to avoid row-by-row spam

        # Processing statistics
        stats = {
            "total_items": 0,
            "encrypted_fields": 0,
            "skipped_fields": 0,
            "failed_encrypts": 0,
            "passed_through": 0
        }

        def _process(item: Any) -> Any:
            nonlocal stats
            stats["total_items"] += 1
            
            if not provider:
                stats["passed_through"] += 1
                return item

            def _try_encrypt(val: Any, field_name: str = None) -> Any:
                nonlocal stats
                field_label = field_name or "unknown"
                try:
                    logger.debug(f"[EncryptNode] Attempting to encrypt field '{field_label}' with value type: {type(val).__name__}")
                    result = provider.encrypt(val, enc_params)
                    stats["encrypted_fields"] += 1
                    logger.debug(f"[EncryptNode] Successfully encrypted field '{field_label}'")
                    return result
                except Exception as e:
                    stats["failed_encrypts"] += 1
                    logger.warning(f"[EncryptNode] Encrypt FAILED for field '{field_label}' ({type(val).__name__}): {e}")
                    return val  # Return original value if encryption fails

            if not isinstance(item, dict):
                # Non-dict input (scalar value)
                if target_fields:
                    stats["skipped_fields"] += 1
                    logger.debug(f"[EncryptNode] Skipping non-dict item, target_fields specified")
                    return item
                # Encrypt the scalar value directly
                logger.debug(f"[EncryptNode] Encrypting scalar value directly")
                return _try_encrypt(item, "scalar_value")

            # Dict input - check if target_fields exist and encrypt them
            new_item = dict(item)
            available_fields = list(new_item.keys())
            logger.debug(f"[EncryptNode] Processing dict with fields: {available_fields}")
            
            for tf in target_fields:
                if tf in new_item:
                    original_value = new_item[tf]
                    if isinstance(original_value, dict) and original_value.get("__type__") == "tenseal_encrypted":
                        logger.debug(f"[EncryptNode] Field '{tf}' is already encrypted. Skipping.")
                        stats["skipped_fields"] += 1
                    else:
                        logger.debug(f"[EncryptNode] Found target field '{tf}' = {_truncate_str(str(original_value), 50)}")
                        new_item[tf] = _try_encrypt(original_value, tf)
                else:
                    if stats["skipped_fields"] < 5:
                        logger.warning(f"[EncryptNode] Target field '{tf}' NOT FOUND in item. Available fields: {available_fields}")
                    elif stats["skipped_fields"] == 5:
                        logger.warning(f"[EncryptNode] (Suppressing further missing field warnings...)")
                    stats["skipped_fields"] += 1
                
            return new_item

        # Process data based on type
        logger.info("[EncryptNode] Starting data processing...")
        if isinstance(input_val, list):
            logger.info(f"[EncryptNode] Processing list of {len(input_val)} items")
            result_payload = [_process(item) for item in input_val]
        elif isinstance(input_val, dict):
            logger.info("[EncryptNode] Processing single dict item")
            result_payload = _process(input_val)
        else:
            logger.info(f"[EncryptNode] Processing scalar value: {type(input_val).__name__}")
            result_payload = _process(input_val)

        # Log processing summary
        logger.info("[EncryptNode] Processing complete!")
        logger.info(f"[EncryptNode] Statistics:")
        logger.info(f"  - Total items processed: {stats['total_items']}")
        logger.info(f"  - Fields encrypted: {stats['encrypted_fields']}")
        logger.info(f"  - Fields skipped: {stats['skipped_fields']}")
        logger.info(f"  - Encryption failures: {stats['failed_encrypts']}")
        logger.info(f"  - Passed through unencrypted: {stats['passed_through']}")
        
        # Log result sample
        if isinstance(result_payload, list) and result_payload:
            sample = result_payload[0]
            logger.info(f"[EncryptNode] Result sample (first item): {json.dumps(sample, default=str)[:500]}")
        elif isinstance(result_payload, dict):
            logger.info(f"[EncryptNode] Result dict: {json.dumps(result_payload, default=str)[:500]}")

        if isinstance(result_payload, list):
            preview_payload = _clean_for_preview(result_payload[:10])  # Limit to 10 rows for UI
        elif isinstance(result_payload, dict):
            preview_payload = _clean_for_preview(result_payload)
        else:
            preview_payload = {"result": _clean_for_preview(result_payload)}
        
        # Save temporary JSONL snapshot of the encrypted data back to MinIO
        out_path = snapshot_path
        if isinstance(result_payload, list) and result_payload and stats["encrypted_fields"] > 0:
            try:
                table_name = "encrypted_data"
                if snapshot_path:
                    parts = snapshot_path.split("/")
                    if len(parts) >= 2:
                        table_name = parts[1]
                logger.info(f"[EncryptNode] Saving encrypted result to MinIO as temporary snapshot...")
                out_path = minio_service.write_custom_snapshot(table_name, f"{table_name}_encrypted", result_payload)
            except Exception as e:
                logger.error(f"[EncryptNode] Failed to save encrypted snapshot to MinIO: {e}")
        elif stats["encrypted_fields"] == 0 and snapshot_path:
            logger.info(f"[EncryptNode] No new fields encrypted. Passing through input snapshot: {snapshot_path}")

        logger.info("============================================================")
        logger.info("                    ENCRYPT NODE COMPLETED                   ")
        logger.info("============================================================")
        
        output_data = preview_payload if out_path else result_payload

        # Save to cache to prevent future redundant executions only if we actually encrypted fields
        if stats.get("encrypted_fields", 0) > 0:
            self.__class__._exec_cache[exec_signature] = (output_data, preview_payload, out_path, stats)
            if len(self.__class__._exec_cache) > 5:
                oldest = next(iter(self.__class__._exec_cache))
                del self.__class__._exec_cache[oldest]
        
        return NodeResult(
            success=True,
            outputs={
                "data": output_data,
                "resolvedEntity": preview_payload,
                "snapshotPath": out_path,
                "columns": _get_columns(preview_payload, config)
            },
            metadata={
                "config_used": config,
                "stats": stats,
                "snapshot_path": out_path,
                "is_manual_trigger": is_manual_trigger
            }
        )

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        if not config.get("provider"):
            return False, "A Security Engine provider is required."
        if not config.get("field") and not config.get("fields"):
            return False, "At least one target field to encrypt is required."
        return True, None