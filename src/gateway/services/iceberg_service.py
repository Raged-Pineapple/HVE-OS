"""
iceberg_service.py — Apache Iceberg Table Management
Interacts with the Iceberg REST Catalog to create tables backed by MinIO/Parquet,
and exposes snapshot time-travel queries.
"""
import os
import io
import json
import logging
from typing import Dict, Any, List

import pyarrow as pa
import pyarrow.parquet as pq

from pyiceberg.catalog import load_catalog
from pyiceberg.schema import Schema
from pyiceberg.types import (
    StructType,
    NestedField,
    IntegerType,
    LongType,
    DoubleType,
    StringType,
    BooleanType,
    TimestampType
)
from pyiceberg.exceptions import NoSuchTableError

from services import minio_service
from services import db_service

logger = logging.getLogger(__name__)

# Load connection settings from env or defaults
ICEBERG_REST_URI = os.getenv("ICEBERG_REST_URI", "http://127.0.0.1:8181")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://127.0.0.1:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ROOT_USER", "hve_admin")
MINIO_SECRET_KEY = os.getenv("MINIO_ROOT_PASSWORD", "hve_password123")
WAREHOUSE_LOCATION = "s3a://hve-iceberg/"
ICEBERG_NAMESPACE = "hve_silver"

# We use pyiceberg's load_catalog with explicit kwargs instead of env vars
_catalog = None

def get_catalog():
    """Get or initialize the Iceberg REST Catalog."""
    global _catalog
    if _catalog is None:
        _catalog = load_catalog(
            "default",
            **{
                "uri": ICEBERG_REST_URI,
                "s3.endpoint": MINIO_ENDPOINT,
                "s3.access-key-id": MINIO_ACCESS_KEY,
                "s3.secret-access-key": MINIO_SECRET_KEY,
                "s3.region": "us-east-1",
            }
        )
        # Ensure our namespace exists
        try:
            _catalog.create_namespace(ICEBERG_NAMESPACE)
            logger.info(f"Created Iceberg namespace '{ICEBERG_NAMESPACE}'")
        except Exception as e:
            # Already exists
            pass
    return _catalog


def _infer_iceberg_schema(rows: List[Dict[str, Any]]) -> Schema:
    """Infer PyIceberg schema from a list of dicts."""
    if not rows:
        raise ValueError("Cannot infer schema from empty rows")
        
    sample = rows[0]
    fields = []
    field_id = 1
    
    for key, val in sample.items():
        if isinstance(val, int) and not isinstance(val, bool):
            ftype = LongType()
        elif isinstance(val, float):
            ftype = DoubleType()
        elif isinstance(val, bool):
            ftype = BooleanType()
        else:
            ftype = StringType()
            
        fields.append(
            NestedField(field_id=field_id, name=key, field_type=ftype, required=False)
        )
        field_id += 1
        
    return Schema(*fields)

def _convert_to_pyarrow_iceberg(rows: List[Dict[str, Any]], schema: Schema) -> pa.Table:
    """Convert rows to a PyArrow Table matching the Iceberg Schema."""
    arrays = {}
    for field in schema.fields:
        key = field.name
        values = [row.get(key) for row in rows]
        
        if isinstance(field.field_type, (IntegerType, LongType)):
            # Self-healing: cast to int if it arrived as a string
            casted_values = []
            for v in values:
                try:
                    casted_values.append(int(v) if v is not None else None)
                except (ValueError, TypeError):
                    casted_values.append(None)
            arrays[key] = pa.array(casted_values, type=pa.int64())
        elif isinstance(field.field_type, DoubleType):
            # Self-healing: cast to float if it arrived as a string
            casted_values = []
            for v in values:
                try:
                    casted_values.append(float(v) if v is not None else None)
                except (ValueError, TypeError):
                    casted_values.append(None)
            arrays[key] = pa.array(casted_values, type=pa.float64())
        elif isinstance(field.field_type, BooleanType):
            arrays[key] = pa.array(values, type=pa.bool_())
        else:
            arrays[key] = pa.array([str(v) if v is not None else None for v in values], type=pa.string())
            
    return pa.table(arrays)

def get_or_create_table(source_id: str, sample_rows: List[Dict[str, Any]]):
    """
    Get an existing Iceberg table or create a new one based on sample rows.
    """
    catalog = get_catalog()
    table_identifier = f"{ICEBERG_NAMESPACE}.{source_id}"
    
    try:
        return catalog.load_table(table_identifier)
    except NoSuchTableError:
        schema = _infer_iceberg_schema(sample_rows)
        logger.info(f"Creating new Iceberg table {table_identifier}")
        return catalog.create_table(
            identifier=table_identifier,
            schema=schema,
            location=f"{WAREHOUSE_LOCATION}{source_id}"
        )

def append_records(source_id: str, records: List[Dict[str, Any]], batch_id: str = None) -> dict:
    """
    Append a batch of records to an Iceberg table as a new snapshot.
    """
    if not records:
        return {"status": "skipped", "reason": "No records to append"}
        
    table = get_or_create_table(source_id, records)
    
    # Convert to PyArrow using inferred schema
    arrow_table = _convert_to_pyarrow_iceberg(records, table.schema())
    
    # Write to Iceberg (creates a snapshot/manifest + data parquet files)
    table.append(arrow_table)
    
    # Get latest snapshot info for logging
    table.refresh()
    history = table.history()
    latest_snapshot = history[-1] if history else None
    
    snapshot_id = latest_snapshot.snapshot_id if latest_snapshot else None
    
    # Get total metrics
    metrics = {
        "snapshot_id": snapshot_id,
        "records_added": len(records),
        "total_snapshots": len(history),
    }

    # Log to Postgres
    if snapshot_id:
        try:
            with db_service.get_cursor() as cur:
                cur.execute("""
                    INSERT INTO iceberg_snapshot_log 
                        (table_name, source_id, snapshot_id, operation, records_added)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    f"{ICEBERG_NAMESPACE}.{source_id}",
                    source_id,
                    snapshot_id,
                    "append",
                    len(records)
                ))
        except Exception as e:
            logger.warning(f"Failed to log snapshot to DB: {e}")
            
    return metrics

def get_snapshots(source_id: str) -> List[Dict[str, Any]]:
    """Get the full snapshot history of an Iceberg table."""
    catalog = get_catalog()
    table_identifier = f"{ICEBERG_NAMESPACE}.{source_id}"
    try:
        table = catalog.load_table(table_identifier)
        history = []
        for snap in table.history():
            history.append({
                "snapshot_id": snap.snapshot_id,
                "timestamp_ms": snap.timestamp_ms,
            })
        return history
    except NoSuchTableError:
        return []

def scan_as_of(source_id: str, snapshot_id: int):
    """Scan the table as of a specific historical snapshot."""
    catalog = get_catalog()
    table_identifier = f"{ICEBERG_NAMESPACE}.{source_id}"
    table = catalog.load_table(table_identifier)
    
    # In PyIceberg, use_snapshot directly configures the scan
    scan = table.scan(snapshot_id=snapshot_id)
    return scan.to_arrow()

def scan_latest(source_id: str):
    """Scan the latest snapshot of the table."""
    catalog = get_catalog()
    table_identifier = f"{ICEBERG_NAMESPACE}.{source_id}"
    table = catalog.load_table(table_identifier)
    return table.scan().to_arrow()


def drop_table(source_id: str) -> bool:
    """Drop an Iceberg table from the catalog (purges all data files)."""
    catalog = get_catalog()
    table_identifier = f"{ICEBERG_NAMESPACE}.{source_id}"
    try:
        catalog.drop_table(table_identifier, purge_requested=True)
        logger.info(f"Dropped Iceberg table: {table_identifier}")
        return True
    except NoSuchTableError:
        logger.warning(f"Iceberg table not found (already gone): {table_identifier}")
        return False
    except Exception as e:
        logger.error(f"Failed to drop Iceberg table {table_identifier}: {e}")
        return False

def drop_all_tables():
    """Drops all Iceberg tables in our namespace."""
    catalog = get_catalog()
    try:
        tables = catalog.list_tables(ICEBERG_NAMESPACE)
        for table_id in tables:
            catalog.drop_table(table_id, purge_requested=True)
            logger.info(f"Dropped Iceberg table: {table_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to drop all Iceberg tables: {e}")
        return False
