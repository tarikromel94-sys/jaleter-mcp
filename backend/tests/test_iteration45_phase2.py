"""Iteration 45 - Phase 2 backend tests.

Focus:
  1. POST /api/plaid/link-token (no item_id) → 200 with link_token
  2. POST /api/plaid/link-token?item_id=nonexistent → 404 "Plaid item not found"
  3. plaid_service.create_link_token now uses days_requested=730 (24 mo backfill)
  4. Update-mode path (with access_token) omits products/optional_products/transactions
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest
import requests

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = (
    os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
    or os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')
)
assert BASE_URL, 'EXPO_PUBLIC_BACKEND_URL must be set'

TEST_EMAIL = 'alex+test1@jaleter.app'
TEST_PASSWORD = 'password123'


@pytest.fixture(scope='module')
def auth_token():
    r = requests.post(
        f'{BASE_URL}/api/auth/login',
        json={'email': TEST_EMAIL, 'password': TEST_PASSWORD},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f'Cannot login as {TEST_EMAIL}: {r.status_code} {r.text}')
    return r.json()['token']


@pytest.fixture(scope='module')
def api_client(auth_token):
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json', 'Authorization': f'Bearer {auth_token}'})
    return s


# --- 1. Plaid link-token (no item_id) — expect 200 + link_token ---
def test_plaid_link_token_new_link_returns_200(api_client):
    r = api_client.post(f'{BASE_URL}/api/plaid/link-token', json={}, timeout=30)
    assert r.status_code == 200, f'Expected 200, got {r.status_code}: {r.text}'
    body = r.json()
    assert 'link_token' in body, f'link_token missing: {body}'
    assert isinstance(body['link_token'], str) and body['link_token']
    # Plaid link tokens are prefixed like `link-production-` or `link-sandbox-`
    assert body['link_token'].startswith('link-'), f'unexpected link_token format: {body["link_token"]}'


# --- 2. Plaid link-token with unknown item_id → 404 ---
def test_plaid_link_token_unknown_item_returns_404(api_client):
    r = api_client.post(
        f'{BASE_URL}/api/plaid/link-token?item_id=nonexistent-item-xyz',
        json={},
        timeout=30,
    )
    assert r.status_code == 404, f'Expected 404, got {r.status_code}: {r.text}'
    body = r.json()
    # FastAPI default error shape: {"detail": "..."}
    assert 'detail' in body
    assert 'not found' in body['detail'].lower(), body


# --- 2b. Same endpoint without auth → 401/403 (defensive) ---
def test_plaid_link_token_requires_auth():
    r = requests.post(f'{BASE_URL}/api/plaid/link-token', json={}, timeout=30)
    assert r.status_code in (401, 403), f'Expected 401/403, got {r.status_code}: {r.text}'


# --- 3. create_link_token uses days_requested=730 (24-month backfill) ---
def test_create_link_token_uses_730_days(monkeypatch):
    import plaid_service

    captured: dict = {}

    async def fake_post(path, body):
        captured['path'] = path
        captured['body'] = body
        return {'link_token': 'link-fake-730', 'expiration': '2026-12-31T00:00:00Z'}

    monkeypatch.setattr(plaid_service, '_post', fake_post)
    monkeypatch.setattr(plaid_service, 'PLAID_CLIENT_ID', 'fake-id')
    monkeypatch.setattr(plaid_service, 'PLAID_SECRET', 'fake-secret')

    asyncio.run(plaid_service.create_link_token('user-abc'))

    body = captured['body']
    assert 'transactions' in body, f'transactions block missing: {body}'
    days = body['transactions'].get('days_requested')
    assert days == 730, f'Expected days_requested=730, got {days!r}'
    # sanity: also confirm optional_products still present (regression from iter41)
    assert body.get('optional_products') == ['liabilities', 'investments']
    assert body.get('products') == ['transactions']


# --- 4. Update-mode path omits products/optional_products/transactions ---
def test_create_link_token_update_mode_omits_products(monkeypatch):
    import plaid_service

    captured: dict = {}

    async def fake_post(path, body):
        captured['body'] = body
        return {'link_token': 'link-fake-update', 'expiration': '2026-12-31T00:00:00Z'}

    monkeypatch.setattr(plaid_service, '_post', fake_post)
    monkeypatch.setattr(plaid_service, 'PLAID_CLIENT_ID', 'fake-id')
    monkeypatch.setattr(plaid_service, 'PLAID_SECRET', 'fake-secret')

    asyncio.run(plaid_service.create_link_token('user-abc', access_token='access-sandbox-fake'))

    body = captured['body']
    # In update mode, access_token must be present…
    assert body.get('access_token') == 'access-sandbox-fake', body
    # …and products / optional_products / transactions MUST be omitted (Plaid rejects otherwise)
    assert 'products' not in body, f'products should be omitted in update mode: {body}'
    assert 'optional_products' not in body, f'optional_products should be omitted in update mode: {body}'
    assert 'transactions' not in body, f'transactions should be omitted in update mode: {body}'
