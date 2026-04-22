import os
import sys

_src_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src"))
_gateway_dir = os.path.abspath(os.path.join(r"d:\Projects\HVE-OS", "src", "gateway"))
for _d in [_src_dir, _gateway_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from services import db_service
from Logic import graph_processor

def verify_gold_layer():
    print("Testing Gold Layer / Blueprint Integration...")
    
    # 1. Provide a Cypher mapping template using the DB service
    # We will pretend the military dataset has rows with a 'base_name' and 'type'
    source_id = "test_military"
    db_service.register_source(source_id, "API_POLL", "HTTP", "Test Military Dataset")
    
    cypher = """
    UNWIND $rows AS row
    MERGE (m:MilitaryInstallation {id: row.id})
    SET m.name = row.base_name,
        m.type = row.type,
        m.last_updated = timestamp()
    """
    
    bp = db_service.upsert_graph_blueprint(source_id, cypher)
    print(f"[1] Saved Blueprint for {source_id}: {bp['blueprint_id'] if 'blueprint_id' in bp else bp.get('source_id')}")
    
    # 2. Emulate Kafka feeding data into the Graph Processor
    print("[2] Simulating incoming streaming rows...")
    proc = graph_processor.get_graph_processor()
    
    row1 = {
        "_hve_id": "r1",
        "_source_id": source_id,
        "id": "B001",
        "base_name": "Alpha Station",
        "type": "Communications"
    }
    row2 = {
        "_hve_id": "r2",
        "_source_id": source_id,
        "id": "B002",
        "base_name": "Bravo Base",
        "type": "Airfield"
    }
    
    # Normally this is done in _process_row and _flush_buffers
    proc._buffers[source_id].extend([row1, row2])
    proc._neo4j = __import__("services.neo4j_service").neo4j_service.get_neo4j_service()
    proc._flush_buffer(source_id)
    print(f"[3] Flushed batch to Neo4j.")
    
    # 3. Query Neo4j to verify mapping
    res = proc._neo4j.execute_query("MATCH (m:MilitaryInstallation) RETURN m.id as id, m.name as name")
    print("\nNode Verification Results:")
    for record in res:
        print(f" - {record['id']}: {record['name']}")
    
    # Verify mapping works independently
    if len(res) >= 2:
        print("\nSUCCESS: Gold Layer pipeline is active!")
    else:
        print("\nFAILURE: Nodes not created.")

if __name__ == "__main__":
    verify_gold_layer()
