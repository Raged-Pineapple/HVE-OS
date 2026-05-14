import os
import psycopg2
import subprocess
import json
from dotenv import load_dotenv

def test_postgres_auth():
    # Load the .env file from the root directory
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".env"))
    load_dotenv(dotenv_path=env_path)
    
    host = os.getenv("POSTGRES_HOST", "127.0.0.1")
    port = os.getenv("DB_PORT", "5433")
    db = os.getenv("POSTGRES_DB", "hve_control_plane")
    user = os.getenv("POSTGRES_USER", "hve_admin")
    password = os.getenv("POSTGRES_PASSWORD", "hve_password123")
    
    print(f"--- Testing Database Connection ---")
    print(f"Host: {host}:{port}")
    print(f"Database: {db} | User: {user} | Password: {password}")
    print(f"-----------------------------------\n")
    
    print("--- Checking Docker Container Environment ---")
    try:
        result = subprocess.run(
            ["docker", "inspect", "hve-postgres"],
            capture_output=True,
            text=True,
            check=True
        )
        inspect_data = json.loads(result.stdout)
        env_vars = inspect_data[0].get("Config", {}).get("Env", [])
        
        docker_env = {}
        for item in env_vars:
            if "=" in item:
                k, v = item.split("=", 1)
                docker_env[k] = v
                
        docker_user = docker_env.get("POSTGRES_USER", "Not Set")
        docker_pass = docker_env.get("POSTGRES_PASSWORD", "Not Set")
        docker_db = docker_env.get("POSTGRES_DB", "Not Set")
        
        print(f"Docker Database: {docker_db} | User: {docker_user} | Password: {docker_pass}")
        
        if db != docker_db or user != docker_user or password != docker_pass:
            print("[⚠️ WARNING] Mismatch detected between .env and Docker container's environment variables!")
        else:
            print("[✅ INFO] .env matches Docker container's environment variables.")
            print("[ℹ️ NOTE] If connection still fails, it means the database VOLUME is stale and ignoring these variables.")
            
    except Exception as e:
        print(f"[❌ FAILED] Could not inspect Docker container. Is it running? Error: {e}")
    print(f"-----------------------------------\n")

    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            database=db,
            user=user,
            password=password
        )
        print("[✅ SUCCESS] Successfully connected and authenticated with PostgreSQL!")
        conn.close()
    except psycopg2.OperationalError as e:
        print(f"[❌ FAILED] Connection or Authentication Failed!\nDetails: {e}")
        if "password authentication failed" in str(e):
            print("\n💡 HOW TO FIX DOCKER VOLUME STALENESS:")
            print("Run these exact commands in your terminal to wipe the old database data:\n")
            print("docker-compose down -v\ndocker-compose up -d")

if __name__ == "__main__":
    test_postgres_auth()