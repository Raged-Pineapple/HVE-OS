import re

class SemanticLabeller:
    """
    Stage 4: Semantic Labelling.
    Derives real-world meaning from columns using explicit Names, Regex Values, and Cross-Column Rules.
    """
    def __init__(self):
        self.NAME_TO_SEMANTIC = {
            'ICAO_CODE': ['icao', 'icao_code', 'icao24', 'ident'],
            'IATA_CODE': ['iata', 'iata_code'],
            'LATITUDE': ['lat', 'latitude', 'lat_deg', 'y'],
            'LONGITUDE': ['lon', 'lng', 'longitude', 'lon_deg', 'x'],
            'ALTITUDE': ['alt', 'altitude', 'elevation', 'elev', 'height'],
            'HEADING': ['hdg', 'heading', 'track', 'bearing', 'course'],
            'SPEED': ['spd', 'speed', 'velocity', 'groundspeed'],
            'REGISTRATION': ['reg', 'registration', 'tail', 'tail_number'],
            'SQUAWK': ['squawk', 'transponder', 'xpdr'],
            'CALLSIGN': ['callsign', 'flight', 'flight_id', 'flt'],
            'COUNTRY': ['country', 'nation', 'state'],
            'NAME': ['name', 'airport_name', 'station_name'],
            'AIRCRAFT_TYPE': ['type', 'aircraft_type', 'type_code'],
            'TIMESTAMP': ['ts', 'timestamp', 'time', 'datetime', 'last_seen']
        }
        
    def label_by_name(self, raw_name: str) -> str:
        clean_name = str(raw_name).lower()
        for semantic, synonyms in self.NAME_TO_SEMANTIC.items():
            if clean_name in synonyms:
                return semantic
        return "UNKNOWN"
        
    def label_by_value(self, schema_col: dict) -> str:
        c_type = schema_col.get('type')
        sample = schema_col.get('sample', [])
        
        if c_type == 'TEXT':
            if all(isinstance(v, str) and len(v) == 6 and re.match(r'^[0-9a-fA-F]{6}$', v) for v in sample):
                return 'ICAO_HEX'
            if all(isinstance(v, str) and len(v) == 4 and v.isdigit() for v in sample):
                return 'SQUAWK'
                
        return schema_col.get('semantic', 'UNKNOWN')

    def apply_labels(self, schema: list[dict]) -> list[dict]:
        # 1. Independent column matching
        for col in schema:
            sem = self.label_by_name(col['name'])
            if sem == "UNKNOWN":
                sem = self.label_by_value(col)
            col['semantic'] = sem
            
        # 2. Cross-Column Rules (Spatial PostGIS inference)
        lat_col = next((c for c in schema if c['semantic'] == 'LATITUDE'), None)
        lon_col = next((c for c in schema if c['semantic'] == 'LONGITUDE'), None)
        
        if lat_col and lon_col:
            lat_col['_flag_gis'] = True
            lon_col['_flag_gis'] = True
            
        return schema

semantic_labeller = SemanticLabeller()
