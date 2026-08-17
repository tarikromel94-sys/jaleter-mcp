"""Backend tests for server-side Budget Alerts (Jaleter).

Coverage:
  - Auth gating on /api/notifications/* and /api/register-push
  - Prefs GET/PUT normalization + persistence
  - evaluate-budget 80% / 100% / dedupe / 50% (only when enabled)
  - evaluate-transaction (large + dedupe + polarity + missing id)
  - Prefs off suppresses everything
  - Notification inbox (list, unread-count, mark-read, mark-all-read)
  - Push relay resilience (401 upstream tolerated, spoof check)
  - Existing endpoints regression smoke
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = "https://no-changes-mobile.preview.emergentagent.com"
API = f"{BASE_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_EMAIL = "push+test1@jaleter.app"
TEST_PW = "password123"
TEST_NAME = "Push Test"


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_ctx(session, mongo):
    """Register (or login) test user, clear state, return (token, user_id)."""
    # Try register
    r = session.post(f"{API}/auth/register",
                     json={"name": TEST_NAME, "email": TEST_EMAIL, "password": TEST_PW})
    token, user_id = None, None
    if r.status_code == 200:
        j = r.json()
        token = j["token"]
        user_id = j["user"]["user_id"]
    else:
        # fallback to login (either existing user or rate limit)
        for _ in range(3):
            r2 = session.post(f"{API}/auth/login",
                              json={"email": TEST_EMAIL, "password": TEST_PW})
            if r2.status_code == 200:
                j = r2.json()
                token = j["token"]
                user_id = j["user"]["user_id"]
                break
            # fall back to seeded credentials
            r3 = session.post(f"{API}/auth/login",
                              json={"email": "alex+test1@jaleter.app", "password": "password123"})
            if r3.status_code == 200:
                j = r3.json()
                token = j["token"]
                user_id = j["user"]["user_id"]
                break
            time.sleep(2)
    assert token, f"Could not obtain token. last status {r.status_code} body {r.text[:200]}"

    # Clean slate: alert_state, notifications, alert_prefs for this user.
    mongo.alert_state.delete_many({"_id": {"$regex": f"^u/{user_id}/"}})
    mongo.notifications.delete_many({"user_id": user_id})
    mongo.users.update_one({"user_id": user_id}, {"$unset": {"alert_prefs": ""}})
    return {"token": token, "user_id": user_id}


@pytest.fixture()
def auth_headers(user_ctx):
    return {"Authorization": f"Bearer {user_ctx['token']}",
            "Content-Type": "application/json"}


# ------------------------------------------------------------------- #
# 1) Auth gating                                                      #
# ------------------------------------------------------------------- #
class TestAuthGating:
    @pytest.mark.parametrize("method,path,body", [
        ("GET",   "/notifications/prefs", None),
        ("PUT",   "/notifications/prefs", {"enabled": True}),
        ("GET",   "/notifications", None),
        ("GET",   "/notifications/unread-count", None),
        ("POST",  "/notifications/mark-all-read", None),
        ("POST",  "/notifications/evaluate-budget", {"categories": []}),
        ("POST",  "/notifications/evaluate-transaction", {"amount": 10}),
        ("POST",  "/register-push",
         {"user_id": "x", "platform": "ios", "device_token": "t"}),
    ])
    def test_requires_auth(self, session, method, path, body):
        r = session.request(method, f"{API}{path}", json=body)
        assert r.status_code in (401, 403), \
            f"{method} {path} expected 401/403 got {r.status_code}: {r.text[:120]}"


# ------------------------------------------------------------------- #
# 2/3) Prefs                                                           #
# ------------------------------------------------------------------- #
class TestPrefs:
    def test_default_prefs_shape(self, session, auth_headers):
        r = session.get(f"{API}/notifications/prefs", headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["enabled"] is True
        assert j["perCategory"] == {}
        assert j["singleExpense"]["enabled"] is False
        assert float(j["singleExpense"]["threshold"]) == 200.0

    def test_put_prefs_normalizes_and_persists(self, session, auth_headers):
        body = {
            "enabled": True,
            "perCategory": {"sub1": {"p50": True, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 100},
        }
        r = session.put(f"{API}/notifications/prefs",
                        headers=auth_headers, json=body)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["enabled"] is True
        assert j["perCategory"]["sub1"] == {"p50": True, "p80": True, "exceeded": True}
        assert j["singleExpense"] == {"enabled": True, "threshold": 100.0}

        # GET again
        r2 = session.get(f"{API}/notifications/prefs", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json() == j


# ------------------------------------------------------------------- #
# 4) evaluate-budget: 80% + 100% + dedupe                              #
# ------------------------------------------------------------------- #
class TestEvaluateBudget:
    def test_80_and_100_then_dedup(self, session, auth_headers, mongo, user_ctx):
        # unique sub ids for isolation
        sub_a = "sub_a_101"
        sub_b = "sub_a_102"
        # Turn on p80+exceeded for both sub_ids
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": True,
            "perCategory": {
                sub_a: {"p50": False, "p80": True, "exceeded": True},
                sub_b: {"p50": False, "p80": True, "exceeded": True},
            },
            "singleExpense": {"enabled": False, "threshold": 200},
        })
        body = {"period": "2026-08", "categories": [
            {"sub_id": sub_a, "name": "Groceries", "parent_name": "Food",
             "spent": 85, "budget": 100},
            {"sub_id": sub_b, "name": "Dining", "parent_name": "Food",
             "spent": 150, "budget": 100},
        ]}
        r = session.post(f"{API}/notifications/evaluate-budget",
                         headers=auth_headers, json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        types = sorted([c["type"] for c in created])
        assert types == ["category_100", "category_80"], f"Unexpected: {types}"
        # Confirm they came out per category
        by_type = {c["type"]: c for c in created}
        assert by_type["category_80"]["category_id"] == sub_a
        assert by_type["category_100"]["category_id"] == sub_b

        # Re-POST identical body — dedup
        r2 = session.post(f"{API}/notifications/evaluate-budget",
                          headers=auth_headers, json=body)
        assert r2.status_code == 200
        assert r2.json()["created"] == []

    def test_50_only_when_enabled_and_dedup(self, session, auth_headers, mongo, user_ctx):
        sub_c = "sub_50_201"
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": True,
            "perCategory": {sub_c: {"p50": True, "p80": False, "exceeded": False}},
            "singleExpense": {"enabled": False, "threshold": 200},
        })
        body = {"period": "2026-08", "categories": [
            {"sub_id": sub_c, "name": "X", "spent": 60, "budget": 100},
        ]}
        r = session.post(f"{API}/notifications/evaluate-budget",
                         headers=auth_headers, json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1 and created[0]["type"] == "category_50", created

        r2 = session.post(f"{API}/notifications/evaluate-budget",
                          headers=auth_headers, json=body)
        assert r2.json()["created"] == []


# ------------------------------------------------------------------- #
# 6) evaluate-transaction                                              #
# ------------------------------------------------------------------- #
class TestEvaluateTransaction:
    def test_large_dedup_polarity_missing_id(self, session, auth_headers):
        # Ensure singleExpense on at threshold 100
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": True,
            "perCategory": {},
            "singleExpense": {"enabled": True, "threshold": 100},
        })
        r = session.post(f"{API}/notifications/evaluate-transaction",
                         headers=auth_headers,
                         json={"id": "tx_alrt_1", "amount": 250, "name": "Best Buy"})
        assert r.status_code == 200, r.text
        c = r.json()["created"]
        assert c and c["type"] == "large_transaction", c

        # Re-post same id → dedup
        r2 = session.post(f"{API}/notifications/evaluate-transaction",
                          headers=auth_headers,
                          json={"id": "tx_alrt_1", "amount": 250, "name": "Best Buy"})
        assert r2.json()["created"] is None

        # Below threshold → null
        r3 = session.post(f"{API}/notifications/evaluate-transaction",
                          headers=auth_headers,
                          json={"id": "tx_alrt_lo", "amount": 50, "name": "Coffee"})
        assert r3.json()["created"] is None

        # Refund / negative → null
        r4 = session.post(f"{API}/notifications/evaluate-transaction",
                          headers=auth_headers,
                          json={"id": "tx_alrt_neg", "amount": -500, "name": "Refund"})
        assert r4.json()["created"] is None

        # Missing id → null
        r5 = session.post(f"{API}/notifications/evaluate-transaction",
                          headers=auth_headers,
                          json={"amount": 500, "name": "Orphan"})
        assert r5.json()["created"] is None


# ------------------------------------------------------------------- #
# 7) Prefs off suppresses everything                                   #
# ------------------------------------------------------------------- #
class TestPrefsOff:
    def test_off_then_on(self, session, auth_headers, mongo, user_ctx):
        sub_x = "sub_off_301"
        # Off
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": False,
            "perCategory": {sub_x: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 100},
        })
        body = {"period": "2026-08", "categories": [
            {"sub_id": sub_x, "name": "Y", "spent": 200, "budget": 100},
        ]}
        r = session.post(f"{API}/notifications/evaluate-budget",
                         headers=auth_headers, json=body)
        assert r.status_code == 200
        assert r.json()["created"] == []

        # Confirm no dedup slot was claimed
        row = mongo.alert_state.find_one(
            {"_id": f"u/{user_ctx['user_id']}/2026-08/{sub_x}/category_100"})
        assert row is None, "prefs.off must not claim a dedup slot"

        # Back on — same sub_id should now emit
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": True,
            "perCategory": {sub_x: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 100},
        })
        r2 = session.post(f"{API}/notifications/evaluate-budget",
                          headers=auth_headers, json=body)
        c = r2.json()["created"]
        assert len(c) == 1 and c[0]["type"] == "category_100", c


# ------------------------------------------------------------------- #
# 8) Notification inbox                                                #
# ------------------------------------------------------------------- #
class TestInbox:
    def test_list_and_read_flow(self, session, auth_headers):
        r = session.get(f"{API}/notifications", headers=auth_headers)
        assert r.status_code == 200
        items = r.json()["notifications"]
        assert isinstance(items, list) and len(items) > 0
        first = items[0]
        for k in ("id", "type", "title", "body", "created_at", "read_at"):
            assert k in first, f"missing {k} in {first}"

        # unread-count > 0
        r2 = session.get(f"{API}/notifications/unread-count", headers=auth_headers)
        assert r2.status_code == 200
        before = r2.json()["unread"]
        assert isinstance(before, int) and before > 0

        # find one unread and mark read
        unread = [i for i in items if not i.get("read_at")]
        assert unread, "expected at least one unread"
        target = unread[0]
        r3 = session.patch(f"{API}/notifications/{target['id']}/read",
                           headers=auth_headers)
        assert r3.status_code == 200, r3.text

        r4 = session.get(f"{API}/notifications/unread-count", headers=auth_headers)
        after = r4.json()["unread"]
        assert after == before - 1, (before, after)

        # mark-all-read
        r5 = session.post(f"{API}/notifications/mark-all-read",
                          headers=auth_headers)
        assert r5.status_code == 200
        r6 = session.get(f"{API}/notifications/unread-count", headers=auth_headers)
        assert r6.json()["unread"] == 0


# ------------------------------------------------------------------- #
# 9) Push relay resilience                                             #
# ------------------------------------------------------------------- #
class TestPushRelay:
    def test_register_push_upstream_401_tolerated(self, session, auth_headers, user_ctx):
        r = session.post(f"{API}/register-push", headers=auth_headers,
                         json={"user_id": user_ctx["user_id"],
                               "platform": "ios", "device_token": "tok_abc"})
        # Placeholder key → upstream 401 → API returns 500 "Push key missing or invalid"
        # or 502 depending on relay behavior; must NOT be 5xx that crashes the server.
        assert r.status_code in (500, 502), \
            f"expected 500/502 got {r.status_code}: {r.text[:200]}"
        detail = ""
        try:
            detail = r.json().get("detail", "")
        except Exception:
            pass
        assert detail in ("Push key missing or invalid",
                          "Push provider unavailable"), detail

        # Server still healthy afterward
        h = session.get(f"{API}/auth/me", headers=auth_headers)
        assert h.status_code == 200

    def test_register_push_spoof_check(self, session, auth_headers):
        r = session.post(f"{API}/register-push", headers=auth_headers,
                         json={"user_id": "someone-else",
                               "platform": "ios", "device_token": "tok"})
        assert r.status_code == 403, f"{r.status_code}: {r.text[:200]}"

    def test_threshold_independent_of_push_failure(self, session, auth_headers,
                                                    mongo, user_ctx):
        sub_p = "sub_push_401"
        session.put(f"{API}/notifications/prefs", headers=auth_headers, json={
            "enabled": True,
            "perCategory": {sub_p: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": False, "threshold": 200},
        })
        body = {"period": "2026-08", "categories": [
            {"sub_id": sub_p, "name": "P", "spent": 300, "budget": 100},
        ]}
        r = session.post(f"{API}/notifications/evaluate-budget",
                         headers=auth_headers, json=body)
        assert r.status_code == 200
        created = r.json()["created"]
        assert len(created) == 1 and created[0]["type"] == "category_100"
        nid = created[0]["id"]

        # persisted notification should have delivery_status='failed'
        from bson import ObjectId
        doc = mongo.notifications.find_one({"_id": ObjectId(nid)})
        assert doc is not None
        assert doc.get("delivery_status") == "failed", doc.get("delivery_status")


# ------------------------------------------------------------------- #
# 10) Regression smoke                                                 #
# ------------------------------------------------------------------- #
class TestRegression:
    def test_auth_me(self, session, auth_headers):
        r = session.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text

    def test_membership(self, session, auth_headers):
        r = session.get(f"{API}/user/membership", headers=auth_headers)
        assert r.status_code == 200, r.text

    def test_plaid_status(self, session, auth_headers):
        r = session.get(f"{API}/plaid/status", headers=auth_headers)
        assert r.status_code == 200, r.text
