import json
import logging
from confluent_kafka import Producer

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import os

# Kafka configuration
# We default to the internal docker network port if running inside docker,
# or localhost:9094 if running the API locally against the dockerized Kafka
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9094")
RAW_TOPIC = "raw-telemetry"
SILVER_TOPIC = "silver-telemetry"

def delivery_report(err, msg):
    """
    Called once for each message produced to indicate delivery result.
    Triggered by poll() or flush().
    """
    if err is not None:
        logger.error(f'Message delivery failed: {err}')
    else:
        # In extremely high volume, you might disable this log, but good for Phase 1.
        logger.debug(f'Message delivered to {msg.topic()} [{msg.partition()}]')

# Create a singleton Producer instance. 
# This handles connection pooling and background batching efficiently.
producer_config = {
    'bootstrap.servers': KAFKA_BROKERS,
    # High throughput configurations
    'linger.ms': 10,  # Wait 10ms to batch messages
    'batch.num.messages': 10000,
    'queue.buffering.max.messages': 100000, 
}
producer = Producer(producer_config)

def publish_stream(canonical_payload: dict, topic: str = RAW_TOPIC):
    """
    Publishes the wrapped Envelope to Kafka asynchronously.
    """
    try:
        # Serialization
        msg_value = json.dumps(canonical_payload).encode('utf-8')
        
        # Fire-and-forget publish
        producer.produce(
            topic=topic,
            value=msg_value,
            callback=delivery_report
        )
        # Serve callbacks to trigger delivery_report
        producer.poll(0)
    except BufferError as e:
        logger.error(f"Local producer queue is full ({len(producer)} messages awaiting delivery): {e}")
        # In a real app, you might apply backpressure to the API here.
        raise Exception("Kafka Producer Buffer Full")
    except Exception as e:
        logger.error(f"Error publishing to Kafka: {e}")
        raise
