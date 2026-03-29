from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import ingest

app = FastAPI(
    title="HVE OS Gateway",
    description="Stage 1 Perimeter: High-throughput ingestion of Streams and generation of Batch URIs.",
    version="1.0.0"
)

# Allowed CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the main Ingestion Router
app.include_router(ingest.router)

@app.get("/health")
async def health_check():
    """Simple Liveness Probe"""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    # If run sequentially, binds to port 8000
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
