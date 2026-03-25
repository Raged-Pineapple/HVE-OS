import datetime
from sqlalchemy import Column, Integer, String, JSON, DateTime
from app.db.session import Base

class Lineage(Base):
    __tablename__ = "lineage"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    output_dataset = Column(String, index=True)
    derived_from = Column(JSON, nullable=False, default=list)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, default="success") # success, failed
