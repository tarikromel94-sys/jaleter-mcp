"""Plaid integration service.

Uses httpx directly against the Plaid REST API (per Plaid playbook) to avoid
plaid-python SDK model-version churn. Stores encrypted access tokens and
per-item transaction sync cursors in MongoDB.

Only the backend sees `PLAID_CLIENT_ID` / `PLAID_SECRET` / `access_token`.
The frontend only ever receives short-lived `link_token`s and a masked
`item_id` used to reference the connection.
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# ---- Env / config -----------------------------------------------------------
PLAID_CLIENT_ID = os.environ.get('PLAID_CLIENT_ID', '').strip()
PLAID_ENV = (os.environ.get('PLAID_ENV', 'sandbox') or 'sandbox').strip().lower()
# Environment-specific secret selection: production > development > sandbox,
# with an explicit override via PLAID_SECRET (matches Plaid dashboard naming).
_ENV_TO_SECRET_KEY = {
    'production': 'PLAID_PRODUCTION_SECRET',
    'development': 'PLAID_DEVELOPMENT_SECRET',
    'sandbox': 'PLAID_SANDBOX_SECRET',
}
_env_secret_name = _ENV_TO_SECRET_KEY.get(PLAID_ENV, 'PLAID_SANDBOX_SECRET')
PLAID_SECRET = (
    os.environ.get('PLAID_SECRET', '').strip()
    or os.environ.get(_env_secret_name, '').strip()
    or os.environ.get('PLAID_SANDBOX_SECRET', '').strip()  # safety fallback
)
PLAID_PRODUCTS = [p.strip() for p in (os.environ.get('PLAID_PRODUCTS', 'transactions') or '').split(',') if p.strip()]
PLAID_COUNTRY_CODES = [c.strip() for c in (os.environ.get('PLAID_COUNTRY_CODES', 'US') or '').split(',') if c.strip()]

_ENV_HOSTS = {
    'sandbox': 'https://sandbox.plaid.com',
    'development': 'https://development.plaid.com',
    'production': 'https://production.plaid.com',
}
PLAID_BASE_URL = _ENV_HOSTS.get(PLAID_ENV, _ENV_HOSTS['sandbox'])

# Reuse SIMPLEFIN_ENC_KEY (also a Fernet key) so we don't require another secret.
_ENC_KEY_RAW = (os.environ.get('PLAID_ENC_KEY') or os.environ.get('SIMPLEFIN_ENC_KEY') or '').strip()
_fernet: Optional[Fernet] = None
if _ENC_KEY_RAW:
    try:
        _fernet = Fernet(_ENC_KEY_RAW.encode())
    except Exception as e:  # noqa: BLE001
        logger.warning('Plaid encryption key invalid: %s', e)
        _fernet = None


class PlaidError(Exception):
    """Human-readable Plaid failure surfaced to the API layer."""


def is_configured() -> bool:
    return bool(PLAID_CLIENT_ID and PLAID_SECRET)


def encrypt(value: str) -> str:
    if not _fernet:
        raise PlaidError('Server encryption key missing. Set PLAID_ENC_KEY or SIMPLEFIN_ENC_KEY.')
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not _fernet:
        raise PlaidError('Server encryption key missing. Set PLAID_ENC_KEY or SIMPLEFIN_ENC_KEY.')
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken as e:
        raise PlaidError(f'Failed to decrypt Plaid token: {e}')


async def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    if not is_configured():
        raise PlaidError('Plaid is not configured on the server.')
    headers = {
        'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
        'PLAID-SECRET': PLAID_SECRET,
        'Content-Type': 'application/json',
    }
    async with httpx.AsyncClient(base_url=PLAID_BASE_URL, timeout=25) as client:
        r = await client.post(path, json=body, headers=headers)
    try:
        data = r.json()
    except Exception:
        raise PlaidError(f'Plaid returned non-JSON response ({r.status_code}).')
    if r.status_code >= 400 or data.get('error_code'):
        msg = data.get('error_message') or data.get('error_code') or f'Plaid HTTP {r.status_code}'
        logger.warning('Plaid error on %s: %s (request_id=%s)', path, msg, data.get('request_id'))
        raise PlaidError(msg)
    return data


# ---- Public API used by server.py ------------------------------------------
async def create_link_token(user_id: str, webhook_url: Optional[str] = None, android_package_name: Optional[str] = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        'client_name': 'Jaleter',
        'language': 'en',
        'country_codes': PLAID_COUNTRY_CODES,
        'user': {'client_user_id': user_id},
        'products': PLAID_PRODUCTS or ['transactions'],
    }
    if 'transactions' in (PLAID_PRODUCTS or ['transactions']):
        body['transactions'] = {'days_requested': 90}
    if webhook_url:
        body['webhook'] = webhook_url
    if android_package_name:
        body['android_package_name'] = android_package_name
    data = await _post('/link/token/create', body)
    return {'link_token': data['link_token'], 'expiration': data.get('expiration')}


async def exchange_public_token(public_token: str) -> dict[str, Any]:
    data = await _post('/item/public_token/exchange', {'public_token': public_token})
    return {'access_token': data['access_token'], 'item_id': data['item_id']}


async def fetch_accounts(access_token: str) -> list[dict[str, Any]]:
    data = await _post('/accounts/get', {'access_token': access_token})
    return data.get('accounts') or []


async def fetch_institution(institution_id: Optional[str]) -> dict[str, Any]:
    if not institution_id:
        return {}
    try:
        data = await _post('/institutions/get_by_id', {
            'institution_id': institution_id,
            'country_codes': PLAID_COUNTRY_CODES,
        })
        return data.get('institution') or {}
    except PlaidError:
        return {}


async def sync_transactions(access_token: str, cursor: str = '') -> dict[str, Any]:
    """Iterates /transactions/sync until has_more=false, returning aggregated results."""
    added: list[dict[str, Any]] = []
    modified: list[dict[str, Any]] = []
    removed: list[dict[str, Any]] = []
    current = cursor or ''
    while True:
        body: dict[str, Any] = {'access_token': access_token, 'count': 500}
        if current:
            body['cursor'] = current
        data = await _post('/transactions/sync', body)
        added += data.get('added') or []
        modified += data.get('modified') or []
        removed += data.get('removed') or []
        current = data.get('next_cursor') or ''
        if not data.get('has_more'):
            break
    return {'added': added, 'modified': modified, 'removed': removed, 'cursor': current}


def map_plaid_transaction(user_id: str, item_id: str, account_id: str, org_name: str, txn: dict[str, Any]) -> dict[str, Any]:
    """Normalize a Plaid transaction into the shared bank_transactions schema."""
    txn_id = txn.get('transaction_id') or ''
    # Plaid expresses money as positive=out (debit), negative=in (credit) for depository.
    # Our app treats income as positive, expense as negative — so flip the sign.
    amt_raw = txn.get('amount')
    try:
        amt = -float(amt_raw) if amt_raw is not None else 0.0
    except (TypeError, ValueError):
        amt = 0.0
    date_val = txn.get('date') or txn.get('authorized_date') or ''
    try:
        # Plaid dates are ISO-8601 (YYYY-MM-DD).
        parsed = datetime.strptime(date_val, '%Y-%m-%d').replace(tzinfo=timezone.utc) if date_val else datetime.now(timezone.utc)
    except Exception:
        parsed = datetime.now(timezone.utc)
    description = (
        txn.get('name')
        or (txn.get('merchant_name') or '')
        or 'Transaction'
    )
    category = ''
    cats = txn.get('personal_finance_category') or {}
    if isinstance(cats, dict) and cats.get('primary'):
        category = cats.get('primary')
    elif isinstance(txn.get('category'), list) and txn['category']:
        category = txn['category'][0]
    return {
        'user_id': user_id,
        'account_id': account_id,
        'external_id': txn_id,
        'provider': 'plaid',
        'link_id': item_id,
        'org_name': org_name,
        'amount': amt,
        'currency': txn.get('iso_currency_code') or txn.get('unofficial_currency_code') or 'USD',
        'date': parsed,
        'description': description,
        'category': category,
        'pending': bool(txn.get('pending')),
        'raw': txn,
    }
