from abc import ABC, abstractmethod
from typing import Any

class BaseConnector(ABC):
    def __init__(self, connector_id: str):
        self.connector_id = connector_id
        
    @abstractmethod
    async def run(self) -> Any:
        pass
        
    @abstractmethod
    async def stop(self) -> None:
        pass
