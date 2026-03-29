from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
from datetime import datetime, timezone
import uuid

class StreamPayload(BaseModel):
    """
    The incoming raw payload from any source.
    """
    source_id: str = Field(..., description="Unique identifier for the data source")
    data: Dict[str, Any] = Field(..., description="The raw JSON data payload")

class CanonicalEnvelope(BaseModel):
    """
    The standardized wrapper for all data entering the HVE OS Lakehouse via streams.
    Adds critical metadata for tracking and quality gates.
    """
    hve_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_id: str
    ingest_timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    payload: Dict[str, Any]

class PreSignedUrlRequest(BaseModel):
    """
    Request model to get a direct-upload URL for a massive static file.
    """
    source_id: str = Field(..., description="Unique identifier for the data source")
    filename: str = Field(..., description="Target filename including extension (e.g., flight_data.csv)")
    file_type: Optional[str] = Field("application/octet-stream")

class PreSignedUrlResponse(BaseModel):
    """
    Response model containing the MinIO Pre-Signed URL.
    """
    upload_url: str
    target_path: str
    expires_in_seconds: int
