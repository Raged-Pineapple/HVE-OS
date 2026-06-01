import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "gateway")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from services import db_service

def check_activity():
    with db_service.get_cursor() as cur:
        # Check all tables and schemas in database
        cur.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")
        print("All tables across schemas:")
        for r in cur.fetchall():
            print(f"{r['table_schema']}.{r['table_name']}")
        
        # Check iceberg_tables contents if it exists in any schema
        try:
            cur.execute("SELECT * FROM iceberg_tables")
            print("\nContents of iceberg_tables:")
            for r in cur.fetchall():
                print(dict(r))
        except Exception as e:
            print(f"\nCould not read iceberg_tables: {e}")


if __name__ == "__main__":
    check_activity()
