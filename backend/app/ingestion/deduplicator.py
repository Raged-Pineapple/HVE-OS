import redis.asyncio as redis
import logging

logger = logging.getLogger(__name__)

class Deduplicator:
    """
    Sub-layer 4: Algorithmic Deduplication and Idempotency tracking.
    Runs exactly concurrent to Schema Validation to ensure Exactly-Once semantics.
    """
    def __init__(self, redis_url="redis://localhost:6379/1"):
        # We use Redis DB 1 for ingestion metadata, DB 0 for World State.
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.WATERMARK_KEY = "watermarks:sources"
        
    async def is_duplicate(self, canonical_record: dict) -> bool:
        """
        Sub-layer 4 rule: 3-pronged deduplication check. 
        Returns True if the record should be aggressively dropped prior to validation.
        """
        source_id = canonical_record.get("source_id")
        row_hash = canonical_record.get("row_hash")
        source_ts = canonical_record.get("source_ts")
        
        # Metric tracking
        if not hasattr(self, "metrics"):
            self.metrics = {"passed": 0, "dropped_hash": 0, "dropped_watermark": 0}
            
        # 1. Content-based Deduplication (O(1) Atomic Check-and-Set)
        # Using 7-day TTL (604800 seconds)
        is_new = await self.redis.set(f"seen:{row_hash}", "1", ex=604800, nx=True)
        if not is_new:
            self.metrics["dropped_hash"] += 1
            logger.warning(f"♻️ DEDUPLICATOR: Dropped exact duplicate row {row_hash}")
            return True
            
        # 2. Watermark Deduplication
        current_watermark = await self.redis.hget(self.WATERMARK_KEY, source_id)
        if current_watermark and source_ts < int(current_watermark):
            # Limit late-arrival tolerance to 30 minutes (1,800,000 ms)
            TOLERANCE_MS = 1800000
            if source_ts < int(current_watermark) - TOLERANCE_MS:
                self.metrics["dropped_watermark"] += 1
                logger.warning(f"🕰️ DEDUPLICATOR: Dropped late arrival {source_id} TS:{source_ts}")
                return True
                
        # 3. Update active watermark if this is the newest chronological record
        if not current_watermark or source_ts > int(current_watermark):
            await self.redis.hset(self.WATERMARK_KEY, source_id, str(source_ts))
            
        self.metrics["passed"] += 1
        return False
        
deduplicator = Deduplicator()
