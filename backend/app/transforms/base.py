from abc import ABC, abstractmethod
from typing import Dict, Any
import pandas as pd

class BaseTransform(ABC):
    @abstractmethod
    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        """
        Process the inputs to produce a single output DataFrame.
        """
        pass
