"""
models.py — Pydantic Models for the HVE-OS Gateway API
All request/response schemas for every endpoint.
"""
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from enum import Enum
import uuid


# ============================================================
# ENUMS
# ============================================================

class SourceType(str, Enum):
    STREAM = "STREAM"
    API_POLL = "API_POLL"
    STATIC_FILE = "STATIC_FILE"

class AuthType(str, Enum):
    NONE = "NONE"
    API_KEY = "API_KEY"
    BEARER = "BEARER"
    BASIC = "BASIC"

class DQAction(str, Enum):
    QUARANTINE = "QUARANTINE"
    DROP = "DROP"
    FLAG = "FLAG"

class DQSeverity(str, Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


# ============================================================
# STAGE 1: PERIMETER MODELS (Ingest)
# ============================================================

class StreamPayload(BaseModel):
    """Incoming raw payload from any streaming source."""
    source_id: str = Field(..., description="Unique identifier for the data source")
    data: Dict[str, Any] = Field(..., description="The raw JSON data payload")
    debug: bool = Field(False, description="Enable synchronous pipeline trace mode")

class CanonicalEnvelope(BaseModel):
    """
    Standardized wrapper for all data entering HVE-OS via streams.
    Adds critical metadata for tracking and quality gates.
    """
    hve_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_id: str
    ingest_timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    payload: Dict[str, Any]

class PreSignedUrlRequest(BaseModel):
    """Request model for direct-upload URL for massive static files."""
    source_id: str = Field(..., description="Unique identifier for the data source")
    filename: str = Field(..., description="Target filename including extension (e.g., flight_data.csv)")
    file_type: Optional[str] = Field("application/octet-stream")

class PreSignedUrlResponse(BaseModel):
    """Response model containing the MinIO Pre-Signed URL."""
    upload_url: str
    target_path: str
    expires_in_seconds: int


# ============================================================
# STAGE 3: CONTROL PLANE MODELS (Source Registration)
# ============================================================

class SourceRegistration(BaseModel):
    """Register a new data source in HVE-OS."""
    source_id: str = Field(..., description="Unique source identifier (e.g., 'opensky_data')")
    source_type: SourceType = Field(SourceType.STREAM, description="Type of data source")
    protocol: str = Field("HTTP", description="Communication protocol (HTTP, MQTT, FILE, KAFKA)")
    description: Optional[str] = Field(None, description="Human-readable description")

class SourceInfo(BaseModel):
    """Response model for source information."""
    source_id: str
    source_type: str
    protocol: str
    status: str
    description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

class APISourceConfig(BaseModel):
    """Configuration for an external API to poll."""
    source_id: str = Field(..., description="Source ID (will be auto-registered)")
    api_url: str = Field(..., description="Full URL of the API endpoint to poll")
    method: str = Field("GET", description="HTTP method")
    headers: Dict[str, str] = Field(default_factory=dict, description="Custom HTTP headers")
    body_template: Optional[Dict[str, Any]] = Field(None, description="Request body for POST APIs")
    poll_interval_seconds: int = Field(60, description="Polling interval in seconds", ge=5, le=86400)
    auth_type: AuthType = Field(AuthType.NONE, description="Authentication type")
    auth_credentials: Dict[str, str] = Field(default_factory=dict, description="Auth credentials")
    extraction_path: Optional[str] = Field(
        None,
        description="JSONPath key for array extraction (e.g. '$.states' for OpenSky, '$.articles' for NewsAPI). "
                    "When set, each item in the array becomes its own Kafka message (Array Explosion)."
    )
    description: Optional[str] = Field(None, description="Human-readable description")


# ============================================================
# STAGE 3: CONTROL PLANE MODELS (Mapping Blueprints)
# ============================================================

class MappingBlueprintCreate(BaseModel):
    """Create a mapping blueprint for dynamic data extraction."""
    target_field: str = Field(..., description="Target column name in Silver table")
    json_path: str = Field(..., description="JSONPath expression to extract value (e.g., '$.states[*][0]')")
    data_type: str = Field("STRING", description="Target data type (STRING, INT, FLOAT, BOOLEAN, TIMESTAMP)")
    is_primary_key: bool = Field(False, description="Is this field a primary key?")
    is_required: bool = Field(True, description="Is this field required (non-null)?")
    default_value: Optional[str] = Field(None, description="Default value if extraction returns null")

class MappingBlueprintInfo(BaseModel):
    """Response model for a mapping blueprint."""
    blueprint_id: int
    source_id: str
    target_field: str
    json_path: str
    data_type: str
    is_primary_key: bool
    is_required: bool
    default_value: Optional[str]


# ============================================================
# STAGE 3: CONTROL PLANE MODELS (DQ Rules)
# ============================================================

class DQRuleCreate(BaseModel):
    """Create a data quality rule."""
    rule_name: str = Field(..., description="Human-readable rule name")
    rule_logic: str = Field(..., description="Python expression evaluated per row (e.g., 'altitude >= 0')")
    action_on_fail: DQAction = Field(DQAction.QUARANTINE, description="Action when rule fails")
    severity: DQSeverity = Field(DQSeverity.ERROR, description="Severity level")

class DQRuleInfo(BaseModel):
    """Response model for a DQ rule."""
    rule_id: int
    source_id: str
    rule_name: Optional[str]
    rule_logic: str
    action_on_fail: str
    severity: str
    is_active: bool


# ============================================================
# STAGE 5: QUERY MODELS
# ============================================================

class QueryRequest(BaseModel):
    """SQL query request against Silver tables."""
    sql: str = Field(..., description="SQL query to execute against Silver layer")
    limit: int = Field(1000, description="Maximum rows to return", ge=1, le=100000)

class QueryResponse(BaseModel):
    """Response model for SQL queries."""
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float

class SilverTableInfo(BaseModel):
    """Information about a Silver table."""
    table_name: str
    source_id: Optional[str]
    minio_path: str
    row_count: int
    file_count: int
    total_size_bytes: int
    schema_json: Optional[Dict[str, Any]]
    source_description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]


# ============================================================
# DEBUG / TRACE MODELS
# ============================================================

class StageStatus(str, Enum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"

class StageTrace(BaseModel):
    """Result of a single pipeline stage in debug mode."""
    status: StageStatus
    duration_ms: float
    detail: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class PipelineTrace(BaseModel):
    """Full 5-stage debug trace response."""
    trace_id: str
    source_id: str
    debug_mode: bool = True
    total_duration_ms: float
    overall_status: StageStatus
    stages: Dict[str, StageTrace]

class DebugTraceRequest(BaseModel):
    """Request body for the dedicated debug trace endpoint."""
    source_id: str = Field(..., description="Source ID to trace")
    data: Dict[str, Any] = Field(..., description="The payload to push through the pipeline")
