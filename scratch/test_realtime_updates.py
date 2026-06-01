"""
test_realtime_updates.py
========================
Monitors whether lat/lon values for flight entities are actually
changing across poll cycles.

Checks THREE layers:
  1. Silver Iceberg  — are new rows being appended?
  2. Neo4j           — are existing node properties being updated?
  3. API poller      — what's the last poll status in Postgres?

Run:
  venv\\Scripts\\python scratch\\test_realtime_updates.py
"""

import os, sys, time, json
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'gateway'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from neo4j import GraphDatabase
import psycopg2
from psycopg2.extras import RealDictCursor

SOURCES = ['flights']
POLL_EVERY = 16   # seconds — just above the 15s poll interval
ROUNDS = 10       # how many cycles to watch

NEO4J_URI  = os.getenv('NEO4J_URI', 'bolt://127.0.0.1:7688').replace('localhost', '127.0.0.1')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASS = os.getenv('NEO4J_PASSWORD', 'hve_password123')

PG_CONN = dict(
    host=os.getenv('POSTGRES_HOST', '127.0.0.1'),
    port=int(os.getenv('DB_PORT', '5433')),
    database=os.getenv('POSTGRES_DB', 'hve_control_plane'),
    user=os.getenv('POSTGRES_USER', 'hve_admin'),
    password=os.getenv('POSTGRES_PASSWORD', 'hve_password123'),
)

SEP = "─" * 72


def neo4j_snapshot(driver):
    """Grab lat/lon for all Flights nodes right now."""
    with driver.session() as s:
        rows = s.run("""
            MATCH (n:Flights)
            WHERE n.latitude IS NOT NULL
            RETURN n.icao24 as icao24,
                   n.callsign as callsign,
                   n.latitude as lat,
                   n.longitude as lon,
                   n.velocity as vel,
                   n.true_track as track,
                   n._ingest_ts as ts,
                   n._source_id as src
            ORDER BY n._ingest_ts DESC
            LIMIT 20
        """).data()
    return {r['icao24']: r for r in rows}


def iceberg_row_count(source_id):
    """Hit the REST API to get current row count from Silver registry."""
    try:
        import urllib.request
        url = f"http://127.0.0.1:8000/api/v1/silver/tables"
        with urllib.request.urlopen(url, timeout=5) as resp:
            tables = json.loads(resp.read())
        for t in tables:
            if t['table_name'] == source_id:
                return t['row_count']
    except Exception as e:
        return f"ERR:{e}"
    return 0


def pg_poll_status():
    """Check last poll timestamps from Postgres."""
    try:
        conn = psycopg2.connect(**PG_CONN)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT source_id, last_polled_at, last_status, last_error
            FROM api_source_configs
            WHERE source_id = ANY(%s)
            ORDER BY source_id
        """, (SOURCES,))
        rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        return [{"source_id": "ERROR", "last_polled_at": str(e)}]


def iceberg_snapshot_count():
    """Count recent Iceberg snapshot commits from log."""
    try:
        conn = psycopg2.connect(**PG_CONN)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("""
            SELECT table_name, records_added, committed_at
            FROM iceberg_snapshot_log
            WHERE table_name = ANY(%s)
            ORDER BY committed_at DESC
            LIMIT 6
        """, ([f'hve_silver.{s}' for s in SOURCES],))
        rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        return []


# ── Main loop ────────────────────────────────────────────────────────────────

print(f"\n{'='*72}")
print(f"  HVE-OS Real-Time Update Monitor")
print(f"  Sources: {SOURCES}")
print(f"  Polling every {POLL_EVERY}s for {ROUNDS} rounds")
print(f"{'='*72}\n")

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))

prev_neo4j   = {}
prev_counts  = {}
changed_nodes = []

for round_num in range(1, ROUNDS + 1):
    print(f"\n{SEP}")
    print(f"  ROUND {round_num}/{ROUNDS}  —  {time.strftime('%H:%M:%S')}")
    print(SEP)

    # ── 1. Poll status from Postgres ─────────────────────────────────────────
    print("\n[1] API Poller Status (Postgres):")
    poll_rows = pg_poll_status()
    for row in poll_rows:
        polled_at = str(row.get('last_polled_at', 'N/A'))[-19:]
        status    = row.get('last_status', '?')
        err       = row.get('last_error') or ''
        symbol    = '✅' if status == 'SUCCESS' else '❌'
        print(f"    {symbol} {row['source_id']:20s}  last_poll={polled_at}  status={status}  {err[:40]}")

    # ── 2. Iceberg row count change ───────────────────────────────────────────
    print("\n[2] Iceberg Silver Row Counts:")
    for src in SOURCES:
        current = iceberg_row_count(src)
        prev    = prev_counts.get(src, current)
        delta   = (current - prev) if isinstance(current, int) and isinstance(prev, int) else '?'
        arrow   = f'+{delta}' if isinstance(delta, int) and delta > 0 else (str(delta) if delta != 0 else ' (no change)')
        symbol  = '🟢' if isinstance(delta, int) and delta > 0 else '🟡'
        print(f"    {symbol} {src:20s}  rows={current}  Δ={arrow}")
        prev_counts[src] = current

    # ── 3. Recent Iceberg snapshots ───────────────────────────────────────────
    print("\n[3] Recent Iceberg Snapshot Commits:")
    snaps = iceberg_snapshot_count()
    if snaps:
        for snap in snaps:
            ts = str(snap.get('committed_at', ''))[-19:]
            print(f"    📦 {snap['table_name']:35s}  +{snap['records_added']} rows  @ {ts}")
    else:
        print("    (no recent snapshots found)")

    # ── 4. Neo4j node lat/lon change ─────────────────────────────────────────
    print("\n[4] Neo4j :Flights Node Positions:")
    current_neo4j = neo4j_snapshot(driver)

    if not current_neo4j:
        print("    ⚠️  No :Flights nodes in Neo4j — GraphProcessor not writing!")
        print("       Fix: run scratch/push_flights_to_neo4j.py")
    else:
        updated = 0
        same    = 0
        for icao24, curr in current_neo4j.items():
            prev = prev_neo4j.get(icao24)
            cs   = (curr.get('callsign') or icao24 or '?').strip()
            lat  = curr.get('lat')
            lon  = curr.get('lon')
            vel  = curr.get('vel')
            trk  = curr.get('track')

            if prev is None:
                marker = '🆕'
                note   = 'new node'
            elif prev.get('lat') != lat or prev.get('lon') != lon:
                marker = '✈️ '
                note   = f"lat {prev['lat']:.4f}→{lat:.4f}  lon {prev['lon']:.4f}→{lon:.4f}"
                updated += 1
                changed_nodes.append({'round': round_num, 'icao24': icao24, 'callsign': cs})
            else:
                marker = '🔴'
                note   = 'UNCHANGED'
                same  += 1

            print(f"    {marker} {cs:10s}  lat={lat:.4f}  lon={lon:.4f}  v={vel}  trk={trk:.1f}°  | {note}")

        print(f"\n    Summary: {updated} nodes UPDATED  |  {same} unchanged  |  total={len(current_neo4j)}")
        if round_num > 1 and updated == 0 and same > 0:
            print("    ⚠️  WARNING: Zero lat/lon changes — Neo4j is NOT being updated in real-time!")
            print("       Likely cause: GraphProcessor has no blueprint or is failing silently.")

    prev_neo4j = current_neo4j

    if round_num < ROUNDS:
        print(f"\n  Waiting {POLL_EVERY}s for next poll cycle...")
        time.sleep(POLL_EVERY)

driver.close()

# ── Final report ─────────────────────────────────────────────────────────────
print(f"\n{'='*72}")
print("  FINAL REPORT")
print(f"{'='*72}")
if changed_nodes:
    print(f"\n  ✅ Position updates detected across {ROUNDS} rounds:")
    for c in changed_nodes:
        print(f"     Round {c['round']}: {c['callsign']} ({c['icao24']}) moved")
else:
    print("\n  ❌ NO position changes detected in any round.")
    print("""
  DIAGNOSIS CHECKLIST:
  ─────────────────────────────────────────────────────────────
  1. Check [1] above — is 'last_status' = SUCCESS every round?
     If 'HTTP 401': token expired → re-register with fresh token
     If 'HTTP 429': rate limited → switch source or reduce poll rate

  2. Check [2] above — are Iceberg rows increasing?
     If not: the API poller is not fetching data

  3. Check [3] above — are Iceberg snapshots being committed?
     If not: stream processor is not processing Kafka messages

  4. If rows are growing but Neo4j isn't updating:
     → GraphProcessor is consuming Silver Kafka but not writing
     → Check that graph blueprint exists for each source
     → Run: scratch/push_flights_to_neo4j.py (manual push)
  ─────────────────────────────────────────────────────────────
""")
