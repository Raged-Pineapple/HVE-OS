"""
ingest.py — The Perimeter Router (Stage 1: Capture & Shield)
Handles all data ingestion: streams, batch file uploads, and API registration.
"""
import os
import sys
import logging

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Form
from models import (
    CanonicalEnvelope, StreamPayload, 
    PreSignedUrlRequest, PreSignedUrlResponse,
    APISourceConfig
)
from services.minio_service import generate_presigned_upload_url
from services.kafka_service import publish_stream
from services import db_service

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
    Accepts real-time streaming JSON, wraps it in the Canonical Envelope,
    and drops it onto the raw Kafka topic. Acts as a high-throughput 
    shock absorber — no storage, pure buffer.
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
    Returns a Pre-Signed MinIO Upload URL.
    The client can upload files up to 50GB+ directly to MinIO,
    completely bypassing this API's memory space to prevent crashes.
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
    Register an external API for automatic polling.
    The system will poll this API at the specified interval,
    wrap each response in a Canonical Envelope, and push it
    through the full stream pipeline (Kafka → Bronze → Silver).
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
            "is_polling": api_config.get("is_polling", True)
        }
    except Exception as e:
        logger.error(f"API registration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
