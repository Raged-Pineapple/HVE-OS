import pandas as pd
from typing import Dict
from app.transforms.base import BaseTransform

class CleanWeatherTransform(BaseTransform):
    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        if "raw_weather" not in inputs:
            # Fallback if names don't match, return an empty DF or the first one
            df = list(inputs.values())[0] if inputs else pd.DataFrame()
        else:
            df = inputs["raw_weather"]
            
        # Example cleaning logic: drop rows where temperature is missing
        if "temperature" in df.columns:
            df = df.dropna(subset=["temperature"])
            # Normalize temperature if needed (e.g. F to C)
            
        # Add a flag to indicate it is clean
        df["is_clean"] = True
        return df
