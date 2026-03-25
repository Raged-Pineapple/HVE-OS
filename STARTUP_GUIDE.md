# Palantir-Tier Ingestion Engine: Startup Guide

Because HVE_OS was upgraded aggressively to a massive 6-layer ingestion stack (featuring Redis deductive caching, Redpanda Kafka topic routing, PyArrow Parquet writers, and Neo4j real-time lineage graphs), running the full system requires booting the physical infrastructure alongside the Python AI engine.

Here is the exact sequence required to boot the entire Data Operating System from scratch:

## Step 1: Start the Core Infrastructure Stack
The distributed infrastructure layer runs inside isolated Docker containers. 

Open a terminal at the root of the project and execute:
```bash
cd backend
docker-compose up -d
```
*Wait 15 seconds. This command boots PostgreSQL, Neo4j (Graph Lineage), Redis (Sub-layer 4 Atomic Deduplicator), and Redpanda (Sub-layer 2 Kafka Message Bus).*

## Step 2: Start the Palantir-Engine & Master APIs 
The Python backend contains NOT just the FastAPI endpoints, but also dynamically manages the background worker Daemons for OpenSky, Schema Validation, Parquet Archiving, and Lineage generation. 

Open a second terminal and execute:
```bash
cd backend
.\venv\Scripts\activate.ps1
uvicorn app.main:app --reload --port 8000
```
*When this successfully starts up, you will see explicit terminal logs confirming the `consumer_daemon` has spawned the Kafka topic listeners, and the `OPENSKY CONNECTOR` has successfully fetched the first batch of live global air traffic!*

## Step 3: Start the Visual Frontend UI Sandbox
Open a third terminal and execute:
```bash
cd frontend
npm run dev -- --force
```
*You can now open `http://localhost:5174` in your browser to interact safely with the AI Nodes.*

---

## How to Verify the Pipeline is Processing Live Data?

Because the OpenSky Flight Radar integration runs continuously in the background parsing live data, you can verify the system is working instantly across the sub-layers:

1. **Verify the Sub-Layer 5 Parquet Delta Archive:** 
   Open your computer's native file explorer and navigate to `D:\HVE_OS\datalake\raw\source=OPENSKY_NETWORK\`. You will see Hive-partitioned directories dynamically generate (e.g., `/year=2026/month=03/day=22/hour=13/`) featuring `.parquet` binary immutable data files. These buffers flush to disk automatically every 5 minutes.

2. **Verify the Sub-Layer 6 Geographic Lineage Trace:** 
   Open your browser to `http://localhost:7474`. Log in with Username: `neo4j` and Password: `new_password`. At the top query prompt, execute the cypher query: 
   ```cypher
   MATCH (r:DataRecord) RETURN r LIMIT 100
   ```
   You will see the cryptographic `row_hash` nodes populating dynamically into the database! They will be explicitly traced back by geometric edges to the `OPENSKY_NETWORK` Batch block. Because the system drops late-arrivals and deduplicates exact matches via Redis (Sub-Layer 4) natively, you will never see a duplicate edge.
