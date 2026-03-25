import logging
import pandas as pd
from app.db.neo4j_session import neo4j_manager

logger = logging.getLogger(__name__)

class OntologyMapper:
    """Translates tabular data into graph nodes and edges."""
    
    async def ingest_clean_weather(self, df: pd.DataFrame):
        """Map clean weather data into WeatherEvent nodes."""
        if neo4j_manager.driver is None:
            logger.error("Neo4j driver is not initialized.")
            return

        query = """
        UNWIND $events AS event
        MERGE (w:WeatherEvent {id: event.id})
        SET w.temperature = event.temperature,
            w.humidity = event.humidity,
            w.timestamp = event.timestamp
        """
        
        # Ensure we have some id, or generate one
        if "id" not in df.columns:
            df["id"] = [f"evt_{i}" for i in range(len(df))]
        
        events = df.to_dict(orient="records")
        
        async with neo4j_manager.driver.session() as session:
            await session.run(query, events=events)
            logger.info(f"Ingested {len(events)} WeatherEvent nodes into Neo4j.")

    async def ingest_risk_score(self, df: pd.DataFrame):
        """Map risk score data and link to Airport/Flight."""
        if neo4j_manager.driver is None:
            return

        query = """
        UNWIND $scores AS score
        MERGE (w:WeatherEvent {id: score.id})
        SET w.risk_score = score.risk_score
        // Example: If location data exists, we could link to an Airport
        // MERGE (a:Airport {id: score.location})
        // MERGE (a)-[:AFFECTED_BY]->(w)
        """
        
        # Assuming df has 'id' and 'risk_score'
        if "id" not in df.columns:
            df["id"] = [f"evt_{i}" for i in range(len(df))]
            
        scores = df.to_dict(orient="records")
        
        async with neo4j_manager.driver.session() as session:
            await session.run(query, scores=scores)
            logger.info(f"Updated {len(scores)} WeatherEvent nodes with risk scores.")
