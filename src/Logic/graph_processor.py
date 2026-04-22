"""
graph_processor.py — Knowledge Graph Ingestion Processor
Consumes from Silver Kafka and upserts entities into Neo4j.
"""
import os
import sys
import json
import logging
import threading
import time
from confluent_kafka import Consumer, KafkaError

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gateway"))
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from services import neo4j_service, kafka_service, db_service, query_service
from services.kafka_service import SILVER_TOPIC
from collections import defaultdict

logger = logging.getLogger(__name__)

# Configuration
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
CONSUMER_GROUP = "hve-graph-processor-v1"

class GraphProcessor:
    """
    Background Kafka consumer that:
    1. Listens for clean records on the Silver Kafka topic.
    2. Maps records to Knowledge Graph entities.
    3. Upserts entities into Neo4j.
    """
    def __init__(self):
        self._consumer = None
        self._running = False
        self._thread = None
        self._neo4j = None
        self._buffers = defaultdict(list)
        self._last_flush = time.time()
        self._blueprint_cache = {}
        self._cache_ttl = 60

    def start(self):
        """Start the consumer in a background thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="graph-processor")
        self._thread.start()
        logger.info("GraphProcessor started in background thread.")

    def stop(self):
        """Gracefully stop the consumer."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)
        if self._consumer:
            self._consumer.close()
        logger.info("GraphProcessor stopped.")

    def _run(self):
        """Main consumer loop."""
        try:
            logger.info("GraphProcessor: Connecting to Neo4j...")
            self._neo4j = neo4j_service.get_neo4j_service()
            logger.info("GraphProcessor: Neo4j service initialized.")
            
            self._consumer = Consumer({
                'bootstrap.servers': KAFKA_BROKERS,
                'group.id': CONSUMER_GROUP,
                'auto.offset.reset': 'earliest',
                'enable.auto.commit': True,
            })
            self._consumer.subscribe([SILVER_TOPIC])
            logger.info(f"GraphProcessor subscribed to Kafka topic: {SILVER_TOPIC}")

            while self._running:
                msg = self._consumer.poll(timeout=1.0)

                if msg is None:
                    self._check_flush_timeout()
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error(f"Kafka error in GraphProcessor: {msg.error()}")
                    continue

                try:
                    msg_val = msg.value().decode('utf-8')
                    row = json.loads(msg_val)
                    source_id = row.get("_source_id", "unknown")
                    self._buffers[source_id].append(row)
                    
                    if len(self._buffers[source_id]) >= 100:
                        self._flush_buffer(source_id)
                except Exception as e:
                    logger.error(f"Error in GraphProcessor row processing: {e}")
                
                self._check_flush_timeout()

            # Flush remaining on shutdown
            for source_id in list(self._buffers.keys()):
                if self._buffers[source_id]:
                    self._flush_buffer(source_id)

        except Exception as e:
            logger.error(f"GraphProcessor crashed: {e}")
        finally:
            if self._consumer:
                self._consumer.close()

    def _check_flush_timeout(self):
        if time.time() - self._last_flush > 5:
            for source_id in list(self._buffers.keys()):
                if self._buffers[source_id]:
                    self._flush_buffer(source_id)
            self._last_flush = time.time()
            
    def _get_blueprint(self, source_id: str):
        cached = self._blueprint_cache.get(source_id)
        if cached and (time.time() - cached[1]) < self._cache_ttl:
            return cached[0]
        try:
            bp = db_service.get_graph_blueprint(source_id)
            self._blueprint_cache[source_id] = (bp, time.time())
            return bp
        except Exception as e:
            logger.warning(f"Failed to fetch graph blueprint for {source_id}: {e}")
            return cached[0] if cached else None

    def _flush_buffer(self, source_id: str):
        messages = self._buffers.pop(source_id, [])
        if not messages:
            return
            
        bp = self._get_blueprint(source_id)
        if bp:
            # Cypher template mode
            try:
                self._neo4j.execute_write(bp["cypher_template"], {"rows": messages})
                logger.info(f"GraphProcessor: Batch of {len(messages)} applied via Blueprint for {source_id}")
            except Exception as e:
                logger.error(f"GraphProcessor Blueprint execution failed for {source_id}: {e}")
        else:
            # Fallback legacy mode
            for row in messages:
                self._process_row_fallback(row)

    def _process_row_fallback(self, row: dict):
        """Legacy fallback if no Cypher template exists."""
        source_id = row.get("_source_id", "unknown")
        label = "".join(word.capitalize() for word in source_id.split("_"))

        callsign = row.get("callsign")
        merge_key = None
        
        if callsign and str(callsign).strip():
            row["callsign"] = str(callsign).strip()
            merge_key = "callsign"

        self._neo4j.upsert_entity(label, row, merge_key=merge_key)
        
        if "icao24" in row and row["icao24"]:
             self._link_flight_data(row, merge_key)

    def _link_flight_data(self, row: dict, merge_key: str = None):
        """Specific logic for flight data to build trajectories (Fallback only)."""
        icao24 = row["icao24"]
        m_key = merge_key or "_hve_id"
        m_val = row.get(m_key)
        
        safe_key = "".join(c for c in m_key if c.isalnum() or c == '_')
        
        query = f"""
        MERGE (a:Aircraft {{ icao24: $icao24 }})
        WITH a
        MATCH (e:Entity {{ {safe_key}: $m_val }})
        MERGE (a)-[:PRODUCED_OBSERVATION]->(e)
        """
        try:
            self._neo4j.execute_write(query, {"icao24": icao24, "m_val": m_val})
        except Exception as e:
            pass

    def sync_table_to_graph(self, source_id: str):
        """Batch sync from Silver via DuckDB."""
        try:
            logger.info(f"Starting Gold Sync for {source_id}...")
            bp = db_service.get_graph_blueprint(source_id)
            if not bp:
                logger.error(f"Sync aborted: No Graph Blueprint for {source_id}")
                return
                
            log_id = db_service.log_processing_start(source_id, "GOLD_SYNC")
            
            # Simple full sync for now
            # In a true incremental system, we would query ICEBERG snapshot metadata and filter
            sql = f"SELECT * FROM {source_id}"
            res = query_service.execute_query(sql, limit=100000)
            
            if not res or not res.get("rows"):
                logger.info(f"No rows to sync for {source_id}")
                db_service.log_processing_complete(log_id, "", 0, 0, 0, "COMPLETED", "No Silver rows")
                return
                
            rows = res["rows"]
            
            # Batch into Neo4j in chunks of 500
            batch_size = 500
            nodes_added = 0
            
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i+batch_size]
                self._neo4j.execute_write(bp["cypher_template"], {"rows": batch})
                nodes_added += len(batch)
            
            # Update Registry
            db_service.update_gold_registry(source_id, nodes_added, 0) # snapshot ID 0 for dummy sync
            db_service.log_processing_complete(log_id, f"nodes:{nodes_added}", len(rows), nodes_added, 0, "COMPLETED")
            
            logger.info(f"Gold Sync Complete: {source_id} ({nodes_added} nodes)")
            
        except Exception as e:
            logger.error(f"Gold Sync failed for {source_id}: {e}")
            if 'log_id' in locals():
                db_service.log_processing_complete(log_id, "", 0, 0, 0, "FAILED", str(e))

# Singleton instance
_processor = None

def get_graph_processor() -> GraphProcessor:
    global _processor
    if _processor is None:
        _processor = GraphProcessor()
    return _processor
