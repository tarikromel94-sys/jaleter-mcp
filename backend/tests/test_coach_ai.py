"""Backend tests for Coach AI (GPT-5.6-Terra) endpoints.

Endpoints covered:
  - POST /api/coach/chat  (auth, persistence, context grounding, multi-turn)
  - GET  /api/coach/history (sort order, IDOR)
  - POST /api/coach/reset (clear session)
  - DELETE /api/auth/delete-account cascade → coach_messages purge
  - Regression: /api/auth/login, /api/auth/me, /api/auth/forgot-password
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

ALEX_EMAIL = 'alex+test1@jaleter.app'
ALEX_PASSWORD = 'password123'


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={'email': email, 'password': password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()['token']


def _register_temp():
    email = f"TEST_coach_{uuid.uuid4().hex[:10]}@jaleter.app"
    password = 'password123'
    r = requests.post(f"{API}/auth/register",
                      json={'name': 'Temp Coach', 'email': email, 'password': password}, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return email, password, r.json()['token']


# ---- Fixtures -------------------------------------------------------------
@pytest.fixture(scope='module')
def alex_token():
    return _login(ALEX_EMAIL, ALEX_PASSWORD)


@pytest.fixture()
def temp_user():
    email, password, token = _register_temp()
    yield {'email': email, 'password': password, 'token': token}
    # cleanup: best-effort delete
    try:
        requests.delete(f"{API}/auth/delete-account",
                        json={'password': password},
                        headers={'Authorization': f'Bearer {token}'}, timeout=30)
    except Exception:
        pass


def _auth(tok):
    return {'Authorization': f'Bearer {tok}'}


# ---- Auth enforcement -----------------------------------------------------
class TestCoachAuthEnforcement:
    def test_chat_requires_auth(self):
        r = requests.post(f"{API}/coach/chat", json={'message': 'hi'}, timeout=15)
        assert r.status_code == 401

    def test_history_requires_auth(self):
        r = requests.get(f"{API}/coach/history", timeout=15)
        assert r.status_code == 401

    def test_reset_requires_auth(self):
        r = requests.post(f"{API}/coach/reset", timeout=15)
        assert r.status_code == 401


# ---- Chat basic + persistence ---------------------------------------------
class TestCoachChatBasic:
    def test_chat_success_and_persistence(self, temp_user):
        tok = temp_user['token']
        # Clear any prior state (default session)
        requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)

        r = requests.post(f"{API}/coach/chat",
                          json={'message': 'Say hello in one sentence.'},
                          headers=_auth(tok), timeout=90)
        assert r.status_code == 200, f"chat failed: {r.status_code} {r.text}"
        data = r.json()
        assert 'session_id' in data
        assert 'answer' in data
        assert isinstance(data['answer'], str) and len(data['answer']) > 0
        assert data.get('model') == 'gpt-5.6-terra', f"unexpected model: {data.get('model')}"

        # Verify persistence via history
        h = requests.get(f"{API}/coach/history",
                         headers=_auth(tok), timeout=30)
        assert h.status_code == 200
        msgs = h.json().get('messages', [])
        roles = [m.get('role') for m in msgs]
        assert 'user' in roles and 'assistant' in roles
        # Sorted by created_at asc: user before assistant
        user_idx = roles.index('user')
        asst_idx = roles.index('assistant')
        assert user_idx < asst_idx
        # required fields present
        for m in msgs:
            assert 'role' in m and 'content' in m and 'session_id' in m and 'created_at' in m


# ---- Multi-turn conversation ----------------------------------------------
class TestCoachMultiTurn:
    def test_context_retained_between_turns(self, temp_user):
        tok = temp_user['token']
        requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)

        r1 = requests.post(f"{API}/coach/chat",
                           json={'message': 'My favorite color is teal, remember it.'},
                           headers=_auth(tok), timeout=90)
        assert r1.status_code == 200, r1.text
        sid = r1.json()['session_id']

        r2 = requests.post(f"{API}/coach/chat",
                           json={'message': 'What color did I mention?', 'session_id': sid},
                           headers=_auth(tok), timeout=90)
        assert r2.status_code == 200, r2.text
        answer = r2.json()['answer'].lower()
        assert 'teal' in answer, f"model did not retain multi-turn context — answer: {r2.json()['answer']}"


# ---- Context grounding ----------------------------------------------------
class TestCoachContextGrounding:
    def test_net_worth_grounding(self, temp_user):
        tok = temp_user['token']
        requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)
        payload = {
            'message': 'What is my net worth? Please state the exact number from my data.',
            'context': {'netWorth': 47325.50}
        }
        r = requests.post(f"{API}/coach/chat", json=payload, headers=_auth(tok), timeout=90)
        assert r.status_code == 200, r.text
        answer = r.json()['answer']
        assert '47' in answer and '325' in answer, f"answer missing net worth: {answer}"

    def test_transaction_grounding(self, temp_user):
        tok = temp_user['token']
        requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)
        payload = {
            'message': 'How much did I spend at Starbucks? Give me the exact amount from my data.',
            'context': {
                'transactions': [{
                    'merchant': 'Starbucks',
                    'amount': 12,
                    'type': 'expense',
                    'date': '2026-01-15'
                }]
            }
        }
        r = requests.post(f"{API}/coach/chat", json=payload, headers=_auth(tok), timeout=90)
        assert r.status_code == 200, r.text
        answer = r.json()['answer']
        assert '12' in answer, f"answer missing amount 12: {answer}"


# ---- History IDOR ---------------------------------------------------------
class TestCoachHistoryIDOR:
    def test_history_excludes_other_users(self, temp_user):
        """User B must not see User A's messages when requesting same session id shape."""
        tok_a = temp_user['token']
        # seed A's history
        requests.post(f"{API}/coach/reset", headers=_auth(tok_a), timeout=15)
        r_a = requests.post(f"{API}/coach/chat",
                            json={'message': 'Remember the codeword: RUBYSTAR.'},
                            headers=_auth(tok_a), timeout=90)
        assert r_a.status_code == 200
        sid_a = r_a.json()['session_id']

        # register B
        email_b, pw_b, tok_b = _register_temp()
        try:
            # B queries A's session_id explicitly (IDOR attempt)
            h = requests.get(f"{API}/coach/history",
                             params={'session_id': sid_a},
                             headers=_auth(tok_b), timeout=30)
            assert h.status_code == 200
            msgs = h.json().get('messages', [])
            # B should see zero messages because the query is scoped by user_id
            joined = ' '.join(m.get('content', '') for m in msgs)
            assert 'RUBYSTAR' not in joined, "IDOR: user B saw user A's messages!"
            assert len(msgs) == 0, f"user B leaked messages: {msgs}"
        finally:
            requests.delete(f"{API}/auth/delete-account",
                            json={'password': pw_b},
                            headers=_auth(tok_b), timeout=30)


# ---- Reset flow -----------------------------------------------------------
class TestCoachReset:
    def test_reset_wipes_default_session(self, temp_user):
        tok = temp_user['token']
        r = requests.post(f"{API}/coach/chat",
                          json={'message': 'A short reply please.'},
                          headers=_auth(tok), timeout=90)
        assert r.status_code == 200

        h_before = requests.get(f"{API}/coach/history", headers=_auth(tok), timeout=30)
        assert h_before.status_code == 200
        before_count = len(h_before.json().get('messages', []))
        assert before_count >= 2

        rr = requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)
        assert rr.status_code == 200
        assert rr.json().get('ok') is True

        h_after = requests.get(f"{API}/coach/history", headers=_auth(tok), timeout=30)
        assert h_after.status_code == 200
        assert len(h_after.json().get('messages', [])) == 0


# ---- Delete-account cascade ----------------------------------------------
class TestDeleteAccountCascade:
    def test_delete_account_purges_coach_messages(self):
        email, pw, tok = _register_temp()
        # seed a message
        r = requests.post(f"{API}/coach/chat",
                          json={'message': 'Just a quick hello.'},
                          headers=_auth(tok), timeout=90)
        assert r.status_code == 200
        sid = r.json()['session_id']

        # confirm history exists
        h = requests.get(f"{API}/coach/history", headers=_auth(tok), timeout=30)
        assert h.status_code == 200 and len(h.json().get('messages', [])) >= 2

        # delete account
        d = requests.delete(f"{API}/auth/delete-account",
                            json={'password': pw},
                            headers=_auth(tok), timeout=30)
        assert d.status_code == 200, d.text
        body = d.json()
        # The response includes deleted_counts keyed by collection name
        assert 'deleted_counts' in body
        # coach_messages must be listed and >=2
        cm = body['deleted_counts'].get('coach_messages', 0)
        assert cm >= 2, f"coach_messages not cascaded: {body['deleted_counts']}"


# ---- Rate-limit (soft check) ---------------------------------------------
class TestRateLimit:
    def test_chat_rate_limit_20_per_minute(self, temp_user):
        """Fire 25 back-to-back requests; expect at least one 429 kicked in.
        Marked as skip-on-failure because Emergent proxy may also 429 with different code."""
        tok = temp_user['token']
        requests.post(f"{API}/coach/reset", headers=_auth(tok), timeout=15)
        codes = []
        # Use tiny fast-fail messages
        for i in range(25):
            try:
                r = requests.post(f"{API}/coach/chat",
                                  json={'message': f'ping {i}'},
                                  headers=_auth(tok), timeout=30)
                codes.append(r.status_code)
                if r.status_code == 429:
                    break
            except Exception:
                codes.append(-1)
        assert 429 in codes, f"expected a 429 in first 25 rapid requests, got codes={codes}"


# ---- Regression tests ----------------------------------------------------
class TestAuthRegression:
    def test_login_still_works(self, alex_token):
        assert isinstance(alex_token, str) and len(alex_token) > 20

    def test_me_endpoint(self, alex_token):
        r = requests.get(f"{API}/auth/me", headers=_auth(alex_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body.get('email') == ALEX_EMAIL

    def test_forgot_password_still_works(self):
        r = requests.post(f"{API}/auth/forgot-password", json={'email': ALEX_EMAIL}, timeout=30)
        # 200 for both delivered and dev-fallback; possibly 429 if hammered
        assert r.status_code in (200, 429), r.text
        if r.status_code == 200:
            body = r.json()
            assert body.get('ok') is True
