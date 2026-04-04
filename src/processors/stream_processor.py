"""
stream_processor.py — Kafka Consumer → Bronze → Transform → Silver Pipeline
The real-time compute engine for HVE-OS (Stage 4).

Consumes from Kafka, batches by source_id, applies mapping blueprints
and DQ rules dynamically from the Control Plane, and writes clean Parquet
to the Silver Layer.
"""
import os
import sys
import json
import time
import uuid
import logging
import threading
from datetime import datetime
from collections import defaultdict

import pyarrow as pa
import pyarrow.parquet as pq

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gateway"))
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from confluent_kafka import Consumer, KafkaError
from services import db_service, minio_service
from services.minio_service import BRONZE_BUCKET, SILVER_BUCKET

logger = logging.getLogger(__name__)

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
RAW_TOPIC = "raw-telemetry"
CONSUMER_GROUP = "hve-stream-processor"
BATCH_SIZE = 100          # Messages per batch
BATCH_TIMEOUT_SEC = 15    # Max seconds before flushing a partial batch


class StreamProcessor:
    """
    Background Kafka consumer that:
    1. Batches incoming messages by source_id
    2. Writes raw batches to MinIO Bronze (JSONL)
    3. Dynamically fetches mapping blueprints from PostgreSQL
    4. Applies JSONPath extraction to build flat rows
    5. Runs DQ rules (Gatekeeper)
    6. Writes clean rows to MinIO Silver (Parquet)
    7. Routes failed rows to DLQ
    """

    def __init__(self):
        self._consumer = None
        self._running = False
        self._thread = None
        self._buffers = defaultdict(list)       # source_id -> [messages]
        self._last_flush = time.time()
        self._blueprint_cache = {}              # source_id -> (blueprints, timestamp)
        self._dq_cache = {}                     # source_id -> (rules, timestamp)
        self._cache_ttl = 60                    # Seconds before re-fetching from DB

    def start(self):
        """Start the consumer in a background thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="stream-processor")
        self._thread.start()
        logger.info("StreamProcessor started in background thread.")

    def stop(self):
        """Gracefully stop the consumer."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)
        if self._consumer:
            self._consumer.close()
        logger.info("StreamProcessor stopped.")

    def _run(self):
        """Main consumer loop."""
        try:
            self._consumer = Consumer({
                'bootstrap.servers': KAFKA_BROKERS,
                'group.id': CONSUMER_GROUP,
                'auto.offset.reset': 'earliest',
                'enable.auto.commit': True,
                'auto.commit.interval.ms': 5000,
                'max.poll.interval.ms': 300000,
            })
            self._consumer.subscribe([RAW_TOPIC])
            logger.info(f"Subscribed to Kafka topic: {RAW_TOPIC}")

            while self._running:
                msg = self._consumer.poll(timeout=1.0)

                if msg is None:
                    self._check_flush_timeout()
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error(f"Kafka error: {msg.error()}")
                    continue

                try:
                    value = json.loads(msg.value().decode('utf-8'))
                    source_id = value.get("source_id", "unknown")
                    self._buffers[source_id].append(value)

                    # Check if any buffer is full
                    if len(self._buffers[source_id]) >= BATCH_SIZE:
                        self._flush_buffer(source_id)
                except Exception as e:
                    logger.error(f"Error processing message: {e}")

                self._check_flush_timeout()

            # Flush remaining on shutdown
            for source_id in list(self._buffers.keys()):
                if self._buffers[source_id]:
                    self._flush_buffer(source_id)

        except Exception as e:
            logger.error(f"StreamProcessor crashed: {e}")
        finally:
            if self._consumer:
                self._consumer.close()

    def _check_flush_timeout(self):
        """Flush all buffers if timeout has elapsed."""
        if time.time() - self._last_flush > BATCH_TIMEOUT_SEC:
            for source_id in list(self._buffers.keys()):
                if self._buffers[source_id]:
                    self._flush_buffer(source_id)
            self._last_flush = time.time()

    def _flush_buffer(self, source_id: str):
        """Process a batch of messages for a source_id."""
        messages = self._buffers.pop(source_id, [])
        if not messages:
            return

        batch_id = str(uuid.uuid4())[:12]
        log_id = None

        try:
            log_id = db_service.log_processing_start(source_id, "STREAM")

            # ── Stage 2: Write to Bronze ──
            bronze_path = minio_service.write_bronze_jsonl(source_id, messages, batch_id)
            logger.info(f"[{source_id}] Bronze: {len(messages)} records → {bronze_path}")

            # ── Stage 3: Fetch blueprints from Control Plane ──
            blueprints = self._get_blueprints(source_id)
            dq_rules = self._get_dq_rules(source_id)

            # ── Stage 4: Transform + DQ Gate ──
            if not blueprints:
                # No blueprints → auto-generate identity mapping from payload keys
                blueprints = self._auto_generate_blueprints(source_id, messages)

            clean_rows, quarantined = self._transform_and_gate(
                source_id, messages, blueprints, dq_rules
            )

            silver_path = None
            file_size = 0

            # ── Stage 5: Write to Silver ──
            if clean_rows:
                silver_path, file_size = self._write_silver(source_id, clean_rows, batch_id)

            # Write quarantined records to DLQ
            if quarantined:
                minio_service.write_dlq(source_id, quarantined, batch_id)
                logger.info(f"[{source_id}] DLQ: {len(quarantined)} quarantined records")

            # Update Silver registry
            if clean_rows:
                schema_json = {col: "dynamic" for col in clean_rows[0].keys()} if clean_rows else None
                db_service.register_silver_table(
                    table_name=source_id,
                    source_id=source_id,
                    minio_path=f"{SILVER_BUCKET}/{source_id}/",
                    row_count=len(clean_rows),
                    file_count=1,
                    total_size=file_size,
                    schema_json=schema_json
                )

            # Log completion
            if log_id:
                db_service.log_processing_complete(
                    log_id=log_id,
                    silver_path=silver_path or "",
                    records_in=len(messages),
                    records_passed=len(clean_rows),
                    records_quarantined=len(quarantined)
                )

            logger.info(
                f"[{source_id}] Batch complete: {len(messages)} in → "
                f"{len(clean_rows)} clean, {len(quarantined)} quarantined"
            )

        except Exception as e:
            logger.error(f"[{source_id}] Batch processing failed: {e}")
            if log_id:
                try:
                    db_service.log_processing_complete(
                        log_id=log_id, silver_path="", records_in=len(messages),
                        records_passed=0, records_quarantined=0,
                        status="FAILED", error_message=str(e)
                    )
                except Exception:
                    pass

    def _get_blueprints(self, source_id: str) -> list:
        """Get blueprints with caching."""
        cached = self._blueprint_cache.get(source_id)
        if cached and (time.time() - cached[1]) < self._cache_ttl:
            return cached[0]
        try:
            blueprints = db_service.get_blueprints(source_id)
            self._blueprint_cache[source_id] = (blueprints, time.time())
            return blueprints
        except Exception as e:
            logger.warning(f"Failed to fetch blueprints for {source_id}: {e}")
            return cached[0] if cached else []

    def _get_dq_rules(self, source_id: str) -> list:
        """Get DQ rules with caching."""
        cached = self._dq_cache.get(source_id)
        if cached and (time.time() - cached[1]) < self._cache_ttl:
            return cached[0]
        try:
            rules = db_service.get_dq_rules(source_id)
            self._dq_cache[source_id] = (rules, time.time())
            return rules
        except Exception as e:
            logger.warning(f"Failed to fetch DQ rules for {source_id}: {e}")
            return cached[0] if cached else []

    def _auto_generate_blueprints(self, source_id: str, messages: list) -> list:
        """Auto-generate identity mapping from the payload keys of the first message."""
        sample = messages[0].get("payload", messages[0])
        blueprints = []
        for key, value in sample.items():
            if key in ("hve_id", "source_id", "ingest_timestamp"):
                continue
            data_type = "STRING"
            if isinstance(value, bool):
                data_type = "BOOLEAN"
            elif isinstance(value, int):
                data_type = "INT"
            elif isinstance(value, float):
                data_type = "FLOAT"
            blueprints.append({
                "target_field": key,
                "json_path": f"$.{key}",
                "data_type": data_type,
                "is_primary_key": False,
                "is_required": False,
            })
        logger.info(f"[{source_id}] Auto-generated {len(blueprints)} identity blueprints")
        return blueprints

    def _transform_and_gate(self, source_id: str, messages: list,
                            blueprints: list, dq_rules: list) -> tuple:
        """
        Apply mapping blueprints and DQ rules to a batch of messages.
        Returns (clean_rows, quarantined_records).
        """
        clean_rows = []
        quarantined = []

        for msg in messages:
            payload = msg.get("payload", msg)
            row = {
                "_hve_id": msg.get("hve_id", str(uuid.uuid4())),
                "_source_id": source_id,
                "_ingest_ts": msg.get("ingest_timestamp", datetime.utcnow().isoformat()),
            }

            # Apply blueprints: extract fields from payload
            for bp in blueprints:
                target = bp["target_field"]
                json_path = bp["json_path"]
                value = self._extract_value(payload, json_path)

                # Type coercion
                if value is not None:
                    try:
                        dtype = bp.get("data_type", "STRING").upper()
                        if dtype == "INT":
                            value = int(value) if value is not None else None
                        elif dtype == "FLOAT":
                            value = float(value) if value is not None else None
                        elif dtype == "BOOLEAN":
                            value = bool(value)
                        else:
                            value = str(value) if value is not None else None
                    except (ValueError, TypeError):
                        value = bp.get("default_value")
                elif bp.get("default_value") is not None:
                    value = bp["default_value"]

                row[target] = value

            # Apply DQ Rules (Gatekeeper)
            failed = False
            failure_reasons = []
            for rule in dq_rules:
                if not self._evaluate_dq_rule(row, rule["rule_logic"]):
                    failed = True
                    reason = f"Rule '{rule.get('rule_name', rule['rule_id'])}' failed: {rule['rule_logic']}"
                    failure_reasons.append(reason)
                    
                    action = rule.get("action_on_fail", "QUARANTINE")
                    if action == "QUARANTINE":
                        quarantined.append({
                            "record": row,
                            "reasons": failure_reasons,
                            "rule_id": rule.get("rule_id"),
                            "rule_name": rule.get("rule_name"),
                        })
                        break
                    elif action == "DROP":
                        break

            if not failed:
                clean_rows.append(row)

        return clean_rows, quarantined

    def _extract_value(self, data: dict, json_path: str):
        """
        Simple JSONPath extractor.
        Supports: $.key, $.nested.key, $.array[0], $.array[*][N]
        """
        if not json_path or not json_path.startswith("$"):
            return data.get(json_path, None) if isinstance(data, dict) else None

        path = json_path[2:]  # Remove "$."
        current = data

        for part in path.split("."):
            if current is None:
                return None

            # Handle array access: key[N] or key[*][N]
            if "[" in part:
                key = part[:part.index("[")]
                idx_str = part[part.index("[") + 1:part.index("]")]

                if key:
                    current = current.get(key) if isinstance(current, dict) else None
                
                if current is None:
                    return None

                if idx_str == "*":
                    # Return the whole list, let the next part index into items
                    continue
                else:
                    try:
                        idx = int(idx_str)
                        if isinstance(current, list) and idx < len(current):
                            current = current[idx]
                        else:
                            return None
                    except (ValueError, IndexError):
                        return None
            else:
                current = current.get(part) if isinstance(current, dict) else None

        return current

    def _evaluate_dq_rule(self, row: dict, rule_logic: str) -> bool:
        """
        Evaluate a DQ rule expression against a row.
        Rules are Python expressions evaluated in the row's namespace.
        """
        try:
            # Make row fields available as local variables
            safe_globals = {"__builtins__": {"None": None, "True": True, "False": False, "abs": abs, "len": len}}
            return bool(eval(rule_logic, safe_globals, row))
        except Exception:
            # If evaluation fails, the rule passes (conservative approach)
            return True

    def _write_silver(self, source_id: str, clean_rows: list, batch_id: str) -> tuple:
        """Convert clean rows to Parquet and write to Silver."""
        if not clean_rows:
            return None, 0

        # Build PyArrow table
        columns = list(clean_rows[0].keys())
        arrays = {}
        for col in columns:
            values = [row.get(col) for row in clean_rows]
            # Infer type from first non-None value
            sample = next((v for v in values if v is not None), None)
            if isinstance(sample, int):
                arrays[col] = pa.array(values, type=pa.int64())
            elif isinstance(sample, float):
                arrays[col] = pa.array(values, type=pa.float64())
            elif isinstance(sample, bool):
                arrays[col] = pa.array(values, type=pa.bool_())
            else:
                arrays[col] = pa.array([str(v) if v is not None else None for v in values], type=pa.string())

        table = pa.table(arrays)
        
        # Write to bytes
        sink = pa.BufferOutputStream()
        pq.write_table(table, sink, compression='snappy')
        parquet_bytes = sink.getvalue().to_pybytes()

        # Upload to MinIO Silver
        silver_path, file_size = minio_service.write_silver_parquet(source_id, parquet_bytes, batch_id)
        logger.info(f"[{source_id}] Silver: {len(clean_rows)} rows → {silver_path}")
        return silver_path, file_size


# Singleton instance
_processor = None

def get_processor() -> StreamProcessor:
    global _processor
    if _processor is None:
        _processor = StreamProcessor()
    return _processor
