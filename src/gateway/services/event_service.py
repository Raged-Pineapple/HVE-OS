"""
event_service.py — Event Service for Real-time Updates
Provides event emission for graph updates.
"""
import logging
from typing import Dict, List
from threading import Lock

logger = logging.getLogger(__name__)

class EventService:
    """Thread-safe event service for real-time updates."""
    
    _instance = None
    _lock = Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._subscribers = []
        return cls._instance
    
    def emit(self, event_type: str, data: Dict):
        """Emit an event to all registered callbacks."""
        for callback in self._subscribers:
            try:
                callback(event_type, data)
            except Exception as e:
                logger.warning(f"Event callback failed: {e}")
    
    def subscribe(self, callback):
        """Add a callback to receive real-time events."""
        if callback not in self._subscribers:
            self._subscribers.append(callback)

    def emit_source_update(self, source_id: str, entity_count: int):
        """Emit source update event when new data arrives in Neo4j."""
        self.emit("source_update", {
            "source_id": source_id,
            "entity_count": entity_count
        })
        logger.info(f"Event emitted: source_update for {source_id}")

_event_service = None

def get_event_service() -> EventService:
    global _event_service
    if _event_service is None:
        _event_service = EventService()
    return _event_service

def subscribe(callback):
    """Module-level convenience method to subscribe."""
    get_event_service().subscribe(callback)