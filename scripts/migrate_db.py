import os
import sys
import psycopg2
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "gateway")))
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "src", "gateway", ".env"))

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "hve_admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "hve_password123")
DB_NAME = os.getenv("DB_NAME", "hve_control_plane")

try:
    conn = psycopg2.connect(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, dbname=DB_NAME)
    cur = conn.cursor()
    cur.execute("ALTER TABLE mapping_blueprints RENAME COLUMN json_path TO jmes_path;")
    conn.commit()
    print("Migration successful: Added jmes_path column.")
except Exception as e:
    print(f"Migration failed or already applied: {e}")
finally:
    if 'conn' in locals():
        conn.close()
