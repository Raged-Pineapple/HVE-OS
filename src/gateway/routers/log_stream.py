"""
log_stream.py — Live Log SSE Endpoint
Streams backend log records to the frontend terminal in real-time.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/v1/logs", tags=["Debug"])

# ── Shared asyncio queue ─────────────────────────────────────────
# All pages share a single queue. The SSE handler drains it.
_log_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

LEVEL_MAP = {
    "DEBUG":    "debug",
    "INFO":     "info",
    "WARNING":  "warning",
    "ERROR":    "error",
    "CRITICAL": "error",
}


class QueueLogHandler(logging.Handler):
    """
    Injects structured log records into the shared async queue
    so the SSE endpoint can stream them to the browser.
    """
    def emit(self, record: logging.LogRecord):
        try:
            entry = {
                "ts":      datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "level":   LEVEL_MAP.get(record.levelname, "info"),
                "logger":  record.name.split(".")[-1],   # short name only
                "message": self.format(record),
            }
            # Non-blocking put — silently drop if queue is full
            _log_queue.put_nowait(entry)
        except Exception:
            pass


def attach_handler():
    """Call once at startup to wire the queue handler into the root logger."""
    handler = QueueLogHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.setLevel(logging.DEBUG)
    root = logging.getLogger()
    # Avoid duplicate handlers on reload
    if not any(isinstance(h, QueueLogHandler) for h in root.handlers):
        root.addHandler(handler)


async def _event_generator():
    """Async generator: yields SSE-formatted messages from the queue."""
    # Send a heartbeat first
    yield "data: {\"ts\":\"--:--:--\",\"level\":\"info\",\"logger\":\"hve-os\",\"message\":\"Log stream connected\"}\n\n"

    while True:
        try:
            entry = await asyncio.wait_for(_log_queue.get(), timeout=15.0)
            yield f"data: {json.dumps(entry)}\n\n"
        except asyncio.TimeoutError:
            # Keep-alive ping
            yield ": ping\n\n"


@router.get("/stream")
async def log_stream():
    """
    SSE endpoint — streams live Python log records to the browser terminal.
    Connect with EventSource('http://localhost:8000/api/v1/logs/stream').
    """
    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )
