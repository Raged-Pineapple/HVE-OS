import psycopg2
import os

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB", "hve_control_plane"),
    "user": os.getenv("POSTGRES_USER", "hve_admin"),
    "password": os.getenv("POSTGRES_PASSWORD", "hve_password123"),
}

def migrate():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        print("Migrating schema...")
        
        # Rename json_path to jmes_path
        try:
            cur.execute("ALTER TABLE mapping_blueprints RENAME COLUMN json_path TO jmes_path;")
            print("Renamed json_path to jmes_path.")
        except psycopg2.errors.UndefinedColumn:
            print("Table already updated or column missing.")
            conn.rollback()
            
        # Drop extraction_path
        try:
            cur.execute("ALTER TABLE api_source_configs DROP COLUMN extraction_path;")
            print("Dropped extraction_path from api_source_configs.")
        except psycopg2.errors.UndefinedColumn:
            print("Column extraction_path already dropped.")
            conn.rollback()

        conn.commit()
        cur.close()
        conn.close()
        print("Migration complete!")
    except Exception as e:
        print(f"Migration failed: {e}")

if __name__ == "__main__":
    migrate()
