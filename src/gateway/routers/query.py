"""
query.py — SQL Query Router for the Silver Layer
Enables SQL queries against clean Parquet tables in MinIO.
"""
from fastapi import APIRouter, HTTPException
from typing import List
from models import QueryRequest, QueryResponse, SilverTableInfo
from services import query_service

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
    Execute a SQL query against Silver layer tables.
    
    Examples:
    - `SELECT * FROM opensky_data LIMIT 100`
    - `SELECT icao24, altitude FROM opensky_data WHERE altitude > 1000`
    - `SELECT COUNT(*) as total FROM test_sensor`
    
    Table names are automatically resolved to MinIO Parquet paths.
    """
    try:
        result = query_service.execute_query(request.sql, limit=request.limit)
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
