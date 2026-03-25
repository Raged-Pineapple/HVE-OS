from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ConnectorBase(BaseModel):
    id: str  # e.g., weather_1
    type: str  # e.g., api, mqtt
    url: Optional[str] = None
    frequency: Optional[str] = None

class ConnectorCreate(ConnectorBase):
    pass

class ConnectorResponse(ConnectorBase):
    created_at: datetime
    
    model_config = {"from_attributes": True}
    
class ConnectorRunResponse(BaseModel):
    status: str
    message: str
