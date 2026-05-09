"""
neo4j_service.py — Neo4j Graph Database Client
The Knowledge Graph (Stage 5) link. Handles semantic storage and relationships.
"""
import os
import logging
from neo4j import GraphDatabase

logger = logging.getLogger(__name__)

# Configuration
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "hve_password123")

class Neo4jService:
    """
    Singleton service for Neo4j operations.
    Handles connection pooling and Cypher execution.
    """
    _driver = None

    def __init__(self):
        if Neo4jService._driver is None:
            try:
                Neo4jService._driver = GraphDatabase.driver(
                    NEO4J_URI, 
                    auth=(NEO4J_USER, NEO4J_PASSWORD)
                )
                # Verify connectivity
                Neo4jService._driver.verify_connectivity()
                logger.info(f"Successfully connected to Neo4j at {NEO4J_URI}")
            except Exception as e:
                logger.error(f"Failed to connect to Neo4j: {e}")
                Neo4jService._driver = None

    def close(self):
        if Neo4jService._driver:
            Neo4jService._driver.close()
            Neo4jService._driver = None
            logger.info("Neo4j driver closed.")

    def execute_query(self, query: str, parameters: dict = None):
        """
        Executes a query and returns the results as a list of dicts.
        Consumes the result within the session context to prevent ResultConsumedError.
        """
        if not Neo4jService._driver:
            logger.error("Neo4j driver not initialized.")
            return []
        
        with Neo4jService._driver.session() as session:
            try:
                result = session.run(query, parameters)
                return [dict(record) for record in result]
            except Exception as e:
                logger.error(f"Neo4j Query Error: {e}")
                raise

    def execute_write(self, query: str, parameters: dict = None):
        """
        Executes a write query (MERGE/CREATE/SET) in a transaction.
        Use this for idempotent upserts.
        """
        if not Neo4jService._driver:
            logger.error("Neo4j driver not initialized.")
            return None
            
        def _txn(tx, q, p):
            result = tx.run(q, p)
            return result.consume() # Ensure it's fully executed

        with Neo4jService._driver.session() as session:
            try:
                return session.execute_write(_txn, query, parameters)
            except Exception as e:
                logger.error(f"Neo4j Write Error: {e}")
                raise

    def run_query(self, query: str, parameters: dict = None):
        """Deprecated: Use execute_query or execute_write instead."""
        return self.execute_query(query, parameters)

    def upsert_entity(self, properties: dict, merge_key: str = None):
        """
        Upserts an entity node based on a merge key (defaults to _hve_id).
        Adds an automatic label based on source_id and links to a Source node.
        """
        # Determine the unique identifier for merging
        # If merge_key is provided (e.g. 'callsign'), use it.
        # Fallback to _hve_id (unique per row).
        
        m_key = merge_key or "_hve_id"
        m_val = properties.get(m_key)
        
        if not m_val:
            logger.warning(f"Upsert failed: properties missing merge_key '{m_key}'. Falling back to _hve_id.")
            m_key = "_hve_id"
            m_val = properties.get("_hve_id")
            
        if not m_val:
            logger.error("Upsert failed: No identifier found (neither merge_key nor _hve_id). Skipping.")
            return

        source_id = properties.get("_source_id", "unknown")
        
        # Automatically generate PascalCase label from source_id (matching graph.py logic)
        label = "".join(word.capitalize() for word in source_id.split("_"))
        
        # We dynamicallly inject the merge key name into the MERGE clause.
        # We ensure it's a safe alphanumeric string to prevent injection.
        safe_key = "".join(c for c in m_key if c.isalnum() or c == '_')
        
        query = f"""
        MERGE (e:Entity {{ {safe_key}: $m_val }})
        SET e += $props
        SET e:{label}
        MERGE (s:Source {{ source_id: $source_id }})
        MERGE (e)-[:PART_OF_SOURCE]->(s)
        RETURN e
        """
        
        try:
            self.execute_write(query, {
                "m_val": m_val,
                "source_id": source_id,
                "props": properties
            })
        except Exception as e:
            logger.error(f"Failed to upsert Neo4j entity with {m_key}={m_val}: {e}")

    def delete_source_nodes(self, source_id: str):
        """Removes a source node and all entities associated with it using batched transactions."""
        if not Neo4jService._driver:
            return
            
        # We delete in batches to avoid transaction log overflow
        # 1. Delete the entities linked to this source
        query_entities = """
        MATCH (s:Source {source_id: $source_id})
        OPTIONAL MATCH (n)-[:PART_OF_SOURCE]->(s)
        CALL {
            WITH n
            DETACH DELETE n
        } IN TRANSACTIONS OF 10000 ROWS;
        """
        
        # 2. Delete the source node itself
        query_source = """
        MATCH (s:Source {source_id: $source_id})
        DETACH DELETE s
        """
        
        try:
            # Must use auto-commit (implicit) transaction for 'CALL {} IN TRANSACTIONS'
            with Neo4jService._driver.session() as session:
                session.run(query_entities, {"source_id": source_id}).consume()
                session.run(query_source, {"source_id": source_id}).consume()
            logger.info(f"Successfully purged source '{source_id}' and all entities from Neo4j.")
        except Exception as e:
            logger.error(f"Failed to delete Neo4j source nodes for {source_id}: {e}")

    def wipe_graph(self):
        """NUCLEAR: Deletes all nodes and relationships."""
        if not Neo4jService._driver:
            logger.error("Neo4j driver not initialized.")
            return
        self.execute_write("MATCH (n) DETACH DELETE n")
        logger.info("Neo4j graph wiped.")

# Singleton instance
_service = None

def get_neo4j_service() -> Neo4jService:
    global _service
    if _service is None:
        _service = Neo4jService()
    return _service

def close_neo4j():
    global _service
    if _service:
        _service.close()
        _service = None
