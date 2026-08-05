"""Pre-launch backend security verification (iteration 31).

Covers:
  1. Rate limits (login 5/min, register 10/min, forgot-password 3/min,
     reset-password 5/min, resend-verification 3/min).
  2. Email-verification flow (register → dev token → verify → reuse → invalid → resend).
  3. Account deletion cascade (support tickets, plaid_items, bank_transactions,
     linked_accounts, sessions, password_resets, email_verifications).
  4. Plaid cascade delete on unlink.
  5. Regression: auth (login/register/reset/me), support tickets, plaid status/link-token.

MongoDB is used directly to seed fake plaid_items / bank_transactions rows,
so tests never call live Plaid endpoints. Rate-limit tests run LAST (they burn
per-IP slots) and use dedicated endpoints where possible.
"""

import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
if not BASE_URL:
    # Fall back to the frontend .env file (production preview URL)
    with open('/app/frontend/.env') as _f:
        for _line in _f:
            if _line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                BASE_URL = _line.strip().split('=', 1)[1].strip('"')
                break
BASE_URL = (BASE_URL or '').rstrip('/')
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get('MONGO_URL') or 'mongodb://localhost:27017'
DB_NAME = os.environ.get('DB_NAME') or 'test_database'
# Fall back to reading backend .env when env not injected here.
if not os.environ.get('MONGO_URL'):
    with open('/app/backend/.env') as _f:
        for _line in _f:
            if _line.startswith('MONGO_URL='):
                MONGO_URL = _line.strip().split('=', 1)[1].strip('"')
            elif _line.startswith('DB_NAME='):
                DB_NAME = _line.strip().split('=', 1)[1].strip('"')

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]

# Shared state across ordered tests (pytest module does not allow arbitrary attrs
# on newer Python; use a plain dict).
STATE: dict = {}


# --------------------------------------------------------------------------- helpers
def _uniq_email(tag: str) -> str:
    return f"TEST_{tag}_{uuid.uuid4().hex[:10]}@jaleter.app"


def _register(session: requests.Session, tag: str, password: str = 'Passw0rd!'):
    email = _uniq_email(tag)
    r = session.post(f"{API}/auth/register", json={
        'name': f'Test {tag}',
        'email': email,
        'password': password,
    })
    return r, email


def _auth_headers(token: str) -> dict:
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


@pytest.fixture(scope='module')
def s():
    return requests.Session()


# =========================================================================== 0. Sanity
def test_00_backend_reachable(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    assert r.json().get('status') == 'ok'


def test_01_plaid_status(s):
    r = s.get(f"{API}/plaid/status")
    assert r.status_code == 200
    body = r.json()
    assert 'configured' in body and 'env' in body


# =========================================================================== 2. Email verification
def test_10_register_returns_dev_verification_token(s):
    r, email = _register(s, 'ver')
    assert r.status_code == 200, r.text
    body = r.json()
    assert 'dev_verification_token' in body, f"missing dev_verification_token; SendGrid may be configured: {body}"
    assert body['user']['email_verified'] is False
    # Stash for next tests
    STATE["ver_token"] = body['dev_verification_token']
    STATE["ver_jwt"] = body['token']
    STATE["ver_email"] = email
    STATE["ver_user_id"] = body['user']['user_id']


def test_11_me_shows_unverified(s):
    r = s.get(f"{API}/auth/me", headers=_auth_headers(STATE["ver_jwt"]))
    assert r.status_code == 200
    assert r.json().get('email_verified') is False


def test_12_verify_email_success(s):
    r = s.post(f"{API}/auth/verify-email", json={'token': STATE["ver_token"]})
    assert r.status_code == 200, r.text
    assert r.json() == {'ok': True}


def test_13_me_shows_verified(s):
    r = s.get(f"{API}/auth/me", headers=_auth_headers(STATE["ver_jwt"]))
    assert r.status_code == 200
    assert r.json().get('email_verified') is True


def test_14_reuse_token_rejected(s):
    r = s.post(f"{API}/auth/verify-email", json={'token': STATE["ver_token"]})
    assert r.status_code == 400
    assert 'invalid' in r.json().get('detail', '').lower() or 'expired' in r.json().get('detail', '').lower()


def test_15_invalid_token_rejected(s):
    r = s.post(f"{API}/auth/verify-email", json={'token': 'not-a-real-token-xyz'})
    assert r.status_code == 400


def test_16_missing_token_rejected(s):
    r = s.post(f"{API}/auth/verify-email", json={'token': ''})
    assert r.status_code == 400


def test_17_resend_verification_when_already_verified(s):
    # ver user is already verified → returns already_verified true
    r = s.post(f"{API}/auth/resend-verification", headers=_auth_headers(STATE["ver_jwt"]))
    assert r.status_code == 200
    body = r.json()
    assert body.get('ok') is True
    assert body.get('already_verified') is True


def test_18_resend_verification_new_user(s):
    r, email = _register(s, 'res')
    assert r.status_code == 200
    tok = r.json()['token']
    r2 = s.post(f"{API}/auth/resend-verification", headers=_auth_headers(tok))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body.get('ok') is True
    assert 'dev_verification_token' in body, f"expected dev token when SendGrid unconfigured: {body}"
    # verify with that token still works
    v = s.post(f"{API}/auth/verify-email", json={'token': body['dev_verification_token']})
    assert v.status_code == 200 and v.json() == {'ok': True}


# =========================================================================== 3. Account deletion
def test_20_account_deletion_full_cascade(s):
    # Register user
    r, email = _register(s, 'del')
    assert r.status_code == 200
    body = r.json()
    token = body['token']
    user_id = body['user']['user_id']
    hdr = _auth_headers(token)

    # Create a support ticket
    tk = s.post(f"{API}/support/tickets", headers=hdr, json={
        'subject': 'TEST_delete_cascade', 'description': 'about to be nuked',
    })
    assert tk.status_code == 200, tk.text
    ticket_id = tk.json().get('ticket_id') or tk.json().get('id') or tk.json().get('ticket', {}).get('ticket_id')

    # Seed fake plaid item + bank transactions directly
    fake_item_id = f'itm_TEST_{uuid.uuid4().hex[:8]}'
    _db.plaid_items.insert_one({
        'user_id': user_id,
        'item_id': fake_item_id,
        'access_token_encrypted': 'FAKE_TOKEN_wont_decrypt',
        'institution_name': 'TEST Bank',
        'cursor': '',
    })
    _db.bank_transactions.insert_many([
        {'user_id': user_id, 'account_id': 'acc_x', 'external_id': f'tx_{i}',
         'link_id': fake_item_id, 'amount': 1.0} for i in range(3)
    ])

    # Sanity — rows exist
    assert _db.plaid_items.count_documents({'user_id': user_id}) == 1
    assert _db.bank_transactions.count_documents({'user_id': user_id}) == 3
    assert _db.support_tickets.count_documents({'user_id': user_id}) >= 1

    # DELETE account
    d = s.delete(f"{API}/auth/delete-account", headers=hdr)
    assert d.status_code == 200, d.text
    body = d.json()
    assert body.get('ok') is True
    assert body.get('user_id') == user_id
    counts = body.get('deleted_counts', {})
    # Users row deleted
    assert counts.get('users') == 1
    # Plaid items deleted (even though remote revoke failed on fake token — best effort)
    assert counts.get('plaid_items') == 1
    # Transactions deleted
    assert counts.get('bank_transactions') == 3
    # Support tickets deleted
    assert counts.get('support_tickets', 0) >= 1

    # Verify in Mongo
    assert _db.users.count_documents({'user_id': user_id}) == 0
    assert _db.plaid_items.count_documents({'user_id': user_id}) == 0
    assert _db.bank_transactions.count_documents({'user_id': user_id}) == 0
    assert _db.support_tickets.count_documents({'user_id': user_id}) == 0
    assert _db.linked_accounts.count_documents({'user_id': user_id}) == 0
    assert _db.email_verifications.count_documents({'user_id': user_id}) == 0
    assert _db.password_resets.count_documents({'user_id': user_id}) == 0
    assert _db.user_sessions.count_documents({'user_id': user_id}) == 0
    assert _db.coaching_bookings.count_documents({'user_id': user_id}) == 0

    # Old token now 401
    m = s.get(f"{API}/auth/me", headers=hdr)
    assert m.status_code == 401


# =========================================================================== 4. Plaid cascade
def test_30_plaid_unlink_cascade_deletes_only_owner_transactions(s):
    # Owner user
    r, _ = _register(s, 'plB')
    assert r.status_code == 200
    body = r.json()
    owner_id = body['user']['user_id']
    hdr = _auth_headers(body['token'])

    # Second user (cross-user isolation check)
    r2, _ = _register(s, 'plC')
    assert r2.status_code == 200
    other_id = r2.json()['user']['user_id']

    # Seed same link_id across BOTH users. Owner has 3 txs, other has 2.
    fake_item_id = f'itm_TEST_{uuid.uuid4().hex[:8]}'
    _db.plaid_items.insert_one({
        'user_id': owner_id,
        'item_id': fake_item_id,
        'access_token_encrypted': 'FAKE_TOKEN',
        'institution_name': 'TEST Bank',
        'cursor': '',
    })
    _db.bank_transactions.insert_many([
        {'user_id': owner_id, 'account_id': 'a', 'external_id': f'own_{i}',
         'link_id': fake_item_id, 'amount': 1.0} for i in range(3)
    ])
    _db.bank_transactions.insert_many([
        {'user_id': other_id, 'account_id': 'a', 'external_id': f'oth_{i}',
         'link_id': fake_item_id, 'amount': 1.0} for i in range(2)
    ])

    # DELETE /api/plaid/item/{item_id}
    d = s.delete(f"{API}/plaid/item/{fake_item_id}", headers=hdr)
    assert d.status_code == 200, d.text
    body = d.json()
    assert body.get('ok') is True
    assert body.get('transactions_deleted') == 3, body

    # Owner txs gone
    assert _db.bank_transactions.count_documents({'user_id': owner_id, 'link_id': fake_item_id}) == 0
    # Other user's txs intact — cross-user isolation
    assert _db.bank_transactions.count_documents({'user_id': other_id, 'link_id': fake_item_id}) == 2

    # Cleanup other user's rows
    _db.bank_transactions.delete_many({'user_id': other_id, 'link_id': fake_item_id})
    _db.users.delete_many({'user_id': {'$in': [owner_id, other_id]}})


def test_31_plaid_unlink_wrong_owner_returns_404(s):
    r, _ = _register(s, 'plD')
    assert r.status_code == 200
    hdr = _auth_headers(r.json()['token'])
    d = s.delete(f"{API}/plaid/item/does-not-exist-xyz", headers=hdr)
    assert d.status_code == 404


# =========================================================================== 5. Regression
def test_40_admin_login_still_works(s):
    r = s.post(f"{API}/auth/login", json={
        'email': 'support@jaleter.com', 'password': 'Tarik0731!',
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['user']['is_admin'] is True
    STATE["admin_token"] = body['token']


def test_41_admin_me(s):
    r = s.get(f"{API}/auth/me", headers=_auth_headers(STATE["admin_token"]))
    assert r.status_code == 200 and r.json()['is_admin'] is True


def test_42_admin_support_tickets_list(s):
    r = s.get(f"{API}/support/admin/tickets", headers=_auth_headers(STATE["admin_token"]))
    assert r.status_code == 200
    assert 'tickets' in r.json()


def test_43_plaid_link_token_requires_auth(s):
    r = s.post(f"{API}/plaid/link-token")
    assert r.status_code == 401


# =========================================================================== 1. Rate limits (LAST — burns per-IP slots)
def test_90_login_rate_limit_5_per_minute(s):
    """Note: K8s ingress load-balances requests across ~2 source IPs, so the
    effective per-tester limit is ~2x the configured 5/min. Burst 20 to be sure."""
    time.sleep(2)
    hit_429 = False
    for i in range(20):
        r = s.post(f"{API}/auth/login", json={
            'email': f'nobody_{i}@example.com', 'password': 'wrongpass',
        })
        if r.status_code == 429:
            hit_429 = True
            break
        # Otherwise expect 401 (invalid email/password)
        assert r.status_code == 401, f'unexpected {r.status_code}: {r.text}'
    assert hit_429, 'Expected a 429 within 20 login attempts (limit 5/min per IP)'


def test_91_forgot_password_rate_limit_3_per_minute(s):
    time.sleep(2)
    hit_429 = False
    for i in range(15):
        r = s.post(f"{API}/auth/forgot-password", json={
            'email': f'nobody_{uuid.uuid4().hex[:6]}@example.com',
        })
        if r.status_code == 429:
            hit_429 = True
            break
        assert r.status_code == 200, f'unexpected {r.status_code}: {r.text}'
    assert hit_429, 'Expected 429 within 15 forgot-password calls (limit 3/min per IP)'


def test_92_resend_verification_rate_limit_3_per_minute(s):
    time.sleep(2)
    # Need a fresh authenticated user
    r, _ = _register(s, 'rl')
    assert r.status_code == 200
    hdr = _auth_headers(r.json()['token'])
    hit_429 = False
    for i in range(15):
        r2 = s.post(f"{API}/auth/resend-verification", headers=hdr)
        if r2.status_code == 429:
            hit_429 = True
            break
        assert r2.status_code == 200, f'unexpected {r2.status_code}: {r2.text}'
    assert hit_429, 'Expected 429 within 15 resend-verification calls (limit 3/min per IP)'


def test_93_reset_password_rate_limit_5_per_minute(s):
    time.sleep(2)
    hit_429 = False
    for i in range(20):
        r = s.post(f"{API}/auth/reset-password", json={
            'token': f'not-a-token-{i}', 'new_password': 'Passw0rd!',
        })
        if r.status_code == 429:
            hit_429 = True
            break
        assert r.status_code == 400, f'unexpected {r.status_code}: {r.text}'
    assert hit_429, 'Expected 429 within 20 reset-password calls (limit 5/min per IP)'


def test_94_register_rate_limit_10_per_minute(s):
    # Register limit is 10/min per IP, but ingress load-balances 2 IPs → ~20 effective.
    hit_429 = False
    for i in range(30):
        r = s.post(f"{API}/auth/register", json={
            'name': 'x', 'email': _uniq_email('rlR'), 'password': 'Passw0rd!',
        })
        if r.status_code == 429:
            hit_429 = True
            break
        # Otherwise 200 (created) — that's fine.
        assert r.status_code in (200, 400), f'unexpected {r.status_code}: {r.text}'
    assert hit_429, 'Expected 429 within 30 register calls (limit 10/min per IP)'
