import logging
import os
import io
import json
import time
from typing import Dict, Any, Optional

import torch
import torch.nn as nn
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from torch.utils.data import Dataset, DataLoader

from Logic.nodes.base import BaseNode, NodeMetadata, NodeResult
from Logic.nodes.registry import register_node
from gateway.services import minio_service

logger = logging.getLogger(__name__)

class FlightDataset(Dataset):
    def __init__(self, x, y):
        self.x = torch.tensor(x, dtype=torch.float32)
        self.y = torch.tensor(y, dtype=torch.float32)

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):
        return self.x[idx], self.y[idx]

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

@register_node
class FheSequentialModelNode(BaseNode):
    metadata = NodeMetadata(
        type="fheSequentialModelNode",
        label="FHE Sequential Model",
        category="ai",
        color="#8B5CF6",
        input_handles=["data"],
        output_handles=["metrics", "model_info"],
        description="Trains a CKKS-Vector compatible homomorphic sequential neural network for general-purpose predictions."
    )

    _processed_triggers = set()

    def execute(self, inputs: Dict[str, Any], config: Dict[str, Any]) -> NodeResult:
        execute_trigger = config.get("_execute_trigger")
        is_manual_trigger = False
        if execute_trigger and execute_trigger not in self.__class__._processed_triggers:
            is_manual_trigger = True
            self.__class__._processed_triggers.add(execute_trigger)

        if not is_manual_trigger:
            logger.info("[FheSequentialModelNode] Automatic execution skipped (no fresh trigger). Passing cached/idle state.")
            last_result = config.get("last_training_result")
            if not last_result and isinstance(config.get("metadata"), dict):
                last_result = config.get("metadata", {}).get("last_training_result")
            
            last_result = last_result or {}
            return NodeResult(
                success=True,
                outputs={
                    "metrics": last_result.get("metrics", {}),
                    "model_info": last_result.get("model_info", {})
                }
            )

        logger.info("[FheSequentialModelNode] ================== TRAINING STARTED ==================")
        
        sequence_length = int(config.get("sequenceLength", 2))
        hidden_dim = int(config.get("hiddenDim", 8))
        epochs = int(config.get("epochs", 100))
        batch_size = int(config.get("batchSize", 32))
        lr = float(config.get("learningRate", 0.001))
        model_path = config.get("modelSavePath", "real_fhe_flight_model.pt")

        # Dynamic mapping settings
        group_by_col = config.get("groupBy", "")
        feature_columns = config.get("features", [])

        if not feature_columns:
            logger.error("[FheSequentialModelNode] No feature columns selected.")
            return NodeResult(success=False, outputs={}, error="Please select at least one feature column to train the model on.")

        # Dynamically fetch snapshot data from data input handle or fallback to previewInput
        data_list = inputs.get("data")
        if not data_list and config.get("previewInput"):
            data_list = config.get("previewInput")
            logger.info("[FheSequentialModelNode] No active data connection. Using previewInput as fallback data source.")

        if not data_list and config.get("inputSnapshotPath"):
            snapshot_path = config.get("inputSnapshotPath")
            if snapshot_path.startswith(f"{minio_service.SILVER_BUCKET}/"):
                snapshot_path = snapshot_path[len(minio_service.SILVER_BUCKET) + 1:]
            
            logger.info(f"[FheSequentialModelNode] Loading from inputSnapshotPath: {snapshot_path}...")
            try:
                data_bytes = minio_service.read_object(minio_service.SILVER_BUCKET, snapshot_path)
                content = data_bytes.decode("utf-8")
                snapshot_rows = []
                for line in content.splitlines():
                    if line.strip():
                        snapshot_rows.append(json.loads(line))
                data_list = snapshot_rows
            except Exception as e:
                logger.error(f"[FheSequentialModelNode] Failed to load inputSnapshotPath: {e}")

        if not data_list:
            logger.error("[FheSequentialModelNode] No input data connected to the 'data' handle.")
            return NodeResult(success=False, outputs={}, error="No snapshot data connected. Please link a database query or snapshot node to this node's 'data' handle.")

        try:
            # Convert list of dicts to DataFrame
            if isinstance(data_list, list):
                df = pd.DataFrame(data_list)
            elif isinstance(data_list, dict) and "data" in data_list:
                df = pd.DataFrame(data_list["data"])
            else:
                df = pd.DataFrame(data_list)

            # Check that feature columns exist
            missing_cols = [col for col in feature_columns if col not in df.columns]
            if missing_cols:
                logger.error(f"[FheSequentialModelNode] Missing columns in input data: {missing_cols}")
                return NodeResult(success=False, outputs={}, error=f"Missing feature columns in snapshot data: {missing_cols}")

            # Standardize numeric columns
            df = df.dropna(subset=feature_columns)
            scaler = StandardScaler()
            df[feature_columns] = scaler.fit_transform(df[feature_columns])
            
            sequences = []
            targets = []

            # Grouping vs Single Continuous Sequence
            if group_by_col and group_by_col in df.columns:
                logger.info(f"[FheSequentialModelNode] Grouping dataset by column '{group_by_col}'...")
                grouped = df.groupby(group_by_col)
                for _, group in grouped:
                    group = group.reset_index(drop=True)
                    values = group[feature_columns].values.astype(np.float32)
                    if len(values) < sequence_length + 1:
                        continue
                    for i in range(len(values) - sequence_length):
                        seq = values[i : i + sequence_length].flatten()
                        target = values[i + sequence_length]
                        sequences.append(seq)
                        targets.append(target)
            else:
                logger.info("[FheSequentialModelNode] GroupBy not configured or missing. Treating as single continuous time-series...")
                values = df[feature_columns].values.astype(np.float32)
                for i in range(len(values) - sequence_length):
                    seq = values[i : i + sequence_length].flatten()
                    target = values[i + sequence_length]
                    sequences.append(seq)
                    targets.append(target)
            
            if not sequences:
                return NodeResult(
                    success=False, 
                    outputs={}, 
                    error=f"Not enough data points to build sequences. Minimum required rows: {sequence_length + 1}. Current: {len(df)}"
                )

            x = np.array(sequences)
            y = np.array(targets)
            
            logger.info(f"[FheSequentialModelNode] Loaded {len(x)} sequences from snapshot data.")
            
            # 2. Build Dataset and DataLoader
            dataset = FlightDataset(x, y)
            loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
            
            input_dim = sequence_length * len(feature_columns)
            output_dim = len(feature_columns)
            
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = FHEFlightNet(input_dim, hidden_dim, output_dim).to(device)
            
            # 3. Train
            criterion = nn.MSELoss()
            optimizer = torch.optim.Adam(model.parameters(), lr=lr)
            
            start_time = time.time()
            model.train()
            epoch_losses = []
            
            # Get unique ReactFlow node ID and display name keys
            node_id = config.get("_node_id")
            source_id = config.get("source_id") or config.get("tableName") or config.get("id")
            cancel_event = config.get("_cancel_event")

            for epoch in range(epochs):
                # Check for cancellation at the start of the epoch
                if cancel_event and cancel_event.is_set():
                    logger.info("[FheSequentialModelNode] 🛑 Training cancelled by user at epoch start.")
                    self.__class__._processed_triggers.clear()
                    return NodeResult(success=False, outputs={}, error="Training cancelled by user.")

                total_loss = 0
                for bx, by in loader:
                    # Check for cancellation mid-batch
                    if cancel_event and cancel_event.is_set():
                        logger.info("[FheSequentialModelNode] 🛑 Training cancelled by user mid-batch.")
                        self.__class__._processed_triggers.clear()
                        return NodeResult(success=False, outputs={}, error="Training cancelled by user.")

                    bx = bx.to(device)
                    by = by.to(device)
                    optimizer.zero_grad()
                    pred = model(bx)
                    loss = criterion(pred, by)
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item()
                
                mean_epoch_loss = float(total_loss / len(loader))
                epoch_losses.append(mean_epoch_loss)
                
                # Periodically log epochs
                if (epoch + 1) % 10 == 0 or epoch == 0 or epoch == epochs - 1:
                    logger.info(f"[FheSequentialModelNode] Epoch {epoch+1}/{epochs} Loss={mean_epoch_loss:.6f}")
                
                # Real-time WebSocket streaming
                if node_id:
                    try:
                        from gateway.routers.events import _engine_loop, broadcast
                        import asyncio
                        
                        prog_metrics = {
                            "epochs": epochs,
                            "current_epoch": epoch + 1,
                            "epoch_loss": mean_epoch_loss,
                            "epoch_losses": list(epoch_losses)
                        }
                        
                        message = {
                            'type': 'node_output',
                            'nodeId': node_id,
                            'sourceId': source_id,
                            'outputs': {
                                'metrics': prog_metrics
                            },
                            'success': True,
                            'metadata': {
                                'config_used': config,
                                'is_manual_trigger': is_manual_trigger,
                                'last_training_result': {
                                    'metrics': prog_metrics
                                }
                            }
                        }
                        
                        if _engine_loop and _engine_loop.is_running():
                            asyncio.run_coroutine_threadsafe(broadcast(message), _engine_loop)
                    except Exception as ws_err:
                        logger.warning(f"[FheSequentialModelNode] Real-time progress broadcast failed: {ws_err}")
                    
            train_duration = time.time() - start_time
            
            # 4. Evaluate
            model.eval()
            with torch.no_grad():
                preds = model(torch.tensor(x, dtype=torch.float32).to(device))
            preds = preds.cpu().numpy()
            
            mse = float(mean_squared_error(y, preds))
            rmse = float(np.sqrt(mse))
            mae = float(mean_absolute_error(y, preds))
            r2 = float(r2_score(y, preds))
            
            # 5. Save model checkpoint locally
            torch.save(model.state_dict(), model_path)
            logger.info(f"[FheSequentialModelNode] Model checkpoint saved locally to {model_path}")
            
            # 6. Upload model checkpoint to MinIO Silver Bucket
            minio_object_path = f"models/{model_path}"
            logger.info(f"[FheSequentialModelNode] Uploading checkpoint to MinIO: {minio_service.SILVER_BUCKET}/{minio_object_path}...")
            try:
                with open(model_path, "rb") as f:
                    model_bytes = f.read()
                
                minio_service.minio_client.put_object(
                    minio_service.SILVER_BUCKET,
                    minio_object_path,
                    io.BytesIO(model_bytes),
                    length=len(model_bytes),
                    content_type="application/octet-stream"
                )
                logger.info(f"[FheSequentialModelNode] Upload successful.")
            except Exception as s3_err:
                logger.error(f"[FheSequentialModelNode] MinIO upload failed: {s3_err}")
            
            metrics = {
                "mse": mse,
                "rmse": rmse,
                "mae": mae,
                "r2": r2,
                "training_time_s": train_duration,
                "epochs": epochs,
                "epoch_losses": epoch_losses
            }
            
            model_info = {
                "model_path": model_path,
                "minio_path": f"{minio_service.SILVER_BUCKET}/{minio_object_path}",
                "input_dim": input_dim,
                "hidden_dim": hidden_dim,
                "output_dim": output_dim,
                "feature_columns": feature_columns,
                "groupBy": group_by_col
            }
            
            logger.info("[FheSequentialModelNode] ================== TRAINING COMPLETED ==================")
            return NodeResult(
                success=True,
                outputs={
                    "metrics": metrics,
                    "model_info": model_info
                },
                metadata={
                    "config_used": config,
                    "is_manual_trigger": is_manual_trigger,
                    "last_training_result": {
                        "metrics": metrics,
                        "model_info": model_info
                    }
                }
            )
            
        except Exception as e:
            logger.error(f"[FheSequentialModelNode] Error executing training: {e}", exc_info=True)
            return NodeResult(success=False, outputs={}, error=str(e))

    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        return True, None
