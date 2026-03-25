import logging
from typing import Dict, Any, List
from app.services.ontology_service import ontology_service
from app.services.world_state import world_state

logger = logging.getLogger(__name__)

class FeatureAggregator:
    """
    Computes advanced composite ML vectors containing:
    1. The node's internal features.
    2. The topographical graph average of 1-hop neighbors from Neo4j.
    3. The temporal trend trajectory from the Redis fast-cache.
    """
    
    async def compute_advanced_features(self, entity_id: str) -> Dict[str, Any]:
        logger.info(f"Aggregating Advanced AI Features for {entity_id}...")
        
        # 1. Base Graph Features
        base_entity = await ontology_service.get_entity(entity_id)
        base_risk = float(base_entity.get("properties", {}).get("risk_score", 0.0))
        
        # 2. Graph Topography (GNN-style neighbor aggregation)
        neighbor_data = await ontology_service.get_relations(entity_id, depth=1)
        
        neighbor_risks = []
        for path in neighbor_data:
            # path is {"nodes": [...], "relationships": [...]}
            # skip the node itself (which is node[0] or node[1] depending on direction)
            for node in path["nodes"]:
                if node["props"].get("id") != entity_id:
                    risk = float(node["props"].get("risk_score", 0.0))
                    neighbor_risks.append(risk)
                    
        avg_neighbor_risk = sum(neighbor_risks) / len(neighbor_risks) if neighbor_risks else 0.0
        
        # 3. Temporal Trend (Redis historical trajectory)
        # In a full deployment, Redis would store bounded lists (e.g. LPUSH) for historical windows.
        # For this prototype, if Redis holds current state, we'll simulate calculating a trend 
        # (e.g. +0.05 increasing risk slope over the last 10 ticks).
        
        live_state = await world_state.get_state(entity_id)
        # Mock trend computation, pretending we read an LPUSH stream and ran linear regression
        temporal_trend_slope = float(live_state.get("risk_trend", 0.02)) 
        
        composite_vector = {
            "node_risk": base_risk,
            "avg_neighbor_risk": avg_neighbor_risk,
            "temporal_trend_slope": temporal_trend_slope,
            "calculated_composite_score": round(base_risk + (avg_neighbor_risk * 0.5) + (temporal_trend_slope * 10), 3)
        }
        
        return composite_vector

feature_aggregator = FeatureAggregator()
