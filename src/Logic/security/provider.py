import abc
from typing import Any, Dict, List

class BaseSecurityProvider(abc.ABC):
    """
    Abstract base class for all security providers in HVE-OS.
    This ensures a modular, Palantir-like architecture where different
    encryption/masking engines can be swapped seamlessly.
    """

    @abc.abstractmethod
    def get_capabilities(self) -> Dict[str, Any]:
        """
        Returns metadata about this provider's capabilities and required parameters.
        This is used by the frontend to dynamically render configuration forms.
        """
        pass

    @abc.abstractmethod
    def encrypt(self, data: Any, params: Dict[str, Any]) -> Any:
        """
        Encrypts or masks the provided data.
        """
        pass

    @abc.abstractmethod
    def decrypt(self, data: Any, params: Dict[str, Any]) -> Any:
        """
        Decrypts or unmasks the provided data.
        """
        pass

    @abc.abstractmethod
    def compute(self, operation: str, data_list: List[Any], params: Dict[str, Any]) -> Any:
        """
        Performs a computation over encrypted data (if supported, e.g., homomorphic encryption).
        """
        pass
