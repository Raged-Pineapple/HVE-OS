import os
import psycopg2
from dotenv import load_dotenv

load_dotenv("src/gateway/.env")

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "hve_admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "hve_password123")
DB_NAME = os.getenv("DB_NAME", "hve_control_plane")

try:
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        dbname=DB_NAME
    )
    cur = conn.cursor()
    cur.execute("ALTER TABLE mapping_blueprints ADD COLUMN IF NOT EXISTS should_explode BOOLEAN DEFAULT TRUE;")
    conn.commit()
    print("Migration successful: Added should_explode column.")
except Exception as e:
    print(f"Migration failed: {e}")
finally:
    if 'conn' in locals():
        conn.close()
