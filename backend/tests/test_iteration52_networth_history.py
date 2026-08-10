"""Iteration 52 — Net Worth History backend regression.

Covers:
  1. Auth-gate (401 without Bearer).
  2. `?range=month` shape (200, `range`/`days`/`points`/`latest`/`live`).
  3. Auto-backfill of today's snapshot on first fetch (source `auto_backfill`).
  4. Range aliases → days mapping (month=30, quarter=90, year=365, unknown→month).
  5. Same-day snapshot dedupe across repeated `POST /api/plaid/sync`.
  6. Server-side math: net_worth == total_assets - total_liabilities in every point.
  7. `PATCH /api/accounts/{id}` override → snapshot with source `manual_edit`
     (skipped if user has no Plaid accounts — noted in stdout).
  8. Existing endpoints smoke: /auth/login, /auth/me, /accounts/all,
     /plaid/sync, /accounts/transactions.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or 'https://no-changes-mobile.preview.emergentagent.com'
BASE_URL = BASE_URL.rstrip('/')

USER_EMAIL = 'alex+test1@jaleter.app'
USER_PW = 'password123'


# ---------- shared fixtures ----------
@pytest.fixture(scope='module')
def http():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='module')
def token(http):
    r = http.post(f'{BASE_URL}/api/auth/login',
                  json={'email': USER_EMAIL, 'password': USER_PW},
                  timeout=30)
    assert r.status_code == 200, f'login failed: {r.status_code} {r.text}'
    body = r.json()
    assert 'token' in body
    return body['token']


@pytest.fixture(scope='module')
def auth_headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _utc_today() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


# ---------- (1) auth-gate ----------
class TestNetWorthAuth:
    def test_history_requires_auth(self, http):
        r = http.get(f'{BASE_URL}/api/networth/history', timeout=15)
        # FastAPI HTTPBearer returns 403 by default when Authorization is
        # missing; endpoint-level auth failures return 401. Accept either.
        assert r.status_code in (401, 403), f'expected 401/403, got {r.status_code} {r.text}'


# ---------- (2)(3)(6) history shape + backfill + math ----------
class TestNetWorthHistoryMonth:
    def test_month_range_shape_and_autofill(self, http, auth_headers):
        r = http.get(f'{BASE_URL}/api/networth/history?range=month',
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()

        # shape
        for k in ('range', 'days', 'points', 'latest', 'live'):
            assert k in body, f'missing key {k}: {body}'
        assert body['range'] == 'month'
        assert body['days'] == 30
        assert isinstance(body['points'], list)

        # auto-backfill guarantee: after the first call today's row exists
        today = _utc_today()
        today_pts = [p for p in body['points'] if p.get('date_key') == today]
        assert len(today_pts) >= 1, f"expected today's snapshot after auto-backfill, got: {body['points']}"

        # Points ordered ascending by taken_at
        ts = [p['taken_at'] for p in body['points'] if p.get('taken_at')]
        assert ts == sorted(ts), 'points not sorted ascending by taken_at'

        # Server-side math
        for p in body['points']:
            ta = round(float(p['total_assets']), 2)
            tl = round(float(p['total_liabilities']), 2)
            nw = round(float(p['net_worth']), 2)
            assert abs((ta - tl) - nw) < 0.01, f'net_worth math wrong for point {p}'

        # latest matches last point
        if body['points']:
            assert body['latest'] == body['points'][-1]

        # live is a dict with the same math
        assert isinstance(body['live'], dict)
        live = body['live']
        for k in ('total_assets', 'total_liabilities', 'net_worth'):
            assert k in live
        assert abs((float(live['total_assets']) - float(live['total_liabilities'])) - float(live['net_worth'])) < 0.01


# ---------- (4) range aliases ----------
class TestNetWorthHistoryRanges:
    @pytest.mark.parametrize('rng,expected_days,expected_range', [
        ('month', 30, 'month'),
        ('quarter', 90, 'quarter'),
        ('year', 365, 'year'),
        ('bogus', 30, 'month'),      # unknown falls back to month
        ('', 30, 'month'),           # empty string falls back to month
        ('YEAR', 365, 'year'),       # case-insensitive per server code
    ])
    def test_range_days_mapping(self, http, auth_headers, rng, expected_days, expected_range):
        r = http.get(f'{BASE_URL}/api/networth/history',
                     params={'range': rng}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['range'] == expected_range, f'range mismatch for {rng!r}: {body["range"]}'
        assert body['days'] == expected_days, f'days mismatch for {rng!r}: {body["days"]}'


# ---------- (5) plaid/sync dedupe ----------
class TestPlaidSyncDedupe:
    def test_multiple_syncs_produce_one_today_row(self, http, auth_headers):
        # Two consecutive syncs must not create two rows for today.
        for _ in range(2):
            r = http.post(f'{BASE_URL}/api/plaid/sync', headers=auth_headers, timeout=45)
            # 200 either way; zero-linked user still returns success payload
            assert r.status_code == 200, r.text

        r = http.get(f'{BASE_URL}/api/networth/history?range=month',
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        today = _utc_today()
        today_pts = [p for p in body['points'] if p.get('date_key') == today]
        assert len(today_pts) == 1, f"dedupe failed: expected 1 today row, got {len(today_pts)}: {today_pts}"


# ---------- (7) manual_edit snapshot via override ----------
class TestOverrideSnapshot:
    def test_override_creates_manual_edit_snapshot(self, http, auth_headers):
        # Fetch Plaid-linked accounts. If none, skip gracefully.
        r = http.get(f'{BASE_URL}/api/accounts/all', headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        accounts = body.get('accounts', []) if isinstance(body, dict) else []
        # Try to find a Plaid account by provider/source hint.
        plaid_accts = [
            a for a in accounts
            if (str(a.get('provider') or a.get('source') or '')).lower() == 'plaid'
            or a.get('plaid_account_id')
            or a.get('item_id')
        ]
        if not plaid_accts:
            pytest.skip('No Plaid-linked accounts for this test user — override step skipped.')
        acct = plaid_accts[0]
        acct_id = acct.get('account_id') or acct.get('id')
        assert acct_id, f'no account_id in account row: {acct}'

        # Apply override
        patch = http.patch(
            f'{BASE_URL}/api/accounts/{acct_id}',
            json={'balance_override': 12345.67},
            headers=auth_headers,
            timeout=30,
        )
        assert patch.status_code in (200, 204), f'PATCH failed: {patch.status_code} {patch.text}'

        # Verify today's snapshot flipped to source=manual_edit
        r = http.get(f'{BASE_URL}/api/networth/history?range=month',
                     headers=auth_headers, timeout=30)
        body = r.json()
        today = _utc_today()
        today_pts = [p for p in body['points'] if p.get('date_key') == today]
        assert len(today_pts) == 1
        assert today_pts[0]['source'] == 'manual_edit', f"expected source manual_edit, got {today_pts[0]}"

        # Clean up
        http.delete(f'{BASE_URL}/api/accounts/{acct_id}/override',
                    headers=auth_headers, timeout=30)


# ---------- (8) existing endpoints smoke ----------
class TestExistingEndpointsRegression:
    def test_auth_me(self, http, auth_headers):
        r = http.get(f'{BASE_URL}/api/auth/me', headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get('email') == USER_EMAIL

    def test_accounts_all(self, http, auth_headers):
        r = http.get(f'{BASE_URL}/api/accounts/all', headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert 'accounts' in r.json()

    def test_plaid_sync(self, http, auth_headers):
        r = http.post(f'{BASE_URL}/api/plaid/sync', headers=auth_headers, timeout=45)
        assert r.status_code == 200, r.text

    def test_accounts_transactions(self, http, auth_headers):
        r = http.get(f'{BASE_URL}/api/accounts/transactions?limit=10',
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
