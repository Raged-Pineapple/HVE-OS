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
    data: Any = Field(..., description="The raw JSON data payload")
    debug: bool = Field(False, description="Enable synchronous pipeline trace mode")

class CanonicalEnvelope(BaseModel):
    """
    Standardized wrapper for all data entering HVE-OS via streams.
    Adds critical metadata for tracking and quality gates.
    """
    hve_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_id: str
    ingest_timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    payload: Any

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
    source_id: str = Field(..., description="The unique name for this data stream. Will be used as the Iceberg table name.", examples=["context_military_bases"])
    api_url: str = Field(..., description="Full URL of the external REST API endpoint to poll.", examples=["https://overpass-api.de/api/interpreter?data=[out:json];node(50.745,7.17,50.75,7.18);out;"])
    method: str = Field("GET", description="HTTP method to use when reaching the external API.", examples=["GET", "POST"])
    headers: Dict[str, str] = Field(default_factory=dict, description="Custom HTTP headers to attach to the request.", examples=[{"Accept": "application/json"}])
    body_template: Optional[Dict[str, Any]] = Field(None, description="Request body payload for POST/PUT APIs.", examples=[{"query": "example"}])
    poll_interval_seconds: int = Field(60, description="How often HVE-OS should wake up and hit this API (in seconds).", ge=5, le=86400, examples=[86400])
    auth_type: AuthType = Field(AuthType.NONE, description="Authentication mechanism for the external API.", examples=["NONE"])
    auth_credentials: Dict[str, str] = Field(default_factory=dict, description="Auth credentials (e.g., tokens, passwords).", examples=[{}])
    description: Optional[str] = Field(None, description="Human-readable description of what this poller does.", examples=["Daily pull of Military Bases"])


# ============================================================
# STAGE 3: CONTROL PLANE MODELS (Mapping Blueprints)
# ============================================================

class MappingBlueprintCreate(BaseModel):
    """Create a mapping blueprint for dynamic data extraction."""
    target_field: str = Field(..., description="Target column name that will be created in your clean Silver Iceberg table.", examples=["latitude"])
    jmes_path: str = Field(..., description="JMESPath expression to hunt down the value inside the messy raw payload.", examples=["center.lat", "tags.name"])
    data_type: str = Field("STRING", description="Target native database type (STRING, INT, FLOAT, BOOLEAN, TIMESTAMP, BIGINT).", examples=["FLOAT"])
    is_primary_key: bool = Field(False, description="Set to true if this field uniquely identifies the row.", examples=[False])
    is_required: bool = Field(True, description="If true, records missing this extraction will be instantly rejected from the pipeline.", examples=[True])
    default_value: Optional[str] = Field(None, description="Fallback value if the extraction path returns null.", examples=["Unknown"])
    should_explode: bool = Field(True, description="If the extracted value is a list, should it be exploded into multiple rows?", examples=[True])
    nested_explode: bool = Field(True, description="If the extracted value is a nested list of lists, should it be deeply exploded?", examples=[True])

class MappingBlueprintInfo(BaseModel):
    """Response model for a mapping blueprint."""
    blueprint_id: int
    source_id: str
    target_field: str
    jmes_path: str
    data_type: str
    is_primary_key: bool
    is_required: bool
    default_value: Optional[str]
    should_explode: bool
    nested_explode: bool


# ============================================================
# STAGE 3: CONTROL PLANE MODELS (DQ Rules)
# ============================================================

class DQRuleCreate(BaseModel):
    """Create a data quality rule."""
    rule_name: str = Field(..., description="Human-readable name explaining what this filter does.", examples=["Strictly Military Bases"])
    rule_logic: str = Field(..., description="Pure Python expression evaluated against the structured row. Any columns extracted in the Blueprints are directly accessible here.", examples=["category == 'base' and base_name is not None"])
    action_on_fail: DQAction = Field(DQAction.QUARANTINE, description="Action taken when the Python rule evaluates to False.", examples=["QUARANTINE"])
    severity: DQSeverity = Field(DQSeverity.ERROR, description="Severity level flag.", examples=["ERROR"])

class DQRuleInfo(BaseModel):
    """Response model for a DQ rule."""
    rule_id: int
    source_id: str
    rule_name: Optional[str]
    rule_logic: str
    action_on_fail: str
    severity: str

class SaveSnapshotRequest(BaseModel):
    """Payload to save a manual snapshot from the UI."""
    table_name: str
    snapshot_name: str
    records: List[Dict[str, Any]]
    overwrite_path: Optional[str] = None

class SnapshotDataRequest(BaseModel):
    """Payload to fetch a manual snapshot's data."""
    path: str
    limit: int = 1000


# ============================================================
# STAGE 5: QUERY MODELS
# ============================================================

class QueryRequest(BaseModel):
    """SQL query request against Silver tables."""
    sql: str = Field(..., description="DuckDB SQL query to execute against the Lakehouse. Table names correspond mathematically to your source IDs.", examples=["SELECT base_id, base_name, latitude, longitude FROM context_military_bases_v2 LIMIT 10"])
    limit: int = Field(1000, description="Safety limit on rows returned.", ge=1, le=100000, examples=[100])

class TimeTravelQueryRequest(BaseModel):
    """Request payload for Iceberg time-travel query."""
    sql: str = Field(..., description="DuckDB SQL query string (e.g. SELECT * FROM table_name)", examples=["SELECT * FROM context_military_bases_v2"])
    snapshot_id: Optional[int] = Field(None, description="Read data exactly as it was at this specific Iceberg snapshot ID.", examples=[6480482424800937643])
    limit: Optional[int] = Field(50, description="Max rows to return", examples=[10])

class SnapshotInfo(BaseModel):
    """Information about an Iceberg table snapshot."""
    snapshot_id: int
    timestamp_ms: int
    committed_at: str

class QueryResponse(BaseModel):
    """Response model for SQL queries."""
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float

class SilverTableInfo(BaseModel):
    """Information about a Silver table."""
    # We changed schema_json to table_schema to prevent Pydantic shadow warnings
    
    table_name: str
    source_id: Optional[str]
    minio_path: str
    row_count: int
    file_count: int
    total_size_bytes: int
    table_schema: Optional[Dict[str, Any]]
    source_description: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

# ============================================================
# STAGE 5: GOLD MODELS (Graph & Blueprints)
# ============================================================

class GraphBlueprintCreate(BaseModel):
    """Create a Cypher template for mapping Silver to Gold Neo4j."""
    cypher_template: str = Field(..., description="Cypher UNWIND query mapping $rows to graph entities.", examples=["UNWIND $rows AS row MERGE (n:Entity {id: row.id}) SET n += row"])

class GraphBlueprintInfo(BaseModel):
    """Information about a saved Graph Blueprint."""
    source_id: str
    cypher_template: str
    created_at: Optional[str]
    updated_at: Optional[str]

class GoldRegistryInfo(BaseModel):
    """Metadata about a materialized Graph source."""
    source_id: str
    node_count: int
    last_snapshot_id: Optional[int]
    status: str
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


# ============================================================
# RAW API PROBE MODEL
# ============================================================

class RawAPIRequest(BaseModel):
    """Request body for the raw API probe debug endpoint."""
    api_url: str = Field(..., description="The external API URL to probe")
    method: str = Field("GET", description="HTTP method: GET, POST, PUT, DELETE")
    headers: Dict[str, str] = Field(default_factory=dict, description="Optional request headers")
    body: Optional[Dict[str, Any]] = Field(None, description="Optional JSON body for POST/PUT requests")
    auth_type: AuthType = Field(AuthType.NONE, description="Authentication type")
    auth_credentials: Dict[str, str] = Field(default_factory=dict, description="Auth credentials (token, username/password, api_key)")
    max_records: Optional[int] = Field(10, description="If the response is a list or has a 'states'/'elements' key, truncate to this many items to prevent browser crashes with large APIs like OpenSky. Set to null for full response.")


class RawAPIPreviewInfo(BaseModel):
    """Metadata about truncation applied to the raw API response."""
    truncated: bool
    total_records: Optional[int] = None
    showing: Optional[int] = None
    tip: Optional[str] = None


class RawAPIResponse(BaseModel):
    """Response from the raw API probe endpoint."""
    status_code: int
    latency_ms: float
    raw_response: Any = Field(description="The parsed JSON response (or raw text) from the external API")
    response_headers: Dict[str, str]
    preview_info: RawAPIPreviewInfo
