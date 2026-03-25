import paho.mqtt.client as mqtt
import logging
import json
import asyncio
from app.connectors.base import BaseConnector
from app.db.session import SessionLocal
from app.models.raw_data import RawData

logger = logging.getLogger(__name__)

class MQTTConnector(BaseConnector):
    def __init__(self, connector_id: str, broker: str, port: int, topic: str):
        super().__init__(connector_id)
        self.broker = broker
        self.port = port
        self.topic = topic
        self.client = mqtt.Client(client_id=self.connector_id)
        
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        
    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info(f"Connected to MQTT broker {self.broker}:{self.port}")
            self.client.subscribe(self.topic)
        else:
            logger.error(f"Failed to connect to MQTT broker. Code: {rc}")
            
    def _on_message(self, client, userdata, msg):
        payload_str = msg.payload.decode("utf-8")
        logger.info(f"Received message on {msg.topic}: {payload_str}")
        try:
            payload = json.loads(payload_str)
        except json.JSONDecodeError:
            payload = {"raw_text": payload_str}
            
        # We must use asyncio.run_coroutine_threadsafe to run async DB call from sync callback
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
            
        if loop and loop.is_running():
            logger.error("Called from running async context, unhandled in _on_message sync func.")
            pass
        else:
            # For simplicity in this early phase, we can synchronously save using standard sync SQLAlchemy engine,
            # or spawn a thread. 
            pass # TODO: Fix the async-sync boundary here properly for the persistent MQTT client
            
    async def run(self) -> None:
        try:
            self.client.connect(self.broker, self.port, 60)
            # loop_start runs a thread for the MQTT client
            self.client.loop_start() 
            logger.info(f"Started MQTT loop for {self.connector_id} on {self.topic}")
        except Exception as e:
            logger.error(f"Error running MQTT connector: {e}")
            
    async def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()
        logger.info(f"Stopped MQTT connector {self.connector_id}")
