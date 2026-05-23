import json
import requests
import numpy as np
import torch
import torch.nn as nn


# ============================================================
# CONFIG
# ============================================================

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

MODEL_PATH = "real_fhe_flight_model.pt"


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
    def from_ciphertext(cls, ciphertext_json):

        return cls(ciphertext_json)

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
# MODEL
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


# ============================================================
# LOAD MODEL
# ============================================================

def load_model():

    model = FHEFlightNet()

    model.load_state_dict(
        torch.load(
            MODEL_PATH,
            map_location="cpu"
        )
    )

    model.eval()

    return model


# ============================================================
# POLY ACTIVATION
# ============================================================

def encrypted_poly_activation(x):

    # 0.125x² + 0.5x + 0.25

    x_sq = x.multiply(x)

    return (
        x_sq.multiply_plain(0.125)
        .add(
            x.multiply_plain(0.5)
        )
        .add_plain(0.25)
    )


# ============================================================
# ENCRYPTED DENSE LAYER
# ============================================================

def encrypted_dense(
    encrypted_inputs,
    weights,
    biases
):

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


# ============================================================
# REAL ENCRYPTED INFERENCE
# ============================================================

def encrypted_inference(
    model,
    encrypted_feature_sequence
):

    W1 = model.fc1.weight.detach().numpy()
    b1 = model.fc1.bias.detach().numpy()

    W2 = model.fc2.weight.detach().numpy()
    b2 = model.fc2.bias.detach().numpy()

    # --------------------------------------------------------
    # INPUT
    # --------------------------------------------------------

    encrypted_inputs = []

    for item in encrypted_feature_sequence:

        encrypted_inputs.append(
            RemoteCKKSVector.from_ciphertext(item)
        )

    # --------------------------------------------------------
    # FC1
    # --------------------------------------------------------

    hidden = encrypted_dense(
        encrypted_inputs,
        W1,
        b1
    )

    # --------------------------------------------------------
    # POLY ACTIVATION
    # --------------------------------------------------------

    activated = []

    for h in hidden:

        activated.append(
            encrypted_poly_activation(h)
        )

    # --------------------------------------------------------
    # FC2
    # --------------------------------------------------------

    outputs = encrypted_dense(
        activated,
        W2,
        b2
    )

    # --------------------------------------------------------
    # RETURN ENCRYPTED OUTPUTS
    # --------------------------------------------------------

    encrypted_result = []

    for out in outputs:

        encrypted_result.append(
            out.data
        )

    return encrypted_result


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("REAL HOMOMORPHIC ENCRYPTED FLIGHT INFERENCE")
    print("=" * 70)

    model = load_model()

    print("\nLoaded model.")

    # ========================================================
    # YOUR ENCRYPTED INPUTS
    # ========================================================

    encrypted_sample = [

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_1"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_2"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_3"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_4"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_5"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_6"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_7"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_8"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_9"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_10"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_11"
        },

        {
            "__type__": "tenseal_encrypted",
            "scheme": "CKKS",
            "data": "PASTE_CIPHERTEXT_12"
        }
    ]

    print("\nRunning encrypted inference...\n")

    encrypted_outputs = encrypted_inference(
        model,
        encrypted_sample
    )

    print("Encrypted Prediction Output:\n")

    print(
        json.dumps(
            encrypted_outputs,
            indent=2
        )
    )

    with open(
        "encrypted_prediction.json",
        "w"
    ) as f:

        json.dump(
            encrypted_outputs,
            f,
            indent=2
        )

    print("\nSaved -> encrypted_prediction.json")


# ============================================================
# ENTRY
# ============================================================

if __name__ == "__main__":
    main()