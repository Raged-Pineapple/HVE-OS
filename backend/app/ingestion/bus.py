import json
import logging
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
import asyncio

logger = logging.getLogger(__name__)

class MessageBus:
    """
    Sub-layer 2: The Message Bus.
    Handles strict topic boundaries: ingest.raw.*, ingest.validated, ingest.dlq
    """
    def __init__(self, bootstrap_servers="localhost:19092"):
        self.bootstrap_servers = bootstrap_servers
        self.producer = None
        
    async def connect(self):
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        await self.producer.start()
        logger.info(f"Connected to Kafka/Redpanda cluster at {self.bootstrap_servers}")
        
    async def close(self):
        if self.producer:
            await self.producer.stop()
            
    async def publish_raw(self, source_id: str, payload: dict, partition_key: str = None):
        """
        Every raw record produced by a connector is immediately written to the internal message bus.
        Partition mapping ensures events for a given entity execute sequentially.
        """
        topic = f"ingest.raw.{source_id}"
        await self._send(topic, payload, partition_key)

    async def publish_validated(self, payload: dict, partition_key: str = None):
        """
        The ingest.validated topic only receives records that passed schema validation and deduplication.
        """
        await self._send("ingest.validated", payload, partition_key)
        
    async def publish_static(self, dataset_name: str, payload: dict):
        """
        Reference data enters as versioned payloads.
        """
        await self._send(f"ingest.static.{dataset_name}", payload)

    async def publish_dlq(self, raw_payload: dict, failure_reason: dict):
        """
        Every record on the DLQ carries the original payload plus a structured failure reason.
        """
        msg = {
            "failed_payload": raw_payload,
            "failure_reason": failure_reason
        }
        await self._send("ingest.dlq", msg)
        logger.error(f"DLQ SHUNT: {failure_reason}")

    async def _send(self, topic: str, value: dict, key: str = None):
        if not self.producer:
            await self.connect()
            
        b_key = key.encode('utf-8') if key else None
        await self.producer.send_and_wait(topic, value, key=b_key)
        
    def get_consumer(self, topic: str = None, group_id: str = "default_group", pattern: str = None):
        consumer = AIOKafkaConsumer(
            bootstrap_servers=self.bootstrap_servers,
            group_id=group_id,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='earliest'
        )
        if pattern:
            consumer.subscribe(pattern=pattern)
        elif topic:
            consumer.subscribe(topics=[topic])
        return consumer

message_bus = MessageBus()
