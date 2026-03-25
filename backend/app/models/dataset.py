from sqlalchemy import Column, String, JSON
from app.db.session import Base

class Dataset(Base):
    __tablename__ = "datasets"
    
    name = Column(String, primary_key=True, index=True)
    inputs = Column(JSON, nullable=False, default=list) # List of input dataset names or "raw_data"
    transform_script = Column(String, nullable=True) # e.g. "compute_risk"
