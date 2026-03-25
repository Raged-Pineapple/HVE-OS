import pandas as pd
import json

class FormatParser:
    """
    Stage 2 (Part B): Format Parsing.
    Receives physical file path and inferred format from the Detector. 
    One absolute responsibility: Return a standardized list of raw dictionaries [{}, ...].
    No type inference or schema coercion happens here—everything is returned as a raw string 
    so the Stage 3 Intelligence cascade can handle it universally.
    """
    def parse(self, filepath: str, format_type: str) -> list[dict]:
        try:
            if format_type == "CSV":
                # Engine=python allows delimiter sniffing, dtype=str prevents pandas from assuming types
                df = pd.read_csv(filepath, sep=None, engine='python', dtype=str, on_bad_lines='skip')
                # Replace pandas NaNs with None for pure JSON compatibility
                return df.where(pd.notnull(df), None).to_dict(orient='records')
                
            elif format_type == "TSV":
                df = pd.read_csv(filepath, sep='\t', dtype=str, on_bad_lines='skip')
                return df.where(pd.notnull(df), None).to_dict(orient='records')
                
            elif format_type == "PSV":
                df = pd.read_csv(filepath, sep='|', dtype=str, on_bad_lines='skip')
                return df.where(pd.notnull(df), None).to_dict(orient='records')
                
            elif format_type in ["XLS_LEGACY", "XLSX", "XLSB"] or filepath.endswith((".xls", ".xlsx", ".xlsb")):
                df = pd.read_excel(filepath, dtype=str)
                return df.where(pd.notnull(df), None).to_dict(orient='records')
                
            elif format_type == "JSON_FAMILY":
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                if isinstance(data, list):
                    return data
                elif isinstance(data, dict):
                    # GeoJSON or wrapped JSON APIs usually have the array nested under a key e.g., 'features' or 'data'
                    for k, v in data.items():
                        if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                            # Special case: GeoJSON geometry separation (hoist properties)
                            if k == "features" and "properties" in v[0]:
                                extracted = []
                                for item in v:
                                    props = item.get("properties", {})
                                    if "geometry" in item:
                                        # Save geometry type simply
                                        props["_raw_geom_type"] = item["geometry"].get("type")
                                        props["_raw_coordinates"] = str(item["geometry"].get("coordinates"))
                                    extracted.append(props)
                                return extracted
                            return v
                    return [data] # Fallback
                    
            elif format_type == "PARQUET":
                df = pd.read_parquet(filepath)
                # Parquet is strictly typed natively, but we cast to string to enforce Stage 3 pipeline purity
                df = df.astype(str)
                return df.where(pd.notnull(df), None).to_dict(orient='records')
                
            else:
                raise ValueError(f"No parser available for detected exact format: {format_type}")
                
        except Exception as e:
            raise RuntimeError(f"Format Parsing failed for {filepath}: {str(e)}")

format_parser = FormatParser()
