"""Phase 1 regression — Jaleter spec fixes #1, #8, #9, #10, #11, #12, #13, #18.

Backend scope (per review request):
1. GET /api/accounts/all → 200; last_sync_at must be null or ISO string ending in +00:00 / Z.
2. GET /api/accounts/transactions?limit=5&include_transfers=true → 200; row shape preserved.
3. GET /api/networth/history?range=month → 200; points array present.
4. POST /api/plaid/sync → 200 (or non-500 error if no linked accounts).
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/') if os.environ.get('EXPO_PUBLIC_BACKEND_URL') else None
# Fall back to backend .env public URL
if not BASE_URL:
    # Read the same URL the app frontend uses
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
                break

TEST_EMAIL = 'alex+test1@jaleter.app'
TEST_PASSWORD = 'password123'

ISO_UTC_RE = re.compile(r'.*(\+00:00|Z)$')


@pytest.fixture(scope='module')
def api_client():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='module')
def auth_token(api_client):
    resp = api_client.post(f'{BASE_URL}/api/auth/login', json={
        'email': TEST_EMAIL,
        'password': TEST_PASSWORD,
    }, timeout=15)
    assert resp.status_code == 200, f'login failed: {resp.status_code} {resp.text}'
    token = resp.json().get('token')
    assert token, 'no token in login response'
    return token


@pytest.fixture(scope='module')
def auth_headers(auth_token):
    return {'Authorization': f'Bearer {auth_token}', 'Content-Type': 'application/json'}


# ---------- #8 Timezone / last_sync_at ----------
def test_accounts_all_last_sync_tz(api_client, auth_headers):
    resp = api_client.get(f'{BASE_URL}/api/accounts/all', headers=auth_headers, timeout=20)
    assert resp.status_code == 200, f'expected 200, got {resp.status_code}: {resp.text[:200]}'
    data = resp.json()
    # Accept both shapes: dict with 'accounts' key or bare list
    accounts = data.get('accounts') if isinstance(data, dict) else data
    assert isinstance(accounts, list), f'accounts field not list: {type(accounts)}'
    print(f'\n[#8] /api/accounts/all → 200, {len(accounts)} account(s)')
    if not accounts:
        print('[#8] No linked accounts — skipping last_sync_at assertion')
        pytest.skip('no linked accounts to verify last_sync_at')
    tz_ok_count = 0
    null_count = 0
    for a in accounts:
        lsa = a.get('last_sync_at')
        print(f"  - {a.get('org_name','?')} / {a.get('name','?')} last_sync_at = {lsa!r}")
        if lsa is None:
            null_count += 1
            continue
        assert isinstance(lsa, str), f'last_sync_at not str: {lsa!r}'
        assert ISO_UTC_RE.match(lsa), f'last_sync_at missing +00:00/Z suffix: {lsa!r}'
        tz_ok_count += 1
    # Report
    print(f'[#8] tz-aware ISO count={tz_ok_count}, null count={null_count}')
    assert tz_ok_count + null_count == len(accounts)


# ---------- Transaction shape preserved ----------
def test_accounts_transactions_shape(api_client, auth_headers):
    resp = api_client.get(
        f'{BASE_URL}/api/accounts/transactions?limit=5&include_transfers=true',
        headers=auth_headers, timeout=20,
    )
    assert resp.status_code == 200, f'expected 200, got {resp.status_code}: {resp.text[:200]}'
    data = resp.json()
    txns = data.get('transactions') if isinstance(data, dict) else data
    assert isinstance(txns, list), f'transactions not list: {type(txns)}'
    print(f'\n[shape] /api/accounts/transactions → 200, {len(txns)} rows')
    required = {'date', 'external_id', 'org_name', 'system_category', 'is_transfer', 'amount'}
    if not txns:
        print('[shape] no rows — skipping field check')
        pytest.skip('no bank transactions')
    for row in txns[:5]:
        missing = required - set(row.keys())
        assert not missing, f'row missing fields {missing}: {row}'
        # ISO date shape check
        assert isinstance(row['amount'], (int, float)), f"amount not numeric: {row['amount']!r}"
        assert isinstance(row['is_transfer'], bool), f"is_transfer not bool: {row['is_transfer']!r}"
    print('[shape] all required fields present')


# ---------- Networth history regression ----------
def test_networth_history_month(api_client, auth_headers):
    resp = api_client.get(f'{BASE_URL}/api/networth/history?range=month', headers=auth_headers, timeout=20)
    assert resp.status_code == 200, f'expected 200, got {resp.status_code}: {resp.text[:200]}'
    data = resp.json()
    assert 'points' in data, f'no points key: {list(data.keys())}'
    assert isinstance(data['points'], list)
    print(f"\n[networth] range=month → 200, {len(data['points'])} points")


# ---------- Plaid sync no 500 ----------
def test_plaid_sync_no_500(api_client, auth_headers):
    resp = api_client.post(f'{BASE_URL}/api/plaid/sync', headers=auth_headers, json={}, timeout=30)
    assert resp.status_code != 500, f'plaid/sync 500! body: {resp.text[:400]}'
    # 200 (or 400/404 if no linked accounts) all acceptable — just no 500
    print(f'\n[plaid] /api/plaid/sync → {resp.status_code}')
    if resp.status_code == 200:
        body = resp.json()
        print(f'  synced={body.get("synced")} errors={body.get("errors")}')
