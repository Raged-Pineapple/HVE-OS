from ortools.sat.python import cp_model
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class FlightOptimizer:
    """
    Optimizes flight routes using Google OR-Tools CP-SAT solver.
    Minimizes the sum of (route_base_delay + risk_score * weight).
    """

    def __init__(self, risk_weight: int = 100):
        # We multiply risks and delays to integers because CP-SAT works purely with integers
        self.risk_weight = risk_weight

    def optimize_rerouting(self, flights: List[Dict[str, Any]], routes: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        flights: [{"id": "F1", "capacity_needed": 1}, ...]
        routes: [{"id": "R1", "delay_mins": 10, "risk_score": 0.1, "capacity": 2}, ...]
        """
        model = cp_model.CpModel()

        num_flights = len(flights)
        num_routes = len(routes)

        if num_flights == 0 or num_routes == 0:
            return {"status": "NO_DATA"}

        # Variables: x[i][j] is 1 if flight i is assigned to route j.
        x = {}
        for i in range(num_flights):
            for j in range(num_routes):
                x[i, j] = model.NewBoolVar(f"x_{i}_{j}")

        # Constraint 1: Each flight must be assigned to exactly ONE route.
        for i in range(num_flights):
            model.AddExactlyOne([x[i, j] for j in range(num_routes)])

        # Constraint 2: Route capacity constraints.
        for j in range(num_routes):
            # Sum of capacity_needed for flights taking this route <= route capacity
            model.Add(
                sum(x[i, j] * flights[i].get("capacity_needed", 1) for i in range(num_flights)) 
                <= routes[j].get("capacity", 999)
            )

        # Objective Function: Minimize total cost = (base_delay + risk * weight)
        objective_terms = []
        for i in range(num_flights):
            for j in range(num_routes):
                # Calculate integer costs
                delay_cost = int(routes[j].get("delay_mins", 0))
                
                # Risk score floats (0.0 to 1.0) into integers
                rc = routes[j].get("risk_score", 0.0)
                risk_cost = int(rc * self.risk_weight)
                
                total_route_cost = delay_cost + risk_cost
                
                objective_terms.append(total_route_cost * x[i, j])

        model.Minimize(sum(objective_terms))

        # Solve
        solver = cp_model.CpSolver()
        # Optional: time limit
        # solver.parameters.max_time_in_seconds = 10.0
        
        status = solver.Solve(model)

        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            assignments = []
            total_cost = solver.ObjectiveValue()
            
            for i in range(num_flights):
                for j in range(num_routes):
                    if solver.BooleanValue(x[i, j]):
                        assignments.append({
                            "flight_id": flights[i]["id"],
                            "assigned_route_id": routes[j]["id"],
                            "delay_mins": routes[j].get("delay_mins", 0),
                            "risk_score": routes[j].get("risk_score", 0.0)
                        })

            logger.info("Optimization successful.")
            return {
                "status": solver.StatusName(status),
                "total_cost": total_cost,
                "assignments": assignments
            }
        else:
            logger.warning("Optimization failed to find a feasible solution.")
            return {"status": solver.StatusName(status)}
