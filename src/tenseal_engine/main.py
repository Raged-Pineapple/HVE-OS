from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import base64
import tenseal as ts
import logging

app = FastAPI(title="TenSEAL Engine Microservice")
logger = logging.getLogger(__name__)

# In-memory context cache
_contexts = {}

def _get_or_create_context(params: Dict[str, Any]):
    context_id = params.get("context_id", "default")
    if context_id in _contexts:
        return _contexts[context_id]

    scheme_str = params.get("scheme", "CKKS")
    scheme = ts.SCHEME_TYPE.CKKS if scheme_str == "CKKS" else ts.SCHEME_TYPE.BFV
    poly_mod_degree = params.get("poly_modulus_degree", 8192)

    if scheme_str == "CKKS":
        context = ts.context(
            scheme,
            poly_modulus_degree=poly_mod_degree,
            coeff_mod_bit_sizes=[60, 40, 40, 60]
        )
        context.global_scale = 2**40
        context.generate_galois_keys()
    else:
        context = ts.context(
            scheme,
            poly_modulus_degree=poly_mod_degree,
            plain_modulus=1032193
        )
    
    _contexts[context_id] = context
    return context


class EncryptRequest(BaseModel):
    data: Any
    params: Dict[str, Any]

class DecryptRequest(BaseModel):
    data: Any
    params: Dict[str, Any]

class ComputeRequest(BaseModel):
    operation: str
    data_list: List[Any]
    params: Dict[str, Any]


@app.post("/encrypt")
async def encrypt(req: EncryptRequest):
    try:
        context = _get_or_create_context(req.params)
        data = req.data
        
        # TenSEAL CKKS expects lists of floats
        if isinstance(data, (int, float)):
            data = [float(data)]
        elif isinstance(data, list):
            data = [float(x) for x in data]
        else:
            raise ValueError(f"TenSEAL cannot encrypt type: {type(data)}")

        scheme = req.params.get("scheme", "CKKS")
        if scheme == "CKKS":
            encrypted_tensor = ts.ckks_vector(context, data)
        else:
            encrypted_tensor = ts.bfv_vector(context, [int(x) for x in data])

        serialized = encrypted_tensor.serialize()
        return {
            "__type__": "tenseal_encrypted",
            "scheme": scheme,
            "data": base64.b64encode(serialized).decode('utf-8')
        }
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/decrypt")
async def decrypt(req: DecryptRequest):
    try:
        data = req.data
        if not isinstance(data, dict) or data.get("__type__") != "tenseal_encrypted":
            return {"result": data} # Return as-is if not encrypted by us
            
        context = _get_or_create_context(req.params)
        raw_bytes = base64.b64decode(data["data"])
        
        scheme = data.get("scheme", "CKKS")
        if scheme == "CKKS":
            encrypted_tensor = ts.ckks_vector_from(context, raw_bytes)
        else:
            encrypted_tensor = ts.bfv_vector_from(context, raw_bytes)
            
        result = encrypted_tensor.decrypt()
        # Return single value if it was a single value
        if len(result) == 1:
            result = result[0]
            
        return {"result": result}
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compute")
async def compute(req: ComputeRequest):
    try:
        if not req.data_list:
            return {"result": None}
            
        context = _get_or_create_context(req.params)
        
        # Deserialize first
        tensors = []
        for item in req.data_list:
            if isinstance(item, dict) and item.get("__type__") == "tenseal_encrypted":
                raw_bytes = base64.b64decode(item["data"])
                if item.get("scheme", "CKKS") == "CKKS":
                    tensors.append(ts.ckks_vector_from(context, raw_bytes))
                else:
                    tensors.append(ts.bfv_vector_from(context, raw_bytes))
            else:
                # If mixing plain and encrypted, TenSEAL supports adding plain lists
                tensors.append([float(item)] if isinstance(item, (int, float)) else [float(x) for x in item])

        if not tensors:
            return {"result": None}

        result_tensor = tensors[0]
        for i in range(1, len(tensors)):
            if req.operation == "sum":
                result_tensor = result_tensor + tensors[i]
            elif req.operation == "multiply":
                result_tensor = result_tensor * tensors[i]
            else:
                raise ValueError(f"Unsupported operation: {req.operation}")

        serialized = result_tensor.serialize()
        return {
            "__type__": "tenseal_encrypted",
            "scheme": req.params.get("scheme", "CKKS"),
            "data": base64.b64encode(serialized).decode('utf-8')
        }
    except Exception as e:
        logger.error(f"Computation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
