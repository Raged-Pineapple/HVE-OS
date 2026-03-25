import re

class ConfidenceScorer:
    """
    Stage 8: Confidence Scoring & Decision Routing
    Determines whether the schema should be silently imported (>=0.85), confirmed (0.60-0.84), or warned (<0.60).
    """
    def compute_confidence(self, schema: list[dict], fingerprint_matched: bool) -> float:
        if fingerprint_matched:
            return 1.0
            
        score = 0.0
        total_cols = len(schema) or 1
        
        # 1. Non-generic names
        generic = sum(1 for c in schema if re.match(r'^col_\d+$|^unnamed', str(c.get('name', '')).lower()))
        score += (1 - (generic / total_cols)) * 0.20
        
        # 2. Semantic labels identified
        labelled = sum(1 for c in schema if c.get('semantic') != 'UNKNOWN')
        score += (labelled / total_cols) * 0.25
        
        # 3. Primary key uniqueness strength
        pk_col = next((c for c in schema if c.get('is_pk')), None)
        if pk_col:
            score += pk_col.get('uniqueness', 0) * 0.25
            
        # 4. Suspicious Text cols (looks numeric but typed text)
        suspicious = 0
        for c in schema:
            if c.get('type') == 'TEXT' and c.get('fill_rate', 0) > 0.80 and c.get('avg_length', 0) < 10:
                sample = c.get('sample', [])
                if sample and all(str(v).replace('.', '').isdigit() for v in sample if v):
                    suspicious += 1
        score += (1 - (suspicious / total_cols)) * 0.15
        
        # 5. Base structural soundness (Fully populated keys)
        if pk_col and pk_col.get('fill_rate', 0) == 1.0:
            score += 0.15
            
        return min(max(round(score, 3), 0.0), 1.0)
        
    def get_decision(self, score: float) -> str:
        if score >= 0.85: return "SILENT_IMPORT"
        if score >= 0.60: return "REQUIRE_CONFIRMATION"
        return "REQUIRE_REVIEW"

confidence_scorer = ConfidenceScorer()
