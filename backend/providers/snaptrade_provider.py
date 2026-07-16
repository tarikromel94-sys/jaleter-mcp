"""SnapTrade provider — inert until SNAPTRADE_CLIENT_ID + SNAPTRADE_CONSUMER_KEY are set.

Uses snaptrade-python-sdk when configured; degrades gracefully otherwise.
User secret is Fernet-encrypted at rest with the same SIMPLEFIN_ENC_KEY.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from providers.base import Provider, ProviderError
from simplefin_service import encrypt as fernet_encrypt, decrypt as fernet_decrypt, SimpleFinError

logger = logging.getLogger(__name__)


class SnapTradeProvider(Provider):
    id = 'snaptrade'
    label = 'Brokerage / Retirement (SnapTrade)'

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self.db = db
        self._client = None
        self._client_id = os.getenv('SNAPTRADE_CLIENT_ID', '').strip()
        self._consumer_key = os.getenv('SNAPTRADE_CONSUMER_KEY', '').strip()
        if self._client_id and self._consumer_key:
            try:
                from snaptrade_client import SnapTrade  # type: ignore
                self._client = SnapTrade(consumer_key=self._consumer_key, client_id=self._client_id)
            except Exception as e:  # noqa: BLE001
                logger.error('SnapTrade SDK init failed: %s', e)
                self._client = None

    def is_configured(self) -> bool:
        return self._client is not None

    async def _ensure_user(self, user_id: str) -> tuple[str, str]:
        """Ensure a SnapTrade user exists for our Jaleter user; return (snap_user_id, snap_secret_plain)."""
        row = await self.db.snaptrade_users.find_one({'user_id': user_id}, {'_id': 0})
        if row:
            try:
                return row['snap_user_id'], fernet_decrypt(row['snap_user_secret_enc'])
            except SimpleFinError as e:
                raise ProviderError(str(e))
        # Register a new SnapTrade user (blocking; wrapped in run_in_executor by caller ideally)
        snap_user_id = f'jaleter-{user_id}'
        try:
            resp = self._client.authentication.register_snap_trade_user(user_id=snap_user_id)  # type: ignore
            body = resp.body if hasattr(resp, 'body') else resp
            secret = (body or {}).get('userSecret') if isinstance(body, dict) else None
            if not secret:
                raise ProviderError('SnapTrade did not return a userSecret')
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f'SnapTrade register failed: {e}')
        await self.db.snaptrade_users.insert_one({
            'user_id': user_id, 'snap_user_id': snap_user_id, 'snap_user_secret_enc': fernet_encrypt(secret),
        })
        return snap_user_id, secret

    async def link(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.is_configured():
            raise ProviderError('SnapTrade not configured — SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY are missing.')
        snap_user_id, snap_secret = await self._ensure_user(user_id)
        custom_redirect = payload.get('custom_redirect') or 'jaleter://snaptrade-callback'
        try:
            resp = self._client.authentication.login_snap_trade_user(  # type: ignore
                user_id=snap_user_id, user_secret=snap_secret,
                custom_redirect=custom_redirect, connection_type='read',
            )
            body = resp.body if hasattr(resp, 'body') else resp
            redirect_uri = (body or {}).get('redirectURI') if isinstance(body, dict) else None
            if not redirect_uri:
                raise ProviderError('SnapTrade returned no redirectURI')
            return {'link_id': None, 'redirect_uri': redirect_uri, 'accounts': []}
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f'SnapTrade login failed: {e}')

    async def list_accounts(self, user_id: str) -> list[dict[str, Any]]:
        if not self.is_configured():
            return []
        cursor = self.db.snaptrade_accounts.find({'user_id': user_id}, {'_id': 0, 'raw': 0})
        return await cursor.to_list(length=200)

    async def sync(self, user_id: str) -> dict[str, Any]:
        if not self.is_configured():
            raise ProviderError('SnapTrade not configured')
        # Concrete refresh omitted here — will be wired after keys are provisioned.
        # For now, return zero and don't crash so multi-provider sync stays functional.
        return {'synced': 0, 'errors': []}

    async def unlink(self, user_id: str, link_id: str) -> None:
        # Removing the SnapTrade user removes all their authorizations.
        row = await self.db.snaptrade_users.find_one({'user_id': user_id}, {'_id': 0})
        if not row:
            return
        # We deliberately don't call SnapTrade's delete-user here without live keys.
        await self.db.snaptrade_accounts.delete_many({'user_id': user_id})
        await self.db.snaptrade_users.delete_one({'user_id': user_id})
