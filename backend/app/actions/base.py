from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseAction(ABC):
    @abstractmethod
    async def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute the action with the provided payload constraints.
        Should return a dictionary with the status and response.
        """
        pass
