"""Iteration 39 — Plaid partial-data hardening backend tests.

Validates `_plaid_list_accounts_for_user()` in server.py returns per-item
error rows with `needs_reconnect` flags rather than 500-ing when
`plaid_service.fetch_accounts` fails.

Uses FastAPI TestClient in-process so we can monkeypatch
`plaid_service.fetch_accounts`. The backend under supervisor keeps
running independently; TestClient shares MongoDB with it, so we
seed/cleanup `plaid_items` directly.
"""
from __future__ import annotations

import os
import sys
import uuid
import pathlib

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from dotenv import load_dotenv

# Ensure /app/backend is importable
BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Load backend .env before importing server so env vars are available
load_dotenv(BACKEND_DIR / '.env')

# Import after path fixup. server imports plaid_service at module scope.
import server  # noqa: E402
import plaid_service  # noqa: E402
from plaid_service import PlaidError  # noqa: E402


TEST_TAG = 'iter39'

# ---- Sync Mongo handle for seeding (motor uses async loop which conflicts
# with TestClient's internal loop; pymongo is sync and independent).
_sync_client = MongoClient(os.environ['MONGO_URL'])
_sync_db = _sync_client[os.environ['DB_NAME']]


# ------------------------------ fixtures ------------------------------
@pytest.fixture(scope='module')
def client():
    with TestClient(server.app) as c:
        yield c


@pytest.fixture()
def throwaway_user(client):
    """Register a fresh throwaway user and return {email, token, user_id}."""
    email = f'test_{TEST_TAG}_{uuid.uuid4().hex[:8]}@jaleter.app'
    payload = {'name': 'Iter39 Tester', 'email': email, 'password': 'password123'}
    r = client.post('/api/auth/register', json=payload)
    assert r.status_code in (200, 201), f'register failed: {r.status_code} {r.text}'
    body = r.json()
    token = body.get('token') or body.get('access_token')
    user = body.get('user') or {}
    user_id = user.get('user_id') or user.get('id')
    assert token and user_id, f'unexpected register response: {body}'
    yield {'email': email, 'token': token, 'user_id': user_id}
    # Cleanup: remove any plaid_items + user afterwards (sync via pymongo)
    _sync_db.plaid_items.delete_many({'user_id': user_id})
    _sync_db.users.delete_many({'user_id': user_id})
    _sync_db.users.delete_many({'email': email})


def _auth_headers(user):
    return {'Authorization': f'Bearer {user["token"]}'}


def _seed_plaid_item(user_id: str, item_id: str, institution_name: str = 'TestBank'):
    """Insert a synthetic plaid_items row via sync pymongo."""
    token_plain = f'access-sandbox-{uuid.uuid4()}'
    try:
        token_enc = plaid_service.encrypt(token_plain)
    except Exception:
        token_enc = token_plain
    doc = {
        'user_id': user_id,
        'item_id': item_id,
        'access_token_encrypted': token_enc,
        'institution_name': institution_name,
        'institution_domain': 'testbank.example.com',
        'last_sync_at': None,
    }
    _sync_db.plaid_items.insert_one(doc)


# ------------------------------ Scenario 1: no Plaid items ------------------------------
class TestNoPlaidItems:
    """User with zero plaid_items rows must get a normal accounts list."""

    def test_no_plaid_items_returns_ok(self, client, throwaway_user):
        r = client.get('/api/accounts/all', headers=_auth_headers(throwaway_user))
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'accounts' in body and isinstance(body['accounts'], list)
        # Must NOT contain any Plaid stub row
        plaid_rows = [a for a in body['accounts'] if a.get('provider') == 'plaid']
        assert plaid_rows == [], f'unexpected plaid rows: {plaid_rows}'


# ------------------------------ Scenario 2: PlaidError ------------------------------
class TestPlaidErrorRow:
    def test_plaid_error_returns_needs_reconnect_true(self, client, throwaway_user, monkeypatch):
        item_id = f'ITEM_{TEST_TAG}_{uuid.uuid4().hex[:8]}'
        _seed_plaid_item(throwaway_user['user_id'], item_id, 'PlaidErrBank')

        async def _boom(access_token):
            raise PlaidError('ITEM_LOGIN_REQUIRED: user must reauth')

        # Patch the attribute on the module (server.py calls
        # plaid_service.fetch_accounts through the module object).
        monkeypatch.setattr(plaid_service, 'fetch_accounts', _boom)

        r = client.get('/api/accounts/all', headers=_auth_headers(throwaway_user))
        assert r.status_code == 200, r.text
        rows = [a for a in r.json().get('accounts', []) if a.get('provider') == 'plaid']
        assert len(rows) == 1, f'expected 1 plaid row, got {rows}'
        row = rows[0]
        assert 'error' in row and 'ITEM_LOGIN_REQUIRED' in row['error']
        assert row.get('needs_reconnect') is True
        assert row.get('link_id') == item_id
        assert row.get('org_name') == 'PlaidErrBank'

        # cleanup
        _sync_db.plaid_items.delete_many({'user_id': throwaway_user['user_id']})


# ------------------------------ Scenario 3: generic Exception ------------------------------
class TestGenericExceptionRow:
    def test_generic_exception_returns_needs_reconnect_false(self, client, throwaway_user, monkeypatch):
        item_id = f'ITEM_{TEST_TAG}_{uuid.uuid4().hex[:8]}'
        _seed_plaid_item(throwaway_user['user_id'], item_id, 'BoomBank')

        async def _boom(access_token):
            raise RuntimeError('kaboom')

        monkeypatch.setattr(plaid_service, 'fetch_accounts', _boom)

        r = client.get('/api/accounts/all', headers=_auth_headers(throwaway_user))
        assert r.status_code == 200, r.text
        rows = [a for a in r.json().get('accounts', []) if a.get('provider') == 'plaid']
        assert len(rows) == 1, f'expected 1 plaid row, got {rows}'
        row = rows[0]
        # server.py sets error to f'{type(e).__name__}: {e}'
        assert row.get('error') == 'RuntimeError: kaboom'
        assert row.get('needs_reconnect') is False
        assert row.get('link_id') == item_id
        assert row.get('org_name') == 'BoomBank'
        # Row should NOT include category / is_asset / is_liability
        assert 'category' not in row
        assert 'is_asset' not in row
        assert 'is_liability' not in row

        _sync_db.plaid_items.delete_many({'user_id': throwaway_user['user_id']})


# ------------------------------ Scenario 4 & 5: valid Plaid data + idempotency ------------------------------
class TestValidPlaidData:
    def _fake_accounts_fn(self):
        async def _ok(access_token):
            return [{
                'account_id': 'acct_TEST_iter39_123',
                'name': 'Iter39 Checking',
                'official_name': 'Iter39 Checking Official',
                'mask': '4242',
                'type': 'depository',
                'subtype': 'checking',
                'balances': {
                    'current': 1234.56,
                    'available': 1200.00,
                    'iso_currency_code': 'USD',
                },
            }]
        return _ok

    def test_valid_plaid_row_shape(self, client, throwaway_user, monkeypatch):
        item_id = f'ITEM_{TEST_TAG}_{uuid.uuid4().hex[:8]}'
        _seed_plaid_item(throwaway_user['user_id'], item_id, 'GoodBank')
        monkeypatch.setattr(plaid_service, 'fetch_accounts', self._fake_accounts_fn())

        r1 = client.get('/api/accounts/all', headers=_auth_headers(throwaway_user))
        assert r1.status_code == 200, r1.text
        rows1 = [a for a in r1.json().get('accounts', []) if a.get('provider') == 'plaid']
        assert len(rows1) == 1
        row = rows1[0]
        assert row.get('link_id') == item_id
        assert row.get('org_name') == 'GoodBank'
        assert row.get('name') == 'Iter39 Checking'
        assert row.get('category') == 'cash'
        assert row.get('is_asset') is True
        assert row.get('is_liability') is False
        assert abs(float(row.get('balance', 0)) - 1234.56) < 0.001

        # Second call — same shape, idempotent
        r2 = client.get('/api/accounts/all', headers=_auth_headers(throwaway_user))
        assert r2.status_code == 200
        rows2 = [a for a in r2.json().get('accounts', []) if a.get('provider') == 'plaid']
        assert len(rows2) == 1
        # Compare relevant fields (last_sync_at etc. may be None both times).
        for k in ('link_id', 'account_id', 'name', 'category', 'is_asset', 'is_liability', 'balance', 'org_name'):
            assert rows1[0].get(k) == rows2[0].get(k), f'field {k} differed between calls'

        _sync_db.plaid_items.delete_many({'user_id': throwaway_user['user_id']})


# ------------------------------ Regression: other endpoints still work ------------------------------
class TestRegression:
    def test_accounts_categories(self, client):
        r = client.get('/api/accounts/categories')
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'assets' in body and 'liabilities' in body
        assert any(a.get('slug') == 'cash' for a in body['assets'])
        assert any(l.get('slug') == 'credit_cards' for l in body['liabilities'])

    def test_auth_me_works(self, client, throwaway_user):
        r = client.get('/api/auth/me', headers=_auth_headers(throwaway_user))
        assert r.status_code == 200, r.text
        assert r.json().get('email') == throwaway_user['email']

    def test_coach_history(self, client, throwaway_user):
        r = client.get('/api/coach/history', headers=_auth_headers(throwaway_user))
        # Endpoint should respond 200 (may be empty history).
        assert r.status_code == 200, r.text
        body = r.json()
        # Common shape variants — check response is a dict or list, no error.
        assert isinstance(body, (dict, list))
