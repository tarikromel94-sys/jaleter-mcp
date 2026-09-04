"""Iteration 79 backend regression tests.

Covers:
  (A) Budget alert wording — /api/notifications/evaluate-budget:
      * spent == budget (exact match) -> title 'Budget fully used'
      * spent >  budget               -> title 'Budget exceeded' with over amount
      * spent <  budget (below 80%)   -> no category_100/80 alert
  (B) Auth / gating regression — evaluate-budget is premium-gated (402 for unpaid).
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

PREMIUM_EMAIL = "demo@jaleter.com"
PREMIUM_PASSWORD = "DemoOKn6EzMtN2!"
UNPAID_EMAIL = "alex+test1@jaleter.app"
UNPAID_PASSWORD = "password123"


# ---------- fixtures ----------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, password):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def premium_token(api):
    return _login(api, PREMIUM_EMAIL, PREMIUM_PASSWORD)


@pytest.fixture(scope="module")
def unpaid_token(api):
    return _login(api, UNPAID_EMAIL, UNPAID_PASSWORD)


# ---------- helpers -----------------------------------------------------------
def _enable_all_prefs(api, token):
    """Ensure category_100 alerts are enabled for the premium user so the
    evaluator actually emits when pct>=1.0. Default is on but be explicit."""
    r = api.put(
        f"{BASE_URL}/api/notifications/prefs",
        headers={"Authorization": f"Bearer {token}"},
        json={"enabled": True, "channels": {"push": True, "inapp": True, "email": False},
              "categories": {"p50": True, "p80": True, "exceeded": True}},
        timeout=10,
    )
    assert r.status_code == 200, r.text


def _evaluate_budget(api, token, categories, period):
    r = api.post(
        f"{BASE_URL}/api/notifications/evaluate-budget",
        headers={"Authorization": f"Bearer {token}"},
        json={"period": period, "categories": categories},
        timeout=15,
    )
    return r


# ---------- (A) exact-match wording ------------------------------------------
class TestBudgetAlertWording:
    def test_exact_match_emits_budget_fully_used(self, api, premium_token):
        _enable_all_prefs(api, premium_token)
        # Unique per-run period + sub_id so we bypass alert_state dedup.
        sub_id = f"TEST_iter79_exact_{uuid.uuid4().hex[:8]}"
        period = f"TEST-{uuid.uuid4().hex[:6]}"
        cats = [{"sub_id": sub_id, "name": "Groceries",
                 "parent_name": "Essentials", "spent": 100.0, "budget": 100.0}]
        r = _evaluate_budget(api, premium_token, cats, period)
        assert r.status_code == 200, r.text
        created = r.json().get("created", [])
        assert len(created) == 1, f"expected 1 alert, got {created}"
        n = created[0]
        assert n.get("title") == "Budget fully used", n
        # body should NOT contain 'over budget' language
        assert "over budget" not in (n.get("body") or "").lower(), n
        assert "right on budget" in (n.get("body") or "").lower(), n
        # metadata sanity
        meta = n.get("metadata") or {}
        assert abs(float(meta.get("spent", 0)) - 100.0) < 0.001
        assert abs(float(meta.get("budget", 0)) - 100.0) < 0.001

    def test_over_budget_emits_budget_exceeded_with_over_amount(self, api, premium_token):
        _enable_all_prefs(api, premium_token)
        sub_id = f"TEST_iter79_over_{uuid.uuid4().hex[:8]}"
        period = f"TEST-{uuid.uuid4().hex[:6]}"
        cats = [{"sub_id": sub_id, "name": "Groceries",
                 "parent_name": "Essentials", "spent": 101.0, "budget": 100.0}]
        r = _evaluate_budget(api, premium_token, cats, period)
        assert r.status_code == 200, r.text
        created = r.json().get("created", [])
        assert len(created) == 1, created
        n = created[0]
        assert n.get("title") == "Budget exceeded", n
        body = (n.get("body") or "").lower()
        assert "over budget" in body, n
        # over amount = 1.00
        assert "$1.00" in (n.get("body") or ""), n

    def test_under_budget_no_alert(self, api, premium_token):
        _enable_all_prefs(api, premium_token)
        sub_id = f"TEST_iter79_under_{uuid.uuid4().hex[:8]}"
        period = f"TEST-{uuid.uuid4().hex[:6]}"
        # 40% used — below all thresholds
        cats = [{"sub_id": sub_id, "name": "Groceries",
                 "parent_name": "Essentials", "spent": 40.0, "budget": 100.0}]
        r = _evaluate_budget(api, premium_token, cats, period)
        assert r.status_code == 200, r.text
        assert r.json().get("created") == []

    def test_penny_over_treated_as_exceeded(self, api, premium_token):
        """0.01 over the tolerance (0.005) must be 'Budget exceeded'."""
        _enable_all_prefs(api, premium_token)
        sub_id = f"TEST_iter79_penny_{uuid.uuid4().hex[:8]}"
        period = f"TEST-{uuid.uuid4().hex[:6]}"
        cats = [{"sub_id": sub_id, "name": "Groceries",
                 "parent_name": "Essentials", "spent": 100.01, "budget": 100.0}]
        r = _evaluate_budget(api, premium_token, cats, period)
        assert r.status_code == 200, r.text
        created = r.json().get("created", [])
        assert len(created) == 1 and created[0]["title"] == "Budget exceeded", created


# ---------- (B) paywall regression -------------------------------------------
class TestEvaluateBudgetPaywall:
    def test_unpaid_user_gets_402_on_evaluate_budget(self, api, unpaid_token):
        cats = [{"sub_id": "x", "name": "Groceries", "spent": 100.0, "budget": 100.0}]
        r = _evaluate_budget(api, unpaid_token, cats, period="TEST-paywall")
        assert r.status_code == 402, r.text
        detail = r.json().get("detail") or {}
        assert detail.get("error") == "payment_required", detail
        assert "subscription_status" in detail, detail
