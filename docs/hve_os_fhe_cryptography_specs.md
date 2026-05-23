# HVE-OS Fully Homomorphic Encryption (FHE) Specifications
## Comprehensive Cryptographic Architecture, Mathematical Formulations, & Key Protocols

---

## 1. Introduction & Security Foundations

The High-Value Edge Operations System (HVE-OS) implements a zero-trust, post-quantum secure data processing pipeline. At its core is **Fully Homomorphic Encryption (FHE)**, which allows operations to be performed directly on encrypted data without first decrypting it. 

### 1.1 The Ring Learning With Errors (RLWE) Hardness Assumption
The mathematical security of FHE in HVE-OS relies on the **Ring Learning With Errors (RLWE)** problem, a lattice-based mathematical problem that is widely believed to be secure against both classical and quantum computing attacks (post-quantum cryptography).

Let $\mathcal{R} = \mathbb{Z}[x] / (x^N + 1)$ be a cyclotomic polynomial ring where $N$ is a power of 2 (the polynomial modulus degree).
Let $\mathcal{R}_q = \mathcal{R} / q\mathcal{R} = \mathbb{Z}_q[x] / (x^N + 1)$ be the ring with coefficients reduced modulo a large integer $q$ (the ciphertext modulus).

The RLWE problem states that for a secret polynomial $s \in \mathcal{R}_q$ drawn from a secret distribution, and samples $(a_i, b_i) \in \mathcal{R}_q \times \mathcal{R}_q$ where:
$$b_i = a_i \cdot s + e_i \pmod q$$
with $a_i \in \mathcal{R}_q$ chosen uniformly at random, and $e_i \in \mathcal{R}$ representing small error polynomials sampled from a discrete Gaussian distribution, the samples $(a_i, b_i)$ are computationally indistinguishable from uniform random samples in $\mathcal{R}_q \times \mathcal{R}_q$.

A ciphertext in RLWE-based homomorphic schemes is represented as a tuple of polynomials:
$$\mathsf{ct} = (c_0, c_1) \in \mathcal{R}_q^2$$
To decrypt a ciphertext using the secret key $s$, the client computes:
$$m + e = c_0 + c_1 \cdot s \pmod q$$
By rounding away the small error term $e$, the original plaintext message $m$ is recovered.

---

## 2. Supported FHE Schemes: CKKS vs. BFV

HVE-OS integrates two primary homomorphic schemes to handle different data profiles:

| Feature | BFV Scheme | CKKS Scheme |
| :--- | :--- | :--- |
| **Arithmetic Type** | Exact Integer Arithmetic | Approximate Floating-Point Arithmetic |
| **Mathematical Ring** | $\mathbb{Z}_t[x]/(x^N+1)$ | $\mathbb{C}^N$ encoded into $\mathbb{R}[x]/(x^N+1)$ |
| **Use Case in HVE-OS** | Transaction logs, count indices, IDs | Sensor logs, coordinates, NN features |
| **Key Limitation** | Fast noise growth on multiplications | Noise is treated as part of precision loss |

```
                       ┌────────────────────────────────────────┐
                       │           Telemetry Ingestion          │
                       └───────────────────┬────────────────────┘
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    ▼ [Is Numeric / Float?]                       ▼ [Is Counter / Integer?]
        ┌───────────────────────┐                     ┌───────────────────────┐
        │      CKKS Scheme      │                     │      BFV Scheme       │
        │ Approximate Real Math │                     │  Exact Integer Math   │
        └───────────┬───────────┘                     └───────────┬───────────┘
                    │                                             │
                    ▼                                             ▼
        [ Encrypted Float Vector ]                    [ Encrypted Int Vector ]
```

### 2.1 The CKKS Scheme (Approximate Real Arithmetic)
CKKS is crucial for handling HVE-OS edge sensor streams (such as airspeed, temperature, or spatial GPS coordinates). In classical cryptography, real numbers cannot be easily represented because modular arithmetic is defined over discrete finite rings.

CKKS solves this by treating the small error added during homomorphic operations not as a cryptographic nuisance, but as the natural **least significant bits of precision loss** in floating-point representations.

#### The CKKS Encoding/Decoding Pipeline:
1.  **Canonical Embedding**: A vector of complex numbers $z \in \mathbb{C}^{N/2}$ is mapped to a polynomial $p(x) \in \mathcal{R}$ using the canonical embedding coordinate map.
2.  **Scaling**: To preserve fractional bits during polynomial rounding, the vector is multiplied by a scaling factor $\Delta$ (configured in HVE-OS to $\Delta = 2^{40}$):
    $$p(x) = \text{round}(\Delta \cdot \pi^{-1}(z))$$
3.  **Encryption**: The polynomial $p(x)$ is encrypted using the RLWE public key parameters.

### 2.2 The BFV Scheme (Exact Integer Arithmetic)
The BFV scheme represents messages as integers modulo a plaintext modulus $t$ (e.g., $1032193$ as defined in the tenseal engine). It scales the plaintext message by a factor of $\lfloor q/t \rfloor$ and embeds it into the most significant bits of the ciphertext modulus $q$. BFV guarantees that no precision rounding occurs, ensuring perfect accuracy for financial logs and counting metrics.

---

## 3. Cryptographic Key Architecture

Homomorphic encryption separates computing permissions from decryption permissions. To support operations like matrix multiplications, vector shifts, and scale alignments, the system generates and utilizes four distinct key structures:

```
                              ┌────────────────────────┐
                              │    Client Key Gen      │
                              └───────────┬───────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
        ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
        │  Secret Key (s)  │    │  Public Key (pk) │    │ Eval Keys (evk)  │
        │ Keep Private!    │    │ Share for Enc    │    │ Relinearization  │
        └──────────────────┘    └──────────────────┘    └────────┬─────────┘
                                                                 │
                                                                 ▼
                                                        ┌──────────────────┐
                                                        │   Galois Keys    │
                                                        │  Vector Rotation │
                                                        └──────────────────┘
```

### 3.1 Secret Key ($s$) & Public Key ($pk$)
*   **Secret Key ($s$)**: A polynomial with small random coefficients (e.g., ternary coefficients in $\{-1, 0, 1\}$). Kept strictly inside the client domain ([decrypt_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/security/decrypt_node.py)).
*   **Public Key ($pk$)**: A pair of polynomials $(a, b = -a \cdot s + e) \in \mathcal{R}_q^2$. Distributed to ingestion edge points ([encrypt_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/security/encrypt_node.py)) to lock outgoing telemetry streams.

### 3.2 Relinearization Keys ($evk$)
When two ciphertexts $\mathsf{ct}_1 = (a_0, a_1)$ and $\mathsf{ct}_2 = (b_0, b_1)$ are multiplied, the resulting ciphertext represents the multiplication polynomial $(a_0 + a_1 s) \cdot (b_0 + b_1 s) = a_0 b_0 + (a_0 b_1 + a_1 b_0) s + (a_1 b_1) s^2$. 

This results in a ciphertext of size 3:
$$\mathsf{ct}_{\text{mult}} = (c_0, c_1, c_2) \in \mathcal{R}_q^3$$
Subsequent multiplications would cause the size of the ciphertext to grow exponentially. **Relinearization** is the process of using evaluation keys ($evk$) to map the $c_2 \cdot s^2$ component back to a linear term of size 2 $(c'_0, c'_1) \in \mathcal{R}_q^2$ without revealing the secret key. 
In HVE-OS, these keys are generated at startup via `context.generate_relin_keys()` inside the TenSEAL microservice.

### 3.3 Galois Keys (Automorphism Keys)
To perform vector operations on packed ciphertexts (such as rotating or shifting array elements homomorphically), the system must perform a polynomial automorphism:
$$x \to x^k$$
To decrypt this rotated ciphertext, one would need a transformed secret key $s(x^k)$. **Galois Keys** are specialized evaluation keys that map ciphertexts encrypted under $s(x^k)$ back to the original secret key $s(x)$. This is crucial for running dense neural network matrix multiplications.

---

## 4. Depth Management, Scaling, & Rescaling

In CKKS, each homomorphic multiplication scales the underlying values by the scaling factor $\Delta$. If $\mathsf{ct}_1$ and $\mathsf{ct}_2$ both have a scale of $\Delta$, their product $\mathsf{ct}_1 \times \mathsf{ct}_2$ will have a scale of $\Delta^2$.

```
   Level L   [Ciphertext ct1 (Scale Δ)]  ×  [Ciphertext ct2 (Scale Δ)]
                                         │
                                         ▼
   Level L   [Raw Product (Scale Δ²)]
                                         │
                                         ▼  [rescale_to_next()]
   Level L-1 [Rescaled Product (Scale Δ)]  (Consumes one modulus level)
```

To prevent the scale from growing out of bounds and overflowing the ciphertext modulus $q$, a **Rescaling** operation must be performed:
$$\mathsf{ct}_{\text{rescaled}} = \text{rescale}(\mathsf{ct}_{\text{mult}})$$
Rescaling divides the ciphertext coefficients by $\Delta$ and switches the ciphertext modulus from the current level $q_l$ down to the next level $q_{l-1}$ in the modulus chain:
$$q_{0} < q_{1} < \dots < q_{L} = q$$

#### Modulus Chain Operations in HVE-OS:
Multiplication consumes one "modulus level". Once the modulus chain is exhausted (reaching $q_0$), no further multiplications can be performed, and the ciphertext must be decrypted.
In `src/tenseal_engine/main.py`, the system automatically calls `.rescale_to_next()` after ciphertext-ciphertext multiplications to preserve numerical stability:
```python
if hasattr(result_tensor, "rescale_to_next"):
    result_tensor.rescale_to_next()
```

---

## 5. Zero-Knowledge Machine Learning (ZKML) & The Activation Crisis

Running neural networks on homomorphic data presents a fundamental mathematical challenge: **Traditional activation functions (ReLU, Sigmoid, GeLU) are non-algebraic.**

FHE only supports polynomial addition and multiplication. Continuous, non-polynomial activation functions cannot be calculated directly on encrypted polynomials.

```
       Plaintext ReLU                      CKKS Polynomial Approximation
           (Non-FHE)                                 (FHE-Safe)

            │   /                                       \     /
            │  /                                         \   /
            │ /                                           \_/
      ──────┴──────                                   ──────┴──────
            │                                               │
     f(x) = max(0, x)                                  f(x) = x²
```

### 5.1 Polynomial Activation Approximations
HVE-OS resolves this "activation crisis" in [inference_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/ai/inference_node.py) and [fhe_sequential_model_node.py](file:///d:/Projects/HVE-OS/src/Logic/nodes/ai/fhe_sequential_model_node.py) by training the recurrent sequential networks (`FHEFlightNet`) using custom polynomial activations, primarily:
$$\text{Activation}(x) = x^2$$
Using $x^2$ requires only a single homomorphic multiplication (consuming 1 modulus level) while introducing non-linearity into the network, allowing the model to learn complex temporal patterns in flight sequences without decrypting the data.

### 5.2 ZKML Dense Layer Matrix Multiplication
To compute a dense linear layer $y = W \cdot x + b$ homomorphically:
1.  **Weights Representation**: Weights $W$ are stored as plaintext values at the processing server.
2.  **Dot Product Evaluation**: The encrypted input vector $x$ is multiplied by the plaintext weights $W$ using homomorphic dot-product evaluations (`result_tensor.dot(operand)`). 
3.  **Plaintext Multiplication Optimization**: Multiplying an encrypted ciphertext by plaintext weights does **not** consume a modulus level in CKKS, meaning multiple linear layers can be computed sequentially with minimal noise growth.

---

## 6. Comprehensive Node & File Mapping

The following catalog provides a map of the FHE implementation files in HVE-OS:

### 6.1 Cryptographic Microservice Core: [src/tenseal_engine/main.py](file:///d:/Projects/HVE-OS/src/tenseal_engine/main.py)
This is the FastAPI backend serving FHE operations. It manages context caching, serialization, and cryptographic endpoints:
*   **`_get_or_create_context(params)` (Lines 50–90)**: Dynamically checks in-memory cache or volume-mounted disks for requested contexts. Generates Galois and Relinearization keys if a fresh context is initialized.
*   **`/encrypt` (Lines 116–147)**: Receives a raw numeric vector, converts elements to floats/ints, encodes them via CKKS/BFV vector arrays, and returns a Base64 serialized ciphertext JSON:
    ```json
    {
      "__type__": "tenseal_encrypted",
      "scheme": "CKKS",
      "context_id": "inference_vector_v4",
      "data": "gICAgICA...[base64 serialized SEAL polynomial]"
    }
    ```
*   **`/decrypt` (Lines 149–178)**: Deserializes the ciphertext using the embedded `context_id` lookup and decrypts the underlying payload.
*   **`/compute` (Lines 180–269)**: Handles homomorphic algebra (`sum`, `multiply`, `dot`). Contains modular scaling protections to prevent scale overflows.

### 6.2 Frontend Node Layouts: [processing_layer_frntnd/frontend/src/components/nodes/security/](file:///d:/Projects/HVE-OS/processing_layer_frntnd/frontend/src/components/nodes/security/)
*   **`EncryptNode.jsx`**: Provides interactive visual canvas inputs to select the homomorphic scheme (CKKS/BFV), polynomial modulus degree (4096/8192/16384), and security context keys.
*   **`DecryptNode.jsx`**: Houses private key authorization controls, enabling decryption on terminal output cards once verified.
