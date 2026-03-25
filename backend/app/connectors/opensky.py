import asyncio
import json
import logging
import httpx
from datetime import datetime
from app.ingestion.standardizer import standardizer

logger = logging.getLogger(__name__)

class OpenSkyConnector:
    """
    Continuous Polling Connector for the OpenSky Network API.
    Retrieves live aircraft state vectors natively via HTTP to bypass global Python module pathing issues.
    """
    def __init__(self, credentials_path="credentials.json"):
        self.credentials_path = credentials_path
        self.running = False
        
    async def poll_forever(self):
        try:
            with open(self.credentials_path, "r") as f:
                creds = json.load(f)
        except Exception as e:
            logger.error(f"Could not load OpenSky credentials from {self.credentials_path}: {e}")
            return
            
        self.running = True
        print("✈️ OPENSKY CONNECTOR: Starting live flight radar HTTP polling loop...")
        
        # Bounding box over North America
        params = {
            "lamin": 24.396308,
            "lamax": 49.384358,
            "lomin": -125.0,
            "lomax": -66.93457
        }
        
        async with httpx.AsyncClient() as client:
            while self.running:
                try:
                    # Authenticate via Basic Auth using the generic API keys
                    auth = (creds["clientId"], creds["clientSecret"])
                    response = await client.get(
                        "https://opensky-network.org/api/states/all", 
                        auth=auth, 
                        params=params,
                        timeout=10.0
                    )
                    
                    if response.status_code == 200:
                        data = response.json()
                        states = data.get("states", [])
                        
                        if states:
                            batch_id = f"opensky_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                            print(f"✈️ OPENSKY CONNECTOR: Natively fetched {len(states)} live aircraft states over North America.")
                            
                            # Standard OpenSky state array mapping
                            for s in states[:200]:
                                payload = {
                                    "icao24": s[0],
                                    "callsign": s[1].strip() if s[1] else None,
                                    "origin_country": s[2],
                                    "time_position": s[3],
                                    "last_contact": s[4],
                                    "longitude": s[5],
                                    "latitude": s[6],
                                    "baro_altitude": s[7],
                                    "on_ground": s[8],
                                    "velocity": s[9],
                                    "true_track": s[10],
                                    "vertical_rate": s[11],
                                    "timestamp": s[3] * 1000 if s[3] else None
                                }
                                
                                await standardizer.standardize_and_publish(
                                    source_id="OPENSKY_NETWORK",
                                    raw_payload=payload,
                                    batch_id=batch_id,
                                    partition_key=s[0]
                                )
                    else:
                        logger.error(f"OpenSky HTTP Error: {response.status_code} - {response.text}")
                        if response.status_code == 429:
                            # If we hit the rate limit, we must wait at least 60 seconds
                            await asyncio.sleep(60)
                    
                    # Standard pause between successful calls
                    await asyncio.sleep(30) 
                except Exception as e:
                    logger.error(f"OpenSky HTTP Connector Error: {e}")
                    await asyncio.sleep(60)

opensky_connector = OpenSkyConnector()
