# HVE-OS API Models Reference

This document serves as the central data dictionary for the HVE-OS Gateway API. The system uses **Pydantic Models** to strictly validate all incoming and outgoing data. This prevents bad configuration states from ever reaching the backend pipeline.

---

## 1. Core Enumerations (Enums)
Enums act as strict dropdown menus for the system. The API will aggressively reject (422 Unprocessable Entity) any input that does not exactly match one of these allowed terms.

### `SourceType`
Defines how data physically enters the perimeter.
* **`STREAM`**: Real-time firehose data hitting your `/ingest/stream` endpoint (e.g., live flight radar coordinates).
* **`API_POLL`**: Scheduled internal jobs where HVE-OS wakes up and automatically fetches data from an external REST API (e.g., OpenStreetMap, NewsAPI).
* **`STATIC_FILE`**: Massive historical datasets (like a 50GB CSV) dropped directly into MinIO using a Pre-Signed URL memory-bypass.

### `AuthType`
Defines how internal pollers authenticate against external `API_POLL` targets.
* **`NONE`**: Public open APIs.
* **`API_KEY`**: Passes a token in the URL or headers.
* **`BEARER`**: Passes a Bearer token in the Authorization header.
* **`BASIC`**: Standard HTTP Basic Auth (Username/Password).

### `DQAction`
Defines the strict operational trigger when a row fails a Data Quality Python rule.
* **`QUARANTINE`**: The standard default. The row is stripped from the main Iceberg pipeline and saved physically in the `hve-dlq` (Dead Letter Queue) bucket in MinIO. It allows engineers to inspect bad data without losing it.
* **`DROP`**: The row is instantly annihilated from memory.
* **`FLAG`**: The row is allowed to pass into the Silver layer, but it is tagged with a warning metadata field indicating it failed a soft check.

### `DQSeverity`
Defines the strictness or logging level of a rule failure.
* **`ERROR`**: Immediately halts the row and executes the `DQAction`.
* **`WARNING`**: Operates the action but logs it distinctly, usually paired with a `FLAG` action.
* **`INFO`**: Never halts the pipeline; simply triggers an informational trace log in the control plane.

---

## 2. Stage 1: Perimeter Models (Ingest)

These models govern the pure ingestion buffer layer, designed for high-throughput capability.

* **`StreamPayload`**: The JSON shape expected when you send live data. It consists of the `source_id` mapping, the raw json `data`, and a `debug` toggle.
* **`CanonicalEnvelope`**: The universal wrapper that wraps *all* incoming data regardless of the source. It tacks on a global UUID (`hve_id`) and timestamp so we never lose track of reality vs. processing time.
* **`PreSignedUrlRequest` / `Response`**: Used exclusively for large static file dumps to guarantee the API server's RAM never crashes under heavy load.

---

## 3. Stage 3: Control Plane Models

The Control Plane defines how the dumb data pipeline engine interprets the raw data.

### Source Registration
* **`SourceRegistration`**: Used to formally declare a data stream to the control plane, defining its ID, type, and protocol.
* **`APISourceConfig`**: Specifically used when configuring an `API_POLL`. Includes the `poll_interval_seconds` (capped at 86400 seconds) and the `extraction_path` to isolate arrays from nested generic REST APIs.

### Mapping Blueprints
* **`MappingBlueprintCreate`**: A scalpel command. Tells the pipeline exactly how to extract a heavily nested raw generic JSON field (e.g. `$.tags.military`) and explicitly flatten it into a mathematically-queryable Silver column in Iceberg (e.g., `target_field: "category"`).

### Data Quality Rules
* **`DQRuleCreate`**: Submits pure Python executable strings to the `stream_processor`. Features the `rule_logic` (e.g. `category == 'base'`), which acts as an inline streaming filter. Drops, quarantines, or flags based on definitions.

---

## 4. Stage 5: Query Models

Interfaces directly with the analytical tools to read the Data Lakehouse.

* **`QueryRequest`**: Accepts standard SQL using DuckDB. Supports dynamic joins across the physical MinIO storage.
* **`TimeTravelQueryRequest`**: Specific to Apache Iceberg. Accepts standard SQL but strictly targets a specific historic `snapshot_id`, perfectly reconstructing a query exactly as the data existed at a past millisecond.
* **`SnapshotInfo`**: Exposes the transactional commit history of an Iceberg table, returning the millisecond timestamps and lineage.

---

## 5. Debug / Trace Models

These trace payloads mathematically monitor what happens to an event in synchronous time.

* **`PipelineTrace`**: A massive payload returning the execution times (in milliseconds) and Status (`PASSED`/`FAILED`) of every single layer of the architecture (Bronze, Blueprints, DQ Gate, Silver Iceberg) for a single test event payload. Used heavily when setting `debug: true` on the stream endpoint.
