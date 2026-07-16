"""Modular financial-data provider layer.

Each provider implements: is_configured(), link(), list_accounts(), sync(), unlink().
Concrete implementations: SimpleFIN (banks + credit + loans), SnapTrade (brokerage,
inert until keys are set), File (CSV/OFX/QFX/QBO import for unsupported banks).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ProviderError(Exception):
    """Any provider-level error. Message is safe to surface to the client."""


class Provider(ABC):
    id: str
    label: str

    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    async def link(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Link an account. Payload shape is provider-specific.
        Returns {'link_id', 'accounts':[…]} on success."""

    @abstractmethod
    async def list_accounts(self, user_id: str) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def sync(self, user_id: str) -> dict[str, Any]:
        """Returns {'synced': int, 'errors': list}"""

    @abstractmethod
    async def unlink(self, user_id: str, link_id: str) -> None: ...
