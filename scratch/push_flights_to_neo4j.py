"""
push_flights_to_neo4j.py
Direct one-shot push of Silver Iceberg flight data into Neo4j.
Bypasses the async thread issue in sync_table_to_graph.
"""
import os, sys, time
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'gateway'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from gateway.services import iceberg_service, neo4j_service, db_service

neo4j = neo4j_service.get_neo4j_service()

CYPHER = """
MERGE (s:Source {source_id: $source_id})
WITH s
UNWIND $rows AS row
WITH s, row WHERE row.icao24 IS NOT NULL
MERGE (n:Entity:Flights {icao24: row.icao24})
SET n += {
  _hve_id:         row._hve_id,
  _source_id:      row._source_id,
  _ingest_ts:      row._ingest_ts,
  callsign:        row.callsign,
  origin_country:  row.origin_country,
  time_position:   row.time_position,
  last_contact:    row.last_contact,
  longitude:       row.longitude,
  latitude:        row.latitude,
  baro_altitude:   row.baro_altitude,
  on_ground:       row.on_ground,
  velocity:        row.velocity,
  true_track:      row.true_track,
  vertical_rate:   row.vertical_rate,
  geo_altitude:    row.geo_altitude,
  squawk:          row.squawk,
  spi:             row.spi,
  position_source: row.position_source
}
MERGE (n)-[:PART_OF_SOURCE]->(s)
"""

for source_id in ['flights_bangalore', 'flights_bang']:
    print(f"\nSyncing {source_id} -> Neo4j...")
    try:
        arrow_table = iceberg_service.scan_latest(source_id)
        rows = arrow_table.to_pylist()
        print(f"  Iceberg rows: {len(rows)}")

        if not rows:
            print(f"  No rows, skipping.")
            continue

        # Sanitize: Neo4j doesn't accept nested dicts/lists as properties
        def sanitize(row):
            import json
            out = {}
            for k, v in row.items():
                if isinstance(v, dict):
                    out[k] = json.dumps(v)
                elif isinstance(v, list) and any(isinstance(i, dict) for i in v):
                    out[k] = json.dumps(v)
                elif hasattr(v, 'isoformat'):
                    out[k] = v.isoformat()
                else:
                    out[k] = v
            return out

        sanitized = [sanitize(r) for r in rows]

        # Push in chunks of 200
        batch_size = 200
        total_pushed = 0
        for i in range(0, len(sanitized), batch_size):
            batch = sanitized[i:i+batch_size]
            neo4j.execute_write(CYPHER, {"rows": batch, "source_id": source_id})
            total_pushed += len(batch)
            print(f"  Pushed {total_pushed}/{len(sanitized)} nodes...", end='\r')

        print(f"\n  Done: {total_pushed} nodes upserted into Neo4j for {source_id}")

    except Exception as e:
        print(f"  ERROR for {source_id}: {e}")

# Verify
from neo4j import GraphDatabase
driver = GraphDatabase.driver(
    os.getenv('NEO4J_URI','bolt://127.0.0.1:7688').replace('localhost','127.0.0.1'),
    auth=(os.getenv('NEO4J_USER','neo4j'), os.getenv('NEO4J_PASSWORD','hve_password123'))
)
s = driver.session()
count = s.run("MATCH (n:Flights) RETURN count(n) as c").single()["c"]
print(f"\nFinal count of :Flights nodes in Neo4j: {count}")

sample = s.run("""
    MATCH (n:Flights)
    WHERE n.latitude IS NOT NULL
    RETURN n.callsign as cs, n.latitude as lat, n.longitude as lon,
           n.velocity as vel, n._source_id as src
    LIMIT 5
""").data()
print("\nSample:")
for f in sample:
    cs = str(f.get('cs') or f.get('src') or '?').strip()
    print(f"  {cs:12s} lat={f['lat']:.4f}  lon={f['lon']:.4f}  vel={f['vel']}  src={f['src']}")

driver.close()
