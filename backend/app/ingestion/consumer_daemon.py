import asyncio
import logging
import re
from contextlib import asynccontextmanager
from app.ingestion.bus import message_bus
from app.ingestion.deduplicator import deduplicator
from app.ingestion.schema_registry import schema_registry
from app.ingestion.archive_writer import archive_writer

logger = logging.getLogger(__name__)

async def start_raw_consumer():
    """
    Consumer 1: Sub-layer 4 & 3 (Deduplication -> Validation -> DLQ/Validated)
    Reads from ingest.raw.* using regex subscription.
    """
    # AIOKafkaConsumer supports regex topics
    consumer = message_bus.get_consumer(pattern="^ingest\.raw\..+", group_id="dlq_validator_group")
    await consumer.start()
    logger.info("📡 KAFKA DAEMON: Started Raw Multi-Topic Consumer (Deduplication & Validation Layer)")
    try:
        async for msg in consumer:
            canonical_record = msg.value
            
            # Sub-Layer 4: Deduplication runs first
            is_dup = await deduplicator.is_duplicate(canonical_record)
            if is_dup:
                continue # Safely vaporized O(1) 
                
            # Sub-Layer 3: Schema Master Validator (Routes to Validated or DLQ)
            await schema_registry.validate_and_route(canonical_record)
            
    except asyncio.CancelledError:
        pass
    finally:
        await consumer.stop()

async def start_validated_consumer():
    """
    Consumer 2: Sub-layer 5 (Archive Delta Lake Writer)
    Reads from ingest.validated -> Writes to Parquet
    """
    consumer = message_bus.get_consumer("ingest.validated", group_id="archive_writer_group")
    await consumer.start()
    logger.info("📡 KAFKA DAEMON: Started Validated Consumer (Parquet Archive Layer)")
    try:
        async for msg in consumer:
            canonical_record = msg.value
            archive_writer.add_record(canonical_record)
    except asyncio.CancelledError:
        pass
    finally:
        await consumer.stop()

from app.ingestion.catalog_updater import catalog_updater

async def start_all_daemons():
    # Run the consumers infinitely in the background
    asyncio.create_task(start_raw_consumer())
    asyncio.create_task(start_validated_consumer())
    asyncio.create_task(catalog_updater.run())
