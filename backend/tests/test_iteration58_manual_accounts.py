"""Iteration 58 - Phase 3 Manual Wealth Accounts backend test suite.

Covers:
- Auth guard on POST /api/accounts/manual
- Create, invalid category, list in /api/accounts/all
- Patch (update), liability normalization
- Net worth snapshot persistence
- Delete + delete non-existent (404)
- Regression: /api/plaid/sync, /api/networth/history, /api/accounts/all, /api/auth/me
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
if not BASE_URL:
    # Fallback: read from frontend/.env
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    BASE_URL = line.strip().split('=', 1)[1]
                    break
    except Exception:
        pass
BASE_URL = (BASE_URL or '').rstrip('/')

EMAIL = 'alex+test1@jaleter.app'
PASSWORD = 'password123'


@pytest.fixture(scope='module')
def token():
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': EMAIL, 'password': PASSWORD}, timeout=15)
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return r.json()['token']


@pytest.fixture(scope='module')
def hdr(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


@pytest.fixture(scope='module')
def created_ids():
    # Track created ids so we can clean up
    return {'cash': None, 'cc': None}


# 1. Auth guard
def test_01_manual_create_requires_auth():
    r = requests.post(f'{BASE_URL}/api/accounts/manual', json={'category': 'cash', 'name': 'Nope', 'balance': 1}, timeout=15)
    assert r.status_code in (401, 403), f'Expected 401/403, got {r.status_code}: {r.text}'


# 2. Create manual cash account
def test_02_create_cash_manual(hdr, created_ids):
    r = requests.post(
        f'{BASE_URL}/api/accounts/manual',
        headers=hdr,
        json={'category': 'cash', 'name': 'Emergency fund', 'balance': 5000, 'institution': 'Ally Bank'},
        timeout=15,
    )
    assert r.status_code == 200, f'{r.status_code}: {r.text}'
    data = r.json()
    assert data.get('ok') is True
    acc = data['account']
    assert acc['category'] == 'cash'
    assert acc['name'] == 'Emergency fund'
    assert float(acc['balance']) == 5000.0
    assert acc['provider'] == 'manual'
    assert acc['status'] == 'Manual'
    assert acc['is_asset'] is True
    assert acc['is_liability'] is False
    assert acc.get('id')
    created_ids['cash'] = acc['id']


# 3. Invalid category
def test_03_invalid_category(hdr):
    r = requests.post(
        f'{BASE_URL}/api/accounts/manual', headers=hdr,
        json={'category': 'bogus', 'name': 'X', 'balance': 1}, timeout=15,
    )
    assert r.status_code == 400, f'Expected 400 got {r.status_code}: {r.text}'
    body = r.json()
    detail = str(body.get('detail', '')).lower()
    assert 'unknown category' in detail or 'bogus' in detail


# 4. Verify in /api/accounts/all
def test_04_accounts_all_contains_manual(hdr, created_ids):
    assert created_ids['cash'], 'cash account not created'
    r = requests.get(f'{BASE_URL}/api/accounts/all', headers=hdr, timeout=20)
    assert r.status_code == 200
    accounts = r.json().get('accounts', [])
    match = next((a for a in accounts if a.get('id') == created_ids['cash']), None)
    assert match is not None, 'Manual account not found in /accounts/all'
    assert match['provider'] == 'manual'
    assert match['category'] == 'cash'
    assert match['name'] == 'Emergency fund'
    assert float(match['balance']) == 5000.0
    assert match['status'] == 'Manual'


# 5. Patch (update)
def test_05_patch_manual(hdr, created_ids):
    aid = created_ids['cash']
    r = requests.patch(
        f'{BASE_URL}/api/accounts/manual/{aid}', headers=hdr,
        json={'balance': 5250, 'name': 'Emergency fund (Ally)'}, timeout=15,
    )
    assert r.status_code == 200, f'{r.status_code}: {r.text}'
    acc = r.json()['account']
    assert acc['name'] == 'Emergency fund (Ally)'
    assert float(acc['balance']) == 5250.0
    # verify via GET all
    r2 = requests.get(f'{BASE_URL}/api/accounts/all', headers=hdr, timeout=20)
    assert r2.status_code == 200
    match = next((a for a in r2.json()['accounts'] if a.get('id') == aid), None)
    assert match is not None
    assert float(match['balance']) == 5250.0
    assert match['name'] == 'Emergency fund (Ally)'


# 6. Create liability - balance magnitude
def test_06_create_liability_normalises(hdr, created_ids):
    r = requests.post(
        f'{BASE_URL}/api/accounts/manual', headers=hdr,
        json={'category': 'credit_cards', 'name': 'Amex Gold', 'balance': -1200}, timeout=15,
    )
    assert r.status_code == 200, f'{r.status_code}: {r.text}'
    acc = r.json()['account']
    assert acc['category'] == 'credit_cards'
    assert float(acc['balance']) == 1200.0, f"Expected positive magnitude 1200, got {acc['balance']}"
    assert acc['is_liability'] is True
    assert acc['is_asset'] is False
    created_ids['cc'] = acc['id']


# 7. Net Worth snapshot includes manual
def test_07_networth_snapshot_updated(hdr, created_ids):
    r = requests.get(f'{BASE_URL}/api/networth/history?range=month', headers=hdr, timeout=20)
    assert r.status_code == 200, f'{r.status_code}: {r.text}'
    data = r.json()
    # Response likely contains snapshots list
    snaps = data.get('snapshots') or data.get('history') or data.get('points') or []
    assert isinstance(snaps, list) and len(snaps) > 0, f'No snapshots returned: {data}'
    # Latest snapshot last in list (usually)
    latest = snaps[-1]
    src = str(latest.get('source', ''))
    # Accept manual_account OR auto_backfill (spec says either OK)
    assert src in ('manual_account', 'manual_edit', 'auto_backfill', 'plaid_sync', ''), f'Unexpected source: {src}'
    # Totals should reflect the manual accounts
    total_assets = float(latest.get('total_assets', 0) or 0)
    total_liab = float(latest.get('total_liabilities', 0) or 0)
    assert total_assets >= 5250.0, f'total_assets={total_assets} should include manual $5250'
    assert total_liab >= 1200.0, f'total_liabilities={total_liab} should include manual $1200'


# 8. Delete existing
def test_08_delete_cash(hdr, created_ids):
    aid = created_ids['cash']
    r = requests.delete(f'{BASE_URL}/api/accounts/manual/{aid}', headers=hdr, timeout=15)
    assert r.status_code == 200, f'{r.status_code}: {r.text}'
    assert r.json().get('ok') is True
    # Verify no longer present
    r2 = requests.get(f'{BASE_URL}/api/accounts/all', headers=hdr, timeout=20)
    assert r2.status_code == 200
    assert not any(a.get('id') == aid for a in r2.json()['accounts'])


# 9. Delete non-existent -> 404
def test_09_delete_nonexistent(hdr):
    r = requests.delete(f'{BASE_URL}/api/accounts/manual/bogus-uuid-1234', headers=hdr, timeout=15)
    assert r.status_code == 404, f'{r.status_code}: {r.text}'


# 10. Regression: other endpoints still healthy
def test_10a_regression_auth_me(hdr):
    r = requests.get(f'{BASE_URL}/api/auth/me', headers=hdr, timeout=15)
    assert r.status_code == 200
    assert r.json().get('email') == EMAIL


def test_10b_regression_plaid_sync(hdr):
    r = requests.post(f'{BASE_URL}/api/plaid/sync', headers=hdr, timeout=30)
    assert r.status_code == 200, f'{r.status_code}: {r.text}'


def test_10c_regression_networth_history(hdr):
    r = requests.get(f'{BASE_URL}/api/networth/history', headers=hdr, timeout=20)
    assert r.status_code == 200


def test_10d_regression_accounts_all(hdr):
    r = requests.get(f'{BASE_URL}/api/accounts/all', headers=hdr, timeout=20)
    assert r.status_code == 200


# Cleanup - delete the CC row we created too
def test_99_cleanup_liability(hdr, created_ids):
    if created_ids.get('cc'):
        r = requests.delete(f'{BASE_URL}/api/accounts/manual/{created_ids["cc"]}', headers=hdr, timeout=15)
        assert r.status_code == 200
