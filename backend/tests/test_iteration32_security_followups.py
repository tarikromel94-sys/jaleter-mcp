"""Post-launch security follow-ups (iteration 32).

Verifies 3 fixes:
  1. `payment_transactions` purged on account deletion (with cross-user isolation).
  2. Rate limiter now buckets by `X-Forwarded-For` (leftmost IP), not by pod IP.
  3. Plaid webhook signature verification — no header/fake header/bad kid → 401,
     and DB (`plaid_items`) is never touched by rejected calls.

Also runs a light regression:
  - `/api/plaid/status` still returns configured=true, env='production'.
  - Support ticket creation still works.

Rate-limit tests intentionally craft distinct `X-Forwarded-For` headers to
prove per-IP bucketing; each bucket is scoped to test-only fake IPs
(203.0.113.0/24 — TEST-NET-3, RFC 5737) so we do not collide with real
traffic buckets.
"""

import hashlib
import json
import os
import time
import uuid

import jwt as pyjwt
import pytest
import requests
from pymongo import MongoClient


# --------------------------------------------------------------------------- env
BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as _f:
        for _line in _f:
            if _line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                BASE_URL = _line.strip().split('=', 1)[1].strip('"')
                break
BASE_URL = (BASE_URL or '').rstrip('/')
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get('MONGO_URL')
DB_NAME = os.environ.get('DB_NAME')
if not MONGO_URL or not DB_NAME:
    with open('/app/backend/.env') as _f:
        for _line in _f:
            if _line.startswith('MONGO_URL='):
                MONGO_URL = _line.strip().split('=', 1)[1].strip('"')
            elif _line.startswith('DB_NAME='):
                DB_NAME = _line.strip().split('=', 1)[1].strip('"')

_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]

STATE: dict = {}


# --------------------------------------------------------------------------- helpers
def _uniq_email(tag: str) -> str:
    return f"TEST_i32_{tag}_{uuid.uuid4().hex[:10]}@jaleter.app"


def _register(session: requests.Session, tag: str, password: str = 'Passw0rd!', xff: str | None = None):
    email = _uniq_email(tag)
    headers = {'Content-Type': 'application/json'}
    if xff:
        headers['X-Forwarded-For'] = xff
    r = session.post(
        f"{API}/auth/register",
        json={'name': f'Test {tag}', 'email': email, 'password': password},
        headers=headers,
    )
    return r, email


def _auth_headers(token: str, xff: str | None = None) -> dict:
    h = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    if xff:
        h['X-Forwarded-For'] = xff
    return h


@pytest.fixture(scope='module')
def s():
    return requests.Session()


# =========================================================================== 0. Sanity
def test_00_backend_reachable(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    assert r.json().get('status') == 'ok'


def test_01_plaid_status_still_production(s):
    r = s.get(f"{API}/plaid/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get('configured') is True, body
    assert body.get('env') == 'production', body


# =========================================================================== FIX 1 — payment_transactions purged on delete-account
def test_10_delete_account_purges_payment_transactions_isolated(s):
    """Register 2 users; seed a payment row for each; delete user A; assert
    A's row is gone (deleted_counts.payment_transactions >= 1) and B's row remains."""
    # User A
    rA, emailA = _register(s, 'payA')
    assert rA.status_code == 200, rA.text
    A = rA.json()
    userA_id = A['user']['user_id']
    tokenA = A['token']

    # User B (must NOT be affected)
    rB, emailB = _register(s, 'payB')
    assert rB.status_code == 200, rB.text
    userB_id = rB.json()['user']['user_id']

    # Seed a fake payment_transactions row for A
    sess_a = f'cs_test_TEST_i32_{uuid.uuid4().hex[:10]}'
    _db.payment_transactions.insert_one({
        'session_id': sess_a,
        'user_id': userA_id,
        'amount': 5000,
        'currency': 'usd',
        'status': 'complete',
        'created_at': 'TEST_i32_seed',
    })
    # Seed one for B (cross-user isolation)
    sess_b = f'cs_test_TEST_i32_{uuid.uuid4().hex[:10]}'
    _db.payment_transactions.insert_one({
        'session_id': sess_b,
        'user_id': userB_id,
        'amount': 7500,
        'currency': 'usd',
        'status': 'complete',
        'created_at': 'TEST_i32_seed',
    })
    STATE['payB_session'] = sess_b
    STATE['userB_id'] = userB_id

    # Sanity: both rows exist in Mongo
    assert _db.payment_transactions.count_documents({'user_id': userA_id}) >= 1
    assert _db.payment_transactions.count_documents({'user_id': userB_id}) >= 1

    # Delete account A
    d = s.delete(f"{API}/auth/delete-account", headers=_auth_headers(tokenA))
    assert d.status_code == 200, d.text
    body = d.json()
    assert body.get('ok') is True
    assert body.get('user_id') == userA_id
    counts = body.get('deleted_counts', {})
    assert 'payment_transactions' in counts, f"deleted_counts missing key: {counts}"
    assert counts['payment_transactions'] >= 1, f"expected >=1 payment_transactions purged: {counts}"
    assert counts.get('users') == 1

    # Mongo verification
    assert _db.payment_transactions.count_documents({'user_id': userA_id}) == 0, \
        "A's payment_transactions row should be gone"
    # Cross-user isolation — B's row untouched
    assert _db.payment_transactions.count_documents({'user_id': userB_id, 'session_id': sess_b}) == 1, \
        "B's payment_transactions row must NOT be deleted"
    # User B still exists
    assert _db.users.count_documents({'user_id': userB_id}) == 1


def test_11_cleanup_userB(s):
    """Best-effort cleanup of user B & their seeded payment row."""
    uid = STATE.get('userB_id')
    if not uid:
        pytest.skip('no user B to cleanup')
    _db.payment_transactions.delete_many({'user_id': uid})
    _db.users.delete_many({'user_id': uid})


# =========================================================================== FIX 2 — Rate limiter uses X-Forwarded-For
# Uses TEST-NET-3 (203.0.113.0/24) fake IPs so we don't collide with buckets from real traffic.

_FAKE_IP_A = '203.0.113.99'
_FAKE_IP_B = '203.0.113.100'


def test_20_login_rate_limit_per_xff_bucket(s):
    """6 login attempts from IP_A → 6th must be 429. Confirms limiter buckets by XFF."""
    time.sleep(2)
    codes = []
    for i in range(6):
        r = s.post(
            f"{API}/auth/login",
            json={'email': f'nobody_{i}@example.com', 'password': 'wrongpass'},
            headers={'Content-Type': 'application/json', 'X-Forwarded-For': _FAKE_IP_A},
        )
        codes.append(r.status_code)
    # First 5 should NOT be 429; the 6th MUST be 429.
    non429 = [c for c in codes[:5] if c != 429]
    assert len(non429) == 5, f"first 5 calls hit 429 unexpectedly: {codes}"
    # Each of the first 5 should be 401 (invalid credentials)
    assert all(c == 401 for c in codes[:5]), f"expected 5x 401 then 429; got {codes}"
    assert codes[5] == 429, f"6th call must be 429 (rate-limited); got {codes}"


def test_21_login_different_xff_ip_has_own_bucket(s):
    """After IP_A is exhausted, 5 more from IP_B should still succeed (no 429)."""
    codes = []
    for i in range(5):
        r = s.post(
            f"{API}/auth/login",
            json={'email': f'nobody_B_{i}@example.com', 'password': 'wrongpass'},
            headers={'Content-Type': 'application/json', 'X-Forwarded-For': _FAKE_IP_B},
        )
        codes.append(r.status_code)
    # None of these should be 429 (fresh IP bucket).
    assert all(c == 401 for c in codes), f"IP_B bucket should be fresh; got {codes}"


def test_22_login_rate_limit_no_xff_falls_back(s):
    """When no X-Forwarded-For header is sent, limiter falls back to
    get_remote_address (pod IP). We can't guarantee we own that bucket exclusively,
    but a burst of 10 login attempts should eventually 429 within a minute."""
    time.sleep(2)
    hit_429 = False
    for i in range(15):
        r = s.post(
            f"{API}/auth/login",
            json={'email': f'nobody_noxff_{i}@example.com', 'password': 'wrongpass'},
            headers={'Content-Type': 'application/json'},
        )
        if r.status_code == 429:
            hit_429 = True
            break
        assert r.status_code == 401, f"unexpected {r.status_code}: {r.text}"
    assert hit_429, 'Expected 429 within 15 no-XFF login attempts (fallback bucket)'


# =========================================================================== FIX 3 — Plaid webhook signature verification
def test_30_plaid_webhook_missing_header_returns_401(s):
    # Snapshot plaid_items count BEFORE
    before = _db.plaid_items.count_documents({})
    r = s.post(
        f"{API}/plaid/webhook",
        json={'webhook_type': 'TRANSACTIONS', 'webhook_code': 'SYNC_UPDATES_AVAILABLE',
              'item_id': 'itm_TEST_i32_bogus'},
    )
    assert r.status_code == 401, r.text
    detail = r.json().get('detail', '')
    assert 'missing Plaid-Verification header' in detail, detail
    # DB untouched
    after = _db.plaid_items.count_documents({})
    assert after == before, f"plaid_items count changed on rejected webhook: {before}->{after}"


def test_31_plaid_webhook_random_header_returns_401(s):
    before = _db.plaid_items.count_documents({})
    r = s.post(
        f"{API}/plaid/webhook",
        json={'webhook_type': 'TRANSACTIONS', 'item_id': 'itm_TEST_i32_bogus'},
        headers={'Content-Type': 'application/json',
                 'Plaid-Verification': 'this-is-not-a-jwt-at-all'},
    )
    assert r.status_code == 401, r.text
    detail = r.json().get('detail', '')
    assert 'invalid webhook signature' in detail, detail
    assert _db.plaid_items.count_documents({}) == before


def test_32_plaid_webhook_wrong_alg_returns_401(s):
    """Valid JWT structure but alg=HS256 (not ES256 as Plaid uses) → rejected."""
    before = _db.plaid_items.count_documents({})
    body = {'webhook_type': 'TRANSACTIONS', 'item_id': 'itm_TEST_i32_bogus'}
    body_bytes = json.dumps(body).encode()
    sha = hashlib.sha256(body_bytes).hexdigest()
    payload = {'iat': int(time.time()), 'request_body_sha256': sha}
    hs_jwt = pyjwt.encode(payload, 'fakesecret', algorithm='HS256',
                          headers={'kid': 'fake-kid-abc123'})
    r = s.post(
        f"{API}/plaid/webhook",
        data=body_bytes,
        headers={'Content-Type': 'application/json', 'Plaid-Verification': hs_jwt},
    )
    assert r.status_code == 401, r.text
    assert 'invalid webhook signature' in r.json().get('detail', '')
    assert _db.plaid_items.count_documents({}) == before


def test_33_plaid_webhook_fake_kid_returns_401(s):
    """Syntactically-valid ES256 JWT header with a `kid` Plaid does NOT recognize.
    The signature can be garbage — Plaid's /webhook_verification_key/get will
    error, and our handler returns 401."""
    before = _db.plaid_items.count_documents({})
    # Build a bare JWT string manually with header.alg=ES256 + fake kid.
    # Signature bytes are junk (we know decode will fail either at key fetch or
    # at signature verification — either path must return 401).
    import base64

    def b64url(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

    header = {'alg': 'ES256', 'kid': f'TEST_i32_fake_kid_{uuid.uuid4().hex[:8]}', 'typ': 'JWT'}
    body = {'webhook_type': 'TRANSACTIONS', 'item_id': 'itm_TEST_i32_bogus'}
    body_bytes = json.dumps(body).encode()
    sha = hashlib.sha256(body_bytes).hexdigest()
    claims = {'iat': int(time.time()), 'request_body_sha256': sha}
    header_b64 = b64url(json.dumps(header).encode())
    claims_b64 = b64url(json.dumps(claims).encode())
    fake_sig = b64url(b'\x00' * 64)  # 64-byte junk sig
    fake_jwt = f'{header_b64}.{claims_b64}.{fake_sig}'

    r = s.post(
        f"{API}/plaid/webhook",
        data=body_bytes,
        headers={'Content-Type': 'application/json', 'Plaid-Verification': fake_jwt},
    )
    assert r.status_code == 401, r.text
    assert 'invalid webhook signature' in r.json().get('detail', ''), r.text
    assert _db.plaid_items.count_documents({}) == before


def test_34_plaid_webhook_endpoint_exists_post_only(s):
    """Confirm the endpoint is still mounted at POST /api/plaid/webhook."""
    # GET should be 405 method not allowed (or 404 — either way NOT 200)
    r = s.get(f"{API}/plaid/webhook")
    assert r.status_code in (404, 405), f"GET should not be allowed; got {r.status_code}"


# =========================================================================== REGRESSION — support tickets untouched
def test_40_support_ticket_creation_still_works(s):
    r, _ = _register(s, 'sup')
    assert r.status_code == 200
    tok = r.json()['token']
    uid = r.json()['user']['user_id']
    tk = s.post(
        f"{API}/support/tickets",
        headers=_auth_headers(tok),
        json={'subject': 'TEST_i32_regression', 'description': 'ok'},
    )
    assert tk.status_code == 200, tk.text
    # Cleanup — delete this user's account fully
    s.delete(f"{API}/auth/delete-account", headers=_auth_headers(tok))
    assert _db.users.count_documents({'user_id': uid}) == 0


def test_41_admin_login_still_works(s):
    r = s.post(f"{API}/auth/login", json={
        'email': 'support@jaleter.com', 'password': 'Tarik0731!',
    }, headers={'Content-Type': 'application/json',
                'X-Forwarded-For': '203.0.113.200'})  # dedicated bucket
    assert r.status_code == 200, r.text
    assert r.json()['user']['is_admin'] is True


# =========================================================================== Global cleanup
def test_99_cleanup_test_data(s):
    """Purge any leftover TEST_i32_ users and their payment rows."""
    # Delete test users
    test_users = list(_db.users.find({'email': {'$regex': '^TEST_i32_'}}, {'user_id': 1}))
    uids = [u['user_id'] for u in test_users]
    if uids:
        _db.users.delete_many({'user_id': {'$in': uids}})
        _db.payment_transactions.delete_many({'user_id': {'$in': uids}})
        _db.support_tickets.delete_many({'user_id': {'$in': uids}})
        _db.email_verifications.delete_many({'user_id': {'$in': uids}})
    # Also purge any leftover TEST_i32_ payment rows by session_id prefix
    _db.payment_transactions.delete_many({'session_id': {'$regex': '^cs_test_TEST_i32_'}})
    print(f"Cleaned up {len(uids)} test users")
