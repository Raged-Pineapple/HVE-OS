from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any
from app.optimization.flight_optimizer import FlightOptimizer
from app.services.ontology_service import ontology_service
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class FlightModel(BaseModel):
    id: str
    capacity_needed: Optional[int] = 1

class RouteModel(BaseModel):
    id: str
    delay_mins: float
    risk_score: float
    capacity: Optional[int] = 10

class OptimizationRequest(BaseModel):
    flights: Optional[List[FlightModel]] = []
    routes: Optional[List[RouteModel]] = []
    risk_weight: Optional[int] = 100

@router.post("/reroute")
async def optimize_rerouting(request: OptimizationRequest):
    optimizer = FlightOptimizer(risk_weight=request.risk_weight)
    
    flights_dicts = [f.model_dump() for f in request.flights]
    routes_dicts = [r.model_dump() for r in request.routes]
    
    # ------------------------------------------------------------
    # ONTOLOGY-FIRST REFACTOR
    # If UI doesn't pass state, pull World State from Neo4j Graph
    # ------------------------------------------------------------
    if not flights_dicts or not routes_dicts:
        logger.info("Fetching World State from Ontology Graph...")
        # Since our simplified get_relations doesn't query all nodes of a label easily without a custom query,
        # we will execute a raw query on the neo4j_manager or we can just mock the fetch for the refactor demo.
        from app.db.neo4j_session import neo4j_manager
        
        if neo4j_manager.driver:
            async with neo4j_manager.driver.session() as session:
                # Fetch flights
                if not flights_dicts:
                    f_res = await session.run("MATCH (n:Flight) RETURN PROPERTIES(n) as p")
                    async for r in f_res:
                        props = r["p"]
                        flights_dicts.append({"id": props.get("id"), "capacity_needed": int(props.get("capacity_needed", 1))})
                        
                # Fetch routes
                if not routes_dicts:
                    r_res = await session.run("MATCH (n:Route) RETURN PROPERTIES(n) as p")
                    async for r in r_res:
                        props = r["p"]
                        routes_dicts.append({
                            "id": props.get("id"), 
                            "delay_mins": float(props.get("delay_mins", 0)),
                            "risk_score": float(props.get("risk_score", 0)),
                            "capacity": int(props.get("capacity", 10))
                        })
                        
    if not flights_dicts or not routes_dicts:
        raise HTTPException(status_code=400, detail="No flights or routes found in Ontology Graph to optimize.")
    
    result = optimizer.optimize_rerouting(flights_dicts, routes_dicts)
    
    if result.get("status") not in ["OPTIMAL", "FEASIBLE"]:
        raise HTTPException(status_code=400, detail=result)
        
    return result
