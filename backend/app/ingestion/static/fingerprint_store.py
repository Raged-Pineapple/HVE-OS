import hashlib
import json

class FingerprintStore:
    """
    Stage 7: Fingerprint Matching
    Computes a strict structural fingerprint of the inferred schema.
    If matched against memory, skips all inference and instantly imports with 100% confidence.
    """
    def compute_fingerprint(self, schema: list[dict]) -> str:
        structure = {
            "col_count": len(schema),
            "types": [c.get('type') for c in schema],
            "semantics": [c.get('semantic') for c in schema]
        }
        # Dump to strict sorted JSON and hash
        return hashlib.sha256(json.dumps(structure, sort_keys=True).encode('utf-8')).hexdigest()

fingerprint_store = FingerprintStore()
