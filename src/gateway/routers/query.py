"""
query.py — SQL Query Router for the Silver Layer
Enables SQL queries against clean Parquet tables in MinIO.
"""
from fastapi import APIRouter, HTTPException
from typing import List
from models import QueryRequest, QueryResponse, SilverTableInfo, TimeTravelQueryRequest, SnapshotInfo
from services import query_service, iceberg_service

router = APIRouter(prefix="/api/v1", tags=["Query Engine"])


@router.get("/silver/tables", response_model=List[SilverTableInfo])
async def list_silver_tables():
    """
    List all available Silver tables that can be queried.
    These are clean, validated Parquet tables ready for analytics.
    """
    try:
        tables = query_service.get_table_info()
        return tables
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest):
    """
    **Query the Data Lakehouse (The DuckDB Engine)**
    
    This is the core analytical endpoint of HVE-OS. It allows you to execute standard SQL queries directly against the highly-optimized Apache Iceberg/Parquet tables residing in MinIO. 
    
    You do NOT need to establish database connections or write SQLAlchemy models. You just send raw SQL.
    
    ### 📝 Parameters & Tutorial
    * **`sql`** *(string)*: The full SQL query string. 
        * Table names are identically mapped to the `source_id` you registered. If your source was `osm_military_bases`, your SQL is `SELECT * FROM osm_military_bases`.
        * *Examples:* 
            * `SELECT * FROM opensky_network LIMIT 100`
            * `SELECT icao24, altitude FROM opensky_network WHERE altitude > 1000`
            * `SELECT base_name, latitude, longitude FROM context_military_bases_v2`
    * **`limit`** *(integer)*: A hard safety limit on the number of rows returned by the API (Max: 100,000). To prevent crashing your browser or app, this defaults to exactly 1,000 rows.
    
    ### ⚡ How it works
    The API Gateway instantiates a high-speed DuckDB memory analytical engine, resolves the Iceberg catalog dynamically against the PostgreSQL control plane, and reads the binary columnar data directly from MinIO object storage over the network, rendering a JSON response in milliseconds.
    """
    try:
        result = query_service.execute_query(request.sql)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query execution error: {str(e)}")


@router.get("/silver/tables/{table_name}/preview")
async def preview_table(table_name: str, limit: int = 10):
    """
    Quick preview of a Silver table's data.
    Returns the first N rows.
    """
    try:
        result = query_service.preview_table(table_name, limit=limit)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/iceberg/{table_name}/snapshots", response_model=List[SnapshotInfo])
async def list_table_snapshots(table_name: str):
    """
    **List Table Transaction History**
    
    Because HVE-OS uses Apache Iceberg, every ingestion batch creates an immutable snapshot. This endpoint lists all historical snapshots for a single table. You can use these `snapshot_id`s in the Time Travel endpoint to query the data exactly as it existed at that millisecond.
    """
    try:
        # Check iceberg history
        history = iceberg_service.get_snapshots(table_name)
        # Also query the pg tracking log for context
        with query_service.db_service.get_cursor() as cur:
            cur.execute("""
                SELECT snapshot_id, committed_at 
                FROM iceberg_snapshot_log 
                WHERE table_name = %s 
                ORDER BY snapshot_id DESC
            """, (f"hve_silver.{table_name}",))
            pg_log = {r['snapshot_id']: str(r['committed_at']) for r in cur.fetchall()}

        result = []
        for snap in history:
            result.append(SnapshotInfo(
                snapshot_id=snap["snapshot_id"],
                timestamp_ms=snap["timestamp_ms"],
                committed_at=pg_log.get(snap["snapshot_id"], "Unknown (not in pg log)")
            ))
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query/time-travel", response_model=QueryResponse)
async def execute_time_travel_query(request: TimeTravelQueryRequest):
    """
    **Execute a Time-Travel SQL Query (Iceberg Exclusive)**
    
    This is one of the most powerful features of the architecture. Because HVE-OS writes data as atomic Apache Iceberg snapshots, the database theoretically never forgets.
    
    If you pass a standard SQL query along with a specific historical `snapshot_id`, the analytical engine will completely ignore all data appended, deleted, or mutated *after* that snapshot. It mathematically reconstructs the state of the database exactly as it was at that specific split-second in history.
    
    ### 📝 Parameters & Tutorial
    1. First, use `GET /api/v1/iceberg/{table_name}/snapshots` to fetch the chronological list of snapshot IDs for your table.
    2. Pick an older `snapshot_id` (e.g. `6480482424800937643`).
    3. Construct your payload here:
    
    * **`sql`** *(string)*: Standard SQL (e.g. `SELECT * FROM opensky_network`).
    * **`snapshot_id`** *(integer)*: The exact ID copied from step 1.
    * **`limit`** *(integer)*: A safety limit on rows returned.
    
    ### 🎯 Use Case
    If yesterday your ML pipeline trained perfectly, but today it is throwing errors, you can use Time Travel to query the data exactly as it looked yesterday to debug the diff, without keeping a separate database backup!
    """
    try:
        if request.snapshot_id is None:
            raise ValueError("snapshot_id must be provided for time travel queries.")
        result = query_service.execute_time_travel_query(request.sql, request.snapshot_id, limit=request.limit)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Time travel query error: {str(e)}")
