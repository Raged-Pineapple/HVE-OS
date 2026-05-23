# HVE-OS Technology Specification
## Cryptography, Machine Learning, System Design, & Quantum-Inspired Logic

---

## 1. Cryptography & Zero-Knowledge Security (FHE)

High-Value Edge Operations System (HVE-OS) implements an industry-leading zero-knowledge computing framework powered by **Fully Homomorphic Encryption (FHE)**. This allows the system to process sensitive IoT, telemetry, and transactional data in an encrypted state, performing complex algebraic and statistical operations without ever decrypting the data on edge nodes or intermediate processing layers.

```
                  ┌────────────────────────────────────────┐
                  │          Raw Ingested Stream           │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                        [ Symmetric / Asymmetric Signatures ]
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │          Encrypt Node (CKKS)           │
                  │   Encrypts vector streams on-the-fly   │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       TenSEAL Docker Engine (8001)     │
                  │  Performs sum/multiply on ciphertexts  │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │          HE Compute / ML Node          │
                  │   Zero-knowledge model forward pass    │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │          Decrypt Node (Secret)         │
                  │     Restores plaintext for visualization│
                  └────────────────────────────────────────┘
```

### 1.1 Homomorphic Encryption Core Engine
FHE inside HVE-OS is powered by **Microsoft SEAL** wrapped via the **TenSEAL** library. To ensure scalability, isolation, and stability, the cryptography engine is built as a modular, dockerized microservice:
*   **Base Engine Endpoint**: `http://localhost:8001`
*   **Provider Client**: Defined in `src/Logic/security/tenseal_provider.py` which abstracts the FHE API from the rest of the node-based pipeline execution.
*   **FastAPI TenSEAL Backend**: Implemented in `src/tenseal_engine/main.py` utilizing in-memory context caching and volume-mounted disk persistence for cryptographic contexts.

### 1.2 Mathematical Schemes & Cryptographic Parameters
HVE-OS supports both major FHE schemes:
1.  **CKKS (Cheon-Kim-Kim-Song)**: Used for approximate, floating-point vector calculations. Essential for time-series sensor logs, GPS coordinates, and neural network weights.
2.  **BFV (Brakerski-Fan-Vercauteren)**: Used for exact integer arithmetic, matching transactional ledgers or counts where precision rounding errors are intolerable.

#### Cryptographic Context Parameters:
*   **Polynomial Modulus Degree ($N$)**: Options include `4096`, `8192`, or `16384`. Increasing $N$ expands the multiplicative depth allowance but scales execution time quadratically.
*   **Coefficient Modulus Bit Sizes**:
    *   For $N = 8192$: `[60, 40, 40, 60]`, providing a solid multiplicative depth pool.
    *   For $N = 16384$: `[60, 40, 40, 40, 40, 60]` for deep homomorphic network evaluation.
*   **Global Scale ($\Delta$)**: Configured to $2^{40}$, balancing numerical precision against overflow risks in CKKS real-number encoding.

### 1.3 Key Architecture & Depth Controls
Homomorphic calculations require several specialized key structures to maintain cryptographic security while enabling computations:
*   **Secret Key ($s$)**: Kept strictly private at the client level (`decrypt_node.py`), used to decode final ciphertexts back to plain integers/floats.
*   **Public Key ($pk$)**: Used to encrypt data streams initially (`encrypt_node.py`).
*   **Relinearization Keys ($evk$)**: Crucial for multiplications. Multiplying two ciphertexts of size 2 produces an intermediate ciphertext of size 3. Relinearization keys compress the size back to 2, preventing exponential growth of ciphertext size during sequential products.
*   **Galois Keys**: Generated automatically to support slot rotation and vector shifting within packed CKKS ciphertexts, which is a core requirement for executing dense neural network matrix multiplications.

#### The Rescaling Constraint:
In CKKS, multiplying two ciphertexts multiplies their scaling factors (e.g., $\Delta \times \Delta = \Delta^2$). To prevent the scale from growing infinitely and consuming the modulus pool, HVE-OS applies a programmatic **Rescaling** step (`rescale_to_next()`). This scales the factor back to $\Delta$ and consumes one level from the coefficient modulus. Plaintext-ciphertext multiplications do not increase the modulus level and do not require rescaling.

### 1.4 zero-knowledge Neural Network Forward Propagation
Standard neural networks rely on non-linear activation functions (e.g., ReLU, Sigmoid). Since homomorphic encryption only supports addition and multiplication (ring operations), executing non-polynomial functions directly over encrypted vectors is mathematically impossible without decryption.

HVE-OS resolves this constraint in its custom **FHE Neural Network** (`FHEFlightNet`, implemented in `inference_node.py` and `fhe_sequential_model_node.py`) by replacing ReLU/Sigmoid activations with **Polynomial Activation Functions** (e.g., $y = x^2$ or Chebyshev polynomial approximations):
$$\text{Activation}(x) = x^2$$
This allows the hidden layer dot product to propagate directly over CKKS vectors (`RemoteCKKSVector`) in a pure zero-knowledge format, enabling secure AI inference over untrusted edge routers.

---

## 2. Machine Learning & Time-Series AI

The AI layer in HVE-OS executes high-fidelity sequential predictions on time-series flight and telemetry streams, identifying operational hazards, predicting future system behaviors, and mapping logical network topologies.

```
 ┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
 │   Ingested Silver    ├────►│ Feature Standardizer ├────►│  LSTM / GRU Network  │
 │   DuckDB Snapshots   │     │ (Mean & Std Scalers) │     │ (PyTorch Exec Nodes) │
 └──────────────────────┘     └──────────────────────┘     └──────────┬───────────┘
                                                                      │
                                                                      ▼
 ┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
 │ Dynamic Optimization ├────►│  Model Checkpoints   ├────►│ Relationship Mapping │
 │ (Adam W/ Canceller)  │     │   (.pt weight files) │     │ (Network Embeddings) │
 └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

### 2.1 Time-Series Predictive Models (LSTMs)
HVE-OS utilizes custom **Long Short-Term Memory (LSTM)** recurrent networks for sequence prediction:
*   **Core Model Structure (`FHEFlightNet`)**: Designed to load multidimensional inputs (e.g., historical flight telemetry containing airspeed, altitude, velocity, and sensor temperatures) across sliding sequence windows (e.g., a 5-step lookback).
*   **Weight Checkpoints**: Saved directly in PyTorch format:
    *   `trained_flight_lstm.pt` (Plaintext model weights).
    *   `real_fhe_flight_model.pt` & `real_fhe.pt` (Weights aligned to work with homomorphic polynomial activations).

### 2.2 Model Training Node (`FheSequentialModelNode`)
Implemented in `src/Logic/nodes/ai/fhe_sequential_model_node.py`, this node allows analysts to train LSTM neural networks dynamically inside their execution graphs:
*   **Dynamic Column Binding**: Extracts training target and feature columns on-the-fly based on visual canvas configurations.
*   **Sequence Preprocessing**: Groups data streams (e.g., by `source_id`), standardizes values using calculated mean/variance scalers, and generates overlapping sequence arrays.
*   **Training Loop**: Utilizes an Adam optimizer. Employs a custom asynchronous **user-cancellation signal hook** (`cancel_event`) which stops weight optimization gracefully at any epoch boundary if a manual cancel is triggered on the frontend.

### 2.3 Neural Network Relationship Mapping Node
The AI pipeline includes a dedicated topology-correlation engine:
*   **File**: `src/Logic/nodes/ai/relationship_mapping_node.py`
*   **Logic**: Calculates multi-dimensional network embeddings across edge hubs and flight corridors. By executing dense correlation matrix calculations, it dynamically builds causal linking recommendations between seemingly detached IoT data streams.

### 2.4 Generative LLM Integration
HVE-OS includes causal language generation logic located in `main_el_integration/backend/app/ml/models.py`. It integrates with **Hugging Face Transformers** (specifically loading the `Mistral` series) using the `AutoModelForCausalLM` pipeline, enabling natural language description synthesis for complex multi-layered system alerts.

---

## 3. System Design & Data Lakehouse Architecture

HVE-OS features a highly modular, decoupled architecture consisting of a React Processing Layer, a FastAPI Gateway, and a Lakehouse Storage tier.

```
       [ React UI Ingestion / Processing Canvas ]
                           │
                           ▼ (REST / WebSockets)
        [ Python FastAPI Gateway (localhost:8000) ]
                           │
         ┌─────────────────┼─────────────────┐
         ▼ (Data streams)  ▼ (JSON Graphs)   ▼ (Metadata)
   [ Kafka Broker ]   [ Neo4j Graph ]   [ Postgres DB ]
         │                 │
         ▼                 ▼
   [ MinIO S3 ]◄─────────────────────────────┐
   (Iceberg Metadata / Parquet Data)         │
         ▲                                   │
         └─────────[ DuckDB Engine ]─────────┘
            Silver Catalog Ingestion / Time-Travel
```

### 3.1 Three-Tier Layout
1.  **Frontend (Vite / React 19)**: Implements an interactive drag-and-drop processing pipeline designer powered by **ReactFlow**, dynamic dashboard panels, and direct console tickers showing execution diagnostics.
2.  **FastAPI Gateway (Port 8000)**: Serves as the central API broker, managing sources, starting background graph executors, and routing spatial query payloads.
3.  **Lakehouse Storage Core**: Decoupled persistent brokers optimized for spatial, graph, and transactional loads.

### 3.2 Lakehouse Database & Storage Stack
HVE-OS incorporates five core databases, each carefully selected for specific operational workloads:

*   **Apache Iceberg (MinIO S3)**: Configured as the core analytical data store. Ingested telemetry is written in parquet format to a local MinIO S3 container wrapped in an Iceberg catalog structure, enforcing robust schema evolution and transactional isolation.
*   **DuckDB In-Memory Engine**: Acts as the dynamic processing layer for the Iceberg analytical tier. It queries Parquet data directly from S3, registers active silver tables, and provides exceptionally fast spatial SQL processing capabilities.
*   **PostgreSQL**: Manages core application metadata, including user-configured pipeline blueprints, ingestion settings, and active logical nodes.
*   **Neo4j Graph Database**: Stores topological mappings and semantic links between physical routers, hangar telemetry, and logical network nodes (`neo4j_service.py`).
*   **Kafka Messaging Broker**: Acts as the live ingestion stream buffer, capturing real-time edge telemetry and feeding it asynchronously into processing pipelines.

### 3.3 Iceberg Time-Travel Capabilities
By leveraging the Apache Iceberg metadata layer, HVE-OS enables **Time-Travel Querying** (`executeTimeTravelQuery`, defined in `client.js`). Every data write or schema update in the Lakehouse writes a new Iceberg metadata snapshot. This allows analysts to run spatial queries targeted at historical snapshot IDs, reviewing system states as they existed at a specific moment in time (e.g., to debug a past cybersecurity intrusion).

---

## 4. Quantum-Inspired & Pipeline Graph Logic

Beyond standard sequential and database operations, the HVE-OS processing graph executes custom topological flow routing, quantum-inspired causal expansion, and aggregated risk scoring.

```
      [ Stream Ingest Node ]           [ Threat Vector Node ]
                │                                │
                ▼                                ▼
       ┌──────────────────────────────────────────────────┐
       │             Risk Scoring Logic Node              │
       │ Calculates safety scores, decrypts HE flags,     │
       │ maps data quality failures.                      │
       └────────────────────────┬─────────────────────────┘
                                │
                                ▼
                      [ Trigger Action Node ]
                     (e.g., Twilio API Alert)
```

### 4.1 Causal Expansion Graph Operations
HVE-OS pipelines leverage quantum-inspired causal routing concepts to determine node dependencies. By analyzing directed acyclic graph (DAG) flows, the pipeline executor determines exact causal event sequences. This ensures that node execution coordinates perfectly based on prior data states rather than arbitrary scheduling intervals.

### 4.2 Risk Scoring Engine (`RiskScoringNode`)
*   **File**: `src/Logic/nodes/logic/risk_scoring_node.py`
*   **Logic**: Evaluates a weighted health score ($S$) representing system state:
    $$S = 100 - \sum (W_i \times C_i)$$
    Where:
    *   $W_i$ is the weight of alert type $i$ (e.g., FHE validation failures, network latency warnings, or cyber intrusion threat triggers).
    *   $C_i$ is the severity coefficient (Critical = 1.0, Warning = 0.5, Healthy = 0).
*   **Data Quality Integration**: Integrates directly with Iceberg metadata flags. If data quality rules fail, a `dq_failed` column is flagged on the row, which the Risk Scoring Node automatically intercepts to degrade the system score and alert operators.

### 4.3 Multi-Stream Combiner & Splitter Nodes
*   **Extract Entities Node (`extract_entities.py`)**: Uses NLP tokenizers to scan plaintext streams, pulling physical nodes out of raw messages and adding them to the Neo4j active graph catalog.
*   **Splitter Node (`split.py`)**: Divides continuous incoming JSON streams into parallel feature flows, routing them to AI predictors and security verification blocks simultaneously.
*   **Combiner Node (`combine.py`)**: Joins asynchronous inputs back into a single unified JSON payload before writing to the DuckDB Lakehouse.

---

## 5. Architectural Summary: Technology Mapping

The following matrix maps HVE-OS system components to their core technologies and implementation files:

| Area | Core Technology | File / Directory Reference |
| :--- | :--- | :--- |
| **Cryptography** | SEAL FHE Library (CKKS/BFV) | [tenseal_engine/main.py](file:///d:/Projects/HVE-OS/src/tenseal_engine/main.py) |
| **Cryptography** | Homomorphic Context Client | [Logic/security/tenseal_provider.py](file:///d:/Projects/HVE-OS/src/Logic/security/tenseal_provider.py) |
| **Cryptography** | Secure Encrypt / Decrypt | [Logic/nodes/security/](file:///d:/Projects/HVE-OS/src/Logic/nodes/security/) |
| **Machine Learning** | PyTorch time-series LSTMs | [Logic/nodes/ai/inference_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/ai/inference_node.py) |
| **Machine Learning** | Dynamic AI Training | [Logic/nodes/ai/fhe_sequential_model_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/ai/fhe_sequential_model_node.py) |
| **Machine Learning** | Entity Embedding Predictor | [Logic/nodes/ai/relationship_mapping_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/ai/relationship_mapping_node.py) |
| **System Design** | Processing Pipeline Canvas | [processing_layer_frntnd/frontend/](file:///d:/Projects/HVE-OS/processing_layer_frntnd/frontend/) |
| **System Design** | Apache Iceberg / Parquet Core | [src/gateway/services/mapping_service.py](file:///d:/Projects/HVE-OS/src/gateway/services/mapping_service.py) |
| **System Design** | DuckDB Query Processor | [src/gateway/routers/](file:///d:/Projects/HVE-OS/src/gateway/routers/) |
| **System Design** | Semantic Mappings (Neo4j) | [src/gateway/services/neo4j_service.py](file:///d:/Projects/HVE-OS/src/gateway/services/neo4j_service.py) |
| **System Design** | Stream Buffer Ingestion (Kafka)| [src/gateway/services/kafka_service.py](file:///d:/Projects/HVE-OS/src/gateway/services/kafka_service.py) |
| **Logic & Quantum** | Risk Scoring Engine | [Logic/nodes/logic/risk_scoring_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/logic/risk_scoring_node.py) |
| **Logic & Quantum** | Multi-stream pipeline splits | [Logic/nodes/logic/split.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/logic/split.py) |
