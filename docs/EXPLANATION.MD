# HVE-OS Deep Dive Architecture & Node Operations

This document provides a comprehensive technical breakdown of the Hybrid Visual Engine (HVE-OS). It is intended for developers and architects who need to understand the underlying data flow, backend mechanisms, and real-world applications of every node in the system.

---

## 1. The Ingestion Perimeter (Capture & Shield)
The Ingestion layer acts as the "Shock Absorber" for the entire platform. It handles the transition from messy, high-velocity external data to clean, structured internal data.

### 1.1 The Lifecycle of a Data Packet
1.  **Entry**: Data enters via HTTP Stream, File Upload, or API Polling.
2.  **Canonical Enveloping**: Every payload is wrapped in a `CanonicalEnvelope`. This adds a globally unique `hve_id` (UUID), an `ingest_timestamp`, and preserves the original `source_id`.
3.  **Kafka Firehose**: The envelope is pushed to the `raw-telemetry` Kafka topic. This decouples the ingestion speed from the processing speed, ensuring the system never crashes during data spikes.
4.  **The Stream Processor**: A dedicated worker consumes from Kafka, applies **Blueprints** (JMESPath field mapping), and runs **DQ Rules** (Python-based validation).
5.  **The Silver Lakehouse**: Validated records are written as Parquet files into an **Apache Iceberg** table.

### 1.2 Capture Mechanisms In-Depth
*   **The API Poller**: 
    *   **Backend**: Managed by `api_poller.py`. It uses a thread-safe scheduler to trigger requests.
    *   **Advanced Feature (JMESPath Explosion)**: If an API returns a list (e.g., 500 aircraft in one JSON), the poller "explodes" this into 500 individual Kafka messages.
    *   **Applications**: Monitoring open-source intelligence (OSINT), flight tracking APIs (OpenSky), or weather stations.
*   **Direct Batch Ingest**:
    *   **Backend**: Uses `batch_processor.py` and **DuckDB**. It can ingest 1 million rows from a CSV in seconds by leveraging memory-mapped I/O.
    *   **Applications**: Migrating historical mission data or uploading satellite imagery metadata.

---

## 2. The Processing Engine (Neural Orchestration)
The Processing Layer is where raw data is turned into actionable intelligence. It uses a **Reactive Node Graph** where data flows through specialized logic units.

### 2.1 Database & Input Nodes
#### **Silver Table Node**
*   **Backend**: Executes DuckDB SQL queries against the Iceberg metadata stored in MinIO.
*   **Data Flow**: Pulls data from the lakehouse → renders an "Excel-like" preview using Handsontable → pushes the result set to downstream handles.
*   **Applications**: Filtering massive datasets down to a specific region or timeframe (e.g., "Show me all objects within 50km of coordinate X").

#### **Logic Trigger Node**
*   **Function**: Acts as the "Spark" for a workflow. It can be set to "Manual" (user clicks a button) or "Scheduled" (runs every hour).
*   **Applications**: Automating daily threat reports or hourly database cleanups.

### 2.2 Logic & Transformation Nodes
#### **Extract Entities Node**
*   **Backend**: Uses a multi-strategy engine.
    *   **NER (NLP)**: Leverages Natural Language Processing to find names, organizations, or locations in raw text.
    *   **Regex**: Uses high-speed pattern matching for structured strings (e.g., VIN numbers, tail numbers, or IP addresses).
    *   **KeyPath**: Direct JSON extraction for deeply nested fields.
*   **The "Pinning" Mechanism**: This is a critical HVE-OS feature. When you "Pin" an entity (e.g., a specific aircraft), the node generates a **Dynamic Handle**. This allows you to branch the logic for that specific target while the rest of the data flows through the "Bulk" handle.
*   **Applications**: Counter-terrorism analysis (finding specific IDs in passenger manifests) or asset tracking.

#### **Split & Combine Nodes**
*   **Function**: These are the "Routers" of the graph.
*   **Split**: Uses Python-style logic (e.g., `speed > 500 and altitude < 1000`) to branch data.
*   **Combine**: Performs **Data Fusion**. It can take a "Flight Object" from one source and a "Weather Object" from another, merging them into a single comprehensive intelligence packet.
*   **Applications**: Multi-sensor fusion (Visual + Radar) or tiered alerting systems.

### 2.3 AI & Intelligence Nodes
#### **AI Analysis Node**
*   **Backend**: Integration with classical machine learning libraries (Scikit-learn, PyTorch).
*   **Models**:
    *   **Kalman Filter**: Used for tracking moving objects and predicting their next position.
    *   **LSTM / Prophet**: Used for time-series forecasting (e.g., "Will this vessel arrive on time?").
*   **Applications**: Predictive maintenance, trajectory forecasting, and anomaly detection.

### 2.4 Security & Privacy Nodes (The Tenseal Engine)
#### **Encrypt / Decrypt & HE Compute**
*   **Backend**: These nodes communicate with the **Tenseal Engine**, an isolated service running **Homomorphic Encryption** algorithms.
*   **Logic**: Homomorphic Encryption allows the system to perform math on *encrypted* data. For example, the HE Compute node can add two encrypted numbers without ever knowing what those numbers are. Only the final recipient with the private key can see the result.
*   **Applications**: Multi-national coalition operations where different countries need to compute shared statistics (e.g., "Total Coalition Strength") without revealing their individual sensitive counts.

---

## 3. Data Integrity & Lakehouse Operations
### 3.1 Apache Iceberg (Silver Table Storage)
HVE-OS uses Iceberg instead of traditional SQL for several reasons:
*   **Time Travel**: You can query the database "as it was yesterday" by specifying a Snapshot ID.
*   **Schema Evolution**: You can add columns to a table with 10 billion rows instantly without locking the table.
*   **Performance**: It uses "Hidden Partitioning," meaning the backend only reads the exact Parquet files needed for a query.

### 3.2 Neo4j (The Knowledge Graph)
While Iceberg stores **tabular data**, Neo4j stores **relationships**. 
*   **Mechanism**: The `graph_processor.py` listens to the `silver-data` Kafka topic and uses **Cypher Blueprints** to automatically create nodes and edges.
*   **Function**: This allows HVE-OS to answer "Link Analysis" questions like "Who is connected to this target through more than 3 degrees of separation?".

---

*Document Version: 2.0 (Deep Dive) — HVE-OS Engineering Team*
