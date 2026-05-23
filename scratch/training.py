import json
import time
import requests
import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    mean_squared_error,
    mean_absolute_error,
    r2_score
)

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader


# ============================================================
# CONFIG
# ============================================================

CSV_FILE = "D:/Projects/HVE-OS/scratch/original.csv"

TENSEAL_ENGINE_URL = "http://localhost:8001"
DEFAULT_CONTEXT_ID = "flight_ctx"

SEQUENCE_LENGTH = 2

FEATURE_COLUMNS = [
    "longitude",
    "latitude",
    "baro_altitude",
    "velocity",
    "true_track",
    "vertical_rate"
]

INPUT_DIM = SEQUENCE_LENGTH * len(FEATURE_COLUMNS)

HIDDEN_DIM = 8
OUTPUT_DIM = len(FEATURE_COLUMNS)

BATCH_SIZE = 32
EPOCHS = 100
LEARNING_RATE = 1e-3

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


# ============================================================
# REMOTE CKKS VECTOR
# ============================================================

def api_post(endpoint, payload):

    r = requests.post(
        f"{TENSEAL_ENGINE_URL}{endpoint}",
        json=payload
    )

    r.raise_for_status()

    return r.json()


class RemoteCKKSVector:

    def __init__(self, encrypted):

        self.data = encrypted

    @classmethod
    def encrypt(cls, values):

        print(f"\n[FHE] Encrypting input values: {values}")

        result = api_post(
            "/encrypt",
            {
                "data": [float(v) for v in values],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID,
                    "poly_modulus_degree": 8192,
                    "coeff_mod_bit_sizes": [60,40,40,60]
                }
            }
        )

        ciphertext = result.get("data", "")
        print(f"[FHE] Ciphertext Payload (Base64, first 80 chars): {ciphertext[:80]}...")
        print(f"[FHE] Total Ciphertext Bytes: {len(ciphertext)} characters\n")

        return cls(result)

    def decrypt(self):

        result = api_post(
            "/decrypt",
            {
                "data": self.data,
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return np.array(result["result"])

    def add_plain(self, value):

        result = api_post(
            "/compute",
            {
                "operation": "sum",
                "data_list": [
                    self.data,
                    float(value)
                ],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return RemoteCKKSVector(result)

    def multiply_plain(self, value):

        result = api_post(
            "/compute",
            {
                "operation": "multiply",
                "data_list": [
                    self.data,
                    float(value)
                ],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return RemoteCKKSVector(result)

    def dot_plain(self, vector):

        result = api_post(
            "/compute",
            {
                "operation": "dot",
                "data_list": [
                    self.data,
                    [float(x) for x in vector]
                ],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return RemoteCKKSVector(result)

    def add(self, other):

        result = api_post(
            "/compute",
            {
                "operation": "sum",
                "data_list": [
                    self.data,
                    other.data
                ],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return RemoteCKKSVector(result)

    def multiply(self, other):

        result = api_post(
            "/compute",
            {
                "operation": "multiply",
                "data_list": [
                    self.data,
                    other.data
                ],
                "params": {
                    "scheme": "CKKS",
                    "context_id": DEFAULT_CONTEXT_ID
                }
            }
        )

        return RemoteCKKSVector(result)


# ============================================================
# DATASET
# ============================================================

class FlightDataset(Dataset):

    def __init__(self, x, y):

        self.x = torch.tensor(
            x,
            dtype=torch.float32
        )

        self.y = torch.tensor(
            y,
            dtype=torch.float32
        )

    def __len__(self):
        return len(self.x)

    def __getitem__(self, idx):

        return self.x[idx], self.y[idx]


# ============================================================
# LOAD DATA
# ============================================================

def load_grouped_flights(csv_file):

    df = pd.read_csv(csv_file)

    df = df.dropna(
        subset=FEATURE_COLUMNS + ["callsign"]
    )

    scaler = StandardScaler()

    df[FEATURE_COLUMNS] = scaler.fit_transform(
        df[FEATURE_COLUMNS]
    )

    grouped = df.groupby("callsign")

    sequences = []
    targets = []

    for _, group in grouped:

        group = group.reset_index(drop=True)

        values = group[
            FEATURE_COLUMNS
        ].values.astype(np.float32)

        if len(values) < SEQUENCE_LENGTH + 1:
            continue

        for i in range(
            len(values) - SEQUENCE_LENGTH
        ):

            seq = values[
                i:i+SEQUENCE_LENGTH
            ].flatten()

            target = values[
                i+SEQUENCE_LENGTH
            ]

            sequences.append(seq)
            targets.append(target)

    return (
        np.array(sequences),
        np.array(targets),
        scaler
    )


# ============================================================
# FHE FRIENDLY NETWORK
# ============================================================

class FHEFlightNet(nn.Module):

    def __init__(self):

        super().__init__()

        self.fc1 = nn.Linear(
            INPUT_DIM,
            HIDDEN_DIM
        )

        self.fc2 = nn.Linear(
            HIDDEN_DIM,
            OUTPUT_DIM
        )

    def poly_act(self, x):

        return (
            0.125 * x * x
            + 0.5 * x
            + 0.25
        )

    def forward(self, x):

        x = self.fc1(x)

        x = self.poly_act(x)

        x = self.fc2(x)

        return x


# ============================================================
# TRAIN
# ============================================================

def train_model(model, loader):

    criterion = nn.MSELoss()

    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=LEARNING_RATE
    )

    losses = []

    model.train()

    for epoch in range(EPOCHS):

        total_loss = 0

        for x, y in loader:

            x = x.to(DEVICE)
            y = y.to(DEVICE)

            optimizer.zero_grad()

            pred = model(x)

            loss = criterion(pred, y)

            loss.backward()

            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(loader)

        losses.append(avg_loss)

        print(
            f"Epoch {epoch+1}/{EPOCHS} "
            f"Loss={avg_loss:.6f}"
        )

    return losses


# ============================================================
# EVALUATION
# ============================================================

def evaluate_model(model, x, y):

    model.eval()

    with torch.no_grad():

        preds = model(
            torch.tensor(
                x,
                dtype=torch.float32
            ).to(DEVICE)
        )

    preds = preds.cpu().numpy()

    mse = mean_squared_error(y, preds)
    rmse = np.sqrt(mse)
    mae = mean_absolute_error(y, preds)
    r2 = r2_score(y, preds)

    return {
        "mse": mse,
        "rmse": rmse,
        "mae": mae,
        "r2": r2
    }


# ============================================================
# REAL FHE INFERENCE
# ============================================================

def fhe_predict(model, sample):

    encrypted_x = RemoteCKKSVector.encrypt(
        sample.tolist()
    )

    W1 = model.fc1.weight.detach().cpu().numpy()
    b1 = model.fc1.bias.detach().cpu().numpy()

    W2 = model.fc2.weight.detach().cpu().numpy()
    b2 = model.fc2.bias.detach().cpu().numpy()

    hidden = []

    # --------------------------------------------------------
    # Layer 1
    # --------------------------------------------------------

    for i in range(HIDDEN_DIM):

        h = encrypted_x.dot_plain(W1[i])

        h = h.add_plain(b1[i])

        h_sq = h.multiply(h)

        h = (
            h_sq.multiply_plain(0.125)
            .add(
                h.multiply_plain(0.5)
            )
            .add_plain(0.25)
        )

        hidden.append(h)

    # --------------------------------------------------------
    # Output Layer
    # --------------------------------------------------------

    outputs = []

    for j in range(OUTPUT_DIM):

        out = hidden[0].multiply_plain(
            W2[j][0]
        )

        for k in range(1, HIDDEN_DIM):

            out = out.add(
                hidden[k].multiply_plain(
                    W2[j][k]
                )
            )

        out = out.add_plain(b2[j])

        outputs.append(out)

    # --------------------------------------------------------
    # CLIENT SIDE DECRYPTION ONLY
    # --------------------------------------------------------

    decrypted = []

    for out in outputs:

        val = out.decrypt()

        if np.isscalar(val):

            decrypted.append(float(val))

        else:

            decrypted.append(float(np.array(val).flatten()[0]))

    return np.array(decrypted)


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("REAL HOMOMORPHIC FLIGHT PREDICTION")
    print("=" * 70)

    x, y, scaler = load_grouped_flights(
        CSV_FILE
    )

    print(f"\nSequences: {len(x)}")

    dataset = FlightDataset(x, y)

    loader = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        shuffle=True
    )

    model = FHEFlightNet().to(DEVICE)

    print("\nTraining...\n")

    start = time.time()

    train_model(model, loader)

    train_time = time.time() - start

    metrics = evaluate_model(
        model,
        x,
        y
    )

    print("\nTRAINING METRICS")

    print(f"MSE  : {metrics['mse']:.6f}")
    print(f"RMSE : {metrics['rmse']:.6f}")
    print(f"MAE  : {metrics['mae']:.6f}")
    print(f"R2   : {metrics['r2']:.6f}")

    sample = x[0]

    target = y[0]

    print("\nRunning REAL FHE inference...\n")

    start = time.time()

    pred = fhe_predict(
        model,
        sample
    )

    inf_time = time.time() - start

    print("Prediction:")
    print(pred)

    print("\nGround Truth:")
    print(target)

    mse = np.mean(
        (pred - target) ** 2
    )

    print(f"\nEncrypted Inference MSE: {mse:.6f}")

    print(
        f"Inference Time: "
        f"{inf_time:.2f}s"
    )

    with open(
        "real_fhe_results.json",
        "w"
    ) as f:

        json.dump(
            {
                "prediction": pred.tolist(),
                "target": target.tolist(),
                "mse": float(mse)
            },
            f,
            indent=2
        )

    print("\nSaved -> real_fhe_results.json")


if __name__ == "__main__":
    main()