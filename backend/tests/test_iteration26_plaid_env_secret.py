"""Iteration 26 backend tests — Plaid env-secret refactor + sandbox regression.

Verifies:
- /api/plaid/status is unchanged after env-secret refactor (configured=true, env=sandbox).
- /api/plaid/link-token still returns a sandbox link token.
- /api/plaid/exchange-public-token still exchanges a sandbox public_token successfully.
"""
from __future__ import annotations

import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
API = f'{BASE_URL}/api'

USER_EMAIL = 'alex+test1@jaleter.app'
USER_PASSWORD = 'password123'
USER_NAME = 'Alex Ward'

PLAID_CLIENT_ID = '69c66d8894f82e000dd1a5f1'
PLAID_SANDBOX_SECRET = '038da1b227c1b7844ccc1264599171'
PLAID_SANDBOX_URL = 'https://sandbox.plaid.com'
PLAID_INSTITUTION_ID = 'ins_109508'


@pytest.fixture(scope='session')
def http():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


def _h(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


@pytest.fixture(scope='session')
def user_token(http):
    r = http.post(f'{API}/auth/login', json={'email': USER_EMAIL, 'password': USER_PASSWORD})
    if r.status_code != 200:
        r = http.post(f'{API}/auth/register', json={'name': USER_NAME, 'email': USER_EMAIL, 'password': USER_PASSWORD})
        if r.status_code != 200:
            time.sleep(1)
            r = http.post(f'{API}/auth/login', json={'email': USER_EMAIL, 'password': USER_PASSWORD})
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return r.json()['token']


# ---- 1) Status endpoint after env-secret refactor ---------------------------
class TestPlaidStatusAfterRefactor:
    def test_status_still_configured_sandbox(self, http):
        r = http.get(f'{API}/plaid/status')
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get('configured') is True, f'expected configured=true, got {data}'
        assert data.get('env') == 'sandbox', f'expected env=sandbox, got {data}'
        assert 'transactions' in (data.get('products') or [])
        assert 'US' in (data.get('country_codes') or [])


# ---- 2) Link-token creation still works -------------------------------------
class TestPlaidLinkToken:
    def test_link_token_returns_sandbox_token(self, http, user_token):
        r = http.post(f'{API}/plaid/link-token', headers=_h(user_token), json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'link_token' in data
        assert data['link_token'].startswith('link-sandbox-'), (
            f"env-secret refactor broke link-token: {data['link_token']}"
        )

    def test_link_token_requires_auth(self, http):
        r = http.post(f'{API}/plaid/link-token', json={})
        assert r.status_code in (401, 403), r.text


# ---- 3) Exchange public_token still succeeds against sandbox ----------------
@pytest.fixture(scope='session')
def sandbox_public_token():
    body = {
        'client_id': PLAID_CLIENT_ID,
        'secret': PLAID_SANDBOX_SECRET,
        'institution_id': PLAID_INSTITUTION_ID,
        'initial_products': ['transactions'],
    }
    r = requests.post(f'{PLAID_SANDBOX_URL}/sandbox/public_token/create', json=body, timeout=30)
    assert r.status_code == 200, f'sandbox public_token create failed: {r.status_code} {r.text}'
    data = r.json()
    assert 'public_token' in data
    return data['public_token']


class TestPlaidExchange:
    _state: dict = {}

    def test_exchange_public_token_succeeds(self, http, user_token, sandbox_public_token):
        r = http.post(
            f'{API}/plaid/exchange-public-token',
            headers=_h(user_token),
            json={'public_token': sandbox_public_token, 'institution_id': PLAID_INSTITUTION_ID},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get('item_id')
        assert 'access_token' not in data
        TestPlaidExchange._state['item_id'] = data['item_id']

    def test_cleanup_delete_item(self, http, user_token):
        item_id = TestPlaidExchange._state.get('item_id')
        if not item_id:
            pytest.skip('no item created')
        r = http.delete(f'{API}/plaid/item/{item_id}', headers=_h(user_token))
        assert r.status_code == 200, r.text
