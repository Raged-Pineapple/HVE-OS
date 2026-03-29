from fastapi import APIRouter, HTTPException, status
from models import CanonicalEnvelope, StreamPayload, PreSignedUrlRequest, PreSignedUrlResponse
from services.minio_service import generate_presigned_upload_url
from services.kafka_service import publish_stream

router = APIRouter(prefix="/api/v1/ingest", tags=["Ingest"])

@router.post("/presigned-url", response_model=PreSignedUrlResponse)
async def get_presigned_url(request: PreSignedUrlRequest):
    """
    Returns a Pre-Signed MinIO Upload URL.
    The Client browser can use this to upload a 50GB file directly to
    MinIO, completely bypassing this API memory space to prevent crashes.
    """
    try:
        url_payload = generate_presigned_upload_url(
            source_id=request.source_id,
            filename=request.filename
        )
        return url_payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stream", status_code=status.HTTP_202_ACCEPTED)
async def stream_data(payload: StreamPayload):
    """
    Accepts real-time streaming JSON, wraps it in the Canonical Envelope,
    and drops it onto the raw Kafka topic. No storage in MinIO is done here,
    acting purely as a high-throughput shock absorber.
    """
    try:
        # 1. Validation has already been enforced by Pydantic 'StreamPayload'
        
        # 2. Add the Canonical Metadata Envelope
        enveloped_data = CanonicalEnvelope(
            source_id=payload.source_id,
            payload=payload.data
        )

        # 3. Fire to Kafka
        publish_stream(enveloped_data.model_dump())
        
        return {
            "status": "Accepted",
            "message": "Enveloped and delivered to Kafka",
            "hve_id": enveloped_data.hve_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
