class OntologyMapper:
    """
    Stage 11 (Part B): Ontology Suggestion.
    Matches newly inferred schemas against existing Neo4j Object Types to propose 
    automatic graph DB integration to the user.
    """
    def suggest_mapping(self, dataset_name: str, schema: list[dict]) -> dict:
        semantics = {c.get('semantic') for c in schema}
        
        # Trivial prototype heuristics for Aviation ontology
        if "ICAO_CODE" in semantics and "LATITUDE" in semantics:
            return {
                "suggestion": "Airport",
                "confidence": 0.92,
                "message": f"This dataset looks like Airport data. Map to existing Object Type: Airport?"
            }
            
        if "ICAO_HEX" in semantics and "CALLSIGN" in semantics:
            return {
                "suggestion": "Aircraft",
                "confidence": 0.88,
                "message": f"This dataset looks like Aircraft data. Map to existing Object Type: Aircraft?"
            }
            
        return None

ontology_mapper = OntologyMapper()
