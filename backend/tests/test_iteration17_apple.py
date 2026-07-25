"""Iteration 17 — Apple Sign-In backend tests + auth regressions."""
import os
import time
import pytest
import requests
from jose import jwt

BASE_URL = os.environ.get('EXPO_BACKEND_URL', 'http://localhost:8001').rstrip('/')

ALEX_EMAIL = 'alex+test1@jaleter.app'
ALEX_PASSWORD = 'password123'


@pytest.fixture(scope='module')
def api():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='module')
def alex_token(api):
    r = api.post(f'{BASE_URL}/api/auth/login', json={'email': ALEX_EMAIL, 'password': ALEX_PASSWORD})
    assert r.status_code == 200, f'Login failed: {r.status_code} {r.text}'
    return r.json()['token']


# ---------------- A1 Apple endpoint ----------------
class TestAppleSignIn:
    def test_missing_body_returns_422(self, api):
        r = api.post(f'{BASE_URL}/api/auth/apple', json={})
        assert r.status_code == 422, f'expected 422, got {r.status_code}: {r.text}'

    def test_empty_identity_token(self, api):
        r = api.post(f'{BASE_URL}/api/auth/apple', json={'identity_token': ''})
        assert r.status_code == 401, f'expected 401, got {r.status_code}: {r.text}'
        assert 'Invalid Apple identity token' in r.json().get('detail', '')

    def test_malformed_header(self, api):
        r = api.post(f'{BASE_URL}/api/auth/apple', json={'identity_token': 'aaa.bbb.ccc'})
        assert r.status_code == 401
        assert 'malformed header' in r.json().get('detail', '')

    def test_fake_jwt_unknown_kid(self, api):
        token = jwt.encode(
            {'sub': 'abc', 'iss': 'https://appleid.apple.com', 'aud': 'com.emergent.nochangesmobile.fl0fmc'},
            'wrong-secret',
            algorithm='HS256',
            headers={'kid': 'zzzzzzzz'},
        )
        r = api.post(f'{BASE_URL}/api/auth/apple', json={'identity_token': token})
        assert r.status_code == 401, f'expected 401, got {r.status_code}: {r.text}'
        detail = r.json().get('detail', '')
        assert 'unknown key' in detail or 'verification failed' in detail, f'unexpected detail: {detail}'

    def test_apple_jwks_reachable(self):
        r = requests.get('https://appleid.apple.com/auth/keys', timeout=10)
        assert r.status_code == 200
        assert 'keys' in r.json()


# ---------------- A2 Regressions ----------------
class TestAuthRegressions:
    def test_register_new(self, api):
        ts = int(time.time())
        r = api.post(f'{BASE_URL}/api/auth/register', json={
            'name': 'QA Apple',
            'email': f'qa+apple-{ts}@example.com',
            'password': 'TestPass123!'
        })
        assert r.status_code == 200, f'{r.status_code} {r.text}'
        assert 'token' in r.json()

    def test_login_alex(self, api):
        r = api.post(f'{BASE_URL}/api/auth/login', json={'email': ALEX_EMAIL, 'password': ALEX_PASSWORD})
        assert r.status_code == 200
        assert r.json()['user']['email'] == ALEX_EMAIL

    def test_auth_me(self, api, alex_token):
        r = api.get(f'{BASE_URL}/api/auth/me', headers={'Authorization': f'Bearer {alex_token}'})
        assert r.status_code == 200
        assert r.json()['email'] == ALEX_EMAIL

    def test_forgot_reset_password_roundtrip(self, api):
        # forgot
        r = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': ALEX_EMAIL})
        assert r.status_code == 200, f'{r.status_code} {r.text}'
        body = r.json()
        assert body.get('ok') is True
        reset_token = body.get('reset_token')
        assert reset_token, f'expected reset_token in dev-fallback, got {body}'

        # reset to new password
        r2 = api.post(f'{BASE_URL}/api/auth/reset-password', json={
            'token': reset_token, 'new_password': 'NewPass123!'
        })
        assert r2.status_code == 200, f'{r2.status_code} {r2.text}'

        # login with new
        r3 = api.post(f'{BASE_URL}/api/auth/login', json={'email': ALEX_EMAIL, 'password': 'NewPass123!'})
        assert r3.status_code == 200

        # reset back — use new forgot cycle
        r4 = api.post(f'{BASE_URL}/api/auth/forgot-password', json={'email': ALEX_EMAIL})
        assert r4.status_code == 200
        back_token = r4.json().get('reset_token')
        assert back_token
        r5 = api.post(f'{BASE_URL}/api/auth/reset-password', json={
            'token': back_token, 'new_password': ALEX_PASSWORD
        })
        assert r5.status_code == 200
        # verify original works
        r6 = api.post(f'{BASE_URL}/api/auth/login', json={'email': ALEX_EMAIL, 'password': ALEX_PASSWORD})
        assert r6.status_code == 200

    def test_emergent_session_invalid_no_crash(self, api):
        r = api.post(f'{BASE_URL}/api/auth/emergent/session', json={'session_id': 'invalid'})
        assert r.status_code in (401, 502, 400), f'expected non-500, got {r.status_code}: {r.text}'
        assert r.status_code != 500


# ---------------- Feature endpoints regressions ----------------
class TestFeatureRegressions:
    def test_simplefin_link_demo(self, api, alex_token):
        # Fetch a demo setup token
        try:
            info = requests.get('https://beta-bridge.simplefin.org/simplefin/create', timeout=10)
            # If we cannot get token, skip
        except Exception:
            pytest.skip('Could not reach SimpleFIN demo')
        # Use demo setup token from documented developer page (they document a shared demo)
        # Fallback: try creating one via POST which returns a token in body
        try:
            demo_resp = requests.post('https://beta-bridge.simplefin.org/simplefin/create', timeout=10)
            if demo_resp.status_code == 200 and demo_resp.text.strip():
                setup_token = demo_resp.text.strip()
            else:
                pytest.skip(f'Could not create demo token: {demo_resp.status_code}')
        except Exception as e:
            pytest.skip(f'demo token fetch failed: {e}')

        r = api.post(
            f'{BASE_URL}/api/accounts/simplefin/link',
            json={'setup_token': setup_token},
            headers={'Authorization': f'Bearer {alex_token}'},
        )
        assert r.status_code == 200, f'{r.status_code} {r.text}'
        body = r.json()
        assert 'link_id' in body

    def test_accounts_all(self, api, alex_token):
        r = api.get(f'{BASE_URL}/api/accounts/all', headers={'Authorization': f'Bearer {alex_token}'})
        assert r.status_code == 200

    def test_payments_products(self, api, alex_token):
        r = api.get(f'{BASE_URL}/api/payments/products', headers={'Authorization': f'Bearer {alex_token}'})
        assert r.status_code == 200
        products = r.json().get('products') or r.json()
        # find coaching product
        found = False
        for p in products if isinstance(products, list) else products.values():
            if 'coach' in str(p).lower():
                found = True
                if isinstance(p, dict):
                    name = p.get('name', '')
                    assert 'Coaching Session (30 min)' == name or 'Coaching' in name
        assert found, f'coaching product not in: {products}'

    def test_checkout_coaching(self, api, alex_token):
        r = api.post(
            f'{BASE_URL}/api/payments/checkout',
            json={'product': 'coaching_session', 'platform': 'mobile'},
            headers={'Authorization': f'Bearer {alex_token}'},
        )
        assert r.status_code == 200, f'{r.status_code} {r.text}'
        body = r.json()
        assert 'checkout.stripe.com' in body.get('url', ''), f'url missing stripe host: {body}'
        assert body.get('product_name') == 'Coaching Session (30 min)', f"name: {body.get('product_name')}"

    def test_checkout_membership(self, api, alex_token):
        r = api.post(
            f'{BASE_URL}/api/payments/checkout',
            json={'product': 'jaleter_premium', 'platform': 'mobile'},
            headers={'Authorization': f'Bearer {alex_token}'},
        )
        assert r.status_code == 200, f'{r.status_code} {r.text}'
        assert 'checkout.stripe.com' in r.json().get('url', '')

    def test_coaching_bookings(self, api, alex_token):
        r = api.get(f'{BASE_URL}/api/coaching/bookings', headers={'Authorization': f'Bearer {alex_token}'})
        assert r.status_code == 200

    def test_user_membership(self, api, alex_token):
        r = api.get(f'{BASE_URL}/api/user/membership', headers={'Authorization': f'Bearer {alex_token}'})
        assert r.status_code == 200
