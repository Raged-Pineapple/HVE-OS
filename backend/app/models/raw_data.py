import datetime
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB

from app.db.session import Base

class RawData(Base):
    __tablename__ = "raw_data"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    connector_id = Column(String, index=True)
    payload = Column(JSONB, nullable=False)
    
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
