from datetime import datetime, timezone

import httpx

from app.core.config import settings
from app.ingestion.connectors.base import SourceConnector
from app.ingestion.schema import NormalizedRecord


class FreightosConnector(SourceConnector):
    name = "freightos"

    async def fetch(self) -> list[NormalizedRecord]:
        if not settings.freightos_api_key:
            raise RuntimeError("FREIGHTOS_API_KEY is not configured")

        headers = {"Authorization": f"Bearer {settings.freightos_api_key}"}

        url = "https://fbx.freightos.com/api/v1/freight"

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()

        entries = payload if isinstance(payload, list) else payload.get("data", [])
        records: list[NormalizedRecord] = []
        now = datetime.now(timezone.utc)

        for item in entries[:100]:
            text = f"Freight index update: {item.get('index_name', 'FBX')} = {item.get('value', 'n/a')}"
            records.append(
                NormalizedRecord.with_defaults(
                    source=self.name,
                    source_id=str(item.get("id", "")),
                    text=text,
                    timestamp=now,
                    location=item.get("route"),
                    metadata=item,
                )
            )

        return records
