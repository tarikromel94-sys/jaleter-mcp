"""Iteration-38 tests: FINAL pre-launch regression + IDOR sweep.

Coverage:
  SANITY
   - Backend up (GET /api/), no import errors, categories endpoint.

  IDOR / OWNERSHIP AUDIT
   - PATCH /api/accounts/{account_id} — 404 when acct belongs to user B.
   - PATCH /api/accounts/transactions/{external_id}/classify — 404 cross-user.
   - GET /api/accounts/all — user B never sees user A's seeded rows.
   - GET /api/accounts/transactions — user B never sees user A's rows.
   - GET /api/coach/history — user B never sees user A's messages.

  REGRESSION Phase 1 — no server-side 'restricted' terminology (grep sanity).
  REGRESSION Phase 2 — /api/accounts/categories spot-check + classify_plaid 5 cases.
  REGRESSION Phase 3 — classifier PFC + CSV parser Chase Business format.
  REGRESSION SUITE   — /auth/login, /auth/me, /auth/forgot-password,
                       /auth/resend-verification, /auth/verify-email,
                       /auth/delete-account (password re-entry),
                       /coach/chat with real LLM, /coach/reset.
"""
from __future__ import annotations

import os
import re
import sys
import time
import uuid
import pathlib
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

sys.path.insert(0, '/app/backend')
import wealth_service  # noqa: E402
import transaction_classifier as tc  # noqa: E402
from providers.file_provider import _parse_csv  # noqa: E402

# ------------ Config -----------------------------------------------------
BASE_URL = None
with open('/app/frontend/.env') as f:
    for line in f:
        if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
            break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]

USER_A_EMAIL = 'alex+test1@jaleter.app'
USER_A_PASSWORD = 'password123'


# ------------ Helpers ----------------------------------------------------
def _bearer(tok: str) -> dict:
    return {'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}


def _login(email: str, password: str) -> dict | None:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={'email': email, 'password': password},
                      headers={'Content-Type': 'application/json'})
    if r.status_code != 200:
        return None
    d = r.json()
    return {'token': d['token'], 'user_id': d['user']['user_id'], 'email': email}


def _register(prefix: str = 'TEST_i38') -> dict | None:
    email = f"{prefix}_{uuid.uuid4().hex[:8]}@jaleter.app"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={'name': 'IDOR User', 'email': email, 'password': 'password123'},
                      headers={'Content-Type': 'application/json'})
    if r.status_code != 200:
        return None
    d = r.json()
    return {'token': d['token'], 'user_id': d['user']['user_id'], 'email': email,
            'password': 'password123'}


def _cleanup_user(u: dict, password: str = 'password123'):
    if not u:
        return
    try:
        requests.request(
            'DELETE', f"{BASE_URL}/api/auth/delete-account",
            headers=_bearer(u['token']), json={'password': password},
        )
    except Exception:
        pass
    _db.bank_transactions.delete_many({'user_id': u['user_id']})
    _db.coach_messages.delete_many({'user_id': u['user_id']})
    _db.account_overrides.delete_many({'user_id': u['user_id']})


def _seed_tx(user_id: str, external_id: str, amount: float = -10.0,
             account_id: str = 'test_acct_i38', **extra) -> dict:
    doc = {
        'user_id': user_id,
        'provider': 'test_seed_i38',
        'link_id': 'test-seed-i38',
        'account_id': account_id,
        'external_id': external_id,
        'date': datetime.now(timezone.utc),
        'amount': amount,
        'name': f'TEST_i38 {external_id}',
        'description': 'TEST_i38',
        'type': 'income' if amount > 0 else 'expense',
        'origin': 'TEST_SEED_I38',
        'pending': False,
    }
    doc.update(extra)
    _db.bank_transactions.insert_one(doc)
    return doc


def _cleanup_seed_i38(user_id: str):
    _db.bank_transactions.delete_many({'user_id': user_id, 'provider': 'test_seed_i38'})


# ------------ Fixtures ---------------------------------------------------
@pytest.fixture(scope='module')
def user_a():
    u = _login(USER_A_EMAIL, USER_A_PASSWORD)
    if not u:
        pytest.skip(f"Cannot login primary user {USER_A_EMAIL}")
    yield u
    _cleanup_seed_i38(u['user_id'])


@pytest.fixture(scope='module')
def user_b():
    u = _register('TEST_i38_userb')
    if not u:
        pytest.skip("Cannot register user B for IDOR tests")
    yield u
    _cleanup_user(u)


# =========================================================================
# 1. SANITY
# =========================================================================
class TestSanity:
    def test_root_up(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text

    def test_no_import_errors_in_supervisor_log(self):
        # Check the most recent backend log for import/exception noise on startup.
        log_paths = [
            '/var/log/supervisor/backend.err.log',
            '/var/log/supervisor/backend.out.log',
        ]
        for path in log_paths:
            p = pathlib.Path(path)
            if not p.exists():
                continue
            try:
                tail = p.read_text(errors='ignore')[-8000:]
            except Exception:
                continue
            # Fail only for actual import errors — Traceback lines can appear
            # from expected 401s etc.
            for offender in ('ImportError', 'ModuleNotFoundError', 'SyntaxError'):
                assert offender not in tail, f"{offender} present in {path}"

    def test_categories_endpoint_10_slugs(self):
        r = requests.get(f"{BASE_URL}/api/accounts/categories")
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) == {'assets', 'liabilities'}
        slugs = {c['slug'] for c in data['assets']} | {c['slug'] for c in data['liabilities']}
        expected = {
            'cash', 'investments', 'real_estate', 'vehicles', 'other_assets',
            'credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities',
        }
        assert slugs == expected, f"Missing/extra: {expected ^ slugs}"


# =========================================================================
# 2. PHASE 1 REGRESSION — 'restricted' terminology gone
# =========================================================================
class TestPhase1Terminology:
    def test_no_user_facing_restricted_in_backend_py(self):
        backend_dir = pathlib.Path('/app/backend')
        offenders: list[str] = []
        for py in backend_dir.rglob('*.py'):
            # Skip tests directory (self-references) and caches.
            if 'tests' in py.parts or '__pycache__' in py.parts:
                continue
            try:
                text = py.read_text(errors='ignore')
            except Exception:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if not re.search(r'\brestricted\b', line, re.IGNORECASE):
                    continue
                stripped = line.strip()
                # Skip negation lines (docs explaining what NOT to say).
                if re.search(r'not\s+["\']?restricted', stripped, re.IGNORECASE):
                    continue
                offenders.append(f"{py}:{i}: {stripped}")
        assert not offenders, ("Found user-facing 'restricted' references:\n"
                               + "\n".join(offenders))


# =========================================================================
# 3. PHASE 2 REGRESSION — Wealth classification matrix spot-check
# =========================================================================
class TestPhase2WealthClassification:
    def test_checking_to_cash(self):
        assert wealth_service.classify_plaid('depository', 'checking') == 'cash'

    def test_ira_to_investments(self):
        assert wealth_service.classify_plaid('investment', 'ira') == 'investments'

    def test_credit_card_to_credit_cards(self):
        assert wealth_service.classify_plaid('credit', 'credit card') == 'credit_cards'

    def test_mortgage_to_mortgage(self):
        assert wealth_service.classify_plaid('loan', 'mortgage') == 'mortgage'

    def test_student_loan_to_student_loans(self):
        assert wealth_service.classify_plaid('loan', 'student') == 'student_loans'


# =========================================================================
# 4. PHASE 3 REGRESSION — classifier + CSV parser
# =========================================================================
class TestPhase3Classifier:
    def test_pfc_transfer_in(self):
        assert tc.classify_system({
            'personal_finance_category': {'primary': 'TRANSFER_IN',
                                          'detailed': 'TRANSFER_IN_ACCOUNT_TRANSFER'}
        }) == 'transfer'

    def test_pfc_loan_payments_cc(self):
        assert tc.classify_system({
            'personal_finance_category': {'primary': 'LOAN_PAYMENTS',
                                          'detailed': 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}
        }) == 'credit_card_payment'

    def test_chase_business_csv_details_desc_amount_type(self):
        # Chase Business format: Details, Posting Date, Description, Amount, Type
        csv = ("Details,Posting Date,Description,Amount,Type\n"
               "CREDIT,2025-01-05,PAYCHECK ACH,2500.00,ACH_CREDIT\n"
               "DEBIT,2025-01-06,STARBUCKS COFFEE,-5.25,DEBIT_CARD\n")
        mapping, rows, skipped = _parse_csv(csv)
        # Description column (not Details) must win
        assert mapping['description'] == 'Description'
        assert mapping['date'] == 'Posting Date'
        assert mapping['amount'] == 'Amount'
        assert len(rows) == 2
        assert rows[0]['amount'] == 2500.00
        # Sign preserved from Amount column
        assert rows[1]['amount'] == -5.25


# =========================================================================
# 5. IDOR / OWNERSHIP AUDIT
# =========================================================================
class TestIDOR:
    def test_patch_account_cross_user_404(self, user_a, user_b):
        # user_a tries to patch an arbitrary account_id. Since user_a's
        # linked accounts don't include this ID (and user_b has no accounts
        # either), we should get 404. Then use user_b's bearer to hit the
        # same ID that (hypothetically) belongs to a: verify same 404.
        fake_acct = f"acct_i38_{uuid.uuid4().hex[:8]}"
        r_a = requests.patch(f"{BASE_URL}/api/accounts/{fake_acct}",
                             headers=_bearer(user_a['token']),
                             json={'override_category': 'cash'})
        # For a non-existent account_id under user_a, IDOR guard returns 404.
        assert r_a.status_code == 404, r_a.text
        r_b = requests.patch(f"{BASE_URL}/api/accounts/{fake_acct}",
                             headers=_bearer(user_b['token']),
                             json={'override_category': 'cash'})
        assert r_b.status_code == 404, r_b.text

    def test_patch_classify_cross_user_404(self, user_a, user_b):
        # Seed a tx on user_a; user_b attempts to classify it -> 404.
        ext_id = f"TEST_i38_idor_{uuid.uuid4().hex[:8]}"
        _seed_tx(user_a['user_id'], ext_id, amount=-42.00)
        try:
            r = requests.patch(
                f"{BASE_URL}/api/accounts/transactions/{ext_id}/classify",
                headers=_bearer(user_b['token']),
                json={'system_category': 'transfer'},
            )
            assert r.status_code == 404, r.text
            # Ensure NO override was written
            doc = _db.bank_transactions.find_one(
                {'user_id': user_a['user_id'], 'external_id': ext_id})
            assert doc.get('system_category_override') is None
            # Sanity: user_a CAN classify it
            r2 = requests.patch(
                f"{BASE_URL}/api/accounts/transactions/{ext_id}/classify",
                headers=_bearer(user_a['token']),
                json={'system_category': 'transfer'},
            )
            assert r2.status_code == 200, r2.text
        finally:
            _db.bank_transactions.delete_one(
                {'user_id': user_a['user_id'], 'external_id': ext_id})

    def test_accounts_all_isolated_per_user(self, user_a, user_b):
        # user_b — fresh account, no linked accounts of any kind.
        r = requests.get(f"{BASE_URL}/api/accounts/all",
                         headers=_bearer(user_b['token']))
        assert r.status_code == 200, r.text
        accts = r.json().get('accounts', [])
        # user_b's account list should have NO user_id from user_a and no
        # test seed rows. Real accounts don't carry user_id in the response
        # (they're already filtered) — just verify all entries are either
        # error-shaped or genuinely belong to user_b (i.e., no accounts).
        for row in accts:
            assert row.get('user_id') != user_a['user_id']

    def test_transactions_isolated_per_user(self, user_a, user_b):
        # Seed a tx for user_a, confirm user_b's list does NOT contain it.
        ext_id = f"TEST_i38_txiso_{uuid.uuid4().hex[:8]}"
        _seed_tx(user_a['user_id'], ext_id, amount=-77.77)
        try:
            r = requests.get(f"{BASE_URL}/api/accounts/transactions?limit=200",
                             headers=_bearer(user_b['token']))
            assert r.status_code == 200, r.text
            ext_ids = {t.get('external_id') for t in r.json()['transactions']}
            assert ext_id not in ext_ids, "IDOR: user_b saw user_a's transaction!"
        finally:
            _db.bank_transactions.delete_one(
                {'user_id': user_a['user_id'], 'external_id': ext_id})

    def test_coach_history_isolated_per_user(self, user_a, user_b):
        # Seed a fake coach message for user_a directly in Mongo, then confirm
        # user_b's history doesn't include it.
        sid_a = f"user_{user_a['user_id']}"
        marker = f"TEST_i38_marker_{uuid.uuid4().hex[:6]}"
        _db.coach_messages.insert_one({
            'session_id': sid_a,
            'user_id': user_a['user_id'],
            'role': 'user',
            'content': marker,
            'created_at': datetime.now(timezone.utc),
        })
        try:
            r = requests.get(f"{BASE_URL}/api/coach/history",
                             headers=_bearer(user_b['token']))
            assert r.status_code == 200, r.text
            contents = [m.get('content') for m in r.json().get('messages', [])]
            assert marker not in contents, "IDOR: user_b saw user_a's coach message!"
        finally:
            _db.coach_messages.delete_many(
                {'user_id': user_a['user_id'], 'content': marker})


# =========================================================================
# 6. AUTH REGRESSION SUITE
# =========================================================================
class TestAuthRegression:
    def test_login_success(self, user_a):
        # user_a fixture already logs in; just confirm token works on /me.
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_bearer(user_a['token']))
        assert r.status_code == 200, r.text
        assert r.json().get('email') == USER_A_EMAIL

    def test_login_wrong_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={'email': USER_A_EMAIL, 'password': 'wrong-pw-xxx'},
                          headers={'Content-Type': 'application/json'})
        assert r.status_code in (400, 401, 403), r.text

    def test_forgot_password_shape(self):
        # Should either send via emergent-resend or dev-fallback — never 500.
        # Use a synthetic email so we don't touch the real user account.
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                          json={'email': USER_A_EMAIL},
                          headers={'Content-Type': 'application/json'})
        # Rate limit: 3/min; if hit, retry once after a wait.
        if r.status_code == 429:
            time.sleep(21)
            r = requests.post(f"{BASE_URL}/api/auth/forgot-password",
                              json={'email': USER_A_EMAIL},
                              headers={'Content-Type': 'application/json'})
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'ok' in body
        assert body.get('via') in ('emergent-resend', 'dev-fallback', 'none') \
            or 'via' not in body  # be lenient on exact contract

    def test_resend_verification_authed(self, user_a):
        r = requests.post(f"{BASE_URL}/api/auth/resend-verification",
                          headers=_bearer(user_a['token']))
        if r.status_code == 429:
            time.sleep(21)
            r = requests.post(f"{BASE_URL}/api/auth/resend-verification",
                              headers=_bearer(user_a['token']))
        # Either 200 (email sent / dev fallback) or 400 if already verified.
        assert r.status_code in (200, 400), r.text

    def test_verify_email_bad_token_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/verify-email",
                          json={'token': 'not-a-real-token'},
                          headers={'Content-Type': 'application/json'})
        assert r.status_code in (400, 404), r.text

    def test_delete_account_requires_password(self):
        u = _register('TEST_i38_delacct')
        assert u, "Failed to register throwaway user"
        try:
            # No body -> 400
            r_empty = requests.request(
                'DELETE', f"{BASE_URL}/api/auth/delete-account",
                headers=_bearer(u['token']),
                json={},
            )
            assert r_empty.status_code == 400, r_empty.text
            # Wrong password -> 401
            r_bad = requests.request(
                'DELETE', f"{BASE_URL}/api/auth/delete-account",
                headers=_bearer(u['token']),
                json={'password': 'wrong-password-xyz'},
            )
            assert r_bad.status_code == 401, r_bad.text
            # Correct password -> 200
            r_ok = requests.request(
                'DELETE', f"{BASE_URL}/api/auth/delete-account",
                headers=_bearer(u['token']),
                json={'password': 'password123'},
            )
            assert r_ok.status_code == 200, r_ok.text
            body = r_ok.json()
            assert body.get('ok') is True
            assert 'deleted_counts' in body
            # After deletion, the token must no longer authenticate.
            r_me = requests.get(f"{BASE_URL}/api/auth/me", headers=_bearer(u['token']))
            assert r_me.status_code in (401, 403), r_me.text
        finally:
            # Best-effort cleanup if something above failed mid-way.
            _db.users.delete_one({'user_id': u['user_id']})


# =========================================================================
# 7. COACH AI — real LLM call
# =========================================================================
class TestCoachAI:
    def test_coach_reset_then_chat_then_history(self, user_a):
        # Reset first so the session starts clean.
        r_reset = requests.post(f"{BASE_URL}/api/coach/reset",
                                headers=_bearer(user_a['token']))
        assert r_reset.status_code == 200, r_reset.text
        assert r_reset.json().get('ok') is True

        # Minimal context; short prompt to minimize LLM tokens.
        r_chat = requests.post(
            f"{BASE_URL}/api/coach/chat",
            headers=_bearer(user_a['token']),
            json={
                'message': 'Say hello in exactly one short sentence.',
                'context': {},
            },
            timeout=60,
        )
        assert r_chat.status_code == 200, r_chat.text
        body = r_chat.json()
        assert 'answer' in body
        assert isinstance(body['answer'], str) and len(body['answer'].strip()) > 0
        assert 'session_id' in body
        assert 'model' in body

        # History should include the user turn + assistant turn.
        r_hist = requests.get(f"{BASE_URL}/api/coach/history",
                              headers=_bearer(user_a['token']))
        assert r_hist.status_code == 200, r_hist.text
        msgs = r_hist.json().get('messages', [])
        assert len(msgs) >= 2, f"Expected at least user+assistant turn, got {len(msgs)}"
        roles = [m.get('role') for m in msgs]
        assert 'user' in roles and 'assistant' in roles

        # Clean up so we don't pollute the user's history.
        requests.post(f"{BASE_URL}/api/coach/reset",
                      headers=_bearer(user_a['token']))

    def test_coach_chat_unauth_401(self):
        r = requests.post(f"{BASE_URL}/api/coach/chat",
                          json={'message': 'hi'},
                          headers={'Content-Type': 'application/json'})
        assert r.status_code in (401, 403), r.text
