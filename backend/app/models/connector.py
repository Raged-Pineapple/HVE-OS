import datetime
from sqlalchemy import Column, String, Integer, DateTime
from app.db.session import Base

class Connector(Base):
    __tablename__ = "connectors"
    
    id = Column(String, primary_key=True, index=True)
    type = Column(String, index=True) # "api", "mqtt", etc
    url = Column(String, nullable=True) # or topic for mqtt
    frequency = Column(String, nullable=True) # e.g. "5s"
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
