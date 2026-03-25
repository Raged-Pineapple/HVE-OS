import pandas as pd
from typing import Dict
from app.transforms.base import BaseTransform

class ComputeRiskTransform(BaseTransform):
    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        if "clean_weather" not in inputs:
            return pd.DataFrame()
            
        df = inputs["clean_weather"].copy()
        
        # Simple risk computation based on temperature or other factors
        if "temperature" in df.columns:
            # If temperature > 35C or < 0C, risk goes up
            df["risk_score"] = df["temperature"].apply(
                lambda t: 0.8 if t > 35 else (0.7 if t < 0 else 0.1)
            )
        else:
            df["risk_score"] = 0.5 # default moderate risk
            
        return df
