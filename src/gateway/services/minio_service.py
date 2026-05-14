"""
minio_service.py — MinIO Object Storage Service
Handles Pre-Signed URLs, Bronze writes, Silver writes, and S3-compatible operations.
"""
import os
import io
import gzip
import json
import logging
from datetime import timedelta, datetime
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

# MinIO Configuration
MINIO_URL = os.getenv("MINIO_URL", "localhost:9000")
MINIO_USER = os.getenv("MINIO_ROOT_USER", "hve_admin")
MINIO_PASS = os.getenv("MINIO_ROOT_PASSWORD", "hve_password123")

# Bucket names
BRONZE_BUCKET = "hve-bronze"
SILVER_BUCKET = "hve-silver"
DLQ_BUCKET = "hve-dlq"
ICEBERG_BUCKET = "hve-iceberg"

# Initialize client
minio_client = Minio(
    MINIO_URL,
    access_key=MINIO_USER,
    secret_key=MINIO_PASS,
    secure=False  # Development environment
)

def ensure_buckets():
    """Create required buckets if they don't exist."""
    for bucket in [BRONZE_BUCKET, SILVER_BUCKET, DLQ_BUCKET, ICEBERG_BUCKET]:
        try:
            if not minio_client.bucket_exists(bucket):
                minio_client.make_bucket(bucket)
                logger.info(f"Created bucket: {bucket}")
        except S3Error as e:
            logger.warning(f"Bucket check/create for {bucket}: {e}")

def clear_all_buckets():
    """Wipes all data from Bronze, Silver, DLQ, and Iceberg buckets."""
    for bucket in [BRONZE_BUCKET, SILVER_BUCKET, DLQ_BUCKET, ICEBERG_BUCKET]:
        try:
            if minio_client.bucket_exists(bucket):
                objects = minio_client.list_objects(bucket, recursive=True)
                # Group deletes to avoid overhead if many objects exist
                for obj in objects:
                    minio_client.remove_object(bucket, obj.object_name)
                logger.info(f"Cleared bucket: {bucket}")
        except S3Error as e:
            logger.warning(f"Failed to clear bucket {bucket}: {e}")


# ============================================================
# PRE-SIGNED URL (Stage 1: Batch Upload Bypass)
# ============================================================

def generate_presigned_upload_url(source_id: str, filename: str) -> dict:
    """
    Generates a Pre-Signed URL for uploading directly to MinIO,
    entirely bypassing the API Gateway memory overhead.
    """
    target_path = f"batch/{source_id}/{filename}"
    expiration = timedelta(hours=1)
    
    try:
        url = minio_client.presigned_put_object(
            BRONZE_BUCKET,
            target_path,
            expires=expiration,
        )
        return {
            "upload_url": url,
            "target_path": f"{BRONZE_BUCKET}/{target_path}",
            "expires_in_seconds": int(expiration.total_seconds())
        }
    except S3Error as e:
        raise Exception(f"Failed to generate MinIO Pre-Signed URL: {e}")


# ============================================================
# BRONZE WRITES (Stage 2: Immutable Vault)
# ============================================================

def write_bronze_jsonl(source_id: str, records: list, batch_id: str) -> str:
    """
    Write a batch of JSON records as a compressed JSONL file to Bronze.
    Returns the MinIO object path.
    """
    now = datetime.utcnow()
    object_path = (
        f"streams/{source_id}/"
        f"year={now.year}/month={now.month:02d}/day={now.day:02d}/"
        f"{batch_id}.jsonl.gz"
    )
    
    # Build JSONL content
    lines = [json.dumps(record) + "\n" for record in records]
    content = "".join(lines).encode("utf-8")
    
    # Compress
    compressed = gzip.compress(content)
    data = io.BytesIO(compressed)
    
    try:
        minio_client.put_object(
            BRONZE_BUCKET,
            object_path,
            data,
            length=len(compressed),
            content_type="application/gzip"
        )
        logger.info(f"Bronze write: {BRONZE_BUCKET}/{object_path} ({len(records)} records)")
        return f"{BRONZE_BUCKET}/{object_path}"
    except S3Error as e:
        logger.error(f"Failed to write to Bronze: {e}")
        raise


def write_bronze_file(source_id: str, filename: str, file_data: bytes, content_type: str) -> str:
    """
    Write a static file directly to Bronze.
    Used for the upload-static endpoint.
    """
    now = datetime.utcnow()
    object_path = (
        f"batch/{source_id}/"
        f"year={now.year}/month={now.month:02d}/day={now.day:02d}/"
        f"{filename}"
    )
    
    data = io.BytesIO(file_data)
    try:
        minio_client.put_object(
            BRONZE_BUCKET,
            object_path,
            data,
            length=len(file_data),
            content_type=content_type
        )
        logger.info(f"Bronze file write: {BRONZE_BUCKET}/{object_path} ({len(file_data)} bytes)")
        return object_path
    except S3Error as e:
        logger.error(f"Failed to write file to Bronze: {e}")
        raise


# ============================================================
# SILVER WRITES (Stage 5: Clean Tables)
# ============================================================

def write_silver_parquet(source_id: str, parquet_bytes: bytes, batch_id: str) -> tuple:
    """
    Write a Parquet file to the Silver bucket.
    Returns (object_path, file_size).
    """
    object_path = f"{source_id}/{batch_id}.parquet"
    data = io.BytesIO(parquet_bytes)
    
    try:
        minio_client.put_object(
            SILVER_BUCKET,
            object_path,
            data,
            length=len(parquet_bytes),
            content_type="application/octet-stream"
        )
        logger.info(f"Silver write: {SILVER_BUCKET}/{object_path} ({len(parquet_bytes)} bytes)")
        return object_path, len(parquet_bytes)
    except S3Error as e:
        logger.error(f"Failed to write to Silver: {e}")
        raise


# ============================================================
# DLQ WRITES (Stage 4: Quarantine)
# ============================================================

def write_dlq(source_id: str, failed_records: list, batch_id: str) -> str:
    """Write quarantined records to the DLQ bucket."""
    object_path = f"{source_id}/{batch_id}.jsonl"
    content = "\n".join(json.dumps(r) for r in failed_records).encode("utf-8")
    data = io.BytesIO(content)
    
    try:
        minio_client.put_object(
            DLQ_BUCKET,
            object_path,
            data,
            length=len(content),
            content_type="application/jsonlines"
        )
        logger.info(f"DLQ write: {DLQ_BUCKET}/{object_path} ({len(failed_records)} records)")
        return f"{DLQ_BUCKET}/{object_path}"
    except S3Error as e:
        logger.error(f"Failed to write to DLQ: {e}")
        raise


# ============================================================
# READ OPERATIONS
# ============================================================

def read_object(bucket: str, object_path: str) -> bytes:
    """Read an object from MinIO and return its bytes."""
    try:
        response = minio_client.get_object(bucket, object_path)
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except S3Error as e:
        logger.error(f"Failed to read {bucket}/{object_path}: {e}")
        raise


def list_objects(bucket: str, prefix: str = "", recursive: bool = True) -> list:
    """List objects in a bucket with optional prefix filter."""
    try:
        objects = minio_client.list_objects(bucket, prefix=prefix, recursive=recursive)
        return [{"name": obj.object_name, "size": obj.size, "last_modified": str(obj.last_modified)} 
                for obj in objects]
    except S3Error as e:
        logger.error(f"Failed to list objects in {bucket}: {e}")
        raise


def list_silver_parquet_files(source_id: str) -> list:
    """List all Parquet files in Silver for a given source."""
    try:
        objects = minio_client.list_objects(SILVER_BUCKET, prefix=f"{source_id}/", recursive=True)
        return [obj.object_name for obj in objects if obj.object_name.endswith(".parquet")]
    except S3Error as e:
        logger.error(f"Failed to list Silver files for {source_id}: {e}")
        return []


# ============================================================
# SMART PEEK OPERATIONS
# ============================================================

def peek_latest_objects(bucket: str, source_id: str, limit: int = 5) -> list:
    """
    Finds the latest objects for a source and returns their raw records.
    Handles compression (.gz) and format (.jsonl).
    """
    try:
        # 1. Find latest files
        prefix = f"streams/{source_id}/" if bucket == BRONZE_BUCKET else f"{source_id}/"
        objects = minio_client.list_objects(bucket, prefix=prefix, recursive=True)
        
        # Sort by last_modified descending
        sorted_objs = sorted(objects, key=lambda x: x.last_modified, reverse=True)
        if not sorted_objs:
            return []
            
        records = []
        for obj in sorted_objs:
            # 2. Read object
            data = read_object(bucket, obj.object_name)
            
            # 3. Decompress if needed
            if obj.object_name.endswith(".gz"):
                data = gzip.decompress(data)
                
            # 4. Parse JSONL
            content = data.decode("utf-8")
            for line in content.splitlines():
                if line.strip():
                    records.append(json.loads(line))
                    if len(records) >= limit:
                        return records
        return records
    except Exception as e:
        logger.error(f"Failed to peek {bucket} for {source_id}: {e}")
        return []

# ============================================================
# CUSTOM USER SNAPSHOTS
# ============================================================

def write_custom_snapshot(table_name: str, snapshot_name: str, records: list) -> str:
    """
    Save a user-edited array of records as a manual snapshot.
    """
    now = datetime.utcnow()
    # Sanitize the name for MinIO
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in snapshot_name)
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    object_path = f"custom_snapshots/{table_name}/{timestamp}_{safe_name}.jsonl"
    
    lines = [json.dumps(record) + "\n" for record in records]
    content = "".join(lines).encode("utf-8")
    data = io.BytesIO(content)
    
    try:
        minio_client.put_object(
            SILVER_BUCKET,
            object_path,
            data,
            length=len(content),
            content_type="application/jsonlines",
            metadata={"is_manual_snapshot": "true"}
        )
        logger.info(f"Custom snapshot saved: {SILVER_BUCKET}/{object_path} ({len(records)} records)")
        return f"{SILVER_BUCKET}/{object_path}"
    except S3Error as e:
        logger.error(f"Failed to save custom snapshot to MinIO: {e}")
        raise

def list_custom_snapshots() -> list:
    """
    List all manual custom snapshots across all tables.
    Returns: [{"table_name": "...", "snapshot_name": "...", "path": "...", "timestamp": ...}]
    """
    try:
        objects = minio_client.list_objects(SILVER_BUCKET, prefix="custom_snapshots/", recursive=True)
        results = []
        for obj in objects:
            if not obj.object_name.endswith(".jsonl"):
                continue
            # Path structure: custom_snapshots/{table_name}/{timestamp}_{snapshot_name}.jsonl
            parts = obj.object_name.split("/")
            if len(parts) >= 3:
                table_name = parts[1]
                filename = parts[2].replace(".jsonl", "")
                
                # Try to extract the friendly name after the timestamp
                if "_" in filename:
                    snapshot_name = filename.split("_", 2)[-1]
                else:
                    snapshot_name = filename
                    
                results.append({
                    "table_name": table_name,
                    "snapshot_name": snapshot_name,
                    "path": obj.object_name,
                    "last_modified": str(obj.last_modified)
                })
        return results
    except S3Error as e:
        logger.error(f"Failed to list custom snapshots: {e}")
        return []

def update_custom_snapshot(object_path: str, data_rows: list):
    """
    Overwrites an existing custom manual snapshot in MinIO.
    """
    try:
        if not object_path.startswith("custom_snapshots/"):
            raise ValueError("Invalid path for custom snapshot update")
        jsonl_data = ""
        for row in data_rows:
            jsonl_data += json.dumps(row) + "\n"
        data_bytes = jsonl_data.encode("utf-8")
        minio_client.put_object(
            SILVER_BUCKET,
            object_path,
            data=io.BytesIO(data_bytes),
            length=len(data_bytes),
            content_type="application/jsonlines"
        )
        logger.info(f"Updated custom snapshot: {SILVER_BUCKET}/{object_path}")
        return object_path
    except Exception as e:
        logger.error(f"Failed to update custom snapshot {object_path}: {e}")
        raise

def delete_custom_snapshot(object_path: str):
    """
    Delete a specific manual custom snapshot.
    """
    try:
        if not object_path.startswith("custom_snapshots/"):
            raise ValueError("Invalid path for custom snapshot deletion")
        minio_client.remove_object(SILVER_BUCKET, object_path)
        logger.info(f"Deleted custom snapshot: {SILVER_BUCKET}/{object_path}")
    except S3Error as e:
        logger.error(f"Failed to delete custom snapshot {object_path}: {e}")
        raise
