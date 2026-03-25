import logging
import copy
from typing import Dict, Any, List
from app.db.neo4j_session import neo4j_manager
from app.optimization.flight_optimizer import FlightOptimizer

logger = logging.getLogger(__name__)

class SimulationEngine:
    """
    Clones the real-world Ontology and applies 'What-If' scenarios locally,
    running the Optimizer to compare alternative timeline outcomes.
    """
    
    def __init__(self):
        self.optimizer = FlightOptimizer()

    async def get_live_world_state(self) -> Dict[str, List[Dict]]:
        """
        Extracts the current structural representation from Neo4j.
        """
        flights = []
        routes = []
        
        if neo4j_manager.driver:
            async with neo4j_manager.driver.session() as session:
                f_res = await session.run("MATCH (n:Flight) RETURN PROPERTIES(n) as p")
                async for r in f_res:
                    props = r["p"]
                    flights.append({"id": props.get("id"), "capacity_needed": int(props.get("capacity_needed", 1))})
                    
                r_res = await session.run("MATCH (n:Route) RETURN PROPERTIES(n) as p")
                async for r in r_res:
                    props = r["p"]
                    routes.append({
                        "id": props.get("id"), 
                        "delay_mins": float(props.get("delay_mins", 0)),
                        "risk_score": float(props.get("risk_score", 0)),
                        "capacity": int(props.get("capacity", 10))
                    })
                    
        return {"flights": flights, "routes": routes}
        
    def apply_hypothetical(self, cloned_state: Dict[str, List[Dict]], entity_id: str, changes: Dict[str, Any]) -> Dict[str, List[Dict]]:
        """
        Alters the cloned reality (e.g. inject extreme risk into a route).
        """
        state = copy.deepcopy(cloned_state)
        
        for route in state.get("routes", []):
            if route["id"] == entity_id:
                route.update(changes)
                
        for flight in state.get("flights", []):
            if flight["id"] == entity_id:
                flight.update(changes)
                
        return state

    async def run_scenario(self, hypothetical_target: str, hypothetical_changes: Dict[str, Any]) -> Dict[str, Any]:
        """
        1. Clones World
        2. Gets Baseline Metrics
        3. Modifies Clone
        4. Gets Alternate Metrics
        5. Returns Comparison
        """
        baseline_world = await self.get_live_world_state()
        
        # Calculate Baseline
        try:
            baseline_result = self.optimizer.optimize_rerouting(baseline_world["flights"], baseline_world["routes"])
        except Exception as e:
            baseline_result = {"status": "ERROR", "error": str(e)}
            
        # Clone & Diverge Timeline
        alternate_world = self.apply_hypothetical(baseline_world, hypothetical_target, hypothetical_changes)
        
        # Calculate Alternate Future
        try:
            alternate_result = self.optimizer.optimize_rerouting(alternate_world["flights"], alternate_world["routes"])
        except Exception as e:
            alternate_result = {"status": "ERROR", "error": str(e)}
            
        return {
            "baseline": baseline_result,
            "simulation": alternate_result,
            "divergence": hypothetical_changes
        }

simulation_engine = SimulationEngine()
