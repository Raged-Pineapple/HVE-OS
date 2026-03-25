import requests
import time
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_URL = "http://localhost:8000"

def test_connectors():
    # 1. Start by waiting for the API to be up
    for _ in range(10):
        try:
            res = requests.get(f"{API_URL}/")
            if res.status_code == 200:
                logger.info("API is up!")
                break
        except requests.exceptions.ConnectionError:
            time.sleep(1)
    else:
        logger.error("API did not start in time.")
        return

    # 2. Create an API connector (e.g. fetching fake json data)
    connector_payload = {
        "id": "weather_test_1",
        "type": "api",
        "url": "https://jsonplaceholder.typicode.com/todos/1",
        "frequency": "manual"
    }
    logger.info(f"Creating connector: {connector_payload['id']}")
    res = requests.post(f"{API_URL}/connectors/create", json=connector_payload)
    if res.status_code == 200:
        logger.info(f"Created connector successfully: {res.json()}")
    else:
        logger.warning(f"Failed to create connector (maybe exists?): {res.text}")

    # 3. Create an MQTT connector
    mqtt_payload = {
        "id": "iot_sensor_1",
        "type": "mqtt",
        "url": "sensors/weather",
        "frequency": "continuous"
    }
    logger.info(f"Creating MQTT connector: {mqtt_payload['id']}")
    res = requests.post(f"{API_URL}/connectors/create", json=mqtt_payload)
    if res.status_code == 200:
        logger.info(f"Created MQTT connector successfully: {res.json()}")
    else:
        logger.warning(f"Failed to create MQTT connector: {res.text}")

    # 4. Read all connectors
    res = requests.get(f"{API_URL}/connectors/")
    logger.info(f"All connectors: {json.dumps(res.json(), indent=2)}")

    # 5. Trigger the API connector to run
    logger.info("Triggering API connectors to run...")
    res = requests.post(f"{API_URL}/connectors/all/run")
    logger.info(f"Trigger response: {res.json()}")

    # 6. Publish an MQTT message to test ingestion
    import paho.mqtt.publish as publish
    logger.info("Publishing test MQTT message to sensors/weather...")
    try:
        publish.single("sensors/weather", payload=json.dumps({"temperature": 22.5, "humidity": 60}), hostname="localhost", port=1883)
        logger.info("Published MQTT message.")
    except Exception as e:
        logger.error(f"Failed to publish MQTT message: {e}")

if __name__ == "__main__":
    test_connectors()
