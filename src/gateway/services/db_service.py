"""
db_service.py — PostgreSQL Connection Pool & CRUD Operations
The "Brain" of HVE-OS. All dynamic configurations live here.
"""
import os
import json
import logging
from contextlib import contextmanager
from datetime import datetime
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# Database configuration
DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB", "hve_control_plane"),
    "user": os.getenv("POSTGRES_USER", "hve_admin"),
    "password": os.getenv("POSTGRES_PASSWORD", "hve_password123"),
}

# Connection pool (lazy initialized)
_pool = None

def get_pool():
    """Get or create the connection pool."""
    global _pool
    if _pool is None or _pool.closed:
        _pool = ThreadedConnectionPool(
            minconn=2,
            maxconn=20,
            **DB_CONFIG
        )
        logger.info("PostgreSQL connection pool created.")
    return _pool

@contextmanager
def get_connection():
    """Context manager for getting a pooled connection."""
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)

@contextmanager
def get_cursor(dict_cursor=True):
    """Context manager for getting a cursor from a pooled connection."""
    with get_connection() as conn:
        cursor_factory = RealDictCursor if dict_cursor else None
        cursor = conn.cursor(cursor_factory=cursor_factory)
        try:
            yield cursor
        finally:
            cursor.close()

def close_pool():
    """Close the connection pool gracefully."""
    global _pool
    if _pool and not _pool.closed:
        _pool.closeall()
        logger.info("PostgreSQL connection pool closed.")

def ensure_graph_tables():
    """Create Stage 5 tables if they don't exist."""
    with get_cursor(dict_cursor=False) as cur:
        # graph_blueprints
        cur.execute("""
            CREATE TABLE IF NOT EXISTS graph_blueprints (
                source_id VARCHAR(255) PRIMARY KEY REFERENCES source_registry(source_id) ON DELETE CASCADE,
                cypher_template TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # gold_registry
        cur.execute("""
            CREATE TABLE IF NOT EXISTS gold_registry (
                source_id VARCHAR(255) PRIMARY KEY REFERENCES source_registry(source_id) ON DELETE CASCADE,
                node_count BIGINT DEFAULT 0,
                last_snapshot_id BIGINT,
                status VARCHAR(50) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # mapping_script column migration (idempotent)
        cur.execute("""
            ALTER TABLE source_registry 
            ADD COLUMN IF NOT EXISTS mapping_script TEXT DEFAULT NULL
        """)
        # iceberg_snapshot_log
        cur.execute("""
            CREATE TABLE IF NOT EXISTS iceberg_snapshot_log (
                log_id SERIAL PRIMARY KEY,
                table_name VARCHAR(255) NOT NULL,
                source_id VARCHAR(255),
                snapshot_id BIGINT NOT NULL,
                operation VARCHAR(50),
                records_added INT,
                committed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Migration: add committed_at if missing from old schema
        cur.execute("""
            ALTER TABLE iceberg_snapshot_log
            ADD COLUMN IF NOT EXISTS committed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        """)
        logger.info("Checked/Created Stage 5 Gold Graph tables + mapping_script column + iceberg log.")

# ============================================================
# SOURCE REGISTRY CRUD
# ============================================================

def register_source(source_id: str, source_type: str, protocol: str, description: str = None) -> dict:
    """Register a new data source."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO source_registry (source_id, source_type, protocol, description)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (source_id) DO UPDATE SET
                source_type = EXCLUDED.source_type,
                protocol = EXCLUDED.protocol,
                description = EXCLUDED.description,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """, (source_id, source_type, protocol, description))
        return dict(cur.fetchone())

def get_all_sources() -> list:
    """Get all registered sources."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM source_registry ORDER BY created_at DESC")
        return [dict(row) for row in cur.fetchall()]

def get_sources_with_status() -> list:
    """Get all sources joined with their API polling status in one query."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT 
                s.*, 
                a.is_polling, 
                a.last_status, 
                a.last_error, 
                a.last_polled_at
            FROM source_registry s
            LEFT JOIN api_source_configs a ON s.source_id = a.source_id
            ORDER BY s.created_at DESC
        """)
        return [dict(row) for row in cur.fetchall()]

def get_source(source_id: str) -> dict:
    """Get a single source."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM source_registry WHERE source_id = %s", (source_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def update_source_status(source_id: str, status: str):
    """Update source status."""
    with get_cursor() as cur:
        cur.execute("""
            UPDATE source_registry SET status = %s, updated_at = CURRENT_TIMESTAMP
            WHERE source_id = %s
        """, (status, source_id))

def delete_source(source_id: str) -> bool:
    """Delete a source (cascades to blueprints, DQ rules, API config, silver registry AND Iceberg table)."""
    # 1. Drop the Iceberg table from the catalog (where the actual data lives)
    try:
        from services import iceberg_service
        iceberg_service.drop_table(source_id)
    except Exception as e:
        logger.warning(f"Could not drop Iceberg table for {source_id}: {e}")

    # 2. Drop Neo4j nodes (Knowledge Graph)
    try:
        from services import neo4j_service
        neo4j_service.get_neo4j_service().delete_source_nodes(source_id)
    except Exception as e:
        logger.warning(f"Could not delete Neo4j nodes for {source_id}: {e}")

    with get_cursor() as cur:
        # 3. Clean up from Silver Registry (matching by ID or Name)
        cur.execute("DELETE FROM silver_registry WHERE source_id = %s OR table_name = %s", (source_id, source_id))

        # 4. Delete the primary source record (cascades to blueprints/rules via DB foreign keys)
        cur.execute("DELETE FROM source_registry WHERE source_id = %s", (source_id,))
        return cur.rowcount > 0

# ============================================================
# MAPPING SCRIPT CRUD
# ============================================================

def get_mapping_script(source_id: str) -> str | None:
    """Get the custom Python mapping script for a source. Returns None if not set."""
    with get_cursor() as cur:
        cur.execute("SELECT mapping_script FROM source_registry WHERE source_id = %s", (source_id,))
        row = cur.fetchone()
        return row["mapping_script"] if row else None

def save_mapping_script(source_id: str, script: str | None) -> None:
    """Save or clear the custom Python mapping script for a source."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO source_registry (source_id, source_type, protocol, description, mapping_script)
            VALUES (%s, 'STREAM', 'HTTP', 'Pre-registered via API Wizard', %s)
            ON CONFLICT (source_id) DO UPDATE SET
                mapping_script = EXCLUDED.mapping_script,
                updated_at = CURRENT_TIMESTAMP
        """, (source_id, script))

# ============================================================
# API SOURCE CONFIG CRUD
# ============================================================

def save_api_config(source_id: str, config: dict) -> dict:
    """Save or update API source configuration."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO api_source_configs 
                (source_id, api_url, method, headers, body_template, 
                 poll_interval_seconds, auth_type, auth_credentials, is_polling)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_id) DO UPDATE SET
                api_url = EXCLUDED.api_url,
                method = EXCLUDED.method,
                headers = EXCLUDED.headers,
                body_template = EXCLUDED.body_template,
                poll_interval_seconds = EXCLUDED.poll_interval_seconds,
                auth_type = EXCLUDED.auth_type,
                auth_credentials = EXCLUDED.auth_credentials,
                is_polling = EXCLUDED.is_polling
            RETURNING *
        """, (
            source_id,
            config["api_url"],
            config.get("method", "GET"),
            json.dumps(config.get("headers", {})),
            json.dumps(config.get("body_template")) if config.get("body_template") else None,
            config.get("poll_interval_seconds", 60),
            config.get("auth_type", "NONE"),
            json.dumps(config.get("auth_credentials", {})),
            config.get("is_polling", True),
        ))
        return dict(cur.fetchone())


def get_api_config(source_id: str) -> dict:
    """Get API config for a source."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM api_source_configs WHERE source_id = %s", (source_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def get_active_api_sources() -> list:
    """Get all sources with polling enabled."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT a.*, s.status FROM api_source_configs a
            JOIN source_registry s ON a.source_id = s.source_id
            WHERE a.is_polling = TRUE AND s.status = 'ACTIVE'
        """)
        return [dict(row) for row in cur.fetchall()]

def update_poll_status(source_id: str, status: str, error: str = None):
    """Update last polled status."""
    with get_cursor() as cur:
        cur.execute("""
            UPDATE api_source_configs 
            SET last_polled_at = CURRENT_TIMESTAMP, last_status = %s, last_error = %s
            WHERE source_id = %s
        """, (status, error, source_id))

# ============================================================
# MAPPING BLUEPRINTS CRUD
# ============================================================

def add_blueprint(source_id: str, target_field: str, jmes_path: str, 
                  data_type: str, is_primary_key: bool = False, 
                  is_required: bool = True, default_value: str = None) -> dict:
    """Add a mapping blueprint for a source."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO mapping_blueprints 
                (source_id, target_field, jmes_path, data_type, is_primary_key, is_required, default_value, nested_explode)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (source_id, target_field, jmes_path, data_type, is_primary_key, is_required, default_value, True))
        return dict(cur.fetchone())

def get_blueprints(source_id: str) -> list:
    """Get all mapping blueprints for a source."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT * FROM mapping_blueprints 
            WHERE source_id = %s ORDER BY blueprint_id
        """, (source_id,))
        results = []
        for row in cur.fetchall():
            d = dict(row)
            # Poly-fill json_path for legacy code compatibility
            if "jmes_path" in d and "json_path" not in d:
                d["json_path"] = d["jmes_path"]
            elif "json_path" in d and "jmes_path" not in d:
                d["jmes_path"] = d["json_path"]
            results.append(d)
        return results

def delete_blueprints(source_id: str) -> int:
    """Delete all blueprints for a source."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM mapping_blueprints WHERE source_id = %s", (source_id,))
        return cur.rowcount

def upsert_blueprints(source_id: str, blueprints: list) -> list:
    """Replace all blueprints for a source with new ones."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM mapping_blueprints WHERE source_id = %s", (source_id,))
        results = []
        for bp in blueprints:
            # Safe extraction for the database write
            path = bp.get("jmes_path") or bp.get("json_path") or ""
            if path and path.startswith("$."):
                path = path[2:] # Strip legacy JSONPath prefix

            cur.execute("""
                INSERT INTO mapping_blueprints 
                    (source_id, target_field, jmes_path, data_type, is_primary_key, is_required, default_value, should_explode, nested_explode)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                source_id, bp["target_field"], path, bp["data_type"],
                bp.get("is_primary_key", False), bp.get("is_required", True), bp.get("default_value"),
                bp.get("should_explode", True), bp.get("nested_explode", True)
            ))
            results.append(dict(cur.fetchone()))
        return results

# ============================================================
# DQ RULES CRUD
# ============================================================

def add_dq_rule(source_id: str, rule_name: str, rule_logic: str, 
                action_on_fail: str = "QUARANTINE", severity: str = "ERROR") -> dict:
    """Add a data quality rule."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO dq_rules (source_id, rule_name, rule_logic, action_on_fail, severity)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """, (source_id, rule_name, rule_logic, action_on_fail, severity))
        return dict(cur.fetchone())

def get_dq_rules(source_id: str, active_only: bool = True) -> list:
    """Get DQ rules for a source."""
    with get_cursor() as cur:
        query = "SELECT * FROM dq_rules WHERE source_id = %s"
        if active_only:
            query += " AND is_active = TRUE"
        query += " ORDER BY rule_id"
        cur.execute(query, (source_id,))
        return [dict(row) for row in cur.fetchall()]

def delete_dq_rules(source_id: str) -> int:
    """Delete all DQ rules for a source."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM dq_rules WHERE source_id = %s", (source_id,))
        return cur.rowcount

# ============================================================
# SILVER REGISTRY CRUD
# ============================================================

def register_silver_table(table_name: str, source_id: str, minio_path: str,
                          row_count: int = 0, file_count: int = 0, 
                          total_size: int = 0, schema_json: dict = None) -> dict:
    """Register or update a Silver table."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO silver_registry 
                (table_name, source_id, minio_path, row_count, file_count, total_size_bytes, schema_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (table_name) DO UPDATE SET
                row_count = silver_registry.row_count + EXCLUDED.row_count,
                file_count = silver_registry.file_count + EXCLUDED.file_count,
                total_size_bytes = silver_registry.total_size_bytes + EXCLUDED.total_size_bytes,
                schema_json = COALESCE(EXCLUDED.schema_json, silver_registry.schema_json),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """, (table_name, source_id, minio_path, row_count, file_count, total_size, 
              json.dumps(schema_json) if schema_json else None))
        return dict(cur.fetchone())

def get_silver_tables() -> list:
    """Get all Silver tables."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT sr.*, s.description as source_description
            FROM silver_registry sr
            LEFT JOIN source_registry s ON sr.source_id = s.source_id
            ORDER BY sr.updated_at DESC
        """)
        return [dict(row) for row in cur.fetchall()]

def get_silver_table(table_name: str) -> dict:
    """Get a single Silver table's info."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM silver_registry WHERE table_name = %s", (table_name,))
        row = cur.fetchone()
        return dict(row) if row else None

def purge_silver_entry(source_id: str) -> int:
    """Remove silver registry entries for a source without deleting the source itself."""
    with get_cursor() as cur:
        cur.execute(
            "DELETE FROM silver_registry WHERE source_id = %s OR table_name = %s",
            (source_id, source_id)
        )
        return cur.rowcount

# ============================================================
# GOLD REGISTRY & GRAPH BLUEPRINTS
# ============================================================

def upsert_graph_blueprint(source_id: str, cypher_template: str) -> dict:
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO graph_blueprints (source_id, cypher_template)
            VALUES (%s, %s)
            ON CONFLICT (source_id) DO UPDATE SET
                cypher_template = EXCLUDED.cypher_template,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """, (source_id, cypher_template))
        return dict(cur.fetchone())

def get_graph_blueprint(source_id: str) -> dict:
    with get_cursor() as cur:
        cur.execute("SELECT * FROM graph_blueprints WHERE source_id = %s", (source_id,))
        row = cur.fetchone()
        return dict(row) if row else None

def update_gold_registry(source_id: str, nodes_added: int, snapshot_id: int):
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO gold_registry (source_id, node_count, last_snapshot_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (source_id) DO UPDATE SET
                node_count = gold_registry.node_count + EXCLUDED.node_count,
                last_snapshot_id = EXCLUDED.last_snapshot_id,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        """, (source_id, nodes_added, snapshot_id))
        return dict(cur.fetchone())

def get_gold_registry(source_id: str = None) -> list:
    with get_cursor() as cur:
        if source_id:
            cur.execute("SELECT * FROM gold_registry WHERE source_id = %s", (source_id,))
            return [dict(row) for row in cur.fetchall()]
        else:
            cur.execute("SELECT * FROM gold_registry ORDER BY updated_at DESC")
            return [dict(row) for row in cur.fetchall()]

# ============================================================
# QUARANTINE LOG
# ============================================================

def log_quarantine(source_id: str, rule_id: int, rule_name: str, 
                   failed_record: dict, failure_reason: str):
    """Log a quarantined record."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO dq_quarantine_log 
                (source_id, rule_id, rule_name, failed_record, failure_reason)
            VALUES (%s, %s, %s, %s, %s)
        """, (source_id, rule_id, rule_name, json.dumps(failed_record), failure_reason))

# ============================================================
# PROCESSING LOG
# ============================================================

def log_processing_start(source_id: str, processor_type: str, bronze_path: str = None) -> int:
    """Log the start of a processing run. Returns log_id."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO processing_log (source_id, processor_type, bronze_path)
            VALUES (%s, %s, %s)
            RETURNING log_id
        """, (source_id, processor_type, bronze_path))
        return cur.fetchone()["log_id"]

def log_processing_complete(log_id: int, silver_path: str, records_in: int,
                            records_passed: int, records_quarantined: int,
                            status: str = "COMPLETED", error_message: str = None):
    """Log the completion of a processing run."""
    with get_cursor() as cur:
        cur.execute("""
                UPDATE processing_log SET
                    silver_path = %s, records_in = %s, records_passed = %s,
                    records_quarantined = %s, status = %s, error_message = %s,
                    completed_at = CURRENT_TIMESTAMP
                WHERE log_id = %s
            """, (silver_path, records_in, records_passed, records_quarantined,
                  status, error_message, log_id))

def wipe_all_data(keep_config: bool = True):
    """
    Global wipe of all operational data.
    If keep_config is False, it also wipes source_registry (everything).
    """
    with get_cursor() as cur:
        # 1. Wipe Materialized Graph Registry
        cur.execute("DELETE FROM gold_registry")
        
        # 2. Wipe Processing & DQ Logs
        cur.execute("DELETE FROM processing_log")
        cur.execute("DELETE FROM dq_quarantine_log")
        if "iceberg_snapshot_log" in [t['table_name'] for t in get_all_tables(cur)]: # Check if table exists
             cur.execute("DELETE FROM iceberg_snapshot_log")
        
        # 3. Wipe Silver Registry
        cur.execute("DELETE FROM silver_registry")
        
        if not keep_config:
            # NUCLEAR OPTION: Wipe all sources, blueprints, and rules
            cur.execute("DELETE FROM source_registry")

def get_all_tables(cur):
    """Helper to list all tables in public schema."""
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    """)
    return cur.fetchall()
