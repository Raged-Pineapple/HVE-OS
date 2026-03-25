import hashlib
import os
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.static_ingest import StaticSourceFile
from uuid import uuid4

class FileReceptionService:
    def __init__(self, upload_dir="D:/HVE_OS/datalake/landing_zone"):
        self.upload_dir = upload_dir
        os.makedirs(self.upload_dir, exist_ok=True)
        
    async def receive_file(self, file: UploadFile, db: AsyncSession) -> dict:
        """
        Stage 1: File Reception & O(1) Duplicate Hash Detection.
        Safely streams massive files to the landing zone disk while hashing.
        """
        # Read first 4KB for Format Sniffing later
        head = await file.read(4096)
        await file.seek(0)
        
        # Calculate full hash and size safely via streaming
        sha256 = hashlib.sha256()
        size_bytes = 0
        while chunk := await file.read(8192):
            sha256.update(chunk)
            size_bytes += len(chunk)
        await file.seek(0) # Reset pointer so format parsers can read it
        
        file_hash = sha256.hexdigest()
        
        # O(1) Deduplication Check
        result = await db.execute(select(StaticSourceFile).where(StaticSourceFile.file_hash == file_hash))
        existing = result.scalars().first()
        if existing:
            return {
                "status": "duplicate",
                "message": f"This file was already imported on {existing.uploaded_at}",
                "file_id": existing.id,
                "head": head
            }
            
        # Store to Disk Landing Zone Safely
        file_id = str(uuid4())
        safe_path = os.path.join(self.upload_dir, f"{file_id}_{file.filename}")
        with open(safe_path, "wb") as f:
            while chunk := await file.read(8192):
                f.write(chunk)
                
        # Register in Database
        db_file = StaticSourceFile(
            id=file_id,
            filename=file.filename,
            file_hash=file_hash,
            size_bytes=size_bytes,
            status="received"
        )
        db.add(db_file)
        await db.commit()
        await db.refresh(db_file)
        
        return {
            "status": "received",
            "file_id": file_id,
            "filepath": safe_path,
            "head": head
        }

reception_service = FileReceptionService()
