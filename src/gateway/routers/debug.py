"""
debug.py — Debug & Observability Router
Makes the entire HVE-OS data pipeline transparent on demand.
"""
import time
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from models import PipelineTrace, DebugTraceRequest, StageTrace, StageStatus
from services import db_service
from services.debug_pipeline import DebugPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/debug", tags=["🔍 Debug & Observability"])


# ============================================================
# POST /debug/trace — Full 5-Stage Pipeline Trace
# ============================================================

@router.post(
    "/trace",
    response_model=PipelineTrace,
    summary="Run Full 5-Stage Pipeline Trace",
    description="""
Runs your data synchronously through the full 5-stage pipeline and returns a 
detailed breakdown of every stage:

- **Stage 1 (Perimeter)**: Source registration + Canonical Envelope creation
- **Stage 2 (Kafka)**: Message delivery confirmation with partition + offset
- **Stage 3 (Bronze)**: Raw JSONL write to MinIO with path + size
- **Stage 4 (Transform)**: Blueprint mapping + every DQ rule evaluated with PASS/FAIL
- **Stage 5 (Silver)**: Parquet write with schema, row count, and file path

⚠️ This endpoint is synchronous (~300ms). Use for debugging, not production load.
    """
)
async def trace_pipeline(request: DebugTraceRequest) -> PipelineTrace:
    """Run a full synchronous pipeline trace for any payload."""
    try:
        pipeline = DebugPipeline(
            source_id=request.source_id,
            payload=request.data
        )
        return pipeline.run()
    except Exception as e:
        logger.error(f"Debug trace failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# GET /debug/pipeline-log — Historical Processing Runs
# ============================================================

@router.get(
    "/pipeline-log",
    summary="View Historical Processing Runs",
    description="Returns the history of all batch processing runs across all sources."
)
async def get_pipeline_log(
    source_id: Optional[str] = Query(None, description="Filter by source_id"),
    limit: int = Query(50, description="Max rows to return", ge=1, le=500)
):
    """Retrieve historical processing run logs from the Control Plane."""
    try:
        with db_service.get_cursor() as cur:
            if source_id:
                cur.execute("""
                    SELECT log_id, source_id, processor_type, bronze_path, silver_path,
                           records_in, records_passed, records_quarantined,
                           status, error_message,
                           started_at, completed_at,
                           EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 AS duration_ms
                    FROM processing_log
                    WHERE source_id = %s
                    ORDER BY started_at DESC
                    LIMIT %s
                """, (source_id, limit))
            else:
                cur.execute("""
                    SELECT log_id, source_id, processor_type, bronze_path, silver_path,
                           records_in, records_passed, records_quarantined,
                           status, error_message,
                           started_at, completed_at,
                           EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 AS duration_ms
                    FROM processing_log
                    ORDER BY started_at DESC
                    LIMIT %s
                """, (limit,))

            rows = cur.fetchall()
            result = []
            for row in rows:
                r = dict(row)
                # Serialize datetimes
                for k in ["started_at", "completed_at"]:
                    if r.get(k):
                        r[k] = str(r[k])
                result.append(r)
            return {
                "count": len(result),
                "filter_source_id": source_id,
                "logs": result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# GET /debug/quarantine/{source_id} — View Quarantined Records
# ============================================================

@router.get(
    "/quarantine/{source_id}",
    summary="View Quarantined Records",
    description="Returns records that failed DQ rules and were quarantined for a given source."
)
async def get_quarantine(
    source_id: str,
    limit: int = Query(50, description="Max rows to return", ge=1, le=500)
):
    """Get quarantined records for a source from the DQ Quarantine Log."""
    try:
        with db_service.get_cursor() as cur:
            cur.execute("""
                SELECT quarantine_id, source_id, rule_id, rule_name,
                       failed_record, failure_reason, quarantined_at
                FROM dq_quarantine_log
                WHERE source_id = %s
                ORDER BY quarantined_at DESC
                LIMIT %s
            """, (source_id, limit))
            rows = cur.fetchall()
            result = []
            for row in rows:
                r = dict(row)
                if r.get("quarantined_at"):
                    r["quarantined_at"] = str(r["quarantined_at"])
                result.append(r)
            return {
                "source_id": source_id,
                "quarantined_count": len(result),
                "records": result
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# GET /debug/health/deep — Deep Health Check with Latency
# ============================================================

@router.get(
    "/health/deep",
    summary="Deep Health Check",
    description="Tests every service (PostgreSQL, MinIO, Kafka) and returns measured latency in ms."
)
async def deep_health_check():
    """Measure response latency of every infrastructure service."""
    results = {}

    # ── PostgreSQL ──
    t = time.time()
    try:
        with db_service.get_cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM source_registry")
            count = cur.fetchone()["count"]
        results["postgresql"] = {
            "status": "✅ HEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "source_count": count
        }
    except Exception as e:
        results["postgresql"] = {
            "status": "❌ UNHEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "error": str(e)
        }

    # ── MinIO ──
    from services.minio_service import minio_client, BRONZE_BUCKET, SILVER_BUCKET
    t = time.time()
    try:
        bronze_exists = minio_client.bucket_exists(BRONZE_BUCKET)
        silver_exists = minio_client.bucket_exists(SILVER_BUCKET)
        results["minio"] = {
            "status": "✅ HEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "buckets": {
                BRONZE_BUCKET: "exists" if bronze_exists else "missing",
                SILVER_BUCKET: "exists" if silver_exists else "missing"
            }
        }
    except Exception as e:
        results["minio"] = {
            "status": "❌ UNHEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "error": str(e)
        }

    # ── Kafka ──
    from services.kafka_service import producer
    t = time.time()
    try:
        producer.poll(0)
        results["kafka"] = {
            "status": "✅ HEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "messages_in_queue": len(producer)
        }
    except Exception as e:
        results["kafka"] = {
            "status": "❌ UNHEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "error": str(e)
        }

    # ── Silver Tables ──
    t = time.time()
    try:
        tables = db_service.get_silver_tables()
        results["silver_layer"] = {
            "status": "✅ HEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "table_count": len(tables),
            "tables": [t["table_name"] for t in tables]
        }
    except Exception as e:
        results["silver_layer"] = {
            "status": "❌ UNHEALTHY",
            "latency_ms": round((time.time() - t) * 1000, 2),
            "error": str(e)
        }

    overall = "✅ ALL SYSTEMS HEALTHY" if all(
        "HEALTHY" in v["status"] for v in results.values()
    ) else "⚠️ DEGRADED — one or more services unhealthy"

    return {
        "overall": overall,
        "timestamp": str(__import__("datetime").datetime.utcnow()),
        "services": results
    }
