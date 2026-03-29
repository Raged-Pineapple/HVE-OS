import os
from datetime import timedelta
from minio import Minio
from minio.error import S3Error

# Ensure environment variables or fallbacks
MINIO_URL = os.getenv("MINIO_URL", "localhost:9000")
MINIO_USER = os.getenv("MINIO_ROOT_USER", "hve_admin")
MINIO_PASS = os.getenv("MINIO_ROOT_PASSWORD", "hve_password123")

# Initialize client
minio_client = Minio(
    MINIO_URL,
    access_key=MINIO_USER,
    secret_key=MINIO_PASS,
    secure=False  # Development environment
)

def generate_presigned_upload_url(source_id: str, filename: str) -> dict:
    """
    Generates a Pre-Signed URL for uploading directly to MinIO,
    entirely bypassing the API Gateway memory overhead.
    """
    bucket_name = "bronze"
    target_path = f"batch/{source_id}/{filename}"
    expiration = timedelta(hours=1)
    
    try:
        url = minio_client.presigned_put_object(
            bucket_name,
            target_path,
            expires=expiration,
        )
        return {
            "upload_url": url,
            "target_path": f"{bucket_name}/{target_path}",
            "expires_in_seconds": int(expiration.total_seconds())
        }
    except S3Error as e:
        raise Exception(f"Failed to generate Minio Pre-Signed URL: {e}")
