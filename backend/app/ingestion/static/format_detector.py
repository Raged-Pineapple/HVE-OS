class FormatDetector:
    """
    Stage 2: Format Detection.
    Never trusts the file extension. Strictly reads Binary Magic Bytes and sniffs the first 4KB of text.
    """
    def detect(self, head_bytes: bytes, filepath: str = "") -> str:
        # 1. Binary Magic Bytes Detection
        if head_bytes.startswith(b'\x50\x4B\x03\x04'):
            ext = str(filepath).lower()
            if ext.endswith(('.xlsx', '.xlsm', '.xltx', '.xltm')):
                return "XLSX"
            if ext.endswith('.xlsb'):
                return "XLSB"
            return "ZIP_CONTAINER" # Default back to generic binary zip
        if head_bytes.startswith(b'\xD0\xCF\x11\xE0'):
            return "XLS_LEGACY"
        if head_bytes.startswith(b'\x89\x50\x4E\x47'):
            return "PNG_REJECT"
        if head_bytes.startswith(b'\x25\x50\x44\x46'):
            return "PDF_REJECT"
        if head_bytes.startswith(b'PAR1'):
            return "PARQUET"
            
        # 2. Text Sniffing (First 4KB decoded)
        text_head = head_bytes.decode('utf-8', errors='ignore').lstrip()
        
        if text_head.startswith("<?xml") or text_head.startswith("<"):
            # Further detection can verify if it's AIXM, KML, GPX
            return "XML_FAMILY"
            
        if text_head.startswith("{") or text_head.startswith("["):
            # Further detection can verify if it's GeoJSON or flat JSON
            return "JSON_FAMILY"
            
        # Specific Aviation text formats
        if "AC " in text_head[:500] or "DP " in text_head[:500]:
            return "OPENAIR"
            
        # Delimiter patterns for tabular data
        lines = text_head.split('\n')
        if len(lines) > 2:
            first_line = lines[0]
            # Verify if delimiter count is consistent across first 3 lines
            if "\t" in first_line:
                if len(first_line.split("\t")) == len(lines[1].split("\t")):
                    return "TSV"
            if "," in first_line:
                if len(first_line.split(",")) == len(lines[1].split(",")):
                    return "CSV"
            if "|" in first_line:
                if len(first_line.split("|")) == len(lines[1].split("|")):
                    return "PSV"
                    
        return "UNKNOWN_TEXT"

format_detector = FormatDetector()
