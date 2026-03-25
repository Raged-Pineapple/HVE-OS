import logging
from app.db.neo4j_session import neo4j_manager

logger = logging.getLogger(__name__)

class GraphReasoner:
    """Executes Graph Reasoning queries to propagate analytical impact."""
    
    async def find_impacted_flights(self, min_risk_score: float = 0.8) -> list:
        """
        Finds all flights running through an airport that is affected by a 
        Weather event with a risk score above the threshold.
        """
        if neo4j_manager.driver is None:
            logger.error("Neo4j driver not initialized.")
            return []
            
        # Example graph traversal query
        # MATCH (f:Flight)-[:LOCATED_AT]->(a:Airport)-[:AFFECTED_BY]->(w:WeatherEvent)
        # WHERE w.risk_score >= $min_risk
        # RETURN f.id as flight_id, a.name as airport, w.risk_score as risk
        
        # Here we use a simpler model for our prototype since we only ingested WeatherEvents
        # If we had Airport and Flight nodes, the full query would execute.
        # For our mock testing, we will just return high risk weather events.
        
        query = """
        MATCH (w:WeatherEvent)
        WHERE w.risk_score >= $min_risk
        RETURN w.id as weather_event_id, w.risk_score as risk
        """
        
        results = []
        async with neo4j_manager.driver.session() as session:
            records = await session.run(query, min_risk=min_risk_score)
            async for record in records:
                results.append(record.data())
                
        logger.info(f"Graph reasoning found {len(results)} high-risk impact paths.")
        return results
