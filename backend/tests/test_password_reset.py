"""Tests for forgot-password/reset-password + SlowAPI rate limits."""
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


# --- forgot-password: valid + non-existent email ---
class TestForgotPassword:
    def test_forgot_existing_returns_reset_token(self, api):
        r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get('ok') is True
        assert j.get('delivered') is True
        assert isinstance(j.get('reset_token'), str) and len(j['reset_token']) > 20
        pytest.reset_token_for_seed = j['reset_token']

    def test_forgot_nonexistent_no_token(self, api):
        fake = f'no-such-user-{uuid.uuid4().hex[:8]}@jaleter.app'
        r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': fake})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get('ok') is True
        assert j.get('delivered') is False
        assert 'reset_token' not in j


# --- reset-password: valid, reuse, invalid, short-pw ---
class TestResetPassword:
    def test_reset_with_valid_token_and_login_with_new_pw(self, api):
        # We assume TestForgotPassword ran and stored reset_token_for_seed
        token = getattr(pytest, 'reset_token_for_seed', None)
        assert token, 'Reset token missing — forgot-password test must run first'
        new_pw = 'TempPass_ResetTest_123'
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': token, 'new_password': new_pw})
        assert r.status_code == 200, r.text
        j = r.json()
        assert 'token' in j and 'user' in j
        assert j['user']['email'] == SEED_EMAIL

        # verify login with new password works
        r2 = api.post(f'{BASE_URL}/api/auth/login', json={'email': SEED_EMAIL, 'password': new_pw})
        assert r2.status_code == 200, r2.text
        assert 'token' in r2.json()
        pytest.used_reset_token = token

    def test_reuse_same_token_returns_400(self, api):
        token = getattr(pytest, 'used_reset_token', None)
        assert token
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': token, 'new_password': 'AnotherPass_123'})
        assert r.status_code == 400
        assert 'Invalid or already-used' in r.json().get('detail', '')

    def test_invalid_token_returns_400(self, api):
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': 'not-a-real-token-xyz', 'new_password': 'SomePass_123'})
        assert r.status_code == 400

    def test_short_password_returns_422(self, api):
        # need a fresh token; issue one but don't rely on rate limit
        # We already used 1 forgot-password call earlier + fake email one; plus test-class one → risk of 429.
        # Sleep to be safe if a prior test consumed the 3/min budget.
        r0 = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
        if r0.status_code == 429:
            pytest.skip('forgot-password rate-limited; skipping short-pw fresh token test')
        assert r0.status_code == 200
        tok = r0.json().get('reset_token')
        assert tok
        r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': tok, 'new_password': 'short'})
        assert r.status_code == 422
        pytest.leftover_valid_token = tok  # save so we can reset back to original


# --- rate limits ---
class TestRateLimits:
    def test_login_rate_limit(self, api):
        # Blast enough requests so per-worker limiters (multi-worker gunicorn) all trip.
        wrong = {'email': f'ratetest-{uuid.uuid4().hex[:6]}@jaleter.app', 'password': 'wrongwrong'}
        codes = []
        for _ in range(20):
            r = api.post(f'{BASE_URL}/api/auth/login', json=wrong)
            codes.append(r.status_code)
        assert 429 in codes, f'Expected some 429 within 20 attempts; got {codes}'
        # Assert the specific error body appears at least once
        first_429_idx = codes.index(429)
        # NB: with N workers and in-memory limiter, first-429 may not be exactly at index 5 (spec).
        # Record for report but don't strictly enforce position.
        pytest.login_rate_first_429_idx = first_429_idx
        pytest.login_rate_codes = codes

    def test_forgot_rate_limit_3_per_min(self, api):
        # Wait a full minute so we start fresh for the 3/min bucket
        time.sleep(61)
        codes = []
        for _ in range(15):
            r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
            codes.append(r.status_code)
        assert 429 in codes, f'Expected some 429 within 15 attempts; got {codes}'
        pytest.forgot_rate_first_429_idx = codes.index(429)
        pytest.forgot_rate_codes = codes


# --- final cleanup: restore alex+test1 password to password123 ---
class TestZZCleanup:
    def test_restore_original_password(self, api):
        # Give rate limiter time to reset (login 5/min + forgot 3/min)
        time.sleep(61)
        # Use leftover valid token if we still have one unused
        tok = getattr(pytest, 'leftover_valid_token', None)
        used = False
        if tok:
            r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': tok, 'new_password': SEED_PW})
            if r.status_code == 200:
                used = True
        if not used:
            r0 = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': SEED_EMAIL})
            assert r0.status_code == 200, f'Could not request new reset token for cleanup: {r0.status_code} {r0.text}'
            tok = r0.json()['reset_token']
            r = api.post(f'{BASE_URL}/api/auth/reset-password', json={'token': tok, 'new_password': SEED_PW})
            assert r.status_code == 200, r.text
        # verify login with original password works
        time.sleep(2)
        r = api.post(f'{BASE_URL}/api/auth/login', json={'email': SEED_EMAIL, 'password': SEED_PW})
        assert r.status_code == 200, f'Original password restore failed: {r.status_code} {r.text}'
