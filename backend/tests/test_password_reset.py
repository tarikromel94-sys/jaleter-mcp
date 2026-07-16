"""Iteration 5 tests for forgot-password/reset-password/SendGrid branching + rate limits.

The deployed backend has SENDGRID_API_KEY="" and SENDGRID_FROM_EMAIL="" so the
'dev-fallback' branch is exercised against BASE_URL. To exercise the
'sendgrid' branch without pasting real credentials we build a local TestClient
against the same FastAPI app with SENDGRID_* env vars monkeypatched.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
SEED_EMAIL = 'alex+test1@jaleter.app'
SEED_PW = 'password123'


@pytest.fixture(scope='module')
def api():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


# --- SendGrid NOT configured (deployed backend, dev-fallback branch) ---
class TestForgotPasswordDevFallback:
    def test_forgot_existing_returns_reset_token_via_dev_fallback(self, api):
        r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get('ok') is True
        assert j.get('delivered') is False
        assert j.get('via') == 'dev-fallback'
        assert isinstance(j.get('reset_token'), str) and len(j['reset_token']) > 20
        assert 'SendGrid not configured' in (j.get('note') or '')
        pytest.reset_token_for_seed = j['reset_token']

    def test_forgot_nonexistent_enumeration_safe(self, api):
        fake = f'no-such-user-{uuid.uuid4().hex[:8]}@jaleter.app'
        r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': fake})
        assert r.status_code == 200, r.text
        j = r.json()
        # enumeration-safe: only ok + delivered, no leakage
        assert j.get('ok') is True
        assert j.get('delivered') is False
        assert 'reset_token' not in j
        assert 'via' not in j
        assert 'note' not in j


# --- SendGrid CONFIGURED (monkeypatched TestClient) ---
class TestForgotPasswordSendgridBranch:
    """Exercise the sendgrid branch via a local TestClient with monkeypatched env
    vars. The real SendGrid call fails (fake key) so delivered=false — that is
    the expected outcome per iteration spec.
    """

    def test_sendgrid_branch_hides_reset_token(self, monkeypatch):
        # Set env vars BEFORE importing server so is_configured() returns True
        monkeypatch.setenv('SENDGRID_API_KEY', 'SG.fake-test-key')
        monkeypatch.setenv('SENDGRID_FROM_EMAIL', 'sender@example.com')
        monkeypatch.setenv('SENDGRID_FROM_NAME', 'Jaleter')

        # Import here so env vars are already patched
        import importlib, sys
        # Force reimport of email_service so anything cached picks up env
        if 'email_service' in sys.modules:
            importlib.reload(sys.modules['email_service'])
        from email_service import is_configured
        assert is_configured() is True, 'email_service.is_configured() should be True with fake env vars'

        # Now hit the server module's forgot-password via TestClient
        if 'server' in sys.modules:
            importlib.reload(sys.modules['server'])
        from fastapi.testclient import TestClient
        import server as server_module
        client = TestClient(server_module.app)

        # Use a unique email to avoid rate-limit collision with other class
        # (the seed user exists so the sendgrid branch is triggered)
        r = client.post('/api/auth/forgot-password', json={'email': SEED_EMAIL})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get('ok') is True
        # Fake key → SendGrid call fails → delivered False (expected per spec)
        assert j.get('delivered') is False
        assert j.get('via') == 'sendgrid'
        assert 'reset_token' not in j, f'reset_token must NOT leak when SendGrid is configured; got {j}'
        assert 'note' not in j

        # Confirm token WAS stored in DB (admin could retrieve it manually)
        # Use pymongo (sync) to avoid motor's event-loop-closed issue with TestClient
        from pymongo import MongoClient
        sync_client = MongoClient(os.environ['MONGO_URL'])
        row = sync_client[os.environ['DB_NAME']].password_resets.find_one(
            {'email': SEED_EMAIL, 'used': False},
            sort=[('created_at', -1)],
        )
        sync_client.close()
        assert row is not None, 'reset token should be persisted in DB even when API hides it'
        assert isinstance(row.get('token'), str) and len(row['token']) > 20


# --- reset-password end-to-end ---
class TestResetPasswordFlow:
    def test_reset_with_valid_token_and_login_with_new_pw(self, api):
        # Wait a bit — the sendgrid-branch test just consumed a forgot-password
        # slot on the deployed backend? NO — TestClient hits the local app, so
        # the deployed rate-limit bucket is not affected. Safe to proceed.
        token = getattr(pytest, 'reset_token_for_seed', None)
        assert token, 'Reset token missing — TestForgotPasswordDevFallback must run first'
        new_pw = 'TempPass_ResetTest_123'
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': token, 'new_password': new_pw})
        assert r.status_code == 200, r.text
        j = r.json()
        assert 'token' in j and 'user' in j
        assert j['user']['email'] == SEED_EMAIL

        # Verify login with new pw works
        r2 = api.post(f'{BASE_URL}/api/auth/login', json={'email': SEED_EMAIL, 'password': new_pw})
        assert r2.status_code == 200, r2.text
        assert 'token' in r2.json()
        pytest.new_pw_used = new_pw

    def test_reuse_token_returns_400(self, api):
        token = getattr(pytest, 'reset_token_for_seed', None)
        assert token
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': token, 'new_password': 'AnotherPass_123'})
        assert r.status_code == 400


# --- SlowAPI rate limits: 4th forgot within a minute → 429 ---
class TestRateLimit:
    def test_forgot_rate_limit_4th_returns_429(self, api):
        # Wait to ensure fresh 1-minute window (previous class used ≥2 slots)
        time.sleep(61)
        codes = []
        for i in range(6):
            r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
            codes.append(r.status_code)
        assert 429 in codes, f'Expected 429 within 6 rapid attempts; got {codes}'
        # Per spec: 4th call within a minute should be limited (index 3)
        # With multi-worker uvicorn + in-memory SlowAPI, first 429 may land at
        # index 3..(3*N-1). Record but do not strictly assert exact index.
        pytest.forgot_codes = codes
        pytest.forgot_first_429 = codes.index(429)


# --- final cleanup: restore alex+test1 → password123 ---
class TestZZRestore:
    def test_restore_password(self, api):
        time.sleep(61)  # let rate limits reset
        r0 = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
        assert r0.status_code == 200, r0.text
        j = r0.json()
        # We're on the dev-fallback backend so token comes back
        assert j.get('reset_token'), f'expected reset_token in dev-fallback response; got {j}'
        tok = j['reset_token']
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': tok, 'new_password': SEED_PW})
        assert r.status_code == 200, r.text
        time.sleep(2)
        # verify original creds work
        r2 = api.post(f'{BASE_URL}/api/auth/login', json={'email': SEED_EMAIL, 'password': SEED_PW})
        assert r2.status_code == 200, f'Password restore verify failed: {r2.status_code} {r2.text}'
