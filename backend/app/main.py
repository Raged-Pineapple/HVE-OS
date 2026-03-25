from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI
from app.core.config import settings
from app.api.routes import connectors, pipelines, optimization, actions, feedback, ontology, simulation, ai, governance, query
from app.services.connector_manager import connector_manager
from app.db.neo4j_session import neo4j_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic: initialize DB schema and start background tasks
    from app.db.session import engine, Base
    from app.models.static_ingest import StaticSourceFile
    
    async with engine.begin() as conn:
        # NOTE: For production, use Alembic. For quick prototyping, we use create_all
        await conn.run_sync(Base.metadata.create_all)
        
    await connector_manager.initialize_from_db()
    neo4j_manager.connect()
    
    # ----------------------------------------------------
    # PHASE 16-21: Sub-layers 1 to 6 Master Kafka Daemon
    from app.ingestion.consumer_daemon import start_all_daemons
    await start_all_daemons()
    
    # ----------------------------------------------------
    # PHASE 22: OpenSky Flight Radar Integration
    # from app.connectors.opensky import opensky_connector
    # asyncio.create_task(opensky_connector.poll_forever())
    # ----------------------------------------------------
    # ----------------------------------------------------
    
    # Note: Using redis without connection pool in global scope is tricky for lifespans, 
    # but we initialize when needed inside the modules.
    print("Application startup complete. Connectors, Neo4j, Kafka Daemons, and OpenSky initialized.")
    yield
    # Shutdown logic
    await connector_manager.stop_all()
    await neo4j_manager.close()
    print("Application shutting down.")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# Allow the React frontend to communicate with the Backend interpreter
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to the specific frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connectors.router, prefix="/connectors", tags=["connectors"])
app.include_router(pipelines.router, prefix="/pipelines", tags=["pipelines"])
app.include_router(ontology.router, prefix="/ontology", tags=["ontology"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(optimization.router, prefix="/optimization", tags=["optimization"])
app.include_router(actions.router, prefix="/actions", tags=["actions"])
app.include_router(simulation.router, prefix="/simulation", tags=["simulation"])
app.include_router(feedback.router, prefix="/feedback", tags=["feedback"])
app.include_router(governance.router, prefix="/governance", tags=["governance"])
app.include_router(query.router, prefix="/query", tags=["query"])

@app.get("/")
async def root():
    return {"message": "Welcome to the Data Operating System"}
