from sqlalchemy import Column, String, DateTime, BigInteger, JSON, Boolean, ForeignKey, Integer
from sqlalchemy.sql import func
import uuid
from app.db.session import Base

class StaticSourceFile(Base):
    __tablename__ = "static_source_files"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    file_hash = Column(String, nullable=False, unique=True, index=True)
    size_bytes = Column(BigInteger, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String, default="received") 

class StaticDataset(Base):
    __tablename__ = "static_datasets"
    id = Column(String, primary_key=True) # e.g. "india_airports"
    display_name = Column(String)
    data_class = Column(String) # "tabular" | "document" | "binary" | "timeseries"
    storage_backend = Column(String) # "postgres" | "jsonb" | "minio" | "timescale"
    storage_ref = Column(String) # table name OR MinIO path OR collection
    row_count = Column(BigInteger, default=0)
    schema_dump = Column(JSON, nullable=True) # Null for binary classes
    pk_column = Column(String, nullable=True) # Null for binary/document classes
    has_geometry = Column(Boolean, default=False)
    geometry_type = Column(String, nullable=True)
    source_file_id = Column(String, ForeignKey("static_source_files.id"))
    version = Column(Integer, default=1)
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

class BinaryAsset(Base):
    __tablename__ = "binary_assets"
    id = Column(String, primary_key=True)
    dataset_name = Column(String, nullable=False, index=True)
    asset_type = Column(String, default="unknown") # audio, image, radar_dump, binary
    storage_path = Column(String, nullable=False) # MinIO bucket + key
    file_size = Column(BigInteger)
    mime_type = Column(String, nullable=True)
    checksum = Column(String, nullable=True)
    metadata_json = Column(JSON, nullable=True) # extracted tags: duration, dimensions, bit depth
    source_file_id = Column(String, ForeignKey("static_source_files.id"))
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

class DocumentText(Base):
    __tablename__ = "document_text"
    id = Column(String, primary_key=True)
    dataset_name = Column(String, nullable=False, index=True)
    content = Column(String) # Raw extracted text for full-text NLP indexing (pg_trgm or direct search)
    source_file_id = Column(String, ForeignKey("static_source_files.id"))
    imported_at = Column(DateTime(timezone=True), server_default=func.now())

class DocumentMetadata(Base):
    __tablename__ = "document_metadata"
    id = Column(String, primary_key=True)
    dataset_name = Column(String, nullable=False)
    page_count = Column(Integer, nullable=True)
    detected_language = Column(String, nullable=True)
    extracted_dates = Column(JSON, nullable=True)
    document_text_id = Column(String, ForeignKey("document_text.id"))

class SchemaFingerprint(Base):
    __tablename__ = "schema_fingerprints"
    id = Column(Integer, primary_key=True, autoincrement=True)
    fingerprint = Column(String, unique=True, index=True)
    dataset_id = Column(String, ForeignKey("static_datasets.id"))
    
class StaticDatasetHistory(Base):
    __tablename__ = "static_dataset_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    dataset_name = Column(String, nullable=False, index=True)
    pk_value = Column(String, nullable=False, index=True)
    data = Column(JSON, nullable=False)
    valid_from = Column(DateTime(timezone=True), nullable=False)
    valid_to = Column(DateTime(timezone=True), nullable=False)
