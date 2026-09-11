"""Iteration 81 — Budget + transaction alert pipeline verification.

Uses the premium App Review account (jaleter.appreview@gmail.com) so the
membership-gated /api/notifications/evaluate-* endpoints return 200 (not 402).

Covers review-request items 1..14:
  1  PREFS ROUND-TRIP
  2  BUDGET 80%
  3  BUDGET 100% EXACT ('Budget fully used')
  4  OVER BUDGET ('Budget exceeded' + $X.XX over)
  5  DEDUPE budget
  6  UNDER THRESHOLD (no alert)
  7  PREFS RESPECTED (enabled=false suppresses)
  8  TX ALERT INCLUSIVE ($500 with threshold 500 must fire — off-by-one fix)
  9  TX BELOW ($499.99 no alert)
  10 TX ABOVE ($750 alert)
  11 TX DEDUPE
  12 INBOX list + unread-count + mark-read
  13 Delivery attempt reaches push layer (delivery_status recorded)
  14 Cleanup: mark-all-read + restore prefs defaults (enabled=true)
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

REVIEW_EMAIL = "jaleter.appreview@gmail.com"
REVIEW_PW = "Jaleter029496!"

PERIOD = "2026-09"

# unique sub_ids for this iteration to avoid colliding with prior test rows
SUB_80 = "iter81_sub_80"
SUB_100 = "iter81_sub_100"
SUB_OVER = "iter81_sub_over"
SUB_UNDER = "iter81_sub_under"
SUB_OFF = "iter81_sub_off"

TX_EXACT = "iter81_txA"
TX_BELOW = "iter81_txB"
TX_ABOVE = "iter81_txC"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def auth(s, mongo):
    """Login as review account and clean iter81 state so tests are deterministic."""
    r = s.post(f"{API}/auth/login", json={"email": REVIEW_EMAIL, "password": REVIEW_PW})
    assert r.status_code == 200, f"review login failed: {r.status_code} {r.text[:200]}"
    j = r.json()
    token = j["token"]
    user_id = j["user"]["user_id"]

    # Wipe only iter81 dedup slots + notifications
    subs = [SUB_80, SUB_100, SUB_OVER, SUB_UNDER, SUB_OFF]
    for sub in subs:
        mongo.alert_state.delete_many(
            {"_id": {"$regex": f"^u/{user_id}/{PERIOD}/{sub}/"}}
        )
    for tx in (TX_EXACT, TX_BELOW, TX_ABOVE):
        mongo.alert_state.delete_many({"_id": f"u/{user_id}/tx/{tx}/large_transaction"})
    mongo.notifications.delete_many({
        "user_id": user_id,
        "$or": [
            {"category_id": {"$in": subs}},
            {"transaction_id": {"$in": [TX_EXACT, TX_BELOW, TX_ABOVE]}},
        ],
    })

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Ensure prefs baseline: enabled + singleExpense on at $500, per-cat exceeded/p80 on
    body = {
        "enabled": True,
        "perCategory": {
            SUB_80: {"p50": False, "p80": True, "exceeded": True},
            SUB_100: {"p50": False, "p80": True, "exceeded": True},
            SUB_OVER: {"p50": False, "p80": True, "exceeded": True},
            SUB_UNDER: {"p50": False, "p80": True, "exceeded": True},
            SUB_OFF: {"p50": False, "p80": True, "exceeded": True},
        },
        "singleExpense": {"enabled": True, "threshold": 500},
    }
    rp = s.put(f"{API}/notifications/prefs", headers=headers, json=body)
    assert rp.status_code == 200, rp.text
    return {"token": token, "user_id": user_id, "headers": headers}


# ---------- 1. PREFS ROUND-TRIP ----------
class TestPrefsRoundTrip:
    def test_prefs_persist_exactly(self, s, auth):
        body = {
            "enabled": True,
            "perCategory": {
                "prefs_rt": {"p50": True, "p80": True, "exceeded": True},
            },
            "singleExpense": {"enabled": True, "threshold": 500},
        }
        r = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        put_body = r.json()
        assert put_body["enabled"] is True
        assert put_body["perCategory"]["prefs_rt"] == \
            {"p50": True, "p80": True, "exceeded": True}
        assert put_body["singleExpense"] == {"enabled": True, "threshold": 500.0}

        g = s.get(f"{API}/notifications/prefs", headers=auth["headers"])
        assert g.status_code == 200
        got = g.json()
        assert got["enabled"] is True
        assert got["perCategory"]["prefs_rt"] == \
            {"p50": True, "p80": True, "exceeded": True}
        assert got["singleExpense"]["enabled"] is True
        assert float(got["singleExpense"]["threshold"]) == 500.0

        # Restore baseline (drop prefs_rt entry so it doesn't linger)
        s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True,
            "perCategory": {
                SUB_80: {"p50": False, "p80": True, "exceeded": True},
                SUB_100: {"p50": False, "p80": True, "exceeded": True},
                SUB_OVER: {"p50": False, "p80": True, "exceeded": True},
                SUB_UNDER: {"p50": False, "p80": True, "exceeded": True},
                SUB_OFF: {"p50": False, "p80": True, "exceeded": True},
            },
            "singleExpense": {"enabled": True, "threshold": 500},
        })


# ---------- 2. BUDGET 80% ----------
class TestBudget80:
    def test_80pct_creates_category_80(self, s, auth):
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_80, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 800,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1, created
        n = created[0]
        assert n["type"] == "category_80"
        assert n["category_id"] == SUB_80
        assert n["title"] == "Budget warning"
        assert "80%" in n["body"]


# ---------- 3. BUDGET 100% EXACT ----------
class TestBudget100Exact:
    def test_exact_100_says_fully_used(self, s, auth):
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_100, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 1000,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1, created
        n = created[0]
        assert n["type"] == "category_100"
        assert n["title"] == "Budget fully used", n["title"]
        assert "100%" in n["body"]


# ---------- 4. OVER BUDGET ----------
class TestBudgetOver:
    def test_over_budget_says_exceeded_with_dollar_over(self, s, auth):
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_OVER, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 1100,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200, r.text
        created = r.json()["created"]
        assert len(created) == 1, created
        n = created[0]
        assert n["type"] == "category_100"
        assert n["title"] == "Budget exceeded", n["title"]
        assert "$100.00 over" in n["body"], n["body"]


# ---------- 5. DEDUPE ----------
class TestBudgetDedupe:
    def test_repeated_evaluate_returns_empty(self, s, auth):
        for sub, spent in [(SUB_80, 800), (SUB_100, 1000), (SUB_OVER, 1100)]:
            body = {"period": PERIOD, "categories": [{
                "sub_id": sub, "name": "Dining", "parent_name": "Food",
                "budget": 1000, "spent": spent,
            }]}
            r = s.post(f"{API}/notifications/evaluate-budget",
                       headers=auth["headers"], json=body)
            assert r.status_code == 200
            assert r.json()["created"] == [], (sub, r.json())


# ---------- 6. UNDER THRESHOLD ----------
class TestBudgetUnderThreshold:
    def test_40pct_creates_nothing(self, s, auth):
        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_UNDER, "name": "Dining", "parent_name": "Food",
            "budget": 1000, "spent": 400,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200
        assert r.json()["created"] == []


# ---------- 7. PREFS RESPECTED (enabled=false) ----------
class TestPrefsRespected:
    def test_disabled_suppresses_and_reenable(self, s, auth, mongo):
        # Disable
        r_off = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": False,
            "perCategory": {SUB_OFF: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 500},
        })
        assert r_off.status_code == 200

        body = {"period": PERIOD, "categories": [{
            "sub_id": SUB_OFF, "name": "X", "budget": 100, "spent": 500,
        }]}
        r = s.post(f"{API}/notifications/evaluate-budget",
                   headers=auth["headers"], json=body)
        assert r.status_code == 200
        assert r.json()["created"] == [], r.json()
        # No dedup slot must have been claimed while disabled.
        row = mongo.alert_state.find_one(
            {"_id": f"u/{auth['user_id']}/{PERIOD}/{SUB_OFF}/category_100"})
        assert row is None, "prefs.enabled=false must not claim dedup"

        # Re-enable — same body should now fire
        s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True,
            "perCategory": {SUB_OFF: {"p50": False, "p80": True, "exceeded": True}},
            "singleExpense": {"enabled": True, "threshold": 500},
        })
        r2 = s.post(f"{API}/notifications/evaluate-budget",
                    headers=auth["headers"], json=body)
        assert r2.status_code == 200
        created = r2.json()["created"]
        assert len(created) == 1 and created[0]["type"] == "category_100"


# ---------- 8-11. Transaction alerts ----------
class TestTxAlerts:
    def test_8_inclusive_at_threshold(self, s, auth):
        """Off-by-one fix: exactly $500 with threshold 500 MUST fire."""
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_EXACT, "amount": 500, "name": "Test Store"})
        assert r.status_code == 200, r.text
        c = r.json()["created"]
        assert c is not None, "Off-by-one: $500 with threshold $500 must create alert"
        assert c["type"] == "large_transaction"
        assert c["transaction_id"] == TX_EXACT
        assert c["title"] == "Large transaction detected"
        assert "$500.00" in c["body"]
        assert "Test Store" in c["body"]

    def test_9_below_threshold_no_alert(self, s, auth):
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_BELOW, "amount": 499.99, "name": "Coffee"})
        assert r.status_code == 200
        assert r.json()["created"] is None

    def test_10_above_threshold_alert(self, s, auth):
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_ABOVE, "amount": 750, "name": "BigMart"})
        assert r.status_code == 200
        c = r.json()["created"]
        assert c is not None
        assert c["type"] == "large_transaction"
        assert "$750.00" in c["body"]

    def test_11_dedupe(self, s, auth):
        r = s.post(f"{API}/notifications/evaluate-transaction",
                   headers=auth["headers"],
                   json={"id": TX_EXACT, "amount": 500, "name": "Test Store"})
        assert r.status_code == 200
        assert r.json()["created"] is None, "Duplicate tx must not re-fire"


# ---------- 12. INBOX ----------
class TestInbox:
    def test_inbox_shows_alerts_and_read_flow(self, s, auth):
        # List
        r = s.get(f"{API}/notifications", headers=auth["headers"])
        assert r.status_code == 200
        items = r.json()["notifications"]
        assert isinstance(items, list)

        # Find our iter81 items by category_id/transaction_id
        subs = {SUB_80, SUB_100, SUB_OVER, SUB_OFF}
        txs = {TX_EXACT, TX_ABOVE}
        ours = [i for i in items
                if i.get("category_id") in subs or i.get("transaction_id") in txs]
        assert len(ours) >= 5, f"expected >=5 iter81 alerts in inbox, got {len(ours)}"

        for n in ours:
            for k in ("id", "type", "title", "body", "created_at"):
                assert k in n, f"missing {k}: {n}"

        # Unread count > 0
        r2 = s.get(f"{API}/notifications/unread-count", headers=auth["headers"])
        assert r2.status_code == 200
        before = r2.json()["unread"]
        assert before > 0, before

        # Mark one iter81 notif as read
        target = next((n for n in ours if not n.get("read_at")), None)
        assert target is not None, "no unread iter81 notif to mark"
        r3 = s.patch(f"{API}/notifications/{target['id']}/read",
                     headers=auth["headers"])
        assert r3.status_code == 200, r3.text

        r4 = s.get(f"{API}/notifications/unread-count", headers=auth["headers"])
        after = r4.json()["unread"]
        assert after == before - 1, (before, after)


# ---------- 13. Push layer attempted ----------
class TestPushLayer:
    def test_push_attempted_and_delivery_status_recorded(self, s, auth, mongo):
        # Any iter81 notif we created should have delivery_status set to
        # 'sent' or 'failed' (both prove the push layer was reached).
        docs = list(mongo.notifications.find({
            "user_id": auth["user_id"],
            "$or": [
                {"category_id": {"$in": [SUB_80, SUB_100, SUB_OVER, SUB_OFF]}},
                {"transaction_id": {"$in": [TX_EXACT, TX_ABOVE]}},
            ],
        }))
        assert docs, "no iter81 notifications persisted"
        statuses = {d.get("delivery_status") for d in docs}
        # 'created' would mean we never even reached the push layer.
        assert statuses.issubset({"sent", "failed"}), \
            f"push layer not reached; statuses={statuses}"
        # `sent_at` must be set on every persisted notif
        assert all(d.get("sent_at") is not None for d in docs), \
            "sent_at missing on some notifications"


# ---------- 14. Cleanup ----------
class TestCleanup:
    def test_mark_all_read_and_restore_prefs_defaults(self, s, auth, mongo):
        # Mark everything read so the reviewer sees a clean inbox
        r = s.post(f"{API}/notifications/mark-all-read", headers=auth["headers"])
        assert r.status_code == 200

        r2 = s.get(f"{API}/notifications/unread-count", headers=auth["headers"])
        assert r2.json()["unread"] == 0

        # Restore prefs default (enabled=true, no per-cat overrides,
        # singleExpense off at 200 — the app default for the review account)
        r3 = s.put(f"{API}/notifications/prefs", headers=auth["headers"], json={
            "enabled": True,
            "perCategory": {},
            "singleExpense": {"enabled": False, "threshold": 200},
        })
        assert r3.status_code == 200
        j = r3.json()
        assert j["enabled"] is True
        assert j["perCategory"] == {}
        assert j["singleExpense"] == {"enabled": False, "threshold": 200.0}

        # Delete the iter81 notifications from the review account inbox
        # (they were only synthetic data — reviewers shouldn't see them)
        subs = [SUB_80, SUB_100, SUB_OVER, SUB_UNDER, SUB_OFF]
        mongo.notifications.delete_many({
            "user_id": auth["user_id"],
            "$or": [
                {"category_id": {"$in": subs}},
                {"transaction_id": {"$in": [TX_EXACT, TX_BELOW, TX_ABOVE]}},
            ],
        })
        # Also drop the dedup slots so future test runs are reproducible
        for sub in subs:
            mongo.alert_state.delete_many(
                {"_id": {"$regex": f"^u/{auth['user_id']}/{PERIOD}/{sub}/"}}
            )
        for tx in (TX_EXACT, TX_BELOW, TX_ABOVE):
            mongo.alert_state.delete_many(
                {"_id": f"u/{auth['user_id']}/tx/{tx}/large_transaction"}
            )
