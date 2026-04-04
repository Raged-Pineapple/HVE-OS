"""
query_service.py — DuckDB Query Engine over MinIO Silver Layer
Enables SQL queries against Parquet files stored in MinIO.

Uses a hybrid approach: reads Parquet files from MinIO into DuckDB 
as registered views for reliable local querying.
"""
import os
import io
import time
import logging
import tempfile
import duckdb

from services import db_service, minio_service
from services.minio_service import SILVER_BUCKET, MINIO_URL, MINIO_USER, MINIO_PASS, minio_client

logger = logging.getLogger(__name__)

# DuckDB in-memory instance
_conn = None
_registered_tables = set()


def get_connection():
    """Get or create DuckDB connection."""
    global _conn
    if _conn is None:
        _conn = duckdb.connect(database=':memory:')
        logger.info("DuckDB query engine initialized.")
    return _conn


def _refresh_tables():
    """
    Scan Silver bucket for Parquet files, download them, 
    and register as DuckDB views.
    """
    global _registered_tables
    conn = get_connection()

    try:
        silver_tables = db_service.get_silver_tables()
    except Exception as e:
        logger.warning(f"Could not fetch silver registry: {e}")
        silver_tables = []

    for table_info in silver_tables:
        table_name = table_info["table_name"]
        
        # List all parquet files for this source in Silver
        parquet_files = minio_service.list_silver_parquet_files(table_name)
        
        if not parquet_files:
            continue

        try:
            # Read all parquet files for this table
            all_frames = []
            import pyarrow.parquet as pq
            import pyarrow as pa

            for pf in parquet_files:
                data = minio_service.read_object(SILVER_BUCKET, pf)
                buf = io.BytesIO(data)
                arrow_table = pq.read_table(buf)
                all_frames.append(arrow_table)

            if all_frames:
                # Concatenate all parquet files
                combined = pa.concat_tables(all_frames, promote_options="default")
                
                # Register as a DuckDB table (replaces if exists)
                conn.execute(f"DROP TABLE IF EXISTS \"{table_name}\"")
                conn.execute(f"CREATE TABLE \"{table_name}\" AS SELECT * FROM combined")
                _registered_tables.add(table_name)
                logger.info(f"Registered DuckDB table: {table_name} ({combined.num_rows} rows from {len(parquet_files)} files)")

        except Exception as e:
            logger.error(f"Failed to register table {table_name}: {e}")


def execute_query(sql: str, limit: int = 1000) -> dict:
    """
    Execute a SQL query against Silver layer tables.
    Auto-refreshes table registrations before querying.
    """
    start_time = time.time()
    
    # Refresh tables to pick up new data
    _refresh_tables()
    
    conn = get_connection()
    
    # Apply limit if not already present
    sql_clean = sql.strip().rstrip(';')
    if "LIMIT" not in sql_clean.upper():
        sql_clean = f"{sql_clean} LIMIT {limit}"
    
    try:
        result = conn.execute(sql_clean)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        
        # Convert to list of dicts
        row_dicts = []
        for row in rows:
            row_dict = {}
            for i, col in enumerate(columns):
                val = row[i]
                # Handle non-serializable types
                if hasattr(val, 'isoformat'):
                    val = val.isoformat()
                elif isinstance(val, bytes):
                    val = val.decode('utf-8', errors='replace')
                elif val is not None and not isinstance(val, (str, int, float, bool)):
                    val = str(val)
                row_dict[col] = val
            row_dicts.append(row_dict)
        
        execution_time = (time.time() - start_time) * 1000
        
        return {
            "columns": columns,
            "rows": row_dicts,
            "row_count": len(row_dicts),
            "execution_time_ms": round(execution_time, 2)
        }
    
    except Exception as e:
        logger.error(f"Query execution failed: {e}")
        raise ValueError(f"Query failed: {str(e)}")


def get_table_info() -> list:
    """Get information about all available Silver tables."""
    try:
        tables = db_service.get_silver_tables()
        result = []
        for t in tables:
            info = {
                "table_name": t["table_name"],
                "source_id": t.get("source_id"),
                "minio_path": t["minio_path"],
                "row_count": t.get("row_count", 0),
                "file_count": t.get("file_count", 0),
                "total_size_bytes": t.get("total_size_bytes", 0),
                "schema_json": t.get("schema_json"),
                "source_description": t.get("source_description"),
                "created_at": str(t["created_at"]) if t.get("created_at") else None,
                "updated_at": str(t["updated_at"]) if t.get("updated_at") else None,
            }
            result.append(info)
        return result
    except Exception as e:
        logger.error(f"Failed to get table info: {e}")
        return []


def preview_table(table_name: str, limit: int = 10) -> dict:
    """Quick preview of a Silver table."""
    return execute_query(f'SELECT * FROM "{table_name}"', limit=limit)


def close_connection():
    """Close the DuckDB connection."""
    global _conn, _registered_tables
    if _conn:
        _conn.close()
        _conn = None
        _registered_tables.clear()
        logger.info("DuckDB connection closed.")
