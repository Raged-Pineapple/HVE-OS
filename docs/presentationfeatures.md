# HVE-OS (Hive Vision Engine Operating System) Blueprint Documentation

This document serves as the comprehensive architectural blueprint for HVE-OS. It contains sufficient detail regarding the file structure, core logic, schemas, and configurations to reconstruct the system.

---

## 1. Infrastructure & Data Plane
**File:** `docker-compose.yml`
The foundation of HVE-OS runs on containerized microservices.
*   **PostgreSQL (hve-postgres)**: Port 5433. Database: `hve_control_plane`. Serves as the metadata and control plane catalog. Initialized via `./scripts/init.sql`.
*   **MinIO (hve-minio)**: Port 9000/9001. S3-compatible object storage. Buckets automatically created via `minio-init` sidecar: `hve-bronze`, `hve-silver`, `hve-iceberg`.
*   **Apache Iceberg REST Catalog**: Port 8181. Connected to MinIO (`s3a://hve-iceberg/`) and backed by PostgreSQL JDBC.
*   **Apache Kafka (hve-kafka)**: Port 9092/9094. Runs in KRaft mode. A `kafka-init` sidecar automatically provisions `raw-telemetry` and `silver-telemetry` topics with 3 partitions and a 7-day retention period.
*   **Neo4j (hve-neo4j)**: Port 7474/7688. The primary Knowledge Graph, loaded with `apoc` and `graph-data-science` plugins.

---

## 2. Ingestion & Streaming Layer (`src/processors`)
This layer handles the acquisition and initial buffering of raw data.

### `api_poller.py`
*   **Responsibility**: High-frequency, scheduled harvesting from external APIs.
*   **Mechanisms**:
    *   **ACLED Poller**: Fetches conflict data. Paginates using `page` parameters.
    *   **News Pollers**: Google News and NewsAPI integration.
*   **Output**: Pushes raw JSON payloads to the `raw-telemetry` Kafka topic using `confluent_kafka.Producer`.

### `stream_processor.py`
*   **Responsibility**: Consumes from `raw-telemetry`, performs initial sanitization, and routes data to the Silver layer (Neo4j and Iceberg).
*   **Mechanisms**: Uses a continuous Kafka Consumer loop. Translates raw JSON into standardized Pydantic models before pushing to storage services.

---

## 3. Gateway & Services (`src/gateway`)
The FastAPI backend orchestrating the system.

### `main.py`
*   **Responsibility**: Application entrypoint.
*   **Lifecycle**: On startup, it initializes connection pools (`db_service`, `neo4j_service`), starts the `APIPoller` threads, and launches the `StreamProcessor` daemon. On shutdown, it gracefully drains and closes connections.

### Services (`src/gateway/services/`)
*   **`neo4j_service.py`**: Singleton wrapper around the Neo4j Python Driver. Provides `execute_query(cypher, params)` and `execute_write()` with built-in retry logic.
*   **`iceberg_service.py` & `query_service.py`**: Interacts with the Iceberg REST catalog and executes analytical queries on Parquet files using **DuckDB**.
*   **`db_service.py`**: Async SQLAlchemy integration with PostgreSQL for managing user configurations, node definitions, and system metadata.

### Routers (`src/gateway/routers/`)
*   **`graph.py`**: Endpoints like `GET /graph/nodes` and `POST /graph/query` to expose Cypher execution to the frontend.
*   **`ingest.py`**: Webhook endpoints for pushing data directly into Kafka.
*   **`nodes.py`**: API for the frontend to list available processing nodes and trigger execution.

---

## 4. Processing Logic Engine (`src/Logic/nodes`)
A Directed Acyclic Graph (DAG) execution engine for data transformation.

### Core Architecture
*   **`base.py`**: Defines `BaseNode`, `NodeMetadata`, and `NodeResult`. Every node must implement `execute(inputs, config)`.
*   **`registry.py`**: Auto-discovers and registers nodes via the `@register_node` decorator into a central dictionary.
*   **`executor.py`**: Handles topological sorting of the UI-defined graph. It resolves wires (React Flow edges), gathers outputs from upstream nodes, and passes them as `inputs` to downstream nodes.

### AI Nodes (`src/Logic/nodes/ai/`)
*   **`relationship_mapping_node.py`**:
    *   **Logic**: Uses a `ThreadPoolExecutor` to evaluate relationships concurrently. Connects to Mistral or Gemini APIs.
    *   **Algorithm**: Prompts the LLM with source/target JSON attributes. Expects a JSON array `[{target_id, score, reason}]`. If `score >= minScore`, it executes a Neo4j Cypher `MERGE` to create the relationship.
    *   **Optimization**: Implements `_local_evaluation_cache` (hashed by configuration) to prevent redundant API calls.
*   **`risk_calculator.py`**:
    *   **Logic**: Receives a `query_config` wire `{relationType, userString}`.
    *   **Algorithm**: Executes a backward traversal Cypher query: `MATCH p=(source {_source_id: $user_string})<-[:REL_TYPE*1..N]-(prev) RETURN prev, p`.
    *   **Scoring**: Averages the AI-generated `score` properties on the edges, applies a depth-decay factor (`1.0 / (1 + depth * 0.2)`), and routes the entity to `high_risk` (>=0.7), `medium_risk`, or `low_risk` output handles.

### Logic Nodes (`src/Logic/nodes/logic/`)
*   **`split.py`**: Iterates over an input array and emits individual items sequentially or explodes a specific array attribute within an object.
*   **`combine.py`**: Acts as a synchronization barrier, waiting for multiple upstream inputs and merging them into a single array payload.
*   **`extract_entities.py`**: Applies Regex patterns or NLP (spaCy/NLTK depending on env) to identify Named Entities (People, Organizations, Locations) within text fields.

### Security Nodes (`src/tenseal_engine/` & `src/Logic/nodes/security/`)
*   **`encrypt.py`**: Integrates with the `tenseal` library.
*   **Logic**: Generates a BFV/CKKS context, serializes data, and encrypts numerical fields for Privacy-Preserving Machine Learning (PPML) workloads.

---

## 5. Visual Orchestration Frontend (`processing_layer_frntnd`)
The UI is a React application utilizing `reactflow`.

### Core Setup
*   **State Management**: Uses React hooks (`useState`, `useEffect`) and React Flow's `useNodesState`, `useEdgesState`.
*   **Communication**: Axios for REST calls to the FastAPI backend.

### Node Components (`src/components/nodes/`)
*   **`BaseNode.jsx`**: A wrapper providing standard UI elements (collapse toggle, status indicators, raw data preview drawer).
*   **`RelationshipMappingNode.jsx`**:
    *   **Features**: Dynamic schema discovery using `resolveUpstreamData()` to populate Source/Target attribute dropdowns.
    *   **Controls**: API Key inputs, Model selection (Gemini/Mistral), and an Inter-Relationship toggle. Emits a `query_config` object on its source handle.
*   **`RiskCalculatorNode.jsx`**:
    *   **Features**: Single `query_config` target handle. Auto-hides manual configuration fields when wired to a mapping node. Displays a live Cypher preview block.

### Execution Flow
1.  User connects nodes in the React Flow canvas.
2.  User clicks "Execute".
3.  Frontend serializes the nodes and edges into a JSON payload.
4.  Payload is POSTed to the backend's `executor.py`.
5.  Backend computes the execution order, runs each node's Python class, and streams logs/results back via WebSockets or polling.

---
*This document provides the exact architectural, functional, and structural blueprint required to recreate the HVE-OS ecosystem.*
