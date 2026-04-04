# Stage 1: The Perimeter (Capture & Shield)

## Overview
The Perimeter is the foundational data ingestion layer of the HVE-OS Data Lakehouse. Its absolute primary directive is **resilience**, acting as an unbreakable shield between the raw data sources and our internal processing pipelines. To achieve this, The Perimeter strictly adheres to the rule: *The API is "dumb," Data Pipelines are "dumb," the Database is "smart."*

## Architecture

We split ingestion into **Batch** (massive static files) and **Streams** (real-time telemetry).

### 1. Batch Data: Generating Pre-Signed URLs
If a user or device attempts to upload a 50GB CSV file through a traditional REST API, the server will quickly run out of memory and crash. We bypass this entirely.
- The user authenticates with our API Gateway.
- The API Gateway executes a lightweight call to **MinIO** requesting a **Pre-Signed URL** for `bronze/batch/{source_id}/{filename}` valid for 1 hour.
- The API immediately returns this URL to the user.
- The client streams the 50GB file *directly* from their machine into the MinIO hard drives. 
- *Impact*: Zero memory penalty on the server, infinitely scalable static ingestion.

### 2. Stream Data: The Canonical Envelope & Apache Kafka
When IoT sensors, Flight telemetry, or external APIs stream thousands of JSON events per second, saving them individually to disk will cause IO thrashing.
- The `POST /api/v1/ingest/stream` endpoint receives raw JSON telemetry.
- The API wraps the raw payload in a **Canonical Envelope**:
  ```json
  {
      "hve_id": "8d3e2a14-...",          // Globally unique identifier for this event
      "source_id": "opensky_network",   // The schema blueprint origin
      "ingest_timestamp": "2026-03-29T...", // When reality originally occurred
      "payload": { ...raw... }          // The unmodified raw data
  }
  ```
- The API Gateway utilizes a high-throughput, fire-and-forget **Apache Kafka Producer** to push this wrapped JSON string to the `raw-telemetry` topic.
- The API immediately responds `202 Accepted`.
- *Wait, why not MinIO too?*: To preserve maximum API throughput, the API does *not* write real-time streams to MinIO. The event lives resiliently on Kafka. Downstream bulk-consumers (like Apache Flink) will pull from this Kafka buffer.
- *Impact*: Kafka handles backpressure and traffic spikes effortlessly. The API acts as a pure, hyper-fast "Shock Absorber."

## Testing with the Universal CLI

To test the Perimeter with any custom data, use the `scripts/hve_ingest.py` utility. This tool demonstrates the "Capture & Shield" architecture without any hardcoded logic.

### 1. Ingesting Real-time Streams
You can pipe any JSON from your custom APIs into the HVE stream.
```powershell
python scripts/hve_ingest.py stream --source "my_custom_api" --data '{"key": "value", "telemetry": 123}'
```
Or, if you have your API output saved to a file:
```powershell
python scripts/hve_ingest.py stream --source "opensky_data" --file "my_api_response.json"
```

### 2. Dropping Massive Static Files (Batch)
This command demonstrates the direct-to-MinIO memory bypass.
```powershell
python scripts/hve_ingest.py batch --source "historical_dump" --path "C:/path/to/my_huge_file.csv"
```
The HVE Perimeter will fetch a Pre-Signed URL and the script will stream the bytes directly to MinIO, ensuring the API server remains crash-proof.

---

## Infrastructure Services
* **MinIO (Ports 9000 & 9001):** The physically immutable "Bronze" hard drives.
* **Apache Kafka (Port 9092):** The stream buffer running in Zookeeper-less KRaft Mode.
* **Gateway API (Port 8000):** A Python FastAPI service facilitating the routing without carrying the weight of the data itself.
