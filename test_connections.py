import os
import socket
from dotenv import load_dotenv

def test_connection(host, port, service_name):
    """Attempt to open a TCP connection to the specified host and port."""
    try:
        with socket.create_connection((host, int(port)), timeout=5):
            print(f"[✅ SUCCESS] Connected to {service_name} on {host}:{port}")
    except Exception as e:
        print(f"[❌ FAILED] Could not connect to {service_name} on {host}:{port} - {e}")

def main():
    # 1. Accurately locate and load the .env file
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".env"))
    load_dotenv(dotenv_path=env_path)
    
    print(f"--- Loading configurations from {env_path} ---\n")
    
    # 2. Map service names to their respective ports from the .env file
    services = {
        "PostgreSQL": os.getenv("DB_PORT", "5433"),
        "MinIO (API)": os.getenv("MINIO_PORT", "9000"),
        "MinIO (Console)": os.getenv("MINIO_CONSOLE_PORT", "9001"),
        "Kafka": os.getenv("KAFKA_PORT", "9094"),
        "Neo4j (Bolt)": os.getenv("NEO4J_BOLT_PORT", "7688"),
        "Neo4j (HTTP)": os.getenv("NEO4J_HTTP_PORT", "7474"),
        "Iceberg REST": os.getenv("ICEBERG_REST_PORT", "8181"),
    }

    # 3. Test each service
    for service, port in services.items():
        if port:
            test_connection("127.0.0.1", port, service)
        else:
            print(f"[⚠️ WARNING] No port defined for {service} in .env")

if __name__ == "__main__":
    main()