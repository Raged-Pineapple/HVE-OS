from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import base64
import os
import tenseal as ts
import logging

app = FastAPI(title="TenSEAL Engine Microservice")
logger = logging.getLogger(__name__)

# In-memory context cache (fast path)
_contexts: Dict[str, ts.Context] = {}

# Persistent context directory — mount a Docker volume here
CONTEXT_DIR = os.environ.get("CONTEXT_DIR", "/app/contexts")
os.makedirs(CONTEXT_DIR, exist_ok=True)


def _ctx_path(context_id: str) -> str:
    # Sanitize to prevent path traversal
    safe_id = "".join(c for c in context_id if c.isalnum() or c in ("_", "-"))
    return os.path.join(CONTEXT_DIR, f"{safe_id}.ctx")


def _load_context_from_disk(context_id: str) -> Optional[ts.Context]:
    path = _ctx_path(context_id)
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                ctx = ts.context_from(f.read())
            logger.info(f"Loaded persisted context '{context_id}' from disk.")
            return ctx
        except Exception as e:
            logger.warning(f"Failed to load context '{context_id}' from disk: {e}. Will recreate.")
    return None


def _save_context_to_disk(context_id: str, context: ts.Context) -> None:
    path = _ctx_path(context_id)
    try:
        with open(path, "wb") as f:
            # save_secret_key=True is required so decryption works later
            f.write(context.serialize(save_secret_key=True))
        logger.info(f"Persisted context '{context_id}' to disk: {path}")
    except Exception as e:
        logger.warning(f"Failed to persist context '{context_id}' to disk: {e}")


def _get_or_create_context(params: Dict[str, Any]) -> ts.Context:
    context_id = params.get("context_id", "default")

    # 1. Fast path — in-memory
    if context_id in _contexts:
        return _contexts[context_id]

    # 2. Medium path — disk (survives container restarts)
    ctx = _load_context_from_disk(context_id)
    if ctx:
        _contexts[context_id] = ctx
        return ctx

    # 3. Slow path — create fresh context, then persist it
    scheme_str = params.get("scheme", "CKKS")
    scheme = ts.SCHEME_TYPE.CKKS if scheme_str == "CKKS" else ts.SCHEME_TYPE.BFV
    poly_mod_degree = params.get("poly_modulus_degree", 8192)

    if scheme_str == "CKKS":
        default_coeff_sizes = [60, 40, 40, 40, 40, 60] if poly_mod_degree >= 16384 else [60, 40, 40, 60]
        coeff_sizes = params.get("coeff_mod_bit_sizes", default_coeff_sizes)
        g_scale = params.get("global_scale", 2 ** 40)
        context = ts.context(
            scheme,
            poly_modulus_degree=poly_mod_degree,
            coeff_mod_bit_sizes=coeff_sizes
        )
        context.global_scale = g_scale
        context.generate_galois_keys()
        context.generate_relin_keys()
    else:
        context = ts.context(
            scheme,
            poly_modulus_degree=poly_mod_degree,
            plain_modulus=1032193
        )

    logger.info(f"Created new context '{context_id}' (poly_degree={poly_mod_degree}, scheme={scheme_str})")
    _contexts[context_id] = context
    _save_context_to_disk(context_id, context)
    return context


# ── Request Models ────────────────────────────────────────────────────────────

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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/encrypt")
async def encrypt(req: EncryptRequest):
    try:
        context_id = req.params.get("context_id", "default")
        context = _get_or_create_context(req.params)
        data = req.data

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
            # Embed context_id so the inference node can look up the right context
            "context_id": context_id,
            "data": base64.b64encode(serialized).decode("utf-8"),
        }
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/decrypt")
async def decrypt(req: DecryptRequest):
    try:
        data = req.data
        if not isinstance(data, dict) or data.get("__type__") != "tenseal_encrypted":
            return {"result": data}

        # Prefer the context_id embedded in the ciphertext dict
        embedded_ctx_id = data.get("context_id")
        if embedded_ctx_id:
            req.params["context_id"] = embedded_ctx_id

        context = _get_or_create_context(req.params)
        raw_bytes = base64.b64decode(data["data"])

        scheme = data.get("scheme", "CKKS")
        if scheme == "CKKS":
            encrypted_tensor = ts.ckks_vector_from(context, raw_bytes)
        else:
            encrypted_tensor = ts.bfv_vector_from(context, raw_bytes)

        result = encrypted_tensor.decrypt()
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

        # We may need multiple contexts if ciphertexts were encrypted under
        # different context_ids — load each on demand.
        def _get_ctx_for_item(item):
            if isinstance(item, dict) and item.get("__type__") == "tenseal_encrypted":
                item_ctx_id = item.get("context_id", req.params.get("context_id", "default"))
                merged = {**req.params, "context_id": item_ctx_id}
                return _get_or_create_context(merged)
            return _get_or_create_context(req.params)

        # Deserialize all items
        tensors = []
        primary_ctx = None  # the context of the first ciphertext — used for re-serialization
        for item in req.data_list:
            if isinstance(item, dict) and item.get("__type__") == "tenseal_encrypted":
                ctx = _get_ctx_for_item(item)
                if primary_ctx is None:
                    primary_ctx = ctx
                raw_bytes = base64.b64decode(item["data"])
                scheme = item.get("scheme", req.params.get("scheme", "CKKS"))
                if scheme == "CKKS":
                    tensors.append(ts.ckks_vector_from(ctx, raw_bytes))
                else:
                    tensors.append(ts.bfv_vector_from(ctx, raw_bytes))
            else:
                # Plain scalar or list — keep as Python for plaintext ops
                if isinstance(item, (int, float)):
                    tensors.append(float(item))
                else:
                    tensors.append([float(x) for x in item])

        if not tensors:
            return {"result": None}

        result_tensor = tensors[0]
        for i in range(1, len(tensors)):
            operand = tensors[i]
            if req.operation == "sum":
                result_tensor = result_tensor + operand
            elif req.operation == "multiply":
                result_tensor = result_tensor * operand
                # Only rescale after ciphertext × ciphertext multiply.
                # Plaintext multiplications (operand is a plain float/list) do NOT
                # add a modulus level in CKKS — rescaling after them consumes a level
                # unnecessarily and causes "scale out of bounds" on the next addition.
                if hasattr(result_tensor, "rescale_to_next"):
                    try:
                        result_tensor.rescale_to_next()
                    except Exception as rescale_err:
                        logger.debug(f"Rescale after multiply skipped: {rescale_err}")
            elif req.operation == "dot":
                result_tensor = result_tensor.dot(operand)
                if hasattr(result_tensor, "rescale_to_next"):
                    try:
                        result_tensor.rescale_to_next()
                    except Exception as rescale_err:
                        logger.debug(f"Rescale after dot skipped: {rescale_err}")
                # dot is always ciphertext × plaintext — no rescale needed
            else:
                raise ValueError(f"Unsupported operation: {req.operation}")

        if not hasattr(result_tensor, "serialize"):
            raise ValueError(
                f"Computation produced a plain Python value ({type(result_tensor).__name__}), "
                f"not a TenSEAL ciphertext. Ensure data_list[0] is an encrypted dict, "
                f"not a bare scalar. Operation='{req.operation}'."
            )

        serialized = result_tensor.serialize()

        # Preserve the context_id of the primary ciphertext in the result
        result_ctx_id = req.params.get("context_id", "default")
        if isinstance(req.data_list[0], dict):
            result_ctx_id = req.data_list[0].get("context_id", result_ctx_id)

        return {
            "__type__": "tenseal_encrypted",
            "scheme": req.params.get("scheme", "CKKS"),
            "context_id": result_ctx_id,
            "data": base64.b64encode(serialized).decode("utf-8"),
        }
    except Exception as e:
        logger.error(f"Computation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
