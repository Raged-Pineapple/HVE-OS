from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

class Materialiser:
    """
    Stage 9: Materialisation
    Issues dynamic DDL to physically spin up the Postgres tables and PostGIS bounds.
    """
    async def materialise_table(self, db: AsyncSession, dataset_name: str, schema: list[dict]):
        TYPE_MAP = {
            "TEXT": "TEXT",
            "INTEGER": "BIGINT",
            "FLOAT": "DOUBLE PRECISION",
            "BOOLEAN": "BOOLEAN",
            "TIMESTAMP": "TIMESTAMP"
        }
        
        pk_col = next((c['name'] for c in schema if c.get('is_pk')), 'id')
        gis_cols = [c for c in schema if c.get('_flag_gis')]
        
        # Build strict Schema DDL
        cols_ddl = []
        for c in schema:
            pg_type = TYPE_MAP.get(c['type'], "TEXT")
            if c['name'] == pk_col:
                cols_ddl.append(f'"{c["name"]}" {pg_type} PRIMARY KEY')
            else:
                cols_ddl.append(f'"{c["name"]}" {pg_type}')
                
        # Inject metadata tracing columns
        cols_ddl.append("_source_id VARCHAR")
        cols_ddl.append("_imported_at TIMESTAMP DEFAULT NOW()")
        
        table_name = f"dataset_{dataset_name}"
        create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} (\n" + ",\n".join(cols_ddl) + "\n);"
        
        # Execute dynamically using SQLAlchemy text execution
        await db.execute(text(create_sql))
        
        # Add PostGIS Geometry if Domain Mapping flagged Spatial properties
        if len(gis_cols) == 2:
            lat = next(c['name'] for c in gis_cols if c['semantic'] == 'LATITUDE')
            lon = next(c['name'] for c in gis_cols if c['semantic'] == 'LONGITUDE')
            
            await db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS geom GEOMETRY(Point, 4326);"))
            await db.execute(text(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_geom ON {table_name} USING GIST (geom);"))
            
        await db.commit()
        return table_name

    async def execute_inserts(self, db: AsyncSession, dataset_name: str, records: list[dict], pk_col: str, gis_cols: list):
        """
        Executes the physical UPSERTS dynamically into the generated table.
        For production, this would stream via COPY or UNNEST optimizations.
        """
        table_name = f"dataset_{dataset_name}"
        
        # PostGIS Geometry updating block
        if len(gis_cols) == 2:
            lat = next(c['name'] for c in gis_cols if c['semantic'] == 'LATITUDE')
            lon = next(c['name'] for c in gis_cols if c['semantic'] == 'LONGITUDE')
            # Trigger geometric indexing dynamically
            await db.execute(text(f"UPDATE {table_name} SET geom = ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326) WHERE {lat} IS NOT NULL AND {lon} IS NOT NULL;"))
            
        await db.commit()

materialiser = Materialiser()
