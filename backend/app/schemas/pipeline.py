from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class DatasetBase(BaseModel):
    name: str # e.g., clean_weather
    inputs: List[str] # e.g., ["raw_data"]
    transform_script: Optional[str] = None

class DatasetCreate(DatasetBase):
    pass

class DatasetResponse(DatasetBase):
    model_config = {"from_attributes": True}

class LineageResponse(BaseModel):
    id: int
    output_dataset: str
    derived_from: List[str]
    timestamp: datetime
    status: str
    
    model_config = {"from_attributes": True}
