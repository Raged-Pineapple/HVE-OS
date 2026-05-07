import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from Logic.security.registry import registry

def test_registry():
    print("Testing Security Registry...")
    caps = registry.get_all_capabilities()
    assert "tenseal" in caps, "TenSEAL provider missing from registry"
    print("Capabilities:")
    for k, v in caps.items():
        print(f"  {k}: {v['name']} (Available: {v['available']})")

def test_tenseal_provider():
    print("\nTesting TenSEAL Provider...")
    provider = registry.get_provider("tenseal")
    if not provider.get_capabilities()["available"]:
        print("TenSEAL is not available in this environment. Skipping encryption tests.")
        return

    params = {"scheme": "CKKS", "poly_modulus_degree": 4096}
    
    # Test encryption
    print("Encrypting single value...")
    encrypted = provider.encrypt(100.5, params)
    assert encrypted["__type__"] == "tenseal_encrypted"
    assert encrypted["scheme"] == "CKKS"
    
    # Test decryption
    print("Decrypting value...")
    decrypted = provider.decrypt(encrypted, params)
    # CKKS has precision loss, check if it's close enough
    assert abs(decrypted - 100.5) < 0.1, f"Decrypted value {decrypted} != 100.5"
    
    # Test homomorphic sum
    print("Testing homomorphic sum...")
    enc1 = provider.encrypt(50, params)
    enc2 = provider.encrypt(25, params)
    enc_sum = provider.compute("sum", [enc1, enc2], params)
    dec_sum = provider.decrypt(enc_sum, params)
    assert abs(dec_sum - 75.0) < 0.1, f"Decrypted sum {dec_sum} != 75.0"
    
    print("TenSEAL Provider tests passed!")

if __name__ == "__main__":
    test_registry()
    test_tenseal_provider()
    print("\nAll tests finished.")
