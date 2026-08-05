"""Iteration 27 backend tests — Plaid switched to PRODUCTION env.

Verifies:
- /api/plaid/status now reports env=production with products=[transactions] only.
- /api/plaid/link-token returns a live link-production-* token.
- Regression: /api/support/tickets (general) still creates a ticket.
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    'EXPO_PUBLIC_BACKEND_URL',
    'https://no-changes-mobile.preview.emergentagent.com',
).rstrip('/')
API = f'{BASE_URL}/api'

USER_EMAIL = 'alex+test1@jaleter.app'
USER_PASSWORD = 'password123'
USER_NAME = 'Alex Ward'


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


@pytest.fixture(scope='session')
def fresh_user_token(http):
    """A brand-new registration, as the review explicitly asks."""
    email = f'TEST_plaid_{uuid.uuid4().hex[:10]}@jaleter.app'
    r = http.post(f'{API}/auth/register', json={'name': 'TEST Plaid User', 'email': email, 'password': 'password123'})
    assert r.status_code == 200, f'register failed: {r.status_code} {r.text}'
    return r.json()['token']


# ---- 1) /api/plaid/status now = production ---------------------------------
class TestPlaidStatusProduction:
    def test_status_reports_production(self, http):
        r = http.get(f'{API}/plaid/status')
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get('configured') is True, f'expected configured=true, got {data}'
        assert data.get('env') == 'production', f'expected env=production, got {data.get("env")!r}'
        products = data.get('products') or []
        assert products == ['transactions'], f'expected products=[transactions], got {products}'
        # auth must be gone since user's Plaid production account is not enabled for it.
        assert 'auth' not in products, f'auth should be removed from products, got {products}'
        cc = data.get('country_codes') or []
        assert 'US' in cc, f'expected US in country_codes, got {cc}'


# ---- 2) /api/plaid/link-token returns link-production-* --------------------
class TestPlaidLinkTokenProduction:
    def test_link_token_is_production(self, http, fresh_user_token):
        r = http.post(f'{API}/plaid/link-token', headers=_h(fresh_user_token), json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'link_token' in data, data
        lt = data['link_token']
        assert lt.startswith('link-production-'), (
            f'expected link-production- prefix, got: {lt!r}'
        )

    def test_link_token_requires_auth(self, http):
        r = http.post(f'{API}/plaid/link-token', json={})
        assert r.status_code in (401, 403), r.text

    def test_link_token_with_existing_user(self, http, user_token):
        # sanity: alex account also gets a production link token
        r = http.post(f'{API}/plaid/link-token', headers=_h(user_token), json={})
        assert r.status_code == 200, r.text
        assert r.json()['link_token'].startswith('link-production-')


# ---- 3) Regression: /api/support/tickets still works -----------------------
class TestSupportRegression:
    def test_create_general_ticket(self, http, user_token):
        payload = {
            'category': 'general',
            'subject': 'TEST_iter27 regression check',
            'description': 'Verifying support tickets still work after Plaid prod switch.',
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code in (200, 201), f'{r.status_code} {r.text}'
        data = r.json()
        # ticket id/reference field naming varies — accept common shapes
        ticket_id = (
            data.get('id')
            or data.get('ticket_id')
            or (data.get('ticket') or {}).get('id')
            or (data.get('ticket') or {}).get('ticket_id')
        )
        assert ticket_id, f'expected a ticket id in response, got {data}'
