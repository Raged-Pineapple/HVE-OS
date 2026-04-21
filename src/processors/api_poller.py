"""
api_poller.py — External API Polling Engine
Fetches data from registered external APIs on a schedule,
wraps responses in Canonical Envelopes, and publishes to Kafka.

KEY FIX: Array Explosion — APIs that return lists (e.g. OpenSky's 6,197 flights,
NewsAPI's 100 articles) are exploded into individual per-record Kafka messages,
keeping each message well under the 1MB Kafka limit.
"""
import os
import sys
import json
import logging
import asyncio
import aiohttp

# Add gateway and src to path for imports
_gateway_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "gateway"))
_src_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _d in [_gateway_dir, _src_dir]:
    if _d not in sys.path:
        sys.path.insert(0, _d)

from services import db_service
from services.kafka_service import publish_stream
from models import CanonicalEnvelope

logger = logging.getLogger(__name__)


def _extract_records(data, extraction_path: str) -> list:
    """
    Extract an array of records from the API response.

    If extraction_path is set (e.g. "$.states" or "$.articles"),
    navigate into the response and return the array.

    If extraction_path is None:
      - If the response IS a list → return it directly
      - Otherwise → wrap the whole response as a single record
    """
    if extraction_path:
        # Strip the leading "$." prefix
        key = extraction_path.lstrip("$.").split(".")[0]
        value = data.get(key) if isinstance(data, dict) else None
        if isinstance(value, list):
            return value
        elif value is not None:
            return [value]
        else:
            return [data]

    if isinstance(data, list):
        return data

    return [data]


class APIPoller:
    """
    Background service that polls external APIs based on configurations
    stored in the Control Plane, wraps responses in Canonical Envelopes,
    and pushes them to Kafka for downstream processing.

    Supports:
    - Array Explosion: explodes list responses into individual Kafka messages
    - extraction_path: JSONPath key to locate the array within the response
    - Auth: NONE, API_KEY, BEARER, BASIC
    - Auto-refresh: re-reads source list every 30 seconds
    """

    def __init__(self):
        self._running = False
        self._tasks = {}    # source_id -> asyncio.Task
        self._loop = None

    async def start(self):
        """Start polling all active API sources."""
        self._running = True
        self._loop = asyncio.get_event_loop()
        logger.info("APIPoller starting — loading active sources...")
        await self._refresh_sources()
        asyncio.create_task(self._periodic_refresh())

    async def stop(self):
        """Stop all polling tasks."""
        self._running = False
        for source_id, task in self._tasks.items():
            task.cancel()
            logger.info(f"[APIPoller] Cancelled polling for {source_id}")
        self._tasks.clear()
        logger.info("APIPoller stopped.")

    async def start_polling_source(self, source_id: str):
        """Start polling a specific source immediately."""
        config = db_service.get_api_config(source_id)
        if config and config.get("is_polling"):
            if source_id in self._tasks:
                self._tasks[source_id].cancel()
            task = asyncio.create_task(self._poll_loop(source_id, config))
            self._tasks[source_id] = task
            logger.info(f"[APIPoller] Started polling: {source_id} every {config['poll_interval_seconds']}s")

    async def stop_polling_source(self, source_id: str):
        """Stop polling a specific source."""
        if source_id in self._tasks:
            self._tasks[source_id].cancel()
            del self._tasks[source_id]
            logger.info(f"[APIPoller] Stopped polling: {source_id}")

    async def _refresh_sources(self):
        """Load active API sources from Control Plane and start/stop tasks."""
        try:
            active_sources = db_service.get_active_api_sources()
            active_ids = {s["source_id"] for s in active_sources}

            for source in active_sources:
                sid = source["source_id"]
                if sid not in self._tasks:
                    task = asyncio.create_task(self._poll_loop(sid, source))
                    self._tasks[sid] = task
                    logger.info(f"[APIPoller] Started: {sid}")

            for sid in list(self._tasks.keys()):
                if sid not in active_ids:
                    self._tasks[sid].cancel()
                    del self._tasks[sid]
                    logger.info(f"[APIPoller] Stopped (deactivated): {sid}")

        except Exception as e:
            logger.error(f"[APIPoller] Failed to refresh sources: {e}")

    async def _periodic_refresh(self):
        """Refresh source list every 30 seconds."""
        while self._running:
            await asyncio.sleep(30)
            await self._refresh_sources()

    async def _poll_loop(self, source_id: str, config: dict):
        """Main polling loop for a single API source."""
        interval = config.get("poll_interval_seconds", 60)
        api_url = config["api_url"]
        method = config.get("method", "GET").upper()
        headers = config.get("headers", {})
        body_template = config.get("body_template")
        auth_type = config.get("auth_type", "NONE")
        auth_creds = config.get("auth_credentials", {})

        # extraction_path: tells us where the array lives in the response
        # e.g. "$.states" for OpenSky, "$.articles" for NewsAPI
        extraction_path = config.get("extraction_path")

        # Parse headers/creds if stored as JSON strings
        if isinstance(headers, str):
            try:
                headers = json.loads(headers)
            except json.JSONDecodeError:
                headers = {}
        if isinstance(auth_creds, str):
            try:
                auth_creds = json.loads(auth_creds)
            except json.JSONDecodeError:
                auth_creds = {}

        # Build auth headers
        if auth_type == "API_KEY":
            key_name = auth_creds.get("header_name", "X-API-Key")
            headers[key_name] = auth_creds.get("api_key", "")
        elif auth_type == "BEARER":
            headers["Authorization"] = f"Bearer {auth_creds.get('token', '')}"
        elif auth_type == "BASIC":
            import base64
            creds = base64.b64encode(
                f"{auth_creds.get('username', '')}:{auth_creds.get('password', '')}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {creds}"

        logger.info(
            f"[APIPoller:{source_id}] Polling {method} {api_url} every {interval}s"
            + (f" | extraction_path={extraction_path}" if extraction_path else " | mode=blob")
        )

        while self._running:
            try:
                async with aiohttp.ClientSession() as session:
                    kwargs = {
                        "headers": headers,
                        "timeout": aiohttp.ClientTimeout(total=30)
                    }
                    if method == "POST" and body_template:
                        kwargs["json"] = body_template

                    async with session.request(method, api_url, **kwargs) as response:
                        if response.status == 200:
                            data = await response.json()

                            # ── ARRAY EXPLOSION ─────────────────────────────
                            # Extract individual records from the response.
                            # Each record is published as its own Kafka message,
                            # keeping message size <<1MB regardless of response size.
                            records = _extract_records(data, extraction_path)

                            published = 0
                            errors = 0
                            for record in records:
                                try:
                                    envelope = CanonicalEnvelope(
                                        source_id=source_id,
                                        payload=record
                                    )
                                    publish_stream(envelope.model_dump())
                                    published += 1
                                except Exception as pub_err:
                                    errors += 1
                                    logger.warning(
                                        f"[APIPoller:{source_id}] Record publish error: {pub_err}"
                                    )

                            db_service.update_poll_status(source_id, "SUCCESS")
                            logger.info(
                                f"[APIPoller:{source_id}] ✅ {published} records → Kafka "
                                f"({errors} errors, response={len(records)} items)"
                            )

                        else:
                            error_text = await response.text()
                            db_service.update_poll_status(
                                source_id, "ERROR",
                                f"HTTP {response.status}: {error_text[:200]}"
                            )
                            logger.warning(f"[APIPoller:{source_id}] HTTP {response.status}")

            except asyncio.CancelledError:
                logger.info(f"[APIPoller:{source_id}] Polling cancelled.")
                return
            except Exception as e:
                db_service.update_poll_status(source_id, "ERROR", str(e)[:500])
                logger.error(f"[APIPoller:{source_id}] Poll failed: {e}")

            await asyncio.sleep(interval)


# Singleton instance
_poller = None

def get_poller() -> APIPoller:
    global _poller
    if _poller is None:
        _poller = APIPoller()
    return _poller
