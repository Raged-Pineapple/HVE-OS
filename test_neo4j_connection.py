import os
import time
from neo4j import GraphDatabase
from dotenv import load_dotenv

def test_neo4j():
    # Load the .env file from the root directory
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ".env"))
    load_dotenv(dotenv_path=env_path)
    
    # Force 127.0.0.1 to avoid IPv6 localhost resolution bugs
    uri = os.getenv("NEO4J_URI", "bolt://127.0.0.1:7688").replace("localhost", "127.0.0.1")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "hve_password123")
    
    print(f"--- Testing Neo4j Connection ---")
    print(f"URI: {uri}")
    print(f"User: {user} | Password: {password}")
    print(f"--------------------------------\n")
    
    max_retries = 15
    retry_delay = 5
    
    for attempt in range(1, max_retries + 1):
        try:
            print(f"Attempt {attempt}/{max_retries}: Connecting to Neo4j...")
            driver = GraphDatabase.driver(uri, auth=(user, password))
            driver.verify_connectivity()
            print(f"\n[✅ SUCCESS] Successfully connected and authenticated with Neo4j!")
            driver.close()
            return
        except Exception as e:
            print(f"[⚠️ WARNING] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                print(f"Waiting {retry_delay} seconds for Neo4j to finish booting...\n")
                time.sleep(retry_delay)
            else:
                print(f"\n[❌ FAILED] Could not connect after {max_retries} attempts.")
                print("\n💡 TROUBLESHOOTING:")
                print("1. Neo4j might still be starting up (it can take 60+ seconds).")
                print("2. Run 'docker logs -f hve-neo4j' and wait for 'Remote interface available'.")

if __name__ == "__main__":
    test_neo4j()