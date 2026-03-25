class PKScorer:
    """
    Stage 5: Primary Key Selection.
    Mathematical deduction of the most optimal Primary Key based on 5 heuristics.
    """
    def score_column(self, col: dict) -> float:
        score = 0.0
        
        # 1. Uniqueness is dominant signal
        score += col.get('uniqueness', 0) * 50
        
        # 2. Must be fully populated
        score += col.get('fill_rate', 0) * 20
        
        # 3. Semantic type signals
        PK_SEMANTICS = ['ICAO_CODE', 'IATA_CODE', 'ICAO_HEX', 'REGISTRATION', 'SQUAWK', 'CALLSIGN']
        if col.get('semantic') in PK_SEMANTICS:
            score += 20
            
        # 4. Name signals
        raw_name = str(col.get('name', '')).lower()
        if any(s in raw_name for s in ['id', 'code', 'key', 'uid', 'uuid', 'identifier', 'number', 'icao', 'iata']):
            score += 10
            
        # 5. Short text (codes)
        if col.get('type') == 'TEXT' and 2 <= col.get('avg_length', 0) <= 8:
            score += 5
            
        # 6. Auto-increment Ints
        if col.get('type') == 'INTEGER' and col.get('uniqueness', 0) == 1.0:
            score += 10
            
        return score

    def select_pk(self, schema: list[dict]) -> str:
        if not schema: return None
        for col in schema:
            col['pk_score'] = self.score_column(col)
            
        best_col = max(schema, key=lambda c: c.get('pk_score', 0))
        # Tag it in the schema directly
        for col in schema:
            col['is_pk'] = (col['name'] == best_col['name'])
            
        return best_col['name']

pk_scorer = PKScorer()
