"""
debug.py — Debug & Observability Router
Makes the entire HVE-OS data pipeline transparent on demand.
"""
import time
import logging
import requests
from typing import Optional, List
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from fastapi import APIRouter, HTTPException, Query
from models import PipelineTrace, DebugTraceRequest, StageTrace, StageStatus, RawAPIRequest, RawAPIResponse, RawAPIPreviewInfo, AuthType
from services import db_service, minio_service, iceberg_service
from services.neo4j_service import get_neo4j_service
from services.debug_pipeline import DebugPipeline
from processors.api_poller import get_poller

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


# ============================================================
# POST /debug/fetch-raw-api — Raw API Probe
# ============================================================

@router.post(
    "/fetch-raw-api",
    response_model=RawAPIResponse,
    summary="Probe Raw API Response",
    description="""
Hits an external API and returns the **exact raw payload** so you can inspect it 
before designing your Blueprint mapping.

Supports all authentication types (Bearer, API Key, Basic Auth) and custom headers.
Send any GET or POST request and receive the full parsed JSON response alongside 
status code, latency, and response headers — all in one call.

### 🔍 Typical Use Case
1. You have a new data source API you want to register.
2. Call this endpoint first to see the raw payload structure.
3. Use the response to design your Blueprint `jmes_path` mappings.
4. Register the API source with confidence.
    """
)
async def fetch_raw_api(request: RawAPIRequest):
    """Hits an external API and returns the exact raw payload for Blueprint design."""
    try:
        # Prepare auth
        auth = None
        headers = dict(request.headers)

        if request.auth_type == AuthType.BASIC:
            username = request.auth_credentials.get("username", "")
            password = request.auth_credentials.get("password", "")
            auth = (username, password)
        elif request.auth_type == AuthType.BEARER:
            token = request.auth_credentials.get("token", "")
            headers["Authorization"] = f"Bearer {token}"
        elif request.auth_type == AuthType.API_KEY:
            api_key = request.auth_credentials.get("api_key", "")
            header_name = request.auth_credentials.get("header_name", "x-api-key")
            headers[header_name] = api_key

        if "User-Agent" not in headers and "user-agent" not in headers:
            headers["User-Agent"] = "HVE-OS-DataFetcher/1.0"

        # Session with automatic retry on transient errors
        session = requests.Session()
        retry_strategy = Retry(
            total=3,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PUT", "DELETE"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)

        kwargs = {
            "method": request.method.upper(),
            "url": request.api_url,
            "headers": headers,
            "auth": auth,
            "timeout": 30,
        }
        
        if request.body:
            # Check if we should send as form data or JSON
            content_type = next((v for k, v in headers.items() if k.lower() == "content-type"), "")
            if "application/x-www-form-urlencoded" in content_type:
                kwargs["data"] = request.body
            else:
                kwargs["json"] = request.body

        response = session.request(**kwargs)

        # Try to parse JSON, fallback to raw text
        try:
            parsed_data = response.json()
        except ValueError:
            parsed_data = response.text

        # ── Truncate large responses to prevent Swagger UI from crashing ──
        total_records = None
        truncated = False
        if request.max_records is not None and isinstance(parsed_data, dict):
            # Handle common array-wrapper patterns (OpenSky: "states", Overpass: "elements", etc.)
            for key in ("states", "elements", "results", "data", "items", "records"):
                if key in parsed_data and isinstance(parsed_data[key], list):
                    total_records = len(parsed_data[key])
                    if total_records > request.max_records:
                        parsed_data = dict(parsed_data)
                        parsed_data[key] = parsed_data[key][:request.max_records]
                        truncated = True
                    break
        elif request.max_records is not None and isinstance(parsed_data, list):
            total_records = len(parsed_data)
            if total_records > request.max_records:
                parsed_data = parsed_data[:request.max_records]
                truncated = True

        return RawAPIResponse(
            status_code=response.status_code,
            latency_ms=round(response.elapsed.total_seconds() * 1000, 2),
            raw_response=parsed_data,
            response_headers=dict(response.headers),
            preview_info=RawAPIPreviewInfo(
                truncated=truncated,
                total_records=total_records,
                showing=request.max_records if truncated else total_records,
                tip="Increase 'max_records' or set to null for the full response." if truncated else None
            )
        )

    except Exception as e:
        logger.error(f"Raw API probe failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post(
    "/factory-reset",
    summary="NUCLEAR: Factory Reset Data Lakehouse",
    description="""
    Wipes all data from MinIO (Bronze/Silver/DLQ), drops all Iceberg tables, 
    and clears the Neo4j Graph. 
    
    By default, it preserves your source registrations and blueprints. 
    Set `keep_config=false` to wipe everything and start from a blank slate.
    """
)
async def factory_reset(keep_config: bool = True):
    """Global data wipe across MinIO, Iceberg, Neo4j, and Postgres."""
    try:
        # 1. Stop all pollers
        await get_poller().stop()
        
        # 2. Wipe MinIO
        minio_service.clear_all_buckets()
        
        # 3. Wipe Iceberg
        iceberg_service.drop_all_tables()
        
        # 4. Wipe Neo4j
        get_neo4j_service().wipe_graph()
        
        # 5. Wipe Postgres Logs & Registries
        db_service.wipe_all_data(keep_config=keep_config)
        
        # 5.5 Wipe Kafka Topics (create new admin client and delete)
        try:
            from confluent_kafka.admin import AdminClient
            import os
            admin = AdminClient({'bootstrap.servers': os.getenv("KAFKA_BROKERS", "127.0.0.1:9094")})
            admin.delete_topics(["raw-telemetry", "silver-telemetry"])
            logger.info("Kafka topics deleted (they will auto-recreate).")
        except Exception as e:
            logger.warning(f"Failed to wipe Kafka topics: {e}")

        # 6. Restart pollers if config was kept
        if keep_config:
            await get_poller().start()
            
        return {
            "status": "success",
            "message": "Factory reset complete. " + 
                       ("Config preserved, pollers restarted." if keep_config else "Total wipe complete.")
        }
    except Exception as e:
        logger.error(f"Factory reset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

