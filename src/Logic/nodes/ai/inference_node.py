import logging
import io
import json
from typing import Dict, Any, Optional

import torch
import torch.nn as nn
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node
from gateway.services import minio_service

logger = logging.getLogger(__name__)


def _is_encrypted_value(value: Any) -> bool:
    return isinstance(value, dict) and value.get("__type__") == "tenseal_encrypted"


def _merge_attribute_inputs(data_input: Any) -> Any:
    """
    Merge multiple Split attr-out payloads like [{"x": 1}, {"y": 2}] into a single row.
    Leaves normal dataset-shaped inputs unchanged.
    """
    if not isinstance(data_input, list) or not data_input:
        return data_input

    if all(isinstance(item, dict) and len(item) == 1 for item in data_input):
        merged = {}
        for item in data_input:
            merged.update(item)
        return [merged]

    return data_input


def _to_plain_scalar(value: Any, tenseal_provider=None) -> Optional[float]:
    if value is None:
        return None

    if _is_encrypted_value(value):
        if not tenseal_provider:
            raise ValueError("Encrypted feature value received but TenSEAL provider is unavailable.")
        value = tenseal_provider.decrypt(value, {"scheme": "CKKS", "context_id": value.get("context_id", "default")})

    if isinstance(value, (list, tuple, np.ndarray)):
        if len(value) == 0:
            return None
        value = value[0]

    return float(value)

class FHEFlightNet(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim):
        super().__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, output_dim)

    def poly_act(self, x):
        return 0.125 * x * x + 0.5 * x + 0.25

    def forward(self, x):
        x = self.fc1(x)
        x = self.poly_act(x)
        x = self.fc2(x)
        return x

def _clean_for_preview(data_val):
    if isinstance(data_val, dict):
        if data_val.get("__type__") == "tenseal_encrypted" and "data" in data_val:
            preview_dict = dict(data_val)
            if isinstance(preview_dict["data"], str):
                preview_dict["data"] = preview_dict["data"][:40] + "... [TRUNCATED FOR UI]"
            return preview_dict
        return {k: _clean_for_preview(v) for k, v in data_val.items()}
    elif isinstance(data_val, list):
        return [_clean_for_preview(item) for item in data_val]
    return data_val

class RemoteCKKSVector:
    def __init__(self, encrypted, provider, context_id="default"):
        self.data = encrypted
        self.provider = provider
        self.context_id = context_id

    @classmethod
    def encrypt(cls, values, provider, context_id="default"):
        if isinstance(values, np.ndarray):
            values = values.tolist()
        if not isinstance(values, list):
            values = [values]

        encrypted = provider.encrypt(
            [float(v) for v in values],
            {
                "scheme": "CKKS",
                "context_id": context_id,
                "poly_modulus_degree": 16384,
                "coeff_mod_bit_sizes": [60, 40, 40, 40, 40, 60]
            }
        )
        return cls(encrypted, provider, context_id)

    @classmethod
    def from_ciphertext(cls, ciphertext_json, provider, context_id=None):
        # If context_id not provided, read it from the ciphertext dict itself.
        # This is the key fix: use whichever context was used during encryption.
        resolved_ctx_id = context_id
        if resolved_ctx_id is None:
            if isinstance(ciphertext_json, dict):
                resolved_ctx_id = ciphertext_json.get("context_id", "default")
            else:
                resolved_ctx_id = "default"
        return cls(ciphertext_json, provider, resolved_ctx_id)

    def add_plain(self, value):
        result = self.provider.compute(
            "sum",
            [self.data, float(value)],
            {"scheme": "CKKS", "context_id": self.context_id}
        )
        return RemoteCKKSVector(result, self.provider, self.context_id)

    def multiply_plain(self, value):
        result = self.provider.compute(
            "multiply",
            [self.data, float(value)],
            {"scheme": "CKKS", "context_id": self.context_id}
        )
        return RemoteCKKSVector(result, self.provider, self.context_id)

    def add(self, other):
        result = self.provider.compute(
            "sum",
            [self.data, other.data],
            {"scheme": "CKKS", "context_id": self.context_id}
        )
        return RemoteCKKSVector(result, self.provider, self.context_id)

    def multiply(self, other):
        result = self.provider.compute(
            "multiply",
            [self.data, other.data],
            {"scheme": "CKKS", "context_id": self.context_id}
        )
        return RemoteCKKSVector(result, self.provider, self.context_id)

    def dot_plain(self, vector):
        result = self.provider.compute(
            "dot",
            [self.data, [float(v) for v in vector]],
            {"scheme": "CKKS", "context_id": self.context_id}
        )
        return RemoteCKKSVector(result, self.provider, self.context_id)


def encrypted_poly_activation(x):
    # 0.125x² + 0.5x + 0.25
    try:
        x_sq = x.multiply(x)
        return (
            x_sq
            .add(x.multiply_plain(4.0))
            .add_plain(2.0)
            .multiply_plain(0.125)
        )
    except RuntimeError as exc:
        logger.warning(
            "[InferenceNode] Encrypted polynomial activation failed; "
            "falling back to linear activation for this ciphertext: %s",
            exc
        )
        return x.multiply_plain(0.5).add_plain(0.25)


def encrypted_dense(encrypted_inputs, weights, biases):
    outputs = []
    out_dim = weights.shape[0]
    in_dim = weights.shape[1]

    for i in range(out_dim):
        out = encrypted_inputs[0].multiply_plain(
            weights[i][0]
        )
        for j in range(1, in_dim):
            out = out.add(
                encrypted_inputs[j].multiply_plain(
                    weights[i][j]
                )
            )
        out = out.add_plain(
            biases[i]
        )
        outputs.append(out)

    return outputs


def encrypted_dense_from_vector(encrypted_vector, weights, biases):
    outputs = []

    for i in range(weights.shape[0]):
        out = encrypted_vector.dot_plain(weights[i])
        out = out.add_plain(biases[i])
        outputs.append(out)

    return outputs

@register_node
class InferenceNode(BaseNode):
    metadata = NodeMetadata(
        type="inference",
        label="Inference",
        category="ai",
        color="#8B5CF6",
        input_handles=["data"],
        output_handles=["data"],
        description="Runs time-series/sequential predictions on a dataset using a pre-trained FHE neural network."
    )

    _processed_triggers = set()

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        execute_trigger = config.get("_execute_trigger")
        is_manual_trigger = False
        if execute_trigger and execute_trigger not in self.__class__._processed_triggers:
            is_manual_trigger = True
            self.__class__._processed_triggers.add(execute_trigger)

        if not is_manual_trigger:
            logger.info("[InferenceNode] Automatic execution skipped (no fresh trigger).")
            return NodeResult(
                success=True,
                outputs={
                    "data": config.get("data", []),
                    "resolvedEntity": config.get("resolvedEntity", []),
                    "snapshotPath": config.get("snapshotPath") or config.get("inputSnapshotPath"),
                    "row_count": config.get("row_count", 0),
                    "columns": config.get("columns", []),
                    "inferenceMode": config.get("inferenceMode", "plaintext")
                },
                metadata={
                    "config_used": config,
                    "inference_mode": config.get("inferenceMode", "plaintext"),
                    "is_manual_trigger": False,
                    "skipped": True
                }
            )

        logger.info("[InferenceNode] ================== INFERENCE STARTED ==================")
        
        # 1. Fetch parameters
        model_s3_path = config.get("modelPath", "")
        sequence_length = int(config.get("sequenceLength", 2))
        feature_columns = config.get("features", [])
        group_by_col = config.get("groupBy", "")
        inference_mode = str(config.get("inferenceMode", "plaintext") or "plaintext").strip().lower()
        if inference_mode not in {"plaintext", "encrypted"}:
            inference_mode = "plaintext"

        if not model_s3_path:
            logger.error("[InferenceNode] No model selected.")
            return NodeResult(success=False, outputs={}, error="Please select a trained model checkpoint.")

        if not feature_columns:
            logger.error("[InferenceNode] No feature columns selected.")
            return NodeResult(success=False, outputs={}, error="Please select the feature columns matching the trained model.")

        # 2. Load dataset
        data_list = _merge_attribute_inputs(inputs.get("data"))
        
        # Dig snapshotPath out of inputs or config
        snapshot_path = None
        if isinstance(data_list, dict) and data_list.get("snapshotPath"):
            snapshot_path = data_list.get("snapshotPath")
        elif isinstance(inputs.get("data"), dict) and inputs["data"].get("snapshotPath"):
            snapshot_path = inputs["data"].get("snapshotPath")
        elif config.get("inputSnapshotPath"):
            snapshot_path = config.get("inputSnapshotPath")

        if snapshot_path:
            bucket = minio_service.SILVER_BUCKET
            s3_key = snapshot_path
            if s3_key.startswith(f"{bucket}/"):
                s3_key = s3_key[len(bucket) + 1:]
                
            logger.info(f"[InferenceNode] Detected snapshotPath: '{s3_key}'. Fetching JSONL data from MinIO...")
            try:
                data_bytes = minio_service.read_object(bucket, s3_key)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines():
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                data_list = snapshot_rows
                logger.info(f"[InferenceNode] Successfully loaded {len(data_list)} rows from snapshot.")
            except Exception as e:
                logger.error(f"[InferenceNode] Failed to load snapshot data from {s3_key}: {e}")

        if not data_list and config.get("previewInput"):
            data_list = config.get("previewInput")
            logger.info("[InferenceNode] Using previewInput as fallback data source.")

        if not data_list:
            logger.error("[InferenceNode] No input data connected.")
            return NodeResult(success=False, outputs={}, error="No snapshot data connected. Please link a dataset snapshot to the 'data' handle.")

        try:
            # Convert list of dicts to DataFrame
            if isinstance(data_list, list):
                df = pd.DataFrame(data_list)
            elif isinstance(data_list, dict):
                if "data" in data_list and isinstance(data_list["data"], list):
                    df = pd.DataFrame(data_list["data"])
                elif any(isinstance(v, dict) for v in data_list.values()):
                    # Treat dictionary containing encrypted nested dicts (or nested structures) as a single row
                    df = pd.DataFrame([data_list])
                else:
                    try:
                        df = pd.DataFrame(data_list)
                    except ValueError as e:
                        if "If using all scalar values" in str(e):
                            df = pd.DataFrame([data_list])
                        else:
                            raise
            else:
                df = pd.DataFrame(data_list)

            is_encrypted = False
            tenseal_provider = None
            
            for col in feature_columns:
                if col in df.columns:
                    # Check if any cell in the column has tenseal_encrypted type
                    if any(isinstance(x, dict) and x.get("__type__") == "tenseal_encrypted" for x in df[col]):
                        is_encrypted = True
                        break

            try:
                from Logic.security.registry import registry
                tenseal_provider = registry.get_provider("tenseal")
            except Exception as reg_err:
                if is_encrypted:
                    logger.error(f"[InferenceNode] Failed to load TenSEAL provider: {reg_err}")
                    return NodeResult(success=False, outputs={}, error=f"TenSEAL provider is not initialized: {reg_err}")
                logger.warning(f"[InferenceNode] TenSEAL provider unavailable. Plaintext inference fallback will be used: {reg_err}")

            if is_encrypted:
                logger.info("[InferenceNode] Encrypted feature values detected in input snapshot.")

            use_fhe_inference = (inference_mode == "encrypted") or is_encrypted
            if use_fhe_inference:
                logger.info("[InferenceNode] Execution mode: encrypted inference.")
                if not tenseal_provider:
                    logger.warning("[InferenceNode] Encrypted inference requested, but TenSEAL provider is unavailable. Falling back to plaintext inference.")
                    use_fhe_inference = False
            else:
                logger.info("[InferenceNode] Execution mode: plaintext inference.")

            # Identify single row direct sequence length 1
            is_single_row_direct = len(df) == 1 and sequence_length == 1
            is_pure_fhe = use_fhe_inference and tenseal_provider and is_single_row_direct

            if is_encrypted and not is_single_row_direct:
                logger.error("[InferenceNode] Explicitly encrypted feature values are only supported in single-row, sequenceLength=1 execution mode.")
                return NodeResult(
                    success=False,
                    outputs={},
                    error="Explicitly encrypted input data is only supported with sequenceLength=1 and single-row entity execution. "
                          f"Currently got {len(df)} row(s) and sequenceLength={sequence_length}."
                )

            logger.info("[InferenceNode] DEBUG: Checking missing columns...")
            # Check that feature columns exist in the DataFrame
            missing_cols = [col for col in feature_columns if col not in df.columns]
            if missing_cols:
                logger.error(f"[InferenceNode] Missing columns: {missing_cols}")
                return NodeResult(success=False, outputs={}, error=f"Missing feature columns in input data: {missing_cols}")

            logger.info("[InferenceNode] DEBUG: Preparing model_df copy...")
            model_df = df.copy()
            if not is_pure_fhe:
                for col in feature_columns:
                    logger.info(f"[InferenceNode] DEBUG: Converting column '{col}' to plain scalar...")
                    try:
                        model_df[col] = model_df[col].apply(lambda value: _to_plain_scalar(value, tenseal_provider))
                    except Exception as value_err:
                        logger.error(f"[InferenceNode] DEBUG: Failed converting column '{col}': {value_err}")
                        return NodeResult(
                            success=False,
                            outputs={},
                            error=f"Could not prepare feature column '{col}' for inference: {value_err}"
                        )

                logger.info("[InferenceNode] DEBUG: Dropna and astype float...")
                model_df = model_df.dropna(subset=feature_columns).copy()
                model_df[feature_columns] = model_df[feature_columns].astype(float)
            else:
                logger.info("[InferenceNode] DEBUG: Skipping plaintext decryption copy of features for pure zero-knowledge execution.")

            # Compute global mean and std from Iceberg if source_id is available
            global_means = {}
            global_stds = {}
            
            # Default baseline statistics from model_df if available
            for col in feature_columns:
                try:
                    if not is_pure_fhe:
                        vals = model_df[col].dropna().astype(float)
                        global_means[col] = float(vals.mean()) if not vals.empty else 0.0
                        global_stds[col] = float(vals.std()) if not vals.empty and vals.std() > 0 else 1.0
                    else:
                        global_means[col] = 0.0
                        global_stds[col] = 1.0
                except Exception:
                    global_means[col] = 0.0
                    global_stds[col] = 1.0

            source_id = None
            if len(df) > 0:
                entity = df.iloc[0].to_dict()
                source_id = entity.get("_source_id")

            if source_id:
                try:
                    from gateway.services import iceberg_service
                    logger.info(f"[InferenceNode] Fetching entire table statistics for '{source_id}' to get global StandardScaler parameters...")
                    arrow_table = iceberg_service.scan_latest(source_id)
                    full_df = arrow_table.to_pandas()
                    for col in feature_columns:
                        if col in full_df.columns:
                            vals = full_df[col].dropna().astype(float)
                            if not vals.empty:
                                global_means[col] = float(vals.mean())
                                global_stds[col] = float(vals.std()) if vals.std() > 0 else 1.0
                                logger.info(f"[InferenceNode] Global stats for '{col}': mean={global_means[col]:.4f}, std={global_stds[col]:.4f}")
                except Exception as e:
                    logger.warning(f"[InferenceNode] Failed to fetch table statistics from Iceberg: {e}. Using local stats fallback.")

            logger.info("[InferenceNode] DEBUG: Preparing model path for MinIO...")
            # 3. Load model checkpoint from MinIO
            bucket = minio_service.SILVER_BUCKET
            s3_key = model_s3_path
            if s3_key.startswith(f"{bucket}/"):
                s3_key = s3_key[len(bucket) + 1:]

            logger.info(f"[InferenceNode] Downloading model checkpoint from MinIO: {bucket}/{s3_key}...")
            logger.info("[InferenceNode] DEBUG: Calling minio_service.read_object...")
            try:
                model_bytes = minio_service.read_object(bucket, s3_key)
                logger.info("[InferenceNode] DEBUG: Successfully read model bytes.")
            except Exception as s3_err:
                logger.error(f"[InferenceNode] Failed to read model checkpoint from MinIO: {s3_err}")
                return NodeResult(success=False, outputs={}, error=f"Model checkpoint not found in bucket: {s3_err}")

            # Load state dict
            try:
                checkpoint = torch.load(io.BytesIO(model_bytes), map_location="cpu")
            except Exception as torch_err:
                logger.error(f"[InferenceNode] PyTorch failed to load state dict: {torch_err}")
                return NodeResult(success=False, outputs={}, error=f"Corrupt or invalid PyTorch checkpoint: {torch_err}")

            # Deduce input/hidden dimensions from PyTorch weights automatically!
            try:
                hidden_dim, input_dim = checkpoint["fc1.weight"].shape
                output_dim, hidden_dim_check = checkpoint["fc2.weight"].shape
                logger.info(f"[InferenceNode] Autodetected layer configuration: InputDim={input_dim}, HiddenDim={hidden_dim}, OutputDim={output_dim}")
            except Exception as struct_err:
                logger.error(f"[InferenceNode] Weights do not match expected sequential model schema: {struct_err}")
                return NodeResult(success=False, outputs={}, error="The selected checkpoint is not a compatible FHE sequential model.")

            selected_feature_count = len(feature_columns)
            if output_dim != selected_feature_count:
                inferred_training_sequence_length = input_dim // output_dim if output_dim and input_dim % output_dim == 0 else None
                logger.error(
                    "[InferenceNode] Output dimension mismatch: checkpoint predicts %s features, but %s features were selected.",
                    output_dim,
                    selected_feature_count
                )
                detail = (
                    f"Model checkpoint predicts {output_dim} feature(s), but you selected {selected_feature_count}. "
                    f"Please select the same feature columns and order used during training."
                )
                if inferred_training_sequence_length:
                    detail += f" This checkpoint also appears to have been trained with sequenceLength={inferred_training_sequence_length}."
                return NodeResult(success=False, outputs={}, error=detail)

            # Validate input dimensions match user feature count and sequence length selection
            expected_input_dim = sequence_length * selected_feature_count
            if expected_input_dim != input_dim:
                if selected_feature_count > 0 and input_dim % selected_feature_count == 0:
                    inferred_sequence_length = input_dim // selected_feature_count
                    logger.warning(
                        "[InferenceNode] Configured sequenceLength=%s produced InputDim=%s, "
                        "but checkpoint requires InputDim=%s. Using inferred sequenceLength=%s.",
                        sequence_length,
                        expected_input_dim,
                        input_dim,
                        inferred_sequence_length
                    )
                    sequence_length = inferred_sequence_length
                    expected_input_dim = sequence_length * selected_feature_count
                else:
                    logger.error(f"[InferenceNode] Dimension mismatch: expected {input_dim}, got {expected_input_dim}")
                    return NodeResult(
                        success=False,
                        outputs={},
                        error=f"Model expects InputDim={input_dim} (sequence length * features). Your selection results in {expected_input_dim}. Please adjust your selected features or sequence length."
                    )

            is_single_row_direct = len(model_df) == 1 and sequence_length == 1

            # If we have only 1 row (e.g. from ExtractEntities) but need a sequence,
            # try to fetch previous rows for this specific entity from MinIO Bronze bucket.
            if len(model_df) == 1 and sequence_length > 1:
                entity = df.iloc[0].to_dict()
                source_id = entity.get("_source_id")
                id_col = next((c for c in ["icao24", "id", "_hve_id"] if c in entity and entity[c]), None)
                
                if source_id and id_col:
                    logger.info(f"[InferenceNode] Fetching history for {id_col}={entity[id_col]} from Iceberg table {source_id}...")
                    try:
                        from gateway.services import iceberg_service
                        
                        # Scan the latest snapshot of the Iceberg table
                        arrow_table = iceberg_service.scan_latest(source_id)
                        full_df = arrow_table.to_pandas()
                        
                        id_value = entity[id_col]
                        filtered_df = full_df[full_df[id_col] == id_value]
                        
                        logger.info(f"[InferenceNode] Found {len(filtered_df)} matching history rows in Iceberg.")
                        
                        if len(filtered_df) > 1:
                            # Sort by time if possible
                            if "_ingest_ts" in filtered_df.columns:
                                filtered_df = filtered_df.sort_values(by="_ingest_ts")
                            elif "time_position" in filtered_df.columns:
                                filtered_df = filtered_df.sort_values(by="time_position")
                            
                            # We need sequence_length rows of history.
                            history_rows = filtered_df.tail(sequence_length)
                            
                            # Ensure feature columns are float
                            for col in feature_columns:
                                if col in history_rows.columns:
                                    history_rows[col] = history_rows[col].astype(float)
                                else:
                                    history_rows[col] = 0.0
                            
                            # Prepend to model_df
                            history_model_df = history_rows[feature_columns].copy()
                            model_df = pd.concat([history_model_df, model_df], ignore_index=True)
                            
                            # Prepend to df
                            df = pd.concat([history_rows, df], ignore_index=True)
                            
                            logger.info(f"[InferenceNode] Successfully prepended {len(history_rows)} historical rows from Iceberg.")
                    except Exception as e:
                        logger.warning(f"[InferenceNode] Failed to fetch history from Iceberg: {e}.")

            if len(model_df) < sequence_length + 1 and not is_single_row_direct:
                logger.error(f"[InferenceNode] Insufficient rows: {len(model_df)} (need at least {sequence_length + 1})")
                return NodeResult(
                    success=False,
                    outputs={},
                    error=f"Insufficient rows: {len(model_df)} (need at least {sequence_length + 1}). No history found in MinIO for this entity."
                )

            # Instantiate model
            model = FHEFlightNet(input_dim, hidden_dim, output_dim)
            model.load_state_dict(checkpoint)
            model.eval()

            # Detach model weights for direct Homomorphic dense execution
            W1 = model.fc1.weight.detach().numpy()
            b1 = model.fc1.bias.detach().numpy()
            W2 = model.fc2.weight.detach().numpy()
            b2 = model.fc2.bias.detach().numpy()

            # 4. Perform prediction
            # Create prediction columns filled with None
            pred_columns = [f"{col}_pred" for col in feature_columns]
            for pred_col in pred_columns:
                df[pred_col] = None

            if is_single_row_direct:
                logger.info("[InferenceNode] Performing direct single-row inference (sequenceLength=1).")
                if is_pure_fhe:
                    try:
                        logger.info("[InferenceNode] Performing zero-knowledge Homomorphic Feature Scaling and Inference...")
                        # 1. Scale homomorphically
                        scaled_inputs = []
                        for col in feature_columns:
                            enc_val = df.at[df.index[0], col]
                            if not _is_encrypted_value(enc_val):
                                # Encrypt on the fly if not encrypted (fallback)
                                enc_val = tenseal_provider.encrypt(float(enc_val), {"scheme": "CKKS", "context_id": "default"})
                            
                            enc_vector = RemoteCKKSVector.from_ciphertext(enc_val, tenseal_provider)
                            mean_val = global_means[col]
                            std_val = global_stds[col]
                            
                            # (enc_vector - mean) * (1 / std)
                            scaled_vector = enc_vector.add_plain(-mean_val).multiply_plain(1.0 / std_val)
                            scaled_inputs.append(scaled_vector)
                            
                        # 2. Run sequential neural network layers homomorphically
                        # fc1 (using encrypted_dense for list of separate encrypted scalars)
                        hidden = encrypted_dense(scaled_inputs, W1, b1)
                        # poly activation
                        activated = [encrypted_poly_activation(h) for h in hidden]
                        # fc2
                        outputs = encrypted_dense(activated, W2, b2)
                        
                        # 3. Inverse scale the encrypted output homomorphically: (output * std) + mean
                        for k, pred_col in enumerate(pred_columns):
                            col_name = feature_columns[k]
                            mean_val = global_means[col_name]
                            std_val = global_stds[col_name]
                            
                            # (outputs[k] * std) + mean
                            unscaled_out = outputs[k].multiply_plain(std_val).add_plain(mean_val)
                            df.at[df.index[0], pred_col] = unscaled_out.data
                            
                        logger.info("[InferenceNode] Zero-knowledge Homomorphic Inference complete!")
                    except Exception as fhe_err:
                        logger.error(f"[InferenceNode] Zero-knowledge Homomorphic Inference failed: {fhe_err}")
                        return NodeResult(success=False, outputs={}, error=f"Homomorphic inference failed: {fhe_err}")
                else:
                    # Plaintext single row direct inference using global scaler parameters!
                    seq = []
                    for col in feature_columns:
                        val = float(_to_plain_scalar(model_df[col].iloc[0], tenseal_provider))
                        scaled_val = (val - global_means[col]) / global_stds[col]
                        seq.append(scaled_val)
                        
                    seq_tensor = torch.tensor(seq, dtype=torch.float32).unsqueeze(0)
                    with torch.no_grad():
                        pred_scaled = model(seq_tensor).numpy().flatten()
                    
                    # Unscale:
                    for k, pred_col in enumerate(pred_columns):
                        col_name = feature_columns[k]
                        pred_unscaled = float(pred_scaled[k] * global_stds[col_name] + global_means[col_name])
                        df.at[df.index[0], pred_col] = pred_unscaled

            def predict_group(group_df):
                feature_group = model_df.loc[group_df.index.intersection(model_df.index)]
                if len(feature_group) < sequence_length + 1:
                    return group_df
                
                # Get indexes
                idx_list = feature_group.index.tolist()
                
                if use_fhe_inference and tenseal_provider:
                    _fhe_context_id = config.get("fheContextId", "inference_vector_v4")
                    logger.info(f"[InferenceNode] Performing scratch-style FHE inference on {len(feature_group)} items... (context_id='{_fhe_context_id}')")
                    
                    # Scale group features using global parameters
                    group_scaled = np.zeros((len(feature_group), len(feature_columns)))
                    for c_idx, col in enumerate(feature_columns):
                        group_scaled[:, c_idx] = (feature_group[col].astype(float).values - global_means[col]) / global_stds[col]
                    fhe_disabled_reason = None

                    for i in range(sequence_length, len(feature_group)):
                        logger.info(f"[InferenceNode] Processing FHE row {i - sequence_length + 1} of {len(feature_group) - sequence_length}...")
                            
                        seq = group_scaled[i - sequence_length : i].flatten()
                        target_idx = idx_list[i]
                        if not fhe_disabled_reason:
                            try:
                                logger.info(f"  [{target_idx}] FHE: Encrypting window sequence...")
                                encrypted_x = RemoteCKKSVector.encrypt(seq, tenseal_provider, _fhe_context_id)
                                logger.info(f"  [{target_idx}] FHE: Computing hidden layer...")
                                hidden = encrypted_dense_from_vector(encrypted_x, W1, b1)
                                logger.info(f"  [{target_idx}] FHE: Applying polynomial activation...")
                                activated = [encrypted_poly_activation(h) for h in hidden]
                                logger.info(f"  [{target_idx}] FHE: Computing output layer...")
                                outputs = encrypted_dense(activated, W2, b2)
                                
                                # Homomorphically unscale each output column and save
                                for k, pred_col in enumerate(pred_columns):
                                    col_name = feature_columns[k]
                                    mean_val = global_means[col_name]
                                    std_val = global_stds[col_name]
                                    
                                    unscaled_out = outputs[k].multiply_plain(std_val).add_plain(mean_val)
                                    group_df.at[target_idx, pred_col] = unscaled_out.data
                                continue
                            except Exception as fhe_err:
                                fhe_disabled_reason = str(fhe_err)
                                logger.warning(
                                    f"[InferenceNode] FHE prediction failed at row {target_idx}; "
                                    f"using plaintext fallback for remaining rows in this group: {fhe_disabled_reason}"
                                )

                        if fhe_disabled_reason:
                            seq_tensor = torch.tensor(seq, dtype=torch.float32).unsqueeze(0)
                            with torch.no_grad():
                                pred_scaled = model(seq_tensor).numpy().flatten()
                            
                            # Unscale manually
                            for k, pred_col in enumerate(pred_columns):
                                col_name = feature_columns[k]
                                pred_unscaled = float(pred_scaled[k] * global_stds[col_name] + global_means[col_name])
                                group_df.at[target_idx, pred_col] = pred_unscaled

                    return group_df
                else:
                    logger.info(f"[InferenceNode] Performing plaintext sliding window inference on {len(feature_group)} items...")
                    
                    # Scale group features using global scaling parameters
                    group_scaled = np.zeros((len(feature_group), len(feature_columns)))
                    for c_idx, col in enumerate(feature_columns):
                        group_scaled[:, c_idx] = (feature_group[col].astype(float).values - global_means[col]) / global_stds[col]
                    
                    for i in range(sequence_length, len(feature_group)):
                        if (i - sequence_length) % 50 == 0:
                            logger.info(f"[InferenceNode] Processing plaintext row {i - sequence_length + 1} of {len(feature_group) - sequence_length}...")
                            
                        seq = group_scaled[i - sequence_length : i].flatten()
                        seq_tensor = torch.tensor(seq, dtype=torch.float32).unsqueeze(0)
                        
                        with torch.no_grad():
                            pred_scaled = model(seq_tensor).numpy().flatten()
                        
                        # Inverse scale manually
                        target_idx = idx_list[i]
                        for k, pred_col in enumerate(pred_columns):
                            col_name = feature_columns[k]
                            pred_unscaled = float(pred_scaled[k] * global_stds[col_name] + global_means[col_name])
                            group_df.at[target_idx, pred_col] = pred_unscaled
                
                return group_df

            # Grouping time-series vs Single continuous time-series
            if not is_single_row_direct:
                if group_by_col and group_by_col in df.columns:
                    logger.info(f"[InferenceNode] Performing grouped sliding window inference on '{group_by_col}'...")
                    df = df.groupby(group_by_col, group_keys=False).apply(predict_group)
                else:
                    logger.info("[InferenceNode] Performing continuous time-series sliding window inference...")
                    df = predict_group(df)

            # Replace NaNs with None for clean JSON serialization
            df = df.replace({np.nan: None})
            output_rows = df.to_dict(orient="records")

            # Save the full prediction dataset back to MinIO as a new manual snapshot!
            out_path = snapshot_path
            if snapshot_path and len(output_rows) > 0:
                try:
                    table_name = "inference_data"
                    parts = snapshot_path.split("/")
                    if len(parts) >= 2:
                        table_name = parts[1]
                    
                    # Generate a unique hash for the inference run
                    import hashlib
                    run_sig = hashlib.md5(f"{snapshot_path}|{model_s3_path}|{sequence_length}".encode("utf-8")).hexdigest()
                    
                    logger.info(f"[InferenceNode] Saving complete prediction dataset to MinIO as temporary snapshot...")
                    out_path = minio_service.write_custom_snapshot(table_name, f"{table_name}_predicted", output_rows)
                    logger.info(f"[InferenceNode] Saved snapshot to: {out_path}")
                except Exception as save_err:
                    logger.error(f"[InferenceNode] Failed to save prediction snapshot to MinIO: {save_err}")

            logger.info("[InferenceNode] ================== INFERENCE COMPLETED ==================")
            
            # Limit to 10 rows for canvas UI preview to prevent freezing, but DO NOT truncate the base64 data
            # otherwise downstream nodes like SplitNode cannot decrypt it!
            pred_cols = [f"{col}_pred" for col in feature_columns]
            rows_with_pred = [row for row in output_rows if any(row.get(col) is not None for col in pred_cols)]
            
            if rows_with_pred:
                preview_rows = rows_with_pred[:10]
                logger.info(f"[InferenceNode] Preview shows {len(preview_rows)} rows with predictions.")
            else:
                preview_rows = output_rows[:10]
                logger.info("[InferenceNode] Preview shows first 10 rows (no predictions found in dataset).")

            return NodeResult(
                success=True,
                outputs={
                    "data": preview_rows,
                    "resolvedEntity": preview_rows,
                    "snapshotPath": out_path,
                    "row_count": len(output_rows),
                    "columns": list(output_rows[0].keys()) if output_rows else (config.get("columns") or []),
                    "inferenceMode": inference_mode
                },
                metadata={
                    "config_used": config,
                    "snapshot_path": out_path,
                    "inference_mode": inference_mode
                }
            )

        except Exception as e:
            logger.error(f"[InferenceNode] Inference execution failed: {e}", exc_info=True)
            return NodeResult(success=False, outputs={}, error=str(e))

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
