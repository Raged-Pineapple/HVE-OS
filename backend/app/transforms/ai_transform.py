import pandas as pd
from typing import Dict
import logging

from app.transforms.base import BaseTransform
from app.ai.filters.kalman_filter import TemperatureKalmanFilter
from app.ai.models.risk_predictor import RiskPredictor

logger = logging.getLogger(__name__)

class KalmanFilterTransform(BaseTransform):
    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        if "raw_weather" not in inputs:
            return pd.DataFrame()
            
        df = inputs["raw_weather"].copy()
        
        if "temperature" in df.columns:
            # Initialize with the first valid temp
            initial_t = df["temperature"].dropna().iloc[0] if not df["temperature"].dropna().empty else 20.0
            kf = TemperatureKalmanFilter(initial_temp=initial_t)
            
            # Smooth the series
            smoothed_temps = kf.process_series(df["temperature"])
            df["temperature_smoothed"] = smoothed_temps
            # Substitute original with smoothed for downstream
            df["temperature"] = df["temperature_smoothed"]
            
        df["is_clean"] = True
        return df

class RiskPredictionTransform(BaseTransform):
    def __init__(self):
        self.predictor = RiskPredictor()
        
    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        if "clean_weather" not in inputs:
            return pd.DataFrame()
            
        df = inputs["clean_weather"].copy()
        
        # We need temperature and humidity to predict
        if "temperature" not in df.columns:
            df["temperature"] = 20.0 # Default safe fallback
        if "humidity" not in df.columns:
            df["humidity"] = 50.0 # Default humidity
            
        features = ["temperature", "humidity"]
        predictions = self.predictor.predict(df, features)
        
        df["risk_score"] = predictions
        
        return df
