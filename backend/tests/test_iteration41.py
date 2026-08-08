"""Iteration 41 backend tests.

Covers:
  1. Plaid /link/token/create body now includes `optional_products` =
     ['liabilities', 'investments'] alongside `products` = ['transactions'].
     Verified via monkey-patching plaid_service._post (no real Plaid calls).
  2. /api/accounts/transactions returns rows seeded directly into
     bank_transactions with the expected shape.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
import requests

# Make backend package importable
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/') or os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')
assert BASE_URL, 'EXPO_PUBLIC_BACKEND_URL must be set'

TEST_EMAIL = 'alex+test1@jaleter.app'
TEST_PASSWORD = 'password123'


# ---------------------------------------------------------------------------
# Fixture: authed session for alex+test1
# ---------------------------------------------------------------------------
@pytest.fixture(scope='module')
def alex_token():
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': TEST_EMAIL, 'password': TEST_PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f'Cannot login as {TEST_EMAIL}: {r.status_code} {r.text}')
    data = r.json()
    return data['token'], data['user']['user_id']


@pytest.fixture(scope='module')
def api_client(alex_token):
    token, _ = alex_token
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    return s


# ---------------------------------------------------------------------------
# 1. Plaid create_link_token payload — optional_products present
# ---------------------------------------------------------------------------
def test_create_link_token_includes_optional_products(monkeypatch):
    """Directly invoke plaid_service.create_link_token with monkeypatched _post
    and confirm the request body contains `products` = ['transactions'] AND
    `optional_products` = ['liabilities', 'investments']."""
    import plaid_service

    captured: dict = {}

    async def fake_post(path, body):
        captured['path'] = path
        captured['body'] = body
        return {'link_token': 'link-sandbox-fake', 'expiration': '2026-01-01T00:00:00Z'}

    # Also bypass is_configured() guard by patching client id/secret env vars
    monkeypatch.setattr(plaid_service, '_post', fake_post)
    monkeypatch.setattr(plaid_service, 'PLAID_CLIENT_ID', 'fake-id')
    monkeypatch.setattr(plaid_service, 'PLAID_SECRET', 'fake-secret')

    result = asyncio.run(plaid_service.create_link_token('user-abc'))
    assert result['link_token'] == 'link-sandbox-fake'
    assert captured['path'] == '/link/token/create'
    body = captured['body']

    # products must include 'transactions' (default)
    assert 'products' in body
    assert body['products'] == ['transactions'], f"Expected products=['transactions'], got {body['products']!r}"

    # optional_products must be exactly ['liabilities', 'investments']
    assert 'optional_products' in body, 'optional_products missing from link/token/create body'
    assert body['optional_products'] == ['liabilities', 'investments'], (
        f"Expected optional_products=['liabilities','investments'], got {body['optional_products']!r}"
    )

    # Ensures the fix (Chase CC) is wired up: transactions block is still requested
    assert body.get('transactions', {}).get('days_requested') == 90


# ---------------------------------------------------------------------------
# 2. Seed bank_transactions and verify /api/accounts/transactions returns them
# ---------------------------------------------------------------------------
_seeded_ids: list[str] = []


@pytest.fixture(scope='module')
def seeded_txns(alex_token):
    """Direct MongoDB insert of two rows for alex+test1, cleaned up after."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BACKEND_DIR, '.env'))

    mongo_url = os.environ['MONGO_URL']
    db_name = os.environ['DB_NAME']
    _, user_id = alex_token

    ext_coffee = f'TEST_iter41_coffee_{uuid.uuid4().hex[:8]}'
    ext_salary = f'TEST_iter41_salary_{uuid.uuid4().hex[:8]}'
    today = datetime.now(timezone.utc).replace(microsecond=0)

    docs = [
        {
            'user_id': user_id,
            'account_id': 'TEST_acct_iter41',
            'external_id': ext_coffee,
            'provider': 'plaid',
            'link_id': 'TEST_link_iter41',
            'org_name': 'TEST Bank',
            'amount': -25.50,
            'currency': 'USD',
            'date': today,
            'description': 'Coffee',
            'category': 'Food',
            'pending': False,
            'system_category': None,
            'system_category_auto': None,
            'is_transfer': False,
            'raw': {},
        },
        {
            'user_id': user_id,
            'account_id': 'TEST_acct_iter41',
            'external_id': ext_salary,
            'provider': 'plaid',
            'link_id': 'TEST_link_iter41',
            'org_name': 'TEST Bank',
            'amount': 1200.00,
            'currency': 'USD',
            'date': today,
            'description': 'Salary',
            'category': 'Income',
            'pending': False,
            'system_category': None,
            'system_category_auto': None,
            'is_transfer': False,
            'raw': {},
        },
    ]

    async def _seed():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.bank_transactions.insert_many(docs)
        client.close()

    async def _cleanup():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.bank_transactions.delete_many({'external_id': {'$in': [ext_coffee, ext_salary]}})
        client.close()

    asyncio.run(_seed())
    _seeded_ids.extend([ext_coffee, ext_salary])
    yield {'coffee': ext_coffee, 'salary': ext_salary}
    asyncio.run(_cleanup())


def test_accounts_transactions_returns_seeded_rows(api_client, seeded_txns):
    r = api_client.get(f'{BASE_URL}/api/accounts/transactions?limit=200&include_transfers=true', timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert 'transactions' in body
    txns = body['transactions']
    assert isinstance(txns, list) and len(txns) >= 2

    by_ext = {t.get('external_id'): t for t in txns}
    assert seeded_txns['coffee'] in by_ext, f"coffee row missing: {list(by_ext)[:5]}"
    assert seeded_txns['salary'] in by_ext, f"salary row missing"

    coffee = by_ext[seeded_txns['coffee']]
    salary = by_ext[seeded_txns['salary']]

    # Expected shape: external_id, date, description, amount, org_name
    for row in (coffee, salary):
        for k in ('external_id', 'date', 'description', 'amount', 'org_name'):
            assert k in row, f'{k} missing in row {row}'

    assert coffee['description'] == 'Coffee'
    assert coffee['amount'] == -25.5
    assert coffee['org_name'] == 'TEST Bank'
    assert salary['description'] == 'Salary'
    assert salary['amount'] == 1200.0
    assert salary['org_name'] == 'TEST Bank'
    # date is serialized as ISO string
    assert isinstance(coffee['date'], str)
    assert isinstance(salary['date'], str)


# ---------------------------------------------------------------------------
# 3. Basic /api/accounts/transactions sanity — endpoint stays healthy
# ---------------------------------------------------------------------------
def test_accounts_transactions_endpoint_healthy(api_client):
    r = api_client.get(f'{BASE_URL}/api/accounts/transactions?limit=50', timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert 'transactions' in body
    assert isinstance(body['transactions'], list)
