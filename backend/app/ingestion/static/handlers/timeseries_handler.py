from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

class TimeseriesHandler:
    """
    Phase 29: Timeseries Handler
    Class 4: High-frequency Timestamp data streams.
    Transforms standard schema DDL into TimescaleDB optimizations (`create_hypertable`).
    """
    async def materialise_hypertable(self, db: AsyncSession, dataset_name: str, schema: list[dict]):
        TYPE_MAP = {"TEXT": "TEXT", "INTEGER": "BIGINT", "FLOAT": "DOUBLE PRECISION", "BOOLEAN": "BOOLEAN", "TIMESTAMP": "TIMESTAMPTZ"}
        
        # 1. Isolate primary time column
        time_col = next((c['name'] for c in schema if c.get('type') == 'TIMESTAMP'), None)
        if not time_col:
            raise ValueError("Timeseries Hypertable Handler requires a valid TIMESTAMP column.")
            
        # 2. Build DDL Base
        cols_ddl = []
        for c in schema:
            pg_type = TYPE_MAP.get(c['type'], "TEXT")
            cols_ddl.append(f'"{c["name"]}" {pg_type}')
            
        cols_ddl.append("_source_id VARCHAR")
        cols_ddl.append("_imported_at TIMESTAMPTZ DEFAULT NOW()")
        
        table_name = f"ts_{dataset_name}"
        create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} (\n" + ",\n".join(cols_ddl) + "\n);"
        await db.execute(text(create_sql))
        
        # 3. TimescaleDB MAGIC: Convert to Hypertable partitioned automatically by time_col chunking.
        hypertable_sql = f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM _timescaledb_catalog.hypertable WHERE table_name = '{table_name}') THEN
                PERFORM create_hypertable('{table_name}', '{time_col}', if_not_exists => TRUE);
            END IF;
        END
        $$;
        """
        try:
            await db.execute(text(hypertable_sql))
        except Exception as e:
            # Standby fallback to static BRIN/B-Tree indices if TimescaleDB extension isn't loaded on the PG instance.
            await db.execute(text(f"CREATE INDEX IF NOT EXISTS idx_{table_name}_time ON {table_name} (\"{time_col}\" DESC);"))
            
        await db.commit()
        return table_name

timeseries_handler = TimeseriesHandler()
