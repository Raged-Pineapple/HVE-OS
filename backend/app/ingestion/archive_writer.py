import os
import time
import pandas as pd
from datetime import datetime
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

class ArchiveWriter:
    """
    Sub-layer 5: Parquet / Delta Lake Raw Archive Writer.
    Consumes from ingest.validated and produces columnar files mimicking scalable Object Storage.
    """
    def __init__(self, base_path="D:/HVE_OS/datalake/raw"):
        self.base_path = base_path
        self.buffer: Dict[str, List[dict]] = {} # source_id -> list of records
        self.last_flush_time = time.time()
        
    def add_record(self, record: dict):
        # Sub-layer 5 rule: Support dataset versioning (static) OR streams (hive partitions)
        source_id = record.get("source_id", "unknown_source")
        if source_id not in self.buffer:
            self.buffer[source_id] = []
            
        self.buffer[source_id].append(record)
        
        # Size threshold (10,000 rows for stream throughput balance)
        if len(self.buffer[source_id]) >= 10000:
            self.flush(source_id)
            
        # Time threshold (30 seconds for local demo, 300s originally)
        if time.time() - self.last_flush_time >= 30:
            self.flush_all()
            
    def flush_all(self):
        for source_id in list(self.buffer.keys()):
            self.flush(source_id)
        self.last_flush_time = time.time()
            
    def flush(self, source_id: str):
        records = self.buffer.get(source_id)
        if not records:
            return
            
        df = pd.DataFrame(records)
        now = datetime.utcnow()
        
        # Sub-layer 5 RULE: Hive-style partitioning: source={id}/year=/month=/day=/hour=/
        partition_path = os.path.join(
            self.base_path,
            f"source={source_id}",
            f"year={now.year}",
            f"month={now.month:02d}",
            f"day={now.day:02d}",
            f"hour={now.hour:02d}"
        )
        os.makedirs(partition_path, exist_ok=True)
        
        # Immutable append: file name uses current timestamp sequence
        # We enforce exactly-once immutability; never overwrite, never delete.
        file_path = os.path.join(partition_path, f"part_{int(now.timestamp() * 1000)}.parquet")
        
        # Write columnar Parquet using pyarrow engine with snappy compression
        df.to_parquet(file_path, engine="pyarrow", compression="snappy")
        
        logger.info(f"📁 ARCHIVE WRITER: Flushed {len(records)} rows to immutable local Parquet storage at {file_path}")
        self.buffer[source_id] = []

archive_writer = ArchiveWriter()
