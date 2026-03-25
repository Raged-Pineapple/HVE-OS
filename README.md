# Palantir-Tier Intelligence Data Operating System (HVE_OS)

Welcome to the finalized Level 3 Maturity Data Operating System. This architecture has been built from the ground up over 15 distinct phases, migrating from basic data pipelines all the way to autonomous Graph Neural Network retraining loops.

## Prerequisites
- Docker & Docker Compose
- Python 3.10+
- Node.js 18+

## 1. System Orchestration (The Infrastructure)
The system relies on 4 core infrastructure services: PostgreSQL (Raw Storage), Eclipse Mosquitto (IoT MQTT Streams), Neo4j (Graph Ontology), and Redis (Real-Time Fast Cache World State).

Start the infrastructure:
```bash
cd backend
docker-compose up -d
```

## 2. Start the Backend API (FastAPI)
The backend acts as the unified API for connectors, graph manipulation, optimization engines, and the active learning loop.

```bash
cd backend
# Activate virtual environment
.\venv\Scripts\activate
# Install requirements if not done
pip install -r requirements.txt
# Start the uvicorn server on port 8000
uvicorn app.main:app --reload --port 8000
```

## 3. Start the Visual UI Engine (React Flow)
The frontend allows operators to drag and drop pipeline triggers, AI predictors, optimization engines, and actions into a compiled execution graph.

```bash
cd frontend
npm install
npm run dev
```
Navigate to `http://localhost:5173` to interact with the Glassmorphism UI.

---

## 4. The Functional Demo Suite (Running the 15 Phases)

We have preserved the testing harnesses for every single Phase of construction. You can run these from the `backend` directory while the `uvicorn` server is active to see the terminal output of each system functionally.

**Level 1: The Pipeline**
*   `python test_phase1.py` - Proves the MQTT IoT and API streaming connectors ingest and format raw data correctly.
*   `python test_phase2.py` - Runs the Pandas data cleaning transformations and generates lineage tracking in PostgreSQL.

**Level 2: Graph & Intelligence Core**
*   `python test_phase3.py` - Demonstrates the Ontology Mapper actively structuring raw rows into Neo4j Graph Network paths.
*   `python test_phase4.py` - Runs the 1D Kalman Filters recursively to smooth noisy streaming metrics via `filterpy`.
*   `python test_phase5.py` - Fires the OR-Tools CPSAT solver to constraint-optimize flight route capacities.
*   `python test_phase7.py` - Generates mock Webhook actions out to external 3rd party services based on rule violations.
*   `python test_phase8.py` - Simulates human operators submitting ground truth API corrections via the Feedback Loop.

**Level 3: Palantir Mechanics**
*   `python test_phase9.py` - Verifies the Ontology Core. The Optimizer fetches its reality completely from the Neo4j API instead of static dicts.
*   `python test_phase10.py` - Blasts 1,000 rapid telemetry state updates into Redis to benchmark the Real-Time caching layer and verifies the silent sync up to Neo4j.
*   `python test_phase11.py` - Triggers the **Scenario Simulation Engine**. Clones the Neo4j graph in memory, mathematically destroys a route via a weather event, and runs the AI Optimization strictly on the localized branch reality to safely test hypothetical damage.
*   `python test_phase12.py` - Proves the Advanced Graph AI. Forces the Regressor model to evaluate a safe node, but correctly aggregates dangerous Topographical context (1-hop neighbors) and Temporal trajectory (Redis history) to spike the composite risk.
*   `python test_phase13.py` - Mocks the frontend React payload and fires it at the Backend Workflow Interpreter, proving the system can dynamically compile and natively execute arbitrary drag-and-drop workflow strings.
*   `python test_phase14.py` - Fires the Governance Tracker, proving that the operating system natively stamps all predictions with an immutable cryptographic SHA-256 hash isolating the exact versions of the Data, Model, and Graph Schema.
*   `python test_phase15.py` - The final Turing tier. Rapidly injects catastrophic prediction feedback via the API. The background **Active Learning Worker** automatically detects the model drift, builds a new composite ground-truth dataset natively, retrains the ML Model recursively, hot-swaps the memory pointer to the new matrix, and increments the Version Control completely autonomously.
