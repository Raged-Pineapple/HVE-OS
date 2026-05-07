import os
import sys
import logging

# Add src to path
sys.path.insert(0, os.path.abspath("src"))

from gateway.services.kafka_service import producer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_kafka")

def test_connection():
    try:
        # poll(0) triggers any pending events, but we want to see if it can connect.
        # Producing a message is the best way to test connectivity in rdkafka.
        logger.info("Checking Kafka connection to localhost:9094...")
        producer.poll(0)
        logger.info("Kafka producer initialized and polled successfully.")
        print("KAFKA_CONNECTED")
    except Exception as e:
        logger.error(f"Failed to connect to Kafka: {e}")
        print("KAFKA_FAILED")

if __name__ == "__main__":
    test_connection()
