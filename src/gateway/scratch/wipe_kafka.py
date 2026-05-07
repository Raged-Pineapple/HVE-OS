from confluent_kafka.admin import AdminClient
import os

def wipe_kafka():
    admin = AdminClient({'bootstrap.servers': os.getenv("KAFKA_BROKERS", "localhost:9094")})
    topics = ["raw-telemetry", "silver-telemetry"]
    print(f"Attempting to delete topics: {topics}...")
    fs = admin.delete_topics(topics, operation_timeout=30)

    for topic, f in fs.items():
        try:
            f.result()  # The result itself is None
            print(f"Topic {topic} deleted successfully.")
        except Exception as e:
            print(f"Failed to delete topic {topic}: {e}")

if __name__ == "__main__":
    wipe_kafka()
