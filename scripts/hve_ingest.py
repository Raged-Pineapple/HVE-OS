import argparse
import json
import os
import sys
import requests
from typing import Dict, Any

# Define the base HVE API endpoint (pointing to your running Gateway)
HVE_API_URL = os.getenv("HVE_API_URL", "http://127.0.0.1:8000/api/v1/ingest")

def stream_ingest(source_id: str, data: Dict[str, Any]):
    """
    Simulates a high-speed telemetry source. 
    Wraps the data in a Canonical Envelope and pushes to Kafka.
    """
    endpoint = f"{HVE_API_URL}/stream"
    payload = {
        "source_id": source_id,
        "data": data
    }
    
    print(f"[*] Ingesting stream for source: {source_id}...")
    try:
        response = requests.post(endpoint, json=payload)
        response.raise_for_status()
        result = response.json()
        print(f"[-] Successfully accepted in HVE! hve_id: {result.get('hve_id')}")
    except Exception as e:
        print(f"[!] Stream error: {e}")
        sys.exit(1)

def batch_ingest(source_id: str, filepath: str):
    """
    Simulates a massive file 'drop'. 
    Uses the Pre-Signed URL memory-bypass architecture to hit MinIO directly.
    """
    if not os.path.exists(filepath):
        print(f"[!] Error: File not found: {filepath}")
        return

    filename = os.path.basename(filepath)
    print(f"[*] Requesting Pre-Signed URL for {filename}...")
    
    # 1. Ask HVE for a direct upload link
    try:
        url_payload = {
            "source_id": source_id,
            "filename": filename
        }
        res = requests.post(f"{HVE_API_URL}/presigned-url", json=url_payload)
        res.raise_for_status()
        presigned_data = res.json()
        upload_url = presigned_data["upload_url"]
        
        # 2. Upload file bytes DIRECTLY to MinIO (Bypassing the API memory)
        print(f"[*] Multi-part streaming upload to MinIO...")
        with open(filepath, 'rb') as f:
            upload_res = requests.put(upload_url, data=f)
            upload_res.raise_for_status()
            
        print(f"[-] File successfully dropped in Bronze! Target: {presigned_data['target_path']}")
    except Exception as e:
        print(f"[!] Batch error: {e}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="HVE-OS Generalized Ingestion Utility")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Stream Command
    stream_parser = subparsers.add_parser("stream", help="Ingest real-time JSON")
    stream_parser.add_argument("--source", required=True, help="Unique Source ID (e.g., flight_tracker)")
    stream_parser.add_argument("--data", help="Raw JSON string")
    stream_parser.add_argument("--file", help="Path to a JSON file to ingest")

    # Batch Command
    batch_parser = subparsers.add_parser("batch", help="Upload large static file")
    batch_parser.add_argument("--source", required=True, help="Unique Source ID (e.g., historical_dump)")
    batch_parser.add_argument("--path", required=True, help="Path to the file to upload")

    args = parser.parse_args()

    if args.command == "stream":
        if args.file:
            with open(args.file, 'r') as f:
                payload = json.load(f)
        elif args.data:
            payload = json.loads(args.data)
        else:
            print("[!] Error: You must provide either --data or --file.")
            return
        stream_ingest(args.source, payload)

    elif args.command == "batch":
        batch_ingest(args.source, args.path)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
