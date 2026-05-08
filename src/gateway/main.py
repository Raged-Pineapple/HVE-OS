"""
main.py — HVE-OS Gateway Application
The central FastAPI application that orchestrates all components.
"""
import os
import sys
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Add src directory to path so processors package is importable
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from routers import ingest, control_plane, query, debug, graph, log_stream, security
from routers.log_stream import attach_handler

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
)
logger = logging.getLogger("hve-os")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle manager.
    Starts background processors on boot, cleans up on shutdown.
    """
    logger.info("=" * 60)
    logger.info("  HVE-OS Gateway Starting...")
    logger.info("=" * 60)

    # ── Attach live log handler (streams to frontend terminal) ──
    attach_handler()
    # ── Ensure MinIO buckets exist ──
    try:
        from services.minio_service import ensure_buckets
        ensure_buckets()
        logger.info("[✓] MinIO buckets verified")
    except Exception as e:
        logger.warning(f"[!] MinIO bucket setup: {e}")

    # ── Ensure Graph Tables exist ──
    try:
        from services.db_service import ensure_graph_tables
        ensure_graph_tables()
    except Exception as e:
        logger.warning(f"[!] Database startup: {e}")

    # ── Start Stream Processor (Kafka Consumer → Silver) ──
    stream_processor = None
    try:
        from processors.stream_processor import get_processor
        stream_processor = get_processor()
        stream_processor.start()
        logger.info("[✓] Stream Processor started (Kafka → Bronze → Silver)")
    except Exception as e:
        logger.warning(f"[!] Stream Processor startup: {e}")

    # ── Start API Poller ──
    api_poller = None
    try:
        from processors.api_poller import get_poller
        api_poller = get_poller()
        await api_poller.start()
        logger.info("[✓] API Poller started")
    except Exception as e:
        logger.warning(f"[!] API Poller startup: {e}")

    # ── Start Graph Processor (Silver Kafka → Neo4j) ──
    graph_processor = None
    try:
        from Logic.graph_processor import get_graph_processor
        graph_processor = get_graph_processor()
        graph_processor.start()
        logger.info("[✓] Graph Processor started (Silver Kafka → Neo4j)")
    except Exception as e:
        logger.warning(f"[!] Graph Processor startup: {e}")

    logger.info("=" * 60)
    logger.info("  HVE-OS Gateway READY — All systems operational")
    logger.info("=" * 60)
    logger.info("  Endpoints:")
    logger.info("    POST /api/v1/ingest/stream        → Stream JSON to Kafka")
    logger.info("    POST /api/v1/ingest/upload-static  → Upload & process files")
    logger.info("    POST /api/v1/ingest/register-api   → Register external APIs")
    logger.info("    POST /api/v1/ingest/presigned-url  → Get MinIO upload URL")
    logger.info("    GET  /api/v1/sources               → List data sources")
    logger.info("    POST /api/v1/query                 → SQL query Silver tables")
    logger.info("    GET  /api/v1/silver/tables          → List Silver tables")
    logger.info("=" * 60)

    yield  # Application runs here

    # ── Shutdown ──
    logger.info("HVE-OS Gateway shutting down...")
    
    if stream_processor:
        try:
            stream_processor.stop()
        except Exception:
            pass
    
    if api_poller:
        try:
            await api_poller.stop()
        except Exception:
            pass

    if graph_processor:
        try:
            graph_processor.stop()
        except Exception:
            pass

    try:
        from services.neo4j_service import close_neo4j
        close_neo4j()
    except Exception:
        pass

    try:
        from services.db_service import close_pool
        close_pool()
    except Exception:
        pass

    try:
        from services.query_service import close_connection
        close_connection()
    except Exception:
        pass

    logger.info("HVE-OS Gateway stopped.")


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="HVE-OS Data Lakehouse Gateway",
    description=(
        "The HVE-OS Phase 1 Data Lakehouse API. "
        "Ingests real-time streams, static files, and external API data. "
        "Processes through Bronze → Transform → Silver pipeline with "
        "dynamic mapping blueprints and data quality gates. "
        "Query clean Silver tables via SQL."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(ingest.router)
app.include_router(control_plane.router)
app.include_router(query.router)
app.include_router(debug.router)
app.include_router(log_stream.router)
app.include_router(security.router)

# Create a dedicated sub-application for the Graph Control Plane
graph_app = FastAPI(
    title="HVE-OS Graph Configuration API",
    description="Dedicated Swagger UI for configuring mapping Blueprints for Neo4j.",
    version="1.0.0",
)
graph_app.include_router(graph.router)

# Mount the sub-app on the main app
app.mount("/api/v1/graph", graph_app)


@app.get("/health")
async def health_check():
    """Liveness probe — returns service health status."""
    health = {"status": "healthy", "service": "hve-os-gateway"}
    
    # Check PostgreSQL
    try:
        from services.db_service import get_cursor
        with get_cursor() as cur:
            cur.execute("SELECT 1")
        health["postgres"] = "connected"
    except Exception as e:
        health["postgres"] = f"error: {str(e)[:100]}"

    # Check MinIO
    try:
        from services.minio_service import minio_client, BRONZE_BUCKET
        minio_client.bucket_exists(BRONZE_BUCKET)
        health["minio"] = "connected"
    except Exception as e:
        health["minio"] = f"error: {str(e)[:100]}"

    # Check Kafka (via producer)
    try:
        from services.kafka_service import producer
        producer.poll(0)
        health["kafka"] = "connected"
    except Exception as e:
        health["kafka"] = f"error: {str(e)[:100]}"

    return health


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
