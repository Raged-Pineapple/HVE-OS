
import json

def _extract_value(data, json_path: str):
    if not json_path or not json_path.startswith("$"):
        return data.get(json_path, None) if isinstance(data, dict) else None

    path = json_path[2:]  # Remove "$."
    current = data

    for part in path.split("."):
        if current is None:
            return None

        if "[" in part:
            key = part[:part.index("[")]
            idx_str = part[part.index("[") + 1:part.index("]")]

            if key:
                current = current.get(key) if isinstance(current, dict) else None
            
            if current is None:
                return None

            if idx_str == "*":
                continue
            else:
                try:
                    idx = int(idx_str)
                    if isinstance(current, list) and idx < len(current):
                        current = current[idx]
                    else:
                        return None
                except (ValueError, IndexError):
                    return None
        else:
            current = current.get(part) if isinstance(current, dict) else None

    return current

# Test data (exploded OpenSky record)
record = ["abc123", "FLIGHT1", "USA", 1610000000, 1610000005, -74.0, 40.0, 10000.0, False, 250.0, 180.0, 0.0, None, 10050.0, "1234", False, 0]

print(f"Index 0 (icao24): {_extract_value(record, '$.[0]')}")
print(f"Index 1 (callsign): {_extract_value(record, '$.[1]')}")
print(f"Index 5 (longitude): {_extract_value(record, '$.[5]')}")
print(f"Index 7 (altitude): {_extract_value(record, '$.[7]')}")
