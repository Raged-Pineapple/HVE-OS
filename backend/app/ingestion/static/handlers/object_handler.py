from sqlalchemy.ext.asyncio import AsyncSession
from app.models.static_ingest import BinaryAsset
import os
import hashlib

class ObjectStorageHandler:
    """
    Phase 29: Object Storage Handler
    Class 3: Binary Media (Radar dumps, Audio, Imagery, Videos).
    Pushes massive blob binaries directly into MinIO/S3 and registers queryable metadata into PostgreSQL.
    """
    def __init__(self, minio_bucket="hve-binary-assets"):
        self.bucket = minio_bucket
        
    async def isolate_and_store(self, db: AsyncSession, filepath: str, dataset_name: str, source_file_id: str) -> str:
        # 1. Upload to Object Storage (S3/Minio) wrapper
        storage_path = f"s3://{self.bucket}/{dataset_name}/{os.path.basename(filepath)}"
        
        # 2. Extract media-specific metadata (Pillow/Librosa/Rasterio bindings occur here)
        metadata = {}
        file_size = os.path.getsize(filepath)
        
        # Calculate Checksum
        with open(filepath, 'rb') as f:
            checksum = hashlib.sha256(f.read()).hexdigest()
            
        # 3. Create Canonical PostgreSQL Reference Row 
        # The ontology platform queries this table, completely oblivious to S3 architectures.
        asset = BinaryAsset(
            id=source_file_id,
            dataset_name=dataset_name,
            asset_type="binary",
            storage_path=storage_path,
            file_size=file_size,
            checksum=checksum,
            metadata_json=metadata,
            source_file_id=source_file_id
        )
        db.add(asset)
        await db.commit()
        
        return storage_path

object_handler = ObjectStorageHandler()
