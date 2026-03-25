class DataClassRouter:
    """
    Phase 29: Data Class Detection Router.
    Executes directly after Stage 3 (Parser). Inspects the raw parsed blocks before generic Tabular schema inference triggers.
    Categorizes the import completely automatically based on structure and shape.
    """
    def route(self, parser_output, format_type: str) -> str:
        # 1. Binary Formats (Audio, Images, Raw Radar Dumps, PDF/Zip binaries)
        if format_type in ["PDF_REJECT", "PNG_REJECT", "ZIP_CONTAINER"] or format_type.startswith("UNKNOWN"):
            return "binary"
            
        # 2. Document formats (Unstructured JSONs, HTML extracts, varying keys across nodes)
        if not isinstance(parser_output, list):
            return "document"
            
        if len(parser_output) == 1:
            return "document"
            
        if format_type in ["XML_FAMILY", "JSON_FAMILY"] and not self._is_structurally_consistent(parser_output):
            return "document"
            
        # At this point, it is roughly Tabular. 
        # 3. High-Frequency Measurement / Timeseries inspection
        if len(parser_output) > 50:
            if self._has_strong_timeseries_signature(parser_output):
                return "timeseries"
                
        # 4. Canonical Enterprise Tabular Relational File (CSV, GeoJSON, Parquet list)
        return "tabular"
        
    def _is_structurally_consistent(self, records: list[dict]) -> bool:
        if not records: return True
        base_keys = set(records[0].keys())
        # Inspect variance across the top 50 rows
        for r in records[:50]:
            diff = set(r.keys()) ^ base_keys
            # If a row has more than 50% non-overlapping keys with the master structure, it's unstructured document data
            if len(diff) > len(base_keys) * 0.5: 
                return False
        return True
        
    def _has_strong_timeseries_signature(self, records: list[dict]) -> bool:
        keys = list(records[0].keys())
        has_time = any(any(time_alias in str(k).lower() for time_alias in ['time', 'ts', 'date', 'created']) for k in keys)
        has_measurement = any(any(meas_alias in str(k).lower() for meas_alias in ['val', 'reading', 'measure', 'lat', 'lon', 'speed', 'rcs']) for k in keys)
        return has_time and has_measurement

data_class_router = DataClassRouter()
