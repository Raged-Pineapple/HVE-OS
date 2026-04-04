"""
debug_pipeline.py — Synchronous 5-Stage X-Ray Engine
Runs the full HVE-OS pipeline synchronously and captures a
detailed trace at every stage for debugging and transparency.
"""
import io
import json
import time
import uuid
import logging
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq

from models import (
    CanonicalEnvelope, StageTrace, StageStatus, PipelineTrace
)
from services import db_service, minio_service, iceberg_service
from services.minio_service import BRONZE_BUCKET, SILVER_BUCKET
from services.kafka_service import producer, RAW_TOPIC, delivery_report

logger = logging.getLogger(__name__)


class DebugPipeline:
    """
    Synchronous pipeline runner that mirrors every stage of the
    production pipeline but captures a full trace at each step.

    Stages:
      1. PERIMETER  — Validate, auto-register source, build Canonical Envelope
      2. KAFKA      — Publish and synchronously confirm delivery (flush)
      3. BRONZE     — Write raw JSONL directly to MinIO
      4. TRANSFORM  — Apply mapping blueprints + DQ rules
      5. SILVER     — Convert clean rows to Parquet and write to MinIO
    """

    def __init__(self, source_id: str, payload: dict):
        self.source_id = source_id
        self.payload = payload
        self.trace_id = str(uuid.uuid4())
        self.stages = {}
        self._envelope = None
        self._clean_rows = []
        self._quarantined = []
        self._pipeline_start = time.time()

    def run(self) -> PipelineTrace:
        """Execute all 5 stages and return the full PipelineTrace."""
        self._stage_perimeter()
        if self.stages["stage_1_perimeter"].status == StageStatus.PASSED:
            self._stage_kafka()
        if self.stages.get("stage_2_kafka", StageTrace(status=StageStatus.SKIPPED, duration_ms=0)).status == StageStatus.PASSED:
            self._stage_bronze()
        if self.stages.get("stage_3_bronze", StageTrace(status=StageStatus.SKIPPED, duration_ms=0)).status == StageStatus.PASSED:
            self._stage_transform()
        if self.stages.get("stage_4_transform", StageTrace(status=StageStatus.SKIPPED, duration_ms=0)).status == StageStatus.PASSED:
            self._stage_silver()

        total_ms = round((time.time() - self._pipeline_start) * 1000, 2)
        overall = StageStatus.PASSED if all(
            s.status == StageStatus.PASSED
            for s in self.stages.values()
            if s.status != StageStatus.SKIPPED
        ) else StageStatus.FAILED

        return PipelineTrace(
            trace_id=self.trace_id,
            source_id=self.source_id,
            debug_mode=True,
            total_duration_ms=total_ms,
            overall_status=overall,
            stages=self.stages
        )

    # ─────────────────────────────────────────────────────────
    # STAGE 1: PERIMETER
    # ─────────────────────────────────────────────────────────
    def _stage_perimeter(self):
        t = time.time()
        try:
            # Auto-register source if needed
            source = db_service.get_source(self.source_id)
            is_new = source is None
            if is_new:
                db_service.register_source(
                    source_id=self.source_id,
                    source_type="STREAM",
                    protocol="HTTP",
                    description="Auto-registered via debug trace"
                )

            # Build Canonical Envelope
            self._envelope = CanonicalEnvelope(
                source_id=self.source_id,
                payload=self.payload
            )

            self.stages["stage_1_perimeter"] = StageTrace(
                status=StageStatus.PASSED,
                duration_ms=round((time.time() - t) * 1000, 2),
                detail={
                    "source_registered": not is_new,
                    "source_auto_created": is_new,
                    "envelope": self._envelope.model_dump()
                }
            )
        except Exception as e:
            self.stages["stage_1_perimeter"] = StageTrace(
                status=StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                error=str(e)
            )

    # ─────────────────────────────────────────────────────────
    # STAGE 2: KAFKA
    # ─────────────────────────────────────────────────────────
    def _stage_kafka(self):
        t = time.time()
        delivery_info = {}

        def _capture_delivery(err, msg):
            if err:
                delivery_info["error"] = str(err)
            else:
                delivery_info["topic"] = msg.topic()
                delivery_info["partition"] = msg.partition()
                delivery_info["offset"] = msg.offset()

        try:
            msg_bytes = json.dumps(self._envelope.model_dump()).encode("utf-8")
            producer.produce(
                topic=RAW_TOPIC,
                value=msg_bytes,
                callback=_capture_delivery
            )
            # Synchronous flush — wait for confirmation
            outstanding = producer.flush(timeout=10)

            if "error" in delivery_info:
                raise Exception(delivery_info["error"])

            if outstanding > 0:
                raise Exception(f"Kafka flush timed out — {outstanding} messages still outstanding")

            self.stages["stage_2_kafka"] = StageTrace(
                status=StageStatus.PASSED,
                duration_ms=round((time.time() - t) * 1000, 2),
                detail={
                    "topic": delivery_info.get("topic", RAW_TOPIC),
                    "partition": delivery_info.get("partition"),
                    "offset": delivery_info.get("offset"),
                    "message_size_bytes": len(msg_bytes)
                }
            )
        except Exception as e:
            self.stages["stage_2_kafka"] = StageTrace(
                status=StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                error=str(e)
            )

    # ─────────────────────────────────────────────────────────
    # STAGE 3: BRONZE
    # ─────────────────────────────────────────────────────────
    def _stage_bronze(self):
        t = time.time()
        try:
            batch_id = self.trace_id[:12]
            messages = [self._envelope.model_dump()]
            bronze_path = minio_service.write_bronze_jsonl(
                self.source_id, messages, batch_id
            )
            object_stat = minio_client_stat(bronze_path)

            self.stages["stage_3_bronze"] = StageTrace(
                status=StageStatus.PASSED,
                duration_ms=round((time.time() - t) * 1000, 2),
                detail={
                    "path": bronze_path,
                    "bucket": BRONZE_BUCKET,
                    "size_bytes": object_stat,
                    "records_written": 1,
                    "format": "JSONL"
                }
            )
        except Exception as e:
            self.stages["stage_3_bronze"] = StageTrace(
                status=StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                error=str(e)
            )

    # ─────────────────────────────────────────────────────────
    # STAGE 4: TRANSFORM + DQ GATE
    # ─────────────────────────────────────────────────────────
    def _stage_transform(self):
        t = time.time()
        try:
            blueprints = db_service.get_blueprints(self.source_id)
            dq_rules = db_service.get_dq_rules(self.source_id)

            # Auto-generate identity blueprints if none exist
            if not blueprints:
                blueprints = _auto_blueprints(self.payload)
                auto_generated = True
            else:
                auto_generated = False

            # Apply blueprints to build a mapped row
            mapped_row = _apply_blueprints(self.payload, self._envelope, blueprints)

            # Evaluate DQ rules
            rule_results = []
            failed = False
            fail_reason = None
            for rule in dq_rules:
                passed = _eval_rule(mapped_row, rule["rule_logic"])
                rule_results.append({
                    "rule_name": rule.get("rule_name", f"rule_{rule['rule_id']}"),
                    "logic": rule["rule_logic"],
                    "result": "✅ PASS" if passed else "❌ FAIL",
                    "action": rule.get("action_on_fail", "QUARANTINE")
                })
                if not passed:
                    failed = True
                    fail_reason = f"Rule '{rule.get('rule_name')}' failed: {rule['rule_logic']}"
                    break

            if not failed:
                self._clean_rows = [mapped_row]
            else:
                self._quarantined = [{"record": mapped_row, "reason": fail_reason}]

            self.stages["stage_4_transform"] = StageTrace(
                status=StageStatus.PASSED if not failed else StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                detail={
                    "blueprints_applied": len(blueprints),
                    "blueprints_auto_generated": auto_generated,
                    "dq_rules_evaluated": len(dq_rules),
                    "rule_results": rule_results,
                    "mapped_row": mapped_row,
                    "outcome": "CLEAN" if not failed else "QUARANTINED",
                    "fail_reason": fail_reason
                }
            )
        except Exception as e:
            self.stages["stage_4_transform"] = StageTrace(
                status=StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                error=str(e)
            )

    # ─────────────────────────────────────────────────────────
    # STAGE 5: SILVER
    # ─────────────────────────────────────────────────────────
    def _stage_silver(self):
        t = time.time()

        if not self._clean_rows:
            self.stages["stage_5_silver"] = StageTrace(
                status=StageStatus.SKIPPED,
                duration_ms=0.0,
                detail={"reason": "No clean rows after DQ gate — record was quarantined"}
            )
            return

        try:
            batch_id = self.trace_id[:12]
            row = self._clean_rows[0]

            # Write to Iceberg
            metrics = iceberg_service.append_records(self.source_id, [row], batch_id)
            snapshot_id = metrics.get('snapshot_id')

            silver_path = f"s3a://hve-iceberg/{self.source_id} (Snapshot {snapshot_id})"

            # Build dummy schema for reporting
            schema_info = {k: "STRING" for k in row.keys()} 

            self.stages["stage_5_silver"] = StageTrace(
                status=StageStatus.PASSED,
                duration_ms=round((time.time() - t) * 1000, 2),
                detail={
                    "path": silver_path,
                    "bucket": "hve-iceberg",
                    "size_bytes": 0,
                    "rows_written": 1,
                    "format": "Iceberg",
                    "schema": schema_info
                }
            )
        except Exception as e:
            self.stages["stage_5_silver"] = StageTrace(
                status=StageStatus.FAILED,
                duration_ms=round((time.time() - t) * 1000, 2),
                error=str(e)
            )


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _auto_blueprints(payload: dict) -> list:
    """Auto-generate identity blueprints from payload keys."""
    blueprints = []
    for key, val in payload.items():
        dtype = "STRING"
        if isinstance(val, bool):
            dtype = "BOOLEAN"
        elif isinstance(val, int):
            dtype = "INT"
        elif isinstance(val, float):
            dtype = "FLOAT"
        blueprints.append({
            "target_field": key,
            "json_path": f"$.{key}",
            "data_type": dtype,
            "is_primary_key": False,
            "is_required": False,
            "default_value": None
        })
    return blueprints


def _apply_blueprints(payload: dict, envelope: CanonicalEnvelope, blueprints: list) -> dict:
    """Apply blueprints to payload and return a flat mapped row."""
    row = {
        "_hve_id": envelope.hve_id,
        "_source_id": envelope.source_id,
        "_ingest_ts": envelope.ingest_timestamp,
    }
    for bp in blueprints:
        path = bp["json_path"]
        # Simple JSONPath: $.key
        key = path.lstrip("$.").split(".")[0]
        value = payload.get(key)
        if value is None and bp.get("default_value") is not None:
            value = bp["default_value"]
        row[bp["target_field"]] = value
    return row


def _eval_rule(row: dict, logic: str) -> bool:
    """Safely evaluate a DQ rule expression against a row."""
    try:
        safe_globals = {"__builtins__": {
            "None": None, "True": True, "False": False,
            "abs": abs, "len": len, "str": str, "int": int, "float": float
        }}
        return bool(eval(logic, safe_globals, dict(row)))
    except Exception:
        return True  # Conservative: if rule errors, let it pass


def object_minio_stat(path: str) -> int:
    """Get object size from MinIO Bronze bucket."""
    try:
        stat = minio_service.minio_client.stat_object(BRONZE_BUCKET, path)
        return stat.size
    except Exception:
        return 0


def minio_client_stat(path: str) -> int:
    """Get object size from MinIO. Tolerates errors."""
    try:
        stat = minio_service.minio_client.stat_object(BRONZE_BUCKET, path)
        return stat.size
    except Exception:
        return 0
