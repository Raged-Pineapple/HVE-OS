import numpy as np
import pandas as pd
from filterpy.kalman import KalmanFilter
import logging

logger = logging.getLogger(__name__)

class TemperatureKalmanFilter:
    """
    A 1D Kalman filter to smooth out noisy temperature readings.
    """
    def __init__(self, initial_temp: float = 20.0):
        self.kf = KalmanFilter(dim_x=1, dim_z=1)
        
        # Initial state (temperature)
        self.kf.x = np.array([[initial_temp]])
        
        # State transition matrix (assume constant temperature model)
        self.kf.F = np.array([[1.]])
        
        # Measurement function
        self.kf.H = np.array([[1.]])
        
        # Covariance matrix (uncertainty in initial state)
        self.kf.P *= 10.
        
        # Measurement noise (variance of sensor noise)
        self.kf.R = np.array([[5.]]) 
        
        # Process noise
        self.kf.Q = np.array([[0.1]])

    def process_series(self, observations: pd.Series) -> list:
        smoothed = []
        for z in observations:
            if pd.isna(z):
                # If measurement is missing, just predict based on previous state
                self.kf.predict()
            else:
                self.kf.predict()
                self.kf.update(np.array([[z]]))
            # Save the smoothed state estimate
            smoothed.append(float(self.kf.x[0][0]))
            
        return smoothed
