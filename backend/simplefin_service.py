"""SimpleFIN Bridge integration helpers.

Handles:
- Setup Token exchange (POST to base64-decoded claim URL) → Access URL
- Fernet encryption/decryption of Access URLs at rest
- Fetching /accounts with HTTP Basic Auth extracted from the Access URL
"""
from __future__ import annotations

import base64
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_ENC_KEY = os.getenv('SIMPLEFIN_ENC_KEY', '').encode() or b''
_fernet: Optional[Fernet] = None
if _ENC_KEY:
    try:
        _fernet = Fernet(_ENC_KEY)
    except Exception as e:  # noqa: BLE001
        logger.error('Invalid SIMPLEFIN_ENC_KEY: %s', e)


class SimpleFinError(Exception):
    pass


def _require_fernet() -> Fernet:
    if _fernet is None:
        raise SimpleFinError('SIMPLEFIN_ENC_KEY is not configured')
    return _fernet


def encrypt(text: str) -> str:
    return _require_fernet().encrypt(text.encode('utf-8')).decode('utf-8')


def decrypt(token: str) -> str:
    try:
        return _require_fernet().decrypt(token.encode('utf-8')).decode('utf-8')
    except InvalidToken as e:
        raise SimpleFinError('Access URL decryption failed') from e


async def claim_setup_token(setup_token: str) -> str:
    """Base64-decode a Setup Token and POST it to obtain an Access URL."""
    st = setup_token.strip()
    try:
        decoded = base64.b64decode(st)
        claim_url = decoded.decode('utf-8').strip()
    except Exception as e:  # noqa: BLE001
        raise SimpleFinError('Invalid Setup Token format') from e
    if not claim_url.startswith('https://'):
        raise SimpleFinError('Setup Token did not decode to a valid claim URL')
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(claim_url, headers={'Content-Length': '0'})
    if resp.status_code == 403:
        raise SimpleFinError('Setup Token has already been used or was revoked')
    if resp.status_code != 200:
        raise SimpleFinError(f'SimpleFIN claim returned HTTP {resp.status_code}')
    access_url = resp.text.strip()
    if not access_url.startswith('https://'):
        raise SimpleFinError('SimpleFIN did not return a valid Access URL')
    return access_url


def _parse_access(access_url: str) -> tuple[str, str, str]:
    parsed = urlparse(access_url)
    if not parsed.username or not parsed.password:
        raise SimpleFinError('Access URL is missing credentials')
    root = urlunparse((parsed.scheme, parsed.hostname or '', parsed.path, '', '', ''))
    return parsed.username, parsed.password, root


async def fetch_accounts(
    access_url: str,
    balances_only: bool = False,
    start_date: Optional[int] = None,
    end_date: Optional[int] = None,
) -> dict:
    user, pw, root = _parse_access(access_url)
    params: dict[str, str] = {}
    if balances_only:
        params['balances-only'] = '1'
    if start_date is not None:
        params['start-date'] = str(int(start_date))
    if end_date is not None:
        params['end-date'] = str(int(end_date))
    async with httpx.AsyncClient(timeout=45.0) as client:
        r = await client.get(f'{root}/accounts', auth=(user, pw), params=params)
    if r.status_code == 401:
        raise SimpleFinError('SimpleFIN rejected the stored credentials')
    if r.status_code == 429:
        raise SimpleFinError('SimpleFIN rate limit reached; try again later')
    if r.status_code != 200:
        raise SimpleFinError(f'SimpleFIN /accounts HTTP {r.status_code}')
    return r.json()


def map_transaction(user_id: str, account_id: str, org_name: str, txn: dict) -> dict:
    posted = int(txn.get('posted') or 0)
    amount_raw = txn.get('amount') or '0'
    try:
        amount = float(amount_raw)
    except (TypeError, ValueError):
        amount = 0.0
    external_id = str(txn.get('id') or f'{account_id}:{posted}:{amount_raw}')
    date = datetime.fromtimestamp(posted, tz=timezone.utc) if posted else datetime.now(timezone.utc)
    return {
        'user_id': user_id,
        'account_id': account_id,
        'external_id': external_id,
        'date': date,
        'name': txn.get('description') or '',
        'amount': amount,
        'type': 'income' if amount > 0 else 'expense',
        'origin': org_name or 'SimpleFIN',
        'period': date.strftime('%B'),
        'pending': bool(txn.get('pending')),
        'raw': txn,
    }
