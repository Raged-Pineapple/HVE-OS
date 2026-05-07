from typing import Dict, Any, Type
import logging
from .provider import BaseSecurityProvider
from .tenseal_provider import TenSEALProvider

logger = logging.getLogger(__name__)

class SecurityRegistry:
    """
    Manages the lifecycle and discovery of Security Providers.
    """
    def __init__(self):
        self._providers: Dict[str, BaseSecurityProvider] = {}
        self._register_defaults()

    def _register_defaults(self):
        self.register_provider("tenseal", TenSEALProvider())

    def register_provider(self, name: str, provider: BaseSecurityProvider):
        self._providers[name] = provider
        logger.info(f"Registered Security Provider: {name}")

    def get_provider(self, name: str) -> BaseSecurityProvider:
        provider = self._providers.get(name)
        if not provider:
            raise ValueError(f"Security provider '{name}' not found.")
        return provider

    def get_all_capabilities(self) -> Dict[str, Any]:
        return {
            name: provider.get_capabilities()
            for name, provider in self._providers.items()
        }

# Singleton instance
registry = SecurityRegistry()
