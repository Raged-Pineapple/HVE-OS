"""
ingest.py — The Perimeter Router (Stage 1: Capture & Shield)
Handles all data ingestion: streams, batch file uploads, and API registration.
"""
import os
import sys
import logging

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from models import (
    CanonicalEnvelope, StreamPayload, 
    PreSignedUrlRequest, PreSignedUrlResponse,
    APISourceConfig
)
from services.minio_service import generate_presigned_upload_url, BRONZE_BUCKET, DLQ_BUCKET, peek_latest_objects
from services.kafka_service import publish_stream
from services import db_service
from processors.api_poller import get_poller

# Add src directory to path so processors package is importable
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingest", tags=["Ingest"])

# Maximum file size for direct upload (100MB)
MAX_UPLOAD_SIZE = 100 * 1024 * 1024


# ============================================================
# STREAM INGESTION (Existing — Enhanced)
# ============================================================

@router.post("/stream", status_code=status.HTTP_202_ACCEPTED)
async def stream_data(payload: StreamPayload):
    """
    **Ingest Live Telemetry Streams (The Firehose)**
    
    This is the primary ingestion gate for massive, high-throughput external systems pushing data to HVE-OS (e.g., IoT sensors, live aircraft transponders, real-time message queues). 
    
    It serves as a "Shock Absorber." It completely bypasses external databases or slow persistent disks, writing your payload instantly into the **Apache Kafka** cluster to guarantee millisecond latency and absolute server crash resilience.

    ### 📝 Parameters & Behavior
    * **`source_id`** *(string)*: The pipeline destination identity (e.g., `opensky_network`). This MUST perfectly match a previously registered source.
    * **`data`** *(dict)*: The raw JSON object you are pushing. Send exactly what the sensor outputs. No pre-formatting required.
    * **`debug`** *(boolean)*: **The Swiss-Army Knife.** 
        * If `false` (default): Operates in production Fire-and-Forget mode (`202 Accepted`). Data flows asynchronously.
        * If `true`: The system intentionally bypasses Kafka, locking the HTTP request. It synchronously forces the event step-by-step through the Database Blueprints and DQ Gates, generating a mathematically precise `PipelineTrace` JSON response showing you exact processing milliseconds and failures. Use this to construct your Blueprints!
    """
    try:
        # Ensure source is registered
        source = db_service.get_source(payload.source_id)
        if not source:
            db_service.register_source(
                source_id=payload.source_id,
                source_type="STREAM",
                protocol="HTTP",
                description=f"Auto-registered stream source"
            )

        # Wrap in Canonical Envelope
        enveloped_data = CanonicalEnvelope(
            source_id=payload.source_id,
            payload=payload.data
        )

        # ── DEBUG MODE: Synchronous full pipeline trace ──
        if payload.debug:
            from services.debug_pipeline import DebugPipeline
            pipeline = DebugPipeline(
                source_id=payload.source_id,
                payload=payload.data
            )
            return pipeline.run()

        # ── NORMAL MODE: Fire-and-forget to Kafka ──
        publish_stream(enveloped_data.model_dump())
        
        return {
            "status": "Accepted",
            "message": "Enveloped and delivered to Kafka",
            "data": enveloped_data.model_dump()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# BATCH INGESTION — Pre-Signed URL (Existing)
# ============================================================

@router.post("/presigned-url", response_model=PreSignedUrlResponse)
async def get_presigned_url(request: PreSignedUrlRequest):
    """
    **Get a MinIO Pre-Signed URL for Massive Data Dumps**
    
    Bypasses the FastAPI memory limits. The server securely generates a temporary URL mapped directly to MinIO's storage drives. The client uses an HTTP `PUT` to upload a 50GB CSV file straight to the Lakehouse disks.
    """
    try:
        # Ensure source is registered
        source = db_service.get_source(request.source_id)
        if not source:
            db_service.register_source(
                source_id=request.source_id,
                source_type="STATIC_FILE",
                protocol="FILE",
                description=f"Static file source (pre-signed upload)"
            )

        url_payload = generate_presigned_upload_url(
            source_id=request.source_id,
            filename=request.filename
        )
        return url_payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# STATIC FILE UPLOAD (New — Direct Upload + Full Pipeline)
# ============================================================

@router.post("/upload-static", status_code=status.HTTP_201_CREATED)
async def upload_static_file(
    file: UploadFile = File(..., description="Static file to process (CSV, JSON, Parquet, Excel, GeoJSON)"),
    source_id: str = Form(..., description="Unique identifier for this data source")
):
    """
    Upload a static file directly through the API.
    The file is processed through the full pipeline:
    1. Bronze (raw storage in MinIO)
    2. Transform (apply mapping blueprints)
    3. DQ Gate (validate against rules)
    4. Silver (clean Parquet output)
    
    For files > 100MB, use the /presigned-url endpoint instead.
    """
    try:
        # Read file contents
        file_data = await file.read()
        
        if len(file_data) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"File too large ({len(file_data)} bytes). "
                       f"Max direct upload: {MAX_UPLOAD_SIZE} bytes. "
                       f"Use /presigned-url for larger files."
            )
        
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required.")

        # Process through the full batch pipeline
        from processors.batch_processor import process_static_file
        result = process_static_file(source_id, file.filename, file_data)
        
        return {
            "status": "Processed",
            "message": f"File processed through full pipeline: {result['records_passed']} clean rows in Silver",
            **result
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Static file upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# API REGISTRATION (New — Register External API for Polling)
# ============================================================

@router.post("/register-api", status_code=status.HTTP_201_CREATED)
async def register_api_source(config: APISourceConfig):
    """
    **Register an External API for Automated Polling (The API Connector)**
    
    This endpoint allows you to seamlessly connect HVE-OS to **any external REST API** in the world without writing custom Python scrapers. The system will autonomously wake up, fetch the data, and stream it deep into your Iceberg Lakehouse.
    
    ### 🚀 Deep Dive: How the Engine Works
    1. **The Poller Wakes Up:** Every `poll_interval_seconds`, a background async worker initiates an HTTP request to the `api_url` you provided.
    2. **Array Extraction (Crucial):** If the API returns a massive nested JSON payload containing a list (like OpenStreetMap `elements` or NewsAPI `articles`), you provide the `extraction_path` (e.g. `$.elements`). The system cuts open the JSON, extracts the array, and explodes it, treating every item inside as an independent, individual row.
    3. **Canonical Envelope:** The system safely wraps the pure extracted JSON in our standard Envelope (injecting a mathematically unique `hve_id` and timestamps).
    4. **Kafka Push:** The array is blasted into the `raw-telemetry` Kafka stream.
    
    ### 📝 Parameters & Complete Tutorial
    A naive user can orchestrate complex extractions by strictly following these fields:
    * **`source_id`** *(string)*: The name of your pipeline! Try to use clean snake_case (e.g., `osm_military_bases`). This dictates exactly what the resulting Iceberg table will be named in the database.
    * **`api_url`** *(string)*: The full HTTP URL of the API you want to hit.
    * **`method`** *(string)*: `GET` or `POST`. Most simple targets are `GET`.
    * **`headers`** *(dict)*: Provide JSON dictionaries here for things like `{"Accept": "application/json"}`.
    * **`poll_interval_seconds`** *(int)*: How frequently the system gathers data. 
        * *Warning:* The maximum legal limit built into Pydantic is `86400` seconds (24 hours). For static mapping data, set this to 86400.
    * **`extraction_path`** *(string)*: The JSONPath string (e.g. `$.elements` or `$.response.items`). If the API returns a root-level JSON array directly, you can leave this blank.
    
    ### ⚠️ Danger: Execution Strategy
    **DO NOT execute this endpoint first!** 
    Because `register-api` wakes up and queries the data instantly, the data will rush into your pipeline. If you have not created your **Blueprints** and **Data Quality (DQ) Rules** in the Control Plane endpoints yet, the system will conservatively *auto-generate* a schema based on whatever raw junk JSON it sees first, locking your Iceberg schema.
    **Pattern:** Define Blueprints -> Define DQ Rules -> Hit `register-api`!
    """
    try:
        # Register the source
        db_service.register_source(
            source_id=config.source_id,
            source_type="API_POLL",
            protocol="HTTP",
            description=config.description or f"API Poll: {config.api_url}"
        )

        # Save API configuration
        api_config = db_service.save_api_config(
            source_id=config.source_id,
            config=config.model_dump()
        )

        # ── NEW: LIVE DATA PREVIEW ──────────────────────────────────────────
        # Provide immediate "Plug-and-Play" verification by fetching sample data
        import aiohttp
        from processors.api_poller import _extract_records
        
        preview_data = None
        try:
            async with aiohttp.ClientSession() as session:
                kwargs = {
                    "headers": config.headers,
                    "timeout": aiohttp.ClientTimeout(total=10)
                }
                if config.method.upper() == "POST" and config.body_template:
                    kwargs["json"] = config.body_template
                
                async with session.request(config.method, config.api_url, **kwargs) as resp:
                    if resp.status == 200:
                        raw_response = await resp.json()
                        preview_data = _extract_records(raw_response, config.extraction_path)
        except Exception as e:
            logger.warning(f"Registration preview fetch failed: {e}")
        # ────────────────────────────────────────────────────────────────────

        # Start polling immediately if the poller is running
        try:
            from processors.api_poller import get_poller
            import asyncio
            poller = get_poller()
            if poller._running:
                await poller.start_polling_source(config.source_id)
        except Exception as e:
            logger.warning(f"Could not start immediate polling: {e}")

        # Convert datetime for serialization
        for key in ['last_polled_at']:
            if api_config.get(key):
                api_config[key] = str(api_config[key])

        return {
            "status": "Registered",
            "message": f"API source '{config.source_id}' registered and polling started",
            "source_id": config.source_id,
            "api_url": config.api_url,
            "poll_interval_seconds": config.poll_interval_seconds,
            "is_polling": api_config.get("is_polling", True),
            "preview_data": preview_data[:5] if preview_data else None,
            "total_records_found": len(preview_data) if preview_data else 0
        }
    except Exception as e:
        logger.error(f"API registration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
