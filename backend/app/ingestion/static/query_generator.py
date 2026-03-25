class QueryFunctionGenerator:
    """
    Stage 11A: Auto-Generated Query Functions.
    Dynamically exports AST footprints so the UI knows how to generate drag-and-drop Nodes
    without requiring manual backend code updates.
    """
    def generate(self, dataset_name: str, schema: list[dict]) -> list[dict]:
        functions = []
        pk_col = next((c['name'] for c in schema if c.get('is_pk')), 'id')
        pk_type = next((c['type'] for c in schema if c.get('is_pk')), 'TEXT')
        
        has_gis = any(c.get('_flag_gis') for c in schema)
        
        # 1. Get All
        functions.append({
            "name": f"get_all_{dataset_name}",
            "description": f"Retrieves full dataset for {dataset_name}",
            "params": []
        })
        
        # 2. Get by PK
        functions.append({
            "name": f"get_{dataset_name}_by_{pk_col}",
            "description": f"Fetch a single record by primary key",
            "params": [{"name": pk_col, "type": pk_type}]
        })
        
        # 3. Spatial Queries if PostGIS generated
        if has_gis:
            functions.append({
                "name": f"get_{dataset_name}_in_bbox",
                "description": "Spatial bounding box query",
                "params": [
                    {"name": "min_lat", "type": "FLOAT"},
                    {"name": "max_lat", "type": "FLOAT"},
                    {"name": "min_lon", "type": "FLOAT"},
                    {"name": "max_lon", "type": "FLOAT"}
                ]
            })
            functions.append({
                "name": f"get_{dataset_name}_near",
                "description": "Spatial radius query",
                "params": [
                    {"name": "lat", "type": "FLOAT"},
                    {"name": "lon", "type": "FLOAT"},
                    {"name": "radius_km", "type": "FLOAT"}
                ]
            })
            
        # 4. Generic Filter
        functions.append({
            "name": f"get_{dataset_name}_where",
            "description": "Generic conditional strict filter",
            "params": [
                {"name": "column", "type": "STRING_ENUM", "options": [c['name'] for c in schema]},
                {"name": "operator", "type": "OPERATOR"},
                {"name": "value", "type": "ANY"}
            ]
        })
        
        return functions

query_generator = QueryFunctionGenerator()
