import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import logging

logger = logging.getLogger(__name__)

class RiskPredictor:
    """
    Predicts a 'risk_score' based on environmental features.
    For this implementation, we use a mock-trained RandomForest model.
    """
    def __init__(self):
        # In a real system, you would load a pre-trained model e.g., using joblib
        # Here we initialize and fit a dummy model for demonstration.
        self.model = RandomForestRegressor(n_estimators=10, random_state=42)
        self._train_dummy_model()

    def _train_dummy_model(self):
        # Dummy training: temperatures around 20C are safe (risk 0.1), extremes are risky (risk > 0.8)
        # Humidity over 80% also increases risk.
        X_train = np.array([
            [20.0, 50.0], [22.0, 45.0], [18.0, 60.0], # Normal
            [38.0, 85.0], [40.0, 90.0],               # Heat/High Humidity
            [-5.0, 40.0], [-10.0, 30.0]               # Freezing
        ])
        y_train = np.array([0.1, 0.1, 0.1, 0.9, 0.95, 0.8, 0.85])
        self.model.fit(X_train, y_train)
        logger.info("Dummy Random Forest model trained for Risk Prediction.")

    def predict(self, df: pd.DataFrame, feature_cols: list) -> np.ndarray:
        if df.empty or not all(col in df.columns for col in feature_cols):
            logger.warning("Missing features for prediction.")
            return np.zeros(len(df))
            
        X = df[feature_cols].values
        predictions = self.model.predict(X)
        return predictions
