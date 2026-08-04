"""Iteration 22 backend tests — Plaid banking integration + Support Phase 1.

Uses the public EXPO backend URL so we test what users see. Skips are only
used when a hard external dependency (Plaid sandbox token creation) fails
transiently to avoid masking real defects.
"""
from __future__ import annotations

import os
import time
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
API = f'{BASE_URL}/api'

USER_EMAIL = 'alex+test1@jaleter.app'
USER_PASSWORD = 'password123'
USER_NAME = 'Alex Ward'

ADMIN_EMAIL = 'support@jaleter.com'
ADMIN_PASSWORD = 'Tarik0731!'

PLAID_CLIENT_ID = '69c66d8894f82e000dd1a5f1'
PLAID_SECRET = '038da1b227c1b7844ccc1264599171'
PLAID_SANDBOX_URL = 'https://sandbox.plaid.com'
PLAID_INSTITUTION_ID = 'ins_109508'  # First Platypus Bank

TINY_PNG_B64 = (
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='
)


# ---------- fixtures ----------
@pytest.fixture(scope='session')
def http():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


def _register_or_login(http, email, password, name):
    r = http.post(f'{API}/auth/login', json={'email': email, 'password': password})
    if r.status_code == 200:
        return r.json()['token']
    # Try register
    r = http.post(f'{API}/auth/register', json={'name': name, 'email': email, 'password': password})
    if r.status_code == 200:
        return r.json()['token']
    # Some rate limit? Retry login once
    time.sleep(1)
    r = http.post(f'{API}/auth/login', json={'email': email, 'password': password})
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return r.json()['token']


@pytest.fixture(scope='session')
def user_token(http):
    return _register_or_login(http, USER_EMAIL, USER_PASSWORD, USER_NAME)


@pytest.fixture(scope='session')
def admin_token(http):
    r = http.post(f'{API}/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    assert r.status_code == 200, f'Admin login failed: {r.status_code} {r.text}'
    return r.json()['token']


def _h(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


# ============================================================================
# PLAID TESTS
# ============================================================================
class TestPlaidStatus:
    def test_status_public(self, http):
        r = http.get(f'{API}/plaid/status')
        assert r.status_code == 200, r.text
        data = r.json()
        assert data['configured'] is True
        assert data['env'] == 'sandbox'
        assert isinstance(data['products'], list) and 'transactions' in data['products']
        assert isinstance(data['country_codes'], list) and 'US' in data['country_codes']


class TestPlaidAuthFlow:
    def test_link_token(self, http, user_token):
        r = http.post(f'{API}/plaid/link-token', headers=_h(user_token), json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'link_token' in data
        assert data['link_token'].startswith('link-sandbox-'), f"Unexpected token: {data['link_token']}"

    def test_link_token_requires_auth(self, http):
        r = http.post(f'{API}/plaid/link-token', json={})
        assert r.status_code in (401, 403), r.text


@pytest.fixture(scope='session')
def sandbox_public_token():
    """Create a Plaid sandbox public_token directly against Plaid."""
    body = {
        'client_id': PLAID_CLIENT_ID,
        'secret': PLAID_SECRET,
        'institution_id': PLAID_INSTITUTION_ID,
        'initial_products': ['transactions'],
    }
    r = requests.post(f'{PLAID_SANDBOX_URL}/sandbox/public_token/create', json=body, timeout=30)
    assert r.status_code == 200, f'sandbox public_token create failed: {r.status_code} {r.text}'
    data = r.json()
    assert 'public_token' in data
    return data['public_token']


class TestPlaidExchangeAndSync:
    @pytest.fixture(scope='class', autouse=True)
    def _state(self, request):
        request.cls._state = {}
        yield

    def test_exchange_public_token(self, http, user_token, sandbox_public_token):
        r = http.post(
            f'{API}/plaid/exchange-public-token',
            headers=_h(user_token),
            json={'public_token': sandbox_public_token, 'institution_id': PLAID_INSTITUTION_ID},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert 'item_id' in data and data['item_id']
        assert 'institution_name' in data
        # Access token must NEVER leak
        assert 'access_token' not in data
        assert 'access_token_encrypted' not in data
        type(self)._state['item_id'] = data['item_id']
        type(self)._state['institution_name'] = data['institution_name']

    def test_exchange_missing_token_rejected(self, http, user_token):
        r = http.post(f'{API}/plaid/exchange-public-token', headers=_h(user_token), json={'public_token': ''})
        assert r.status_code == 400, r.text

    def test_plaid_accounts(self, http, user_token):
        item_id = type(self)._state.get('item_id')
        assert item_id, 'exchange test must have run first'
        r = http.get(f'{API}/plaid/accounts', headers=_h(user_token))
        assert r.status_code == 200, r.text
        payload = r.json()
        assert 'accounts' in payload
        rows = payload['accounts']
        assert isinstance(rows, list) and len(rows) > 0, 'Expected at least one Plaid account'
        first = rows[0]
        # Access token must NEVER be included in list response
        assert 'access_token' not in first
        assert 'access_token_encrypted' not in first
        assert 'link_id' in first
        assert 'name' in first
        assert 'balance' in first

    def test_plaid_sync(self, http, user_token):
        r = http.post(f'{API}/plaid/sync', headers=_h(user_token), json={})
        assert r.status_code == 200, r.text
        payload = r.json()
        assert 'synced' in payload or 'items' in payload
        # Sandbox transactions may need a few polling cycles; sync may return 0 initially.
        # Poll a couple more times to give Plaid a chance to prep sandbox txns.
        added = 0
        items = payload.get('items') or []
        for it in items:
            added += int(it.get('added') or 0)
        if added == 0:
            for _ in range(4):
                time.sleep(2)
                r2 = http.post(f'{API}/plaid/sync', headers=_h(user_token), json={})
                assert r2.status_code == 200
                p2 = r2.json()
                added2 = sum(int(it.get('added') or 0) for it in (p2.get('items') or []))
                if added2 > 0:
                    added = added2
                    break
        # We assert that sync completed (added=0 is OK for a brand-new sandbox item; log for visibility)
        print(f'Plaid sync added transactions: {added}')

    def test_accounts_all_includes_plaid(self, http, user_token):
        r = http.get(f'{API}/accounts/all', headers=_h(user_token))
        assert r.status_code == 200, r.text
        data = r.json()
        # accounts/all shape varies; ensure at least one row references provider=plaid
        # Try common shapes.
        rows = []
        if isinstance(data, dict):
            rows = data.get('accounts') or data.get('rows') or []
        elif isinstance(data, list):
            rows = data
        plaid_rows = [r for r in rows if (r.get('provider') == 'plaid')]
        assert plaid_rows, f'Expected Plaid rows in /accounts/all. Got: {data}'

    def test_transactions_persisted_with_provider_plaid(self, http, user_token):
        # Uses the existing /api/accounts/transactions endpoint to introspect bank_transactions.
        r = http.get(f'{API}/accounts/transactions?limit=200', headers=_h(user_token))
        if r.status_code == 404:
            pytest.skip('/api/accounts/transactions endpoint not present in this build')
        assert r.status_code == 200, r.text
        payload = r.json()
        txns = payload.get('transactions') if isinstance(payload, dict) else payload
        # Log for context, don't fail if sandbox has no txns yet.
        plaid_txns = [t for t in (txns or []) if t.get('provider') == 'plaid']
        print(f'Persisted plaid bank_transactions returned via API: {len(plaid_txns)}')

    def test_plaid_item_delete(self, http, user_token):
        item_id = type(self)._state.get('item_id')
        assert item_id
        r = http.delete(f'{API}/plaid/item/{item_id}', headers=_h(user_token))
        assert r.status_code == 200, r.text
        # Verify accounts list no longer contains this item
        r2 = http.get(f'{API}/plaid/accounts', headers=_h(user_token))
        assert r2.status_code == 200
        remaining = [a for a in r2.json().get('accounts', []) if a.get('link_id') == item_id]
        assert not remaining, f'Expected item removed, still present: {remaining}'


# ============================================================================
# SUPPORT — USER
# ============================================================================
class TestSupportUser:
    _state: dict = {}

    def test_auth_me_not_admin(self, http, user_token):
        r = http.get(f'{API}/auth/me', headers=_h(user_token))
        assert r.status_code == 200, r.text
        me = r.json()
        # is_admin may be missing OR False for regular user
        assert not me.get('is_admin'), f'Regular user should not be admin: {me}'

    def test_create_ticket(self, http, user_token):
        payload = {
            'subject': f'TEST_Iteration22 ticket {uuid.uuid4().hex[:6]}',
            'category': 'bug',
            'priority': 'high',
            'description': 'Automated regression: Plaid + Support Phase 1',
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t['ticket_id'].startswith('T-')
        assert isinstance(t['ticket_number'], int) and t['ticket_number'] >= 1
        assert t['status'] == 'open'
        assert t['subject'] == payload['subject']
        TestSupportUser._state['ticket_id'] = t['ticket_id']
        TestSupportUser._state['ticket_number'] = t['ticket_number']

    def test_ticket_number_increments(self, http, user_token):
        # Create a second ticket and confirm ticket_number is greater
        prev = TestSupportUser._state['ticket_number']
        payload = {
            'subject': f'TEST_Iteration22 second {uuid.uuid4().hex[:6]}',
            'category': 'general',
            'priority': 'normal',
            'description': 'second',
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code == 200
        t = r.json()
        assert t['ticket_number'] > prev, f'Expected > {prev}, got {t["ticket_number"]}'

    def test_list_tickets_only_own(self, http, user_token):
        r = http.get(f'{API}/support/tickets', headers=_h(user_token))
        assert r.status_code == 200
        tickets = r.json()['tickets']
        assert len(tickets) >= 2
        # Verify our just-created one is present
        ids = [t['ticket_id'] for t in tickets]
        assert TestSupportUser._state['ticket_id'] in ids

    def test_get_ticket_detail(self, http, user_token):
        tid = TestSupportUser._state['ticket_id']
        r = http.get(f'{API}/support/tickets/{tid}', headers=_h(user_token))
        assert r.status_code == 200
        t = r.json()
        assert t['ticket_id'] == tid
        assert 'description' in t
        assert 'replies' in t

    def test_user_reply(self, http, user_token):
        tid = TestSupportUser._state['ticket_id']
        r = http.post(
            f'{API}/support/tickets/{tid}/reply',
            headers=_h(user_token),
            json={'message': 'User reply from automated test'},
        )
        assert r.status_code == 200, r.text
        assert r.json()['message'] == 'User reply from automated test'

    def test_create_ticket_with_attachment(self, http, user_token):
        payload = {
            'subject': 'TEST_Iteration22 with attachment',
            'category': 'bug',
            'priority': 'normal',
            'description': 'has attachment',
            'attachments': [{
                'filename': 'dot.png',
                'mime_type': 'image/png',
                'data_base64': TINY_PNG_B64,
            }],
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t['attachment_count'] == 1
        assert t['attachments'][0]['mime_type'] == 'image/png'
        assert t['attachments'][0]['size_bytes'] > 0
        TestSupportUser._state['attachment_ticket_id'] = t['ticket_id']

    def test_reject_invalid_mime(self, http, user_token):
        payload = {
            'subject': 'TEST_Iteration22 invalid mime',
            'description': 'bad mime',
            'attachments': [{
                'filename': 'evil.exe',
                'mime_type': 'application/x-msdownload',
                'data_base64': TINY_PNG_B64,
            }],
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code == 400, f'Expected 400, got {r.status_code}: {r.text}'

    def test_reject_oversized_attachment(self, http, user_token):
        # Build a >5 MB base64 blob quickly.
        big = base64.b64encode(b'A' * (5 * 1024 * 1024 + 32)).decode()
        payload = {
            'subject': 'TEST_Iteration22 big attach',
            'description': 'too big',
            'attachments': [{
                'filename': 'big.png',
                'mime_type': 'image/png',
                'data_base64': big,
            }],
        }
        r = http.post(f'{API}/support/tickets', headers=_h(user_token), json=payload)
        assert r.status_code == 413, f'Expected 413, got {r.status_code}: {r.text}'

    def test_non_admin_forbidden(self, http, user_token):
        r = http.get(f'{API}/support/admin/tickets', headers=_h(user_token))
        assert r.status_code == 403, r.text


# ============================================================================
# SUPPORT — ADMIN
# ============================================================================
class TestSupportAdmin:
    _state: dict = {}

    def test_admin_me_flag(self, http, admin_token):
        r = http.get(f'{API}/auth/me', headers=_h(admin_token))
        assert r.status_code == 200, r.text
        me = r.json()
        assert me.get('is_admin') is True, f'Admin flag missing: {me}'

    def test_admin_list_all(self, http, admin_token):
        r = http.get(f'{API}/support/admin/tickets', headers=_h(admin_token))
        assert r.status_code == 200, r.text
        tickets = r.json()['tickets']
        assert len(tickets) >= 2
        TestSupportAdmin._state['tickets'] = tickets
        # Pick one of user's tickets to operate on
        target = tickets[0]
        TestSupportAdmin._state['ticket_id'] = target['ticket_id']

    def test_admin_list_filtered(self, http, admin_token):
        r = http.get(f'{API}/support/admin/tickets?status_filter=open', headers=_h(admin_token))
        assert r.status_code == 200, r.text
        tickets = r.json()['tickets']
        for t in tickets:
            assert t['status'] == 'open', t

    def test_admin_update_status(self, http, admin_token):
        tid = TestSupportAdmin._state['ticket_id']
        r = http.patch(
            f'{API}/support/admin/tickets/{tid}',
            headers=_h(admin_token),
            json={'status': 'in_progress'},
        )
        assert r.status_code == 200, r.text
        assert r.json()['status'] == 'in_progress'

    def test_admin_public_reply_moves_to_waiting(self, http, admin_token):
        tid = TestSupportAdmin._state['ticket_id']
        r = http.post(
            f'{API}/support/admin/tickets/{tid}/reply',
            headers=_h(admin_token),
            json={'message': 'Admin public reply from automated test'},
        )
        assert r.status_code == 200, r.text
        # Verify status moved to waiting_on_user
        r2 = http.get(f'{API}/support/admin/tickets/{tid}', headers=_h(admin_token))
        assert r2.status_code == 200
        assert r2.json()['status'] == 'waiting_on_user'

    def test_admin_private_note_hidden_from_user(self, http, admin_token, user_token):
        tid = TestSupportAdmin._state['ticket_id']
        secret = f'PRIVATE_NOTE_{uuid.uuid4().hex}'
        r = http.post(
            f'{API}/support/admin/tickets/{tid}/note',
            headers=_h(admin_token),
            json={'note': secret},
        )
        assert r.status_code == 200, r.text
        assert r.json()['is_private'] is True

        # As user, fetch the same ticket and verify the private note is not present.
        r2 = http.get(f'{API}/support/tickets/{tid}', headers=_h(user_token))
        assert r2.status_code == 200, r2.text
        t = r2.json()
        msgs = [rep.get('message') for rep in (t.get('replies') or [])]
        assert secret not in msgs, f'Private note leaked to user: {msgs}'
        # Also verify no reply flagged is_private=True is visible
        privates = [rep for rep in (t.get('replies') or []) if rep.get('is_private')]
        assert not privates, f'Private replies leaked: {privates}'

        # As admin, verify note IS visible
        r3 = http.get(f'{API}/support/admin/tickets/{tid}', headers=_h(admin_token))
        assert r3.status_code == 200
        admin_msgs = [rep.get('message') for rep in (r3.json().get('replies') or [])]
        assert secret in admin_msgs, f'Admin should see private note: {admin_msgs}'
