from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
import io
import json
import logging

try:
    import numpy as np
except ImportError:
    np = None

router = APIRouter(prefix="/api/v1/ai-prep", tags=["AI Data Preparation"])
logger = logging.getLogger(__name__)

class SequenceRequest(BaseModel):
    data: List[dict]
    window_size: int
    feature_columns: List[str]
    target_column: Optional[str] = None
    shift_step: int = 1

@router.post("/sequence-window")
async def generate_sequence_windows(request: SequenceRequest):
    """
    Takes flat JSON rows and converts them into sliding window sequences for LSTM training.
    Returns the sequence data and (optionally) targets.
    """
    if not request.data:
        raise HTTPException(status_code=400, detail="No data provided")
        
    if request.window_size <= 0:
        raise HTTPException(status_code=400, detail="Window size must be greater than 0")
        
    if not request.feature_columns:
        raise HTTPException(status_code=400, detail="No feature columns specified")
        
    if len(request.data) < request.window_size:
        raise HTTPException(status_code=400, detail=f"Data length ({len(request.data)}) is smaller than window size ({request.window_size})")

    # Extract sequences
    sequences = []
    targets = []
    
    # We'll do this in pure Python first for safety, then try numpy if available
    rows = request.data
    features = request.feature_columns
    target_col = request.target_column
    
    # Try to convert everything to floats safely
    processed_rows = []
    for row in rows:
        processed_row = []
        for col in features:
            val = row.get(col, 0)
            try:
                processed_row.append(float(val))
            except (ValueError, TypeError):
                processed_row.append(0.0)
        processed_rows.append(processed_row)
        
    # Build sliding windows
    for i in range(0, len(processed_rows) - request.window_size, request.shift_step):
        window = processed_rows[i : i + request.window_size]
        sequences.append(window)
        
        if target_col:
            # Target is the value *after* the window
            target_val = rows[i + request.window_size].get(target_col, 0)
            try:
                targets.append(float(target_val))
            except (ValueError, TypeError):
                targets.append(0.0)

    result = {
        "samples": len(sequences),
        "window_size": request.window_size,
        "features": len(features),
        "sequences": sequences,
        "targets": targets if target_col else None
    }
    
    return result

@router.post("/sequence-window/npz")
async def generate_sequence_windows_npz(request: SequenceRequest):
    """
    Same as /sequence-window but returns a .npz file download.
    Requires numpy to be installed.
    """
    if np is None:
        raise HTTPException(status_code=501, detail="Numpy is required for .npz export. Please install it on the server.")
        
    result_dict = await generate_sequence_windows(request)
    
    X = np.array(result_dict["sequences"])
    arrays_to_save = {'X': X}
    
    if result_dict["targets"]:
        y = np.array(result_dict["targets"])
        arrays_to_save['y'] = y
        
    # Save to in-memory bytes buffer
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays_to_save)
    buf.seek(0)
    
    return Response(
        content=buf.read(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename=lstm_sequences_w{request.window_size}.npz"
        }
    )
