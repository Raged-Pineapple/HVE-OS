import logging
from typing import Dict, Any, List
from app.db.neo4j_session import neo4j_manager

logger = logging.getLogger(__name__)

class OntologyService:
    """
    CRUD wrapper allowing the Neo4j Graph to act as the supreme API of the system.
    """
    
    async def get_entity(self, entity_id: str) -> Dict[str, Any]:
        if not neo4j_manager.driver:
            return {}
            
        query = """
        MATCH (n) WHERE n.id = $id
        RETURN labels(n) as labels, properties(n) as props
        """
        async with neo4j_manager.driver.session() as session:
            result = await session.run(query, id=entity_id)
            record = await result.single()
            if record:
                return {"id": entity_id, "labels": record["labels"], "properties": record["props"]}
            return {}
            
    async def get_relations(self, entity_id: str, depth: int = 1) -> List[Dict[str, Any]]:
        if not neo4j_manager.driver:
            return []
            
        # Matches paths from the entity up to `depth` hops away
        query = f"""
        MATCH p=(n)-[*1..{depth}]-(m)
        WHERE n.id = $id
        RETURN nodes(p) as nodes, relationships(p) as relations
        """
        paths = []
        async with neo4j_manager.driver.session() as session:
            records = await session.run(query, id=entity_id)
            async for record in records:
                nodes = [{"labels": list(node.labels), "props": dict(node)} for node in record["nodes"]]
                rels = [{"type": rel.type, "props": dict(rel)} for rel in record["relations"]]
                paths.append({"nodes": nodes, "relationships": rels})
        return paths
        
    async def update_entity(self, entity_id: str, labels: List[str], properties: Dict[str, Any]) -> Dict[str, Any]:
        if not neo4j_manager.driver:
            return {}
            
        # Create or update node
        labels_str = ":".join(labels) if labels else "Entity"
        
        query = f"""
        MERGE (n:{labels_str} {{id: $id}})
        SET n += $props
        RETURN n
        """
        async with neo4j_manager.driver.session() as session:
            result = await session.run(query, id=entity_id, props=properties)
            record = await result.single()
            if record:
                return dict(record["n"])
            return {}

ontology_service = OntologyService()
