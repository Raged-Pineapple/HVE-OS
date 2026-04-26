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

import jmespath
import pyarrow as pa
import pyarrow.parquet as pq

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gateway"))
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from confluent_kafka import Consumer, KafkaError
from services import db_service, minio_service, iceberg_service, kafka_service, mapping_service
from services.minio_service import BRONZE_BUCKET, SILVER_BUCKET
from services.kafka_service import SILVER_TOPIC

logger = logging.getLogger(__name__)

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
RAW_TOPIC = "raw-telemetry"
CONSUMER_GROUP = "hve-stream-processor-v2"
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
                logger.warning(f"[{source_id}] No blueprints defined! Skipping Silver processing. Data safely stored in Bronze.")
                if log_id:
                    db_service.log_processing_complete(
                        log_id=log_id,
                        silver_path="",
                        records_in=len(messages),
                        records_passed=0,
                        records_quarantined=0,
                        status="SKIPPED",
                        error_message="Manual Blueprint required for Silver layer processing."
                    )
                return

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

                # ── Stage 6: Emit to Silver Kafka Topic ──
                for row in clean_rows:
                    try:
                        kafka_service.publish_stream(row, topic=SILVER_TOPIC)
                    except Exception as ke:
                        logger.warning(f"[{source_id}] Failed to emit to Silver Kafka: {ke}")

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


    def _transform_and_gate(self, source_id: str, messages: list,
                            blueprints: list, dq_rules: list) -> tuple:
        """
        Apply mapping blueprints and DQ rules to a batch of messages.
        Returns (clean_rows, quarantined_records).
        """
        clean_rows = []
        quarantined = []

        for msg in messages:
            # ── 3. Transform: Apply Blueprints or Custom Script via Unified Service ──
            payload = msg.get("payload", msg)
            mapping_script = db_service.get_mapping_script(source_id)
            if mapping_script:
                rows = mapping_service.run_script(
                    payload,
                    source_id,
                    mapping_script,
                    ingest_ts=msg.get("ingest_timestamp"),
                    base_hve_id=msg.get("hve_id")
                )
            else:
                rows = mapping_service.apply_blueprints(
                    payload, 
                    source_id, 
                    blueprints, 
                    ingest_ts=msg.get("ingest_timestamp"),
                    base_hve_id=msg.get("hve_id")
                )

            for row in rows:
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
        """Append clean rows to an Iceberg table in Silver."""
        if not clean_rows:
            return None, 0

        try:
            metrics = iceberg_service.append_records(source_id, clean_rows, batch_id)
            snapshot_id = metrics.get('snapshot_id')
            silver_path = f"s3a://hve-iceberg/{source_id} (Snapshot {snapshot_id})"
            logger.info(f"[{source_id}] Silver Iceberg: {metrics.get('records_added')} rows appended (Snapshot {snapshot_id})")
            return silver_path, 0
        except Exception as e:
            logger.error(f"[{source_id}] Failed to write to Iceberg: {e}")
            raise


# Singleton instance
_processor = None

def get_processor() -> StreamProcessor:
    global _processor
    if _processor is None:
        _processor = StreamProcessor()
    return _processor
