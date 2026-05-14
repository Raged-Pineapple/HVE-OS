# HVE-OS Main Execution Logic & Node Implementation

This document details the complete current implementation of the HVE-OS Graph Execution Engine, including data ingestion, the actor-model backend executor, and the precise logic inside the processing nodes (like the Risk Calculator).

---

## 1. The Backend Executor (The Reactive Graph Engine)

The HVE-OS execution engine has evolved from a brute-force polling loop into a **Reactive, Actor-Model Event Engine**. 

### Core Mechanics
* **Event-Driven Wakeups:** The engine no longer runs on a timer or blocks processing by evaluating entire dependency layers (`asyncio.gather`). Instead, it uses targeted wakeups. When a data source updates, the engine specifically calls `engine.trigger_source("source_id")`.
* **Cascading Execution:** Once a node finishes processing, it directly triggers its specific downstream children using `self.trigger_node(target_id)`.
* **Debouncing & Queue Management:** To prevent slow nodes from stacking up infinite execution queues (e.g., if triggered 1,000 times by rapid upstream events), nodes run inside a `while self.dirty_flags[node_id]:` loop. This acts as a shock absorber, safely frame-dropping redundant intermediate states and ensuring the node runs a final time with the freshest data.
* **GIL Management (Thread Offloading):** Massive dataset serialization (like converting 60,000 nested Neo4j entities to JSON) previously locked the Python Global Interpreter Lock (GIL), freezing the FastAPI ASGI loop. This is circumvented by offloading heavy hashing and stringification to a background ThreadPool (`await asyncio.to_thread(_dump_json, message)`), guaranteeing non-blocking WebSocket streams.

---

## 2. Data Ingestion & Perimeter Storage

Before data enters the visual graph, it is ingested through a strictly typed perimeter defined by Pydantic models.

### Ingestion Connectors (API Pollers)
The system uses asynchronous Python connectors extending `SourceConnector` to pull external intelligence:
* **ACLED:** Fetches global conflict data using token-based OAuth (`POST` for token, `GET` for data).
* **GDELT & NewsAPI:** Queries news firehoses for supply chain and commodity disruptions.
* **FRED & WorldBank:** Pulls macroeconomic indicators and commodity price fluctuations.
* **Freightos:** Fetches global freight index updates.
* **Google News:** Parses RSS XML feeds for configurable query strings.

All raw data is formatted into a universal `NormalizedRecord` containing a `source_id`, `text`, `timestamp`, `location`, and a generic `metadata` JSON blob.

### Data Storage (Neo4j Graph Database)
Relational risk data is pushed into Neo4j via `GraphService.upsert_risk_paths_batch()`. This method explodes flattened records into an ontology:
* **Nodes:** `RiskEvent`, `Country`, `Port`, `Commodity`, `Supplier`, and `Manufacturer`.
* **Edges:** `AFFECTS_COUNTRY`, `AFFECTS_PORT`, `AFFECTS_COMMODITY`, `LOCATED_IN`, `SHIPS_THROUGH`, `PROVIDES`, `MONITORS`, and `EXPOSES`.
Each edge carries an `impact_weight` (e.g., `AFFECTS_PORT {weight: 0.9}`).

---

## 3. Node Logic: The Risk Calculator

The nodes in the UI (Frontend) and Engine (Backend) are completely decoupled, operating via Duck Typing.

### The Python Backend (`risk_calculator.py`)
1. **Input Resolution & The Golden Boilerplate:** 
   The node looks for data on the `data`, `default`, or `target` handles. If the node is triggered by a UI preview (empty inputs), it safely falls back to `config.get("previewInput")` without crashing.
2. **Smart Bulk vs. Scalar Execution:** 
   The engine checks `isinstance(input_val, list)`. If it's a bulk array from Neo4j, it maps the internal `_process()` function across every item. If it's a single streaming dict, it processes it instantly.
3. **Explicit Data Lineage:** 
   Data isn't destroyed. The node creates a `.copy()` of the dictionary, runs its base risk extraction (currently pulling an explicit `severity` float, or defaulting to `0.5`), and injects it into a user-configurable `target_field` (default: `risk_score`).
4. **Categorical Split Routing:** 
   The node buckets the entities into separate Python arrays based on the calculated risk (`high_risk` >= 0.7, `medium_risk` >= 0.4, `low_risk` < 0.4) and outputs all arrays to their respective handles for downstream branching.

### The React Frontend (`RiskCalculatorNode.jsx`)
1. **Zero-API Previews:** 
   The frontend never calls the backend to resolve schemas. It uses the `resolveUpstreamData` hook to parse the `edges` and dynamically read the data structure from upstream nodes. 
2. **Syncing via WebSocket:** 
   It saves a sample of the upstream schema to `previewInput` and syncs it back to the Python backend via the WebSocket graph state diff (`type: 'graph_update'`).
3. **Entity Pinning & Search:** 
   The node's `SettingsForm` provides a rich interactive search panel for `high_risk`, `medium_risk`, and `low_risk` data subsets, allowing users to "Pin" critical entities. These pinned entities generate dynamic output handles (e.g., `entity-out-pinned-hve_123::SupplierName`) mapped back to backend routing logic.

---

## 4. The Risk Engine Logic (Graph Pathing)

The actual calculation of Risk is handled by Neo4j's Cypher traversal, specifically inside the `GraphService`.

### Path Weight Estimation
The backend function `estimate_path_weight` calculates how heavily an event affects a mapped supplier by mathematically multiplying edge weights across a 1-to-3 hop path:
```cypher
MATCH (e:RiskEvent {event_id: $event_id})
MATCH (s:Supplier {supplier_id: $supplier_id})
OPTIONAL MATCH p=(e)-[:AFFECTS_COUNTRY|AFFECTS_PORT|AFFECTS_COMMODITY*1..3]->(i)
<-[:LOCATED_IN|SHIPS_THROUGH|PROVIDES]-(s)
RETURN coalesce(max(reduce(w = 1.0, rel IN relationships(p) | w * coalesce(rel.impact_weight, 1.0))), 1.0) AS best_weight
```
* **Example Traversal:** `RiskEvent(Strike) -> AFFECTS_PORT(0.9) -> Port(Shanghai) <- SHIPS_THROUGH(0.8) <- Supplier`.
* **Reduction:** `0.9 * 0.8 = 0.72` Path Weight.
* This path weight is then factored against the event's raw severity and the supplier's criticality to establish a final composite score.

### Downstream Impact Aggregation
The `get_impact` and `get_supplier_risk` functions allow the application to query the graph in reverse—looking at a single `Manufacturer` to return all connected `Suppliers` and the specific paths (`path_types`) of events currently exposing them to risk.

---

## 5. System Interconnectivity (The Big Picture)

1. **Ingest:** A scheduled task wakes up the `NewsAPIConnector`. It fetches JSON and converts it to a list of `NormalizedRecord` objects.
2. **Perimeter Database:** These records hit the FastAPI `/ingest` route. Data is logged in PostgreSQL (RiskRecord) and MinIO (Iceberg Lakehouse).
3. **Graph Materialization:** The pipeline triggers `upsert_risk_paths_batch()` which maps the NLP-extracted entities to their graph representations in Neo4j.
4. **UI Notification:** The Neo4j insertion triggers the Graph Executor's event system: `engine.trigger_source("newsapi")`.
5. **Graph Execution:** The Engine pulls the fresh Neo4j entities, passes them through the `SourceNode`, cascades them into the `RiskCalculatorNode`, and offloads the JSON serialization of the results to a separate thread.
6. **Real-time Sync:** The ASGI loop broadcasts the JSON via WebSocket to the React Flow instance, automatically updating the counts and subsets in the UI.
