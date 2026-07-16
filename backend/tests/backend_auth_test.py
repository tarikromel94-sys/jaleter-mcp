"""Backend auth tests for Jaleter — registration, login, /me, logout, emergent."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope='module')
def api():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='module')
def new_user_creds():
    return {
        'name': 'TEST User',
        'email': f'test_{uuid.uuid4().hex[:10]}@jaleter.app',
        'password': 'password123',
    }


class TestHealth:
    def test_root(self, api):
        r = api.get(f'{BASE_URL}/api/')
        assert r.status_code == 200
        assert r.json().get('status') == 'ok'


class TestRegisterLogin:
    def test_register_success(self, api, new_user_creds):
        r = api.post(f'{BASE_URL}/api/auth/register', json=new_user_creds)
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'token' in body and 'user' in body
        assert body['user']['email'] == new_user_creds['email']
        assert body['user']['provider'] == 'password'
        pytest.token = body['token']
        pytest.user_id = body['user']['user_id']

    def test_register_duplicate(self, api, new_user_creds):
        r = api.post(f'{BASE_URL}/api/auth/register', json=new_user_creds)
        assert r.status_code == 400
        assert 'already' in r.json().get('detail', '').lower()

    def test_login_success(self, api, new_user_creds):
        r = api.post(f'{BASE_URL}/api/auth/login',
                     json={'email': new_user_creds['email'], 'password': new_user_creds['password']})
        assert r.status_code == 200
        body = r.json()
        assert body['user']['email'] == new_user_creds['email']
        assert 'token' in body

    def test_login_wrong_password(self, api, new_user_creds):
        r = api.post(f'{BASE_URL}/api/auth/login',
                     json={'email': new_user_creds['email'], 'password': 'wrongwrongwrong'})
        assert r.status_code == 401

    def test_login_seed_user(self, api):
        r = api.post(f'{BASE_URL}/api/auth/login',
                     json={'email': 'alex+test1@jaleter.app', 'password': 'password123'})
        assert r.status_code == 200, r.text
        assert r.json()['user']['email'] == 'alex+test1@jaleter.app'


class TestMe:
    def test_me_without_token(self, api):
        # New session, no auth header
        r = requests.get(f'{BASE_URL}/api/auth/me')
        assert r.status_code == 401

    def test_me_invalid_token(self, api):
        r = requests.get(f'{BASE_URL}/api/auth/me',
                         headers={'Authorization': 'Bearer bogus.token.xyz'})
        assert r.status_code == 401

    def test_me_with_valid_token(self, api, new_user_creds):
        token = getattr(pytest, 'token', None)
        assert token, 'register test must run first'
        r = requests.get(f'{BASE_URL}/api/auth/me',
                         headers={'Authorization': f'Bearer {token}'})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['email'] == new_user_creds['email']
        assert body['user_id'] == pytest.user_id


class TestLogout:
    def test_logout_ok(self, api):
        token = getattr(pytest, 'token', None)
        r = requests.post(f'{BASE_URL}/api/auth/logout',
                          headers={'Authorization': f'Bearer {token}'})
        assert r.status_code == 200
        assert r.json().get('ok') is True

    def test_logout_no_token(self, api):
        r = requests.post(f'{BASE_URL}/api/auth/logout')
        assert r.status_code == 200  # endpoint accepts missing bearer gracefully


class TestEmergent:
    def test_emergent_invalid_session(self, api):
        r = requests.post(f'{BASE_URL}/api/auth/emergent/session',
                          json={'session_id': 'invalid-session-id-xyz'})
        assert r.status_code == 401
