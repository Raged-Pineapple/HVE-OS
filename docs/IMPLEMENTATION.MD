# HVE-OS Implementation Summary

## 1. System Architecture Overview
HVE-OS (Hive Operating System) is an autonomous Data Lakehouse and Ontology platform designed to seamlessly ingest, process, and query multi-modal data streams. The architecture is broken down into a Control Plane (API & Metadata) and a Data Plane (Storage & Processing).

### Tech Stack
*   **Frontend:** React (Vite), Vanilla CSS, multi-tab interface with SSE-based real-time logging.
*   **Backend (Gateway):** Python FastAPI, asynchronous endpoints, SSE log streaming.
*   **Message Broker:** Apache Kafka (KRaft mode).
*   **Storage (Lakehouse):** 
    *   **Bronze Tier:** MinIO (S3-compatible object storage for raw ingestion).
    *   **Silver Tier:** Apache Iceberg (structured, typed data) powered by DuckDB.
*   **Relational Meta-Store:** PostgreSQL (PostGIS enabled) for registering sources, blueprints, and data quality (DQ) rules.
*   **Ontology Layer:** Neo4j Graph Database for autonomous entity resolution and linking.
*   **Containerization:** Docker & Docker Compose.

---

## 2. Core Modules & Data Flow

The platform operates on a strict **Source ID** paradigm. Every data feed (whether static file or live API) is assigned a `source_id` (e.g., `bangalore_military`), which defines its Kafka topic, its Bronze S3 path, its Silver Iceberg table, and its PostgreSQL metadata registry.

### Phase 1: Ingestion (Perimeter)
*   **Static Uploads:** Supports CSV, JSON, Parquet, Excel, and GeoJSON. Files are streamed directly to the Bronze layer via MinIO presigned URLs or gateway passthrough.
*   **API Polling:** Users can register external REST APIs (e.g., OpenStreetMap Overpass). A background `APIPoller` fetches data at configured intervals and pushes JSON elements to Kafka.
*   **Stream Endpoints:** Direct `POST /api/v1/ingest/stream` endpoint for pushing live telemetry into Kafka.

### Phase 2: Processing (Pipelines)
Data arriving in Kafka is consumed by the `stream_processor`. 
*   **Blueprints:** Users define explicit JSON-to-Column mappings. The processor extracts nested fields using JSONPath, casts them to strict types (STRING, INT, FLOAT, TIMESTAMP), and routes them. If blueprints are missing, data is safely quarantined in the Bronze tier.
*   **Data Quality (DQ) Gate:** Python-based firewall rules (e.g., `latitude > 0`). Failing records are dropped, flagged, or quarantined in a Dead Letter Queue (DLQ) based on user configuration.

### Phase 3: Materialization & Query
*   **Silver Layer:** Validated records are appended to Apache Iceberg tables in MinIO. 
*   **Query Engine:** DuckDB is used as the high-performance OLAP engine to query the Silver Iceberg tables dynamically. The frontend provides a SQL terminal to interact with this data.

### Phase 4: Ontology Mapping (Graph)
*   As Silver tables are updated, an `AutoBuilder` service infers relationships and synchronizes the relational data into a Neo4j knowledge graph, enabling complex geospatial and semantic graph queries.

---

## 3. Frontend Implementation
The frontend is a modular, single-page application built with React and a custom glassmorphism design system.

### Key Components
1.  **Ingestion Page (`IngestionPage.jsx`):** A unified dashboard with three main sub-tabs:
    *   **Ingest:** A 4-step wizard to register APIs and a drag-and-drop file uploader.
    *   **Pipelines:** A dual-pane interface to select sources and configure Mapping Blueprints and Python DQ Rules.
    *   **Query:** A SQL text editor that executes queries against DuckDB and renders results in a dynamic table, featuring a "Quick Queries" preset list.
2.  **Status Bar (`StatusBar.jsx`):** A top navigation bar that actively monitors backend health (Postgres, MinIO, Kafka) and displays real-time connection status.
3.  **Bottom Panel (`BottomPanel.jsx`):** A resizable, tabbed dock containing:
    *   **SYSTEM LOG:** An SSE (Server-Sent Events) consumer that streams live Python logs from the backend directly to the browser window.
    *   **CURL:** A built-in HTTP terminal that parses raw curl commands, executes them via `fetch`, and renders formatted JSON responses.

---

## 4. Debugging & Traceability
To ensure transparency in the distributed pipeline, the system implements a synchronous **Debug Trace Engine**. 
*   When a payload is submitted with `debug: true`, the gateway injects a unique `trace_id`.
*   The payload synchronously traverses the Perimeter → Kafka → Bronze → Transform → Silver stages.
*   The backend listens for the specific Kafka delivery callback for that trace, bypassing async backlogs, to provide instant, stage-by-stage success/failure feedback to the developer.

---

## 5. Deployment State
The entire platform is orchestrated via `docker-compose.yml`, which spins up MinIO, Kafka, Postgres, and Neo4j. The Python backend runs via Uvicorn (`main.py` on port 8000), and the Vite frontend runs locally on port 5173. 

The architecture strictly separates concerns, keeping raw data isolated in Bronze, strongly-typed data in Silver, and complex relationships in the Graph layer, adhering to modern Data Lakehouse best practices.
