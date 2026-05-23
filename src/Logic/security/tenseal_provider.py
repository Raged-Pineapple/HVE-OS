import os
import requests
import base64
import logging
from typing import Any, Dict, List
from .provider import BaseSecurityProvider

logger = logging.getLogger(__name__)

# We set this to True so the Frontend UI will render the configuration panels.
# The actual math is now handled by the Dockerized microservice.
TENSEAL_AVAILABLE = True
TENSEAL_ENGINE_URL = os.environ.get("TENSEAL_ENGINE_URL", "http://localhost:8001")

class TenSEALProvider(BaseSecurityProvider):
    """
    Provides Homomorphic Encryption capabilities using Microsoft SEAL via TenSEAL.
    Now acts as a client to the tenseal-engine Docker microservice.
    """
    
    def __init__(self):
        pass

    def get_capabilities(self) -> Dict[str, Any]:
        return {
            "name": "TenSEAL Homomorphic Encryption",
            "id": "tenseal",
            "available": TENSEAL_AVAILABLE,
            "operations": ["encrypt", "decrypt", "compute"],
            "computations": ["sum", "multiply"],
            "params_schema": {
                "encrypt": {
                    "scheme": ["CKKS", "BFV"],
                    "poly_modulus_degree": [4096, 8192, 16384],
                    "context_id": "string"
                },
                "compute": {
                    "operation": ["sum", "multiply"]
                }
            }
        }

    def encrypt(self, data: Any, params: Dict[str, Any]) -> Any:
        try:
            response = requests.post(f"{TENSEAL_ENGINE_URL}/encrypt", json={
                "data": data,
                "params": params
            }, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            detail = ""
            response = locals().get("response")
            if response is not None:
                try:
                    detail = f" Response body: {response.text[:500]}"
                except Exception:
                    detail = ""
            logger.error(f"Failed to communicate with TenSEAL engine: {e}{detail}")
            raise RuntimeError(f"TenSEAL Microservice Error: {e}{detail}")

    def decrypt(self, data: Any, params: Dict[str, Any]) -> Any:
        if not isinstance(data, dict) or data.get("__type__") != "tenseal_encrypted":
            return data # Return as-is if not encrypted by us
            
        try:
            response = requests.post(f"{TENSEAL_ENGINE_URL}/decrypt", json={
                "data": data,
                "params": params
            }, timeout=10)
            response.raise_for_status()
            return response.json().get("result")
        except Exception as e:
            logger.error(f"Failed to communicate with TenSEAL engine: {e}")
            raise RuntimeError(f"TenSEAL Microservice Error: {e}")

    def compute(self, operation: str, data_list: List[Any], params: Dict[str, Any]) -> Any:
        if not data_list:
            return None
            
        try:
            response = requests.post(f"{TENSEAL_ENGINE_URL}/compute", json={
                "operation": operation,
                "data_list": data_list,
                "params": params
            }, timeout=10)
            response.raise_for_status()
            # Returns the encrypted tensor dictionary
            return response.json()
        except Exception as e:
            detail = ""
            response = locals().get("response")
            if response is not None:
                try:
                    detail = f" Response body: {response.text[:500]}"
                except Exception:
                    detail = ""
            logger.error(f"Failed to communicate with TenSEAL engine: {e}{detail}")
            raise RuntimeError(f"TenSEAL Microservice Error: {e}{detail}")
