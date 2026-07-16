"""Provider registry."""
from __future__ import annotations

from typing import TYPE_CHECKING

from providers.base import Provider, ProviderError
from providers.file_provider import FileProvider
from providers.snaptrade_provider import SnapTradeProvider

if TYPE_CHECKING:
    from motor.motor_asyncio import AsyncIOMotorDatabase


def build_registry(db: 'AsyncIOMotorDatabase') -> dict[str, Provider]:
    return {
        # SimpleFIN is invoked via its existing endpoints; still register a stub
        # for enumeration/discovery.
        'file': FileProvider(db),
        'snaptrade': SnapTradeProvider(db),
    }


def catalog(registry: dict[str, Provider], include_simplefin: bool = True) -> list[dict]:
    items: list[dict] = []
    if include_simplefin:
        items.append({
            'id': 'simplefin', 'label': 'Banks / Credit / Loans (SimpleFIN)',
            'kinds': ['checking', 'savings', 'credit', 'loan'], 'configured': True,
        })
    items.append({
        'id': 'snaptrade', 'label': registry['snaptrade'].label,
        'kinds': ['brokerage', 'retirement', 'investment'], 'configured': registry['snaptrade'].is_configured(),
    })
    items.append({
        'id': 'file', 'label': registry['file'].label,
        'kinds': ['csv', 'ofx', 'qfx', 'qbo'], 'configured': True,
    })
    return items


__all__ = ['Provider', 'ProviderError', 'FileProvider', 'SnapTradeProvider', 'build_registry', 'catalog']
