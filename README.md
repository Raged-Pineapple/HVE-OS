# HVE-OS: Stage 1 Perimeter

This project implements the foundational data ingestion layer of the HVE-OS Data Lakehouse. It acts as a resilient shield for raw data ingestion using MinIO (Batch) and Apache Kafka (Streams).

## Prerequisites
- [Docker & Docker Compose](https://www.docker.com/products/docker-desktop)
- [Python 3.10+](https://www.python.org/downloads/)

## How to Run

### 1. Start Infrastructure
Run the following in the project root to start **MinIO** and **Kafka**:

```powershell
docker-compose up -d
```

- **MinIO Console**: [http://localhost:9001](http://localhost:9001) (User: `hve_admin`, Password: `hve_password123`)
- **Kafka**: Accessible at `localhost:29092`

### 2. Start Gateway API
Navigate to the `src/gateway` directory and run the FastAPI server:

```powershell
cd src/gateway
# (Optional) Create a virtual environment
python -m venv venv
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the API
python main.py
```

The API will be available at [http://localhost:8000](http://localhost:8000).

### 3. Verify Health
Check if the API is running by visiting:
[http://localhost:8000/health](http://localhost:8000/health)

## Architecture Overview
For a deeper dive into the architectural principles, see [docs/perimeter_architecture.md](docs/perimeter_architecture.md).
