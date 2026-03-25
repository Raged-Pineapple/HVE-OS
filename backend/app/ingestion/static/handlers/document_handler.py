from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.models.static_ingest import StaticDataset, DocumentText, DocumentMetadata
import json

class DocumentHandler:
    """
    Phase 29: Document Handler
    Class 2: Unstructured Documents (JSONB arrays, dicts, PDFs, Word).
    Avoids rigid row/column tables entirely on favor of Schema-Free PostgreSQL JSONB 
    and Full-Text Search models.
    """
    async def materialise_document(self, db: AsyncSession, dataset_name: str, raw_content, source_file_id: str):
        # 1. Native JSONB Postgres Table structure
        table_name = f"doc_{dataset_name}"
        create_sql = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id SERIAL PRIMARY KEY,
            source_file_id VARCHAR,
            content JSONB,
            imported_at TIMESTAMP DEFAULT NOW()
        );
        """
        await db.execute(text(create_sql))
        
        # 2. In Production: Insert unstructured dicts into JSONB natively (schema-free)
        # await db.execute(text(f"INSERT INTO {table_name} (source_file_id, content) VALUES (:s, :c)"), {"s": source_file_id, "c": json.dumps(raw_content)})
        
        # 3. For PDF/HTML NLP indexing, text extraction layers (pdfplumber/beautifulsoup) 
        # would write directly to the `document_text` full-text search index here.
        
        await db.commit()
        return table_name

document_handler = DocumentHandler()
