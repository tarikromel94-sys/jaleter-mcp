"""Iteration 92 backend verification for the RC identity-binding paywall fix.

Scope (per review_request):
  • Register fresh user via API → user_id starts with 'user_'
  • GET /api/auth/me returns that same user_id
  • GET /api/user/membership (fresh) → active:false
  • After POSTing /api/iap/sync (ACTIVE snapshot) → active:true, source=='iap'
  • A SECOND fresh user still sees active:false (purchases don't leak)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ["EXPO_BACKEND_URL"]
BASE_URL = BASE_URL.rstrip("/")


def _register():
    """Register a brand-new throwaway user; return (token, user)."""
    ts = int(time.time() * 1000)
    email = f"iter92+{ts}@example.com"
    res = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": "Iter92", "email": email, "password": "TestPass123!"},
        timeout=15,
    )
    assert res.status_code == 200, f"register failed: {res.status_code} {res.text}"
    data = res.json()
    assert "token" in data and "user" in data
    return data["token"], data["user"]


@pytest.fixture(scope="module")
def user_a():
    # Avoid hitting the 10/min register rate limit by pacing between fixtures.
    t, u = _register()
    yield t, u


@pytest.fixture(scope="module")
def user_b():
    time.sleep(2)
    t, u = _register()
    yield t, u


class TestIdentity:
    def test_register_returns_prefixed_user_id(self, user_a):
        _, user = user_a
        assert str(user["user_id"]).startswith("user_"), user

    def test_me_matches_registered_user(self, user_a):
        token, user = user_a
        res = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert res.status_code == 200, res.text
        me = res.json()
        assert me["user_id"] == user["user_id"]
        assert me["email"] == user["email"]


class TestMembership:
    def test_fresh_user_has_no_membership(self, user_a):
        token, _ = user_a
        res = requests.get(
            f"{BASE_URL}/api/user/membership",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("active") is False, body

    def test_iap_sync_unlocks_member(self, user_a):
        token, _ = user_a
        future = "2099-01-01T00:00:00Z"
        res = requests.post(
            f"{BASE_URL}/api/iap/sync",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "active": True,
                "expires_at": future,
                "product_id": "jaleter_premium_annual",
                "platform": "web",
            },
            timeout=15,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("active") is True, body

        # Verify via GET
        chk = requests.get(
            f"{BASE_URL}/api/user/membership",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert chk.status_code == 200
        m = chk.json()
        assert m.get("active") is True
        src = m.get("source") or m.get("provider") or ""
        assert src == "iap" or m.get("source") == "iap", f"expected source=iap, got {m}"

    def test_other_user_does_not_inherit_membership(self, user_a, user_b):
        # User A was just unlocked above; User B must still be free.
        token_b, user_b_obj = user_b
        assert user_b_obj["user_id"] != user_a[1]["user_id"]
        res = requests.get(
            f"{BASE_URL}/api/user/membership",
            headers={"Authorization": f"Bearer {token_b}"},
            timeout=10,
        )
        assert res.status_code == 200
        body = res.json()
        assert body.get("active") is False, body
