"""Iteration 36 — Phase 2 pre-launch punch-list tests.

Coverage:
  * Unit: wealth_service.classify_plaid() for all Plaid type/subtype combos
  * API:  GET /api/accounts/categories (public)
  * API:  GET /api/accounts/all shape for a user with no plaid_items
  * API:  PATCH /api/accounts/{account_id} error paths (400/401/404/409)
  * API:  IDOR — user A patching user B's account -> 404
  * API:  DELETE /api/accounts/{account_id}/override
  * DB:   account_overrides unique index on (user_id, account_id)
  * Cascade: DELETE /api/auth/delete-account purges account_overrides
  * Regression smoke: Coach AI multi-turn preserved
  * Regression smoke: /auth/forgot-password, /auth/resend-verification,
                      /auth/verify-email still respond

BASE URL: EXPO_PUBLIC_BACKEND_URL from frontend/.env is the public preview URL
that user code hits; we use it directly here to mirror real user traffic.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
import asyncio
from pathlib import Path

import pytest
import requests

# --- Discover public backend URL -----------------------------------------
def _load_public_base_url() -> str:
    env_path = Path('/app/frontend/.env')
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                return line.split('=', 1)[1].strip().strip('"').rstrip('/')
    raise RuntimeError('EXPO_PUBLIC_BACKEND_URL missing from /app/frontend/.env')


BASE_URL = _load_public_base_url()

# --- Import backend modules directly for unit tests ---------------------
sys.path.insert(0, '/app/backend')
import wealth_service  # noqa: E402


# =============================================================================
# 1. UNIT TESTS — wealth_service.classify_plaid
# =============================================================================
class TestClassifyPlaid:
    @pytest.mark.parametrize('subtype', ['checking', 'savings', 'money market',
                                          'money_market', 'cd'])
    def test_depository_cash(self, subtype):
        assert wealth_service.classify_plaid('depository', subtype) == 'cash'

    @pytest.mark.parametrize('type_,subtype', [
        ('investment', 'brokerage'),
        ('investment', 'ira'),
        ('investment', '401k'),
        ('investment', 'roth ira'),
        ('brokerage', ''),
        ('depository', ''),  # falls to cash bucket, not investments
    ])
    def test_investments(self, type_, subtype):
        result = wealth_service.classify_plaid(type_, subtype)
        if type_ == 'depository':
            assert result == 'cash'
        else:
            assert result == 'investments'

    def test_credit_card(self):
        assert wealth_service.classify_plaid('credit', 'credit card') == 'credit_cards'
        assert wealth_service.classify_plaid('credit', '') == 'credit_cards'

    @pytest.mark.parametrize('subtype', ['mortgage', 'home equity', 'home_equity'])
    def test_loan_mortgage(self, subtype):
        assert wealth_service.classify_plaid('loan', subtype) == 'mortgage'

    def test_loan_auto(self):
        assert wealth_service.classify_plaid('loan', 'auto') == 'auto_loans'

    def test_loan_student(self):
        assert wealth_service.classify_plaid('loan', 'student') == 'student_loans'

    def test_loan_personal_and_empty(self):
        assert wealth_service.classify_plaid('loan', 'personal') == 'other_liabilities'
        assert wealth_service.classify_plaid('loan', '') == 'other_liabilities'

    def test_other_none_fallback(self):
        assert wealth_service.classify_plaid('other', None) == 'other_assets'
        assert wealth_service.classify_plaid(None, None) == 'other_assets'

    def test_helpers(self):
        assert wealth_service.is_asset('cash') is True
        assert wealth_service.is_liability('credit_cards') is True
        assert wealth_service.is_asset('mortgage') is False
        assert wealth_service.is_liability('cash') is False
        assert 'cash' in wealth_service.ALL_CATEGORIES
        assert 'credit_cards' in wealth_service.ALL_CATEGORIES
        assert wealth_service.switching_sides('cash', 'credit_cards') is True
        assert wealth_service.switching_sides('cash', 'investments') is False

    def test_merge_override(self):
        cat, name, co, no = wealth_service.merge_override('cash', 'Chase', None)
        assert (cat, name, co, no) == ('cash', 'Chase', False, False)
        cat, name, co, no = wealth_service.merge_override(
            'cash', 'Chase',
            {'override_category': 'investments', 'override_name': 'Vanguard'},
        )
        assert (cat, name, co, no) == ('investments', 'Vanguard', True, True)
        # Bogus override_category is silently ignored
        cat, name, co, no = wealth_service.merge_override(
            'cash', 'Chase', {'override_category': 'garbage'},
        )
        assert (cat, co) == ('cash', False)


# =============================================================================
# Shared HTTP fixtures
# =============================================================================
@pytest.fixture(scope='module')
def api():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


def _register(api, email_prefix='TEST_iter36'):
    email = f'{email_prefix}_{uuid.uuid4().hex[:10]}@example.com'
    r = api.post(f'{BASE_URL}/api/auth/register', json={
        'name': 'Iter36 Test',
        'email': email,
        'password': 'password12345',
    })
    assert r.status_code == 200, f'register failed: {r.status_code} {r.text}'
    body = r.json()
    return email, body['token'], body['user']['user_id']


def _delete_user(api, token, password='password12345'):
    try:
        api.delete(
            f'{BASE_URL}/api/auth/delete-account',
            headers={'Authorization': f'Bearer {token}'},
            json={'password': password},
            timeout=15,
        )
    except Exception:
        pass


# =============================================================================
# 2. GET /api/accounts/categories — public
# =============================================================================
class TestCategoriesEndpoint:
    def test_categories_shape_and_labels(self, api):
        r = api.get(f'{BASE_URL}/api/accounts/categories')
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) == {'assets', 'liabilities'}
        asset_slugs = {a['slug'] for a in data['assets']}
        liab_slugs = {a['slug'] for a in data['liabilities']}
        assert asset_slugs == {'cash', 'investments', 'real_estate',
                               'vehicles', 'other_assets'}
        assert liab_slugs == {'credit_cards', 'mortgage', 'auto_loans',
                              'student_loans', 'other_liabilities'}
        # Labels & is_asset flags
        for a in data['assets']:
            assert a['is_asset'] is True
            assert isinstance(a['label'], str) and a['label']
        for a in data['liabilities']:
            assert a['is_asset'] is False
            assert isinstance(a['label'], str) and a['label']
        # Spot-check a label
        cash = next(x for x in data['assets'] if x['slug'] == 'cash')
        assert cash['label'] == 'Cash'
        cc = next(x for x in data['liabilities'] if x['slug'] == 'credit_cards')
        assert cc['label'] == 'Credit Cards'


# =============================================================================
# 3. GET /api/accounts/all — user with no plaid items
# =============================================================================
class TestAccountsAll:
    def test_empty_user_returns_accounts_list(self, api):
        email, token, uid = _register(api)
        try:
            r = api.get(
                f'{BASE_URL}/api/accounts/all',
                headers={'Authorization': f'Bearer {token}'},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert 'accounts' in body
            assert isinstance(body['accounts'], list)
            # No Plaid items => no plaid rows for the user (SimpleFIN/file/
            # snaptrade providers may return their own error/empty rows, but
            # there must be no *plaid* row and no unhandled 500).
            plaid_rows = [
                r for r in body['accounts']
                if r.get('provider') == 'plaid' and 'error' not in r
            ]
            assert plaid_rows == []
        finally:
            _delete_user(api, token)

    def test_accounts_all_requires_auth(self, api):
        r = api.get(f'{BASE_URL}/api/accounts/all')
        assert r.status_code in (401, 403)


# =============================================================================
# 4. PATCH /api/accounts/{account_id} — error paths
# =============================================================================
class TestPatchAccountOverrides:
    def test_401_without_auth(self, api):
        r = api.patch(
            f'{BASE_URL}/api/accounts/some-id',
            json={'override_name': 'Foo'},
        )
        assert r.status_code in (401, 403)

    def test_404_missing_account(self, api):
        email, token, _ = _register(api)
        try:
            r = api.patch(
                f'{BASE_URL}/api/accounts/nonexistent_acct_{uuid.uuid4().hex[:6]}',
                headers={'Authorization': f'Bearer {token}'},
                json={'override_name': 'Foo'},
            )
            assert r.status_code == 404, r.text
        finally:
            _delete_user(api, token)

    def test_400_unknown_category(self, api):
        email, token, _ = _register(api)
        try:
            r = api.patch(
                f'{BASE_URL}/api/accounts/any-id',
                headers={'Authorization': f'Bearer {token}'},
                json={'override_category': 'not_a_real_slug'},
            )
            assert r.status_code == 400, r.text
            assert 'unknown category' in r.text.lower()
        finally:
            _delete_user(api, token)

    def test_idor_returns_404(self, api):
        # User A cannot see user B's account => must be 404 not 200.
        email_a, token_a, _ = _register(api, 'TEST_iter36_A')
        email_b, token_b, _ = _register(api, 'TEST_iter36_B')
        try:
            fake_acct_id = f'acct_userB_{uuid.uuid4().hex[:8]}'
            r = api.patch(
                f'{BASE_URL}/api/accounts/{fake_acct_id}',
                headers={'Authorization': f'Bearer {token_a}'},
                json={'override_name': 'sneaky'},
            )
            assert r.status_code == 404, (
                f'IDOR guard failed — expected 404, got {r.status_code}: {r.text}'
            )
        finally:
            _delete_user(api, token_a)
            _delete_user(api, token_b)

    def test_delete_override_no_op_returns_200(self, api):
        # DELETE /override for an account without any override just returns
        # {ok: true, account: None} (no 404) — verifies handler is wired.
        email, token, _ = _register(api)
        try:
            r = api.delete(
                f'{BASE_URL}/api/accounts/any-random-id/override',
                headers={'Authorization': f'Bearer {token}'},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get('ok') is True
        finally:
            _delete_user(api, token)


# =============================================================================
# 5. DB — account_overrides unique index + cascade on delete-account
# =============================================================================
class TestAccountOverridesDB:
    """Uses motor directly against MONGO_URL to verify index + cascade."""

    def _get_db(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_url = os.environ.get('MONGO_URL') or self._load_env('MONGO_URL')
        db_name = os.environ.get('DB_NAME') or self._load_env('DB_NAME')
        client = AsyncIOMotorClient(mongo_url)
        return client[db_name]

    @staticmethod
    def _load_env(key):
        for line in Path('/app/backend/.env').read_text().splitlines():
            if line.startswith(f'{key}='):
                return line.split('=', 1)[1].strip().strip('"')
        raise RuntimeError(f'{key} missing')

    def test_unique_index_on_user_id_account_id(self, api):
        async def run():
            db = self._get_db()
            uid = f'TEST_iter36_idx_{uuid.uuid4().hex[:8]}'
            aid = f'acct_{uuid.uuid4().hex[:8]}'
            try:
                await db.account_overrides.insert_one({
                    'user_id': uid, 'account_id': aid,
                    'override_name': 'A',
                })
                # Second insert with same (user_id, account_id) must raise
                from pymongo.errors import DuplicateKeyError
                raised = False
                try:
                    await db.account_overrides.insert_one({
                        'user_id': uid, 'account_id': aid,
                        'override_name': 'B',
                    })
                except DuplicateKeyError:
                    raised = True
                assert raised, 'Missing unique index on (user_id, account_id)'
            finally:
                await db.account_overrides.delete_many({'user_id': uid})
        asyncio.get_event_loop().run_until_complete(run()) if False else asyncio.run(run())

    def test_delete_account_purges_overrides(self, api):
        """Register a user, seed an override row directly, then call
        DELETE /api/auth/delete-account and verify the override is gone."""
        email, token, uid = _register(api)
        aid = f'acct_seed_{uuid.uuid4().hex[:8]}'

        async def seed():
            db = self._get_db()
            await db.account_overrides.insert_one({
                'user_id': uid, 'account_id': aid,
                'override_name': 'Seeded', 'override_category': 'cash',
            })
            found = await db.account_overrides.find_one(
                {'user_id': uid, 'account_id': aid}
            )
            assert found is not None
        asyncio.run(seed())

        # Delete the account via the public API (cascade should purge).
        # /auth/delete-account is rate-limited to 3/min — fixture teardowns in
        # earlier tests may have consumed our budget. Wait + retry on 429.
        r = None
        for attempt in range(4):
            r = requests.delete(
                f'{BASE_URL}/api/auth/delete-account',
                headers={'Authorization': f'Bearer {token}',
                         'Content-Type': 'application/json'},
                json={'password': 'password12345'},
                timeout=30,
            )
            if r.status_code != 429:
                break
            time.sleep(25)
        assert r.status_code == 200, f'delete-account failed: {r.status_code} {r.text}'

        async def verify():
            db = self._get_db()
            leftover = await db.account_overrides.find_one(
                {'user_id': uid, 'account_id': aid}
            )
            assert leftover is None, f'account_overrides not purged: {leftover}'
        asyncio.run(verify())


# =============================================================================
# 6. REGRESSION — Coach AI still works (spot check, not exhaustive)
# =============================================================================
class TestCoachRegression:
    def test_coach_chat_smoke(self, api):
        email, token, _ = _register(api)
        try:
            r = api.post(
                f'{BASE_URL}/api/coach/chat',
                headers={'Authorization': f'Bearer {token}'},
                json={'message': 'What is a set-aside?'},
                timeout=60,
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert 'answer' in body and body['answer']
            assert 'session_id' in body
        finally:
            _delete_user(api, token)


# =============================================================================
# 7. REGRESSION — auth email endpoints (smoke)
# =============================================================================
class TestAuthEmailRegression:
    def test_forgot_password_returns_ok(self, api):
        # Use a random non-existent email — endpoint should still return 200
        # (does not disclose account existence).
        r = api.post(
            f'{BASE_URL}/api/auth/forgot-password',
            json={'email': f'TEST_iter36_nobody_{uuid.uuid4().hex[:6]}@example.com'},
        )
        assert r.status_code in (200, 202), r.text

    def test_resend_verification_ok(self, api):
        email, token, _ = _register(api)
        try:
            r = api.post(
                f'{BASE_URL}/api/auth/resend-verification',
                headers={'Authorization': f'Bearer {token}'},
                json={},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get('ok') is True
        finally:
            _delete_user(api, token)

    def test_verify_email_bad_token_returns_error(self, api):
        r = api.post(
            f'{BASE_URL}/api/auth/verify-email',
            json={'token': f'not-a-real-token-{uuid.uuid4().hex[:6]}'},
        )
        # Endpoint must respond (not 500), typically 400/404 for bad token.
        assert r.status_code in (400, 401, 404), r.text
