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

from services import db_service, minio_service, iceberg_service
from services.minio_service import SILVER_BUCKET, MINIO_URL, MINIO_USER, MINIO_PASS, minio_client

logger = logging.getLogger(__name__)

# DuckDB in-memory instance
_conn = None
_registered_tables = set()
_registered_table_snapshots = {}
_registered_parquet_files = {}


def get_connection():
    """Get or create DuckDB connection."""
    global _conn
    if _conn is None:
        _conn = duckdb.connect(database=':memory:')
        logger.info("DuckDB query engine initialized.")
    return _conn


def _refresh_tables(sql_context: str = None):
    """
    Scan Silver bucket for Parquet files, download them, 
    and register as DuckDB views.
    Optional sql_context can be used to only refresh tables mentioned in the query.
    """
    global _registered_tables, _registered_table_snapshots, _registered_parquet_files
    conn = get_connection()

    try:
        silver_tables = db_service.get_silver_tables()
    except Exception as e:
        logger.warning(f"Could not fetch silver registry: {e}")
        silver_tables = []

    # 1. PURGE REMOVED TABLES (Synchronization)
    active_names = {t["table_name"] for t in silver_tables}
    for old_table in list(_registered_tables):
        if old_table not in active_names:
            try:
                conn.execute(f"DROP TABLE IF EXISTS \"{old_table}\"")
                _registered_tables.remove(old_table)
                _registered_table_snapshots.pop(old_table, None)
                _registered_parquet_files.pop(old_table, None)
                logger.info(f"Purged from DuckDB (deleted in registry): {old_table}")
            except Exception as e:
                logger.error(f"Failed to purge {old_table} from memory: {e}")

    for table_info in silver_tables:
        table_name = table_info["table_name"]
        
        # Performance Optimization: Only refresh if the table is actually in the SQL query
        # (Or if no query context is provided, refresh everything)
        if sql_context and table_name.lower() not in sql_context.lower():
            continue
        
        try:
            # ── TRY ICEBERG FIRST ──
            # Load Iceberg REST catalog dynamically to check latest snapshots
            catalog = iceberg_service.get_catalog()
            table_identifier = f"{iceberg_service.ICEBERG_NAMESPACE}.{table_name}"
            
            try:
                table = catalog.load_table(table_identifier)
                history = table.history()
                latest_snap_id = history[-1].snapshot_id if history else None
            except Exception as ie_load:
                # If table does not exist or has no history, raise to fallback to legacy parquet
                raise ie_load

            # Performance Optimization: Skip scanning if already registered and up-to-date
            if table_name in _registered_tables and _registered_table_snapshots.get(table_name) == latest_snap_id:
                continue

            arrow_table = table.scan().to_arrow()
            conn.execute(f"DROP TABLE IF EXISTS \"{table_name}\"")
            conn.execute(f"CREATE TABLE \"{table_name}\" AS SELECT * FROM arrow_table")
            _registered_tables.add(table_name)
            _registered_table_snapshots[table_name] = latest_snap_id
            logger.info(f"Registered DuckDB table from Iceberg: {table_name} ({arrow_table.num_rows} rows), snapshot {latest_snap_id}")
            continue  # Skip Parquet fallback
        except Exception as ie:
            logger.debug(f"Not an Iceberg table or load failed for {table_name}: {ie}. Falling back to Parquet.")
            pass

        # ── LEGACY PARQUET FALLBACK ──
        # List all parquet files for this source in Silver
        parquet_files = minio_service.list_silver_parquet_files(table_name)
        
        if not parquet_files:
            continue

        # Performance Optimization: Skip re-registering if already registered and files are identical
        if table_name in _registered_tables and _registered_parquet_files.get(table_name) == parquet_files:
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
                _registered_parquet_files[table_name] = parquet_files
                logger.info(f"Registered DuckDB table: {table_name} ({combined.num_rows} rows from {len(parquet_files)} files)")

        except Exception as e:
            logger.error(f"Failed to register table {table_name}: {e}")


def execute_query(sql: str, limit: int = 1000) -> dict:
    """
    Execute a SQL query against Silver layer tables.
    Auto-refreshes table registrations before querying.
    """
    start_time = time.time()
    
    # Refresh ONLY the tables needed for this query to pick up new data
    _refresh_tables(sql_context=sql)
    
    conn = get_connection()
    
    # Execute the raw SQL exactly as provided by the user
    sql_clean = sql.strip().rstrip(';')
    
    try:
        result = conn.execute(sql_clean)
        columns = [desc[0] for desc in result.description]
        
        # Fetch only up to the safety limit to prevent OOM
        rows = result.fetchmany(limit)
        
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


def execute_time_travel_query(sql: str, snapshot_id: int, limit: int = 1000) -> dict:
    """Execute SQL exactly as it was at a specific Iceberg snapshot_id."""
    start_time = time.time()
    conn = get_connection()
    
    # We need to find which table to load. Basic inference from FROM clause or just load all related sources at that snapshot.
    # A robust way is scanning text for table names from silver_registry, but for simplicity let's rely on the user to use "FROM <table>".
    silver_tables = db_service.get_silver_tables()
    for t in silver_tables:
        table_name = t["table_name"]
        if table_name.lower() in sql.lower():
            try:
                arrow_table = iceberg_service.scan_as_of(table_name, snapshot_id)
                # Register as a temporary snapshot table to avoid polluting the latest
                tmp_name = f"{table_name}_snap_{snapshot_id}"
                conn.execute(f"DROP TABLE IF EXISTS \"{tmp_name}\"")
                conn.execute(f"CREATE TABLE \"{tmp_name}\" AS SELECT * FROM arrow_table")
                # Mutate SQL to use the temp table
                sql = sql.replace(table_name, f"\"{tmp_name}\"")
            except Exception as e:
                logger.error(f"Failed to load snapshot {snapshot_id} for table {table_name}: {e}")

    # Apply limit
    sql_clean = sql.strip().rstrip(';')
    if "LIMIT" not in sql_clean.upper():
        sql_clean = f"{sql_clean} LIMIT {limit}"
    
    try:
        result = conn.execute(sql_clean)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        
        row_dicts = []
        for row in rows:
            row_dict = {}
            for i, col in enumerate(columns):
                val = row[i]
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
        logger.error(f"Time travel query execution failed: {e}")
        raise ValueError(f"Time travel query failed: {str(e)}")




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
                "table_schema": t.get("schema_json"),
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
    global _conn, _registered_tables, _registered_table_snapshots, _registered_parquet_files
    if _conn:
        _conn.close()
        _conn = None
        _registered_tables.clear()
        _registered_table_snapshots.clear()
        _registered_parquet_files.clear()
        logger.info("DuckDB connection closed.")
