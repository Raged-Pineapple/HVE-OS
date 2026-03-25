from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import duckdb
import os
import json

router = APIRouter()

class FlightQuery(BaseModel):
    min_altitude: Optional[float] = None
    max_altitude: Optional[float] = None
    origin_country: Optional[str] = None
    on_ground: Optional[bool] = None
    callsign: Optional[str] = None
    limit: int = 100

@router.post("/flights/filter")
async def filter_flight_radar(query: FlightQuery):
    """
    Query the massive OpenSky Parquet Delta Lake natively via DuckDB.
    Runs at memory-speed directly against the immutable files.
    """
    parquet_path = "D:/HVE_OS/datalake/raw/source=OPENSKY_NETWORK/**/*.parquet"
    
    # Check if any files exist yet to prevent DuckDB throwing a FileNotFoundError
    if not os.path.exists("D:/HVE_OS/datalake/raw/source=OPENSKY_NETWORK"):
        return {"flights": [], "message": "No radar data materialized in the Delta Lake yet."}

    # Base SQL Query
    # DuckDB's magic: We natively extract JSON keys dynamically from the 'payload' struct
    sql = f"""
        SELECT 
            payload.icao24 as icao24,
            payload.callsign as callsign,
            payload.origin_country as origin_country,
            payload.longitude as longitude,
            payload.latitude as latitude,
            payload.baro_altitude as altitude,
            payload.velocity as velocity,
            payload.true_track as heading,
            payload.on_ground as on_ground,
            source_ts
        FROM parquet_scan('{parquet_path}')
        WHERE 1=1
    """
    
    # Dynamically inject filters (DuckDB allows standard string filtering against Parquet Structs)
    if query.min_altitude is not None:
        sql += f" AND payload.baro_altitude >= {query.min_altitude}"
    if query.max_altitude is not None:
        sql += f" AND payload.baro_altitude <= {query.max_altitude}"
    if query.origin_country:
        sql += f" AND payload.origin_country = '{query.origin_country}'"
    if query.on_ground is not None:
        sql += f" AND payload.on_ground = {str(query.on_ground).lower()}"
    if query.callsign:
        # standard LIKE operator for partial matching
        sql += f" AND payload.callsign LIKE '%{query.callsign}%'"
        
    sql += f" ORDER BY source_ts DESC LIMIT {query.limit}"
    
    try:
        # Execute query and convert to Pandas DataFrame -> JSON dict
        df = duckdb.query(sql).to_df()
        
        # We drop any nulls created by pandas for JSON serialization
        results = json.loads(df.to_json(orient="records"))
        return {
            "total_matches_returned": len(results),
            "flights": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DuckDB Query Failed: {str(e)}")
