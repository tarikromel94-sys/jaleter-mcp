"""Iteration 77 — Hard server-side membership paywall (require_active_membership).

Verifies:
- Unpaid user login + /user/membership returns active:false
- All ~13 gated routes return 402 with detail.error='payment_required'
- 402 body includes subscription_status field
- Non-gated routes (auth/me, membership, support/tickets, notifications/prefs,
  payments/checkout, coaching/bookings) return 200 for unpaid user
- Premium user (demo@jaleter.com) gets 200 on gated routes + membership active:true
- Admin user (support@jaleter.com) bypasses gate (200 on /api/accounts)
- Stripe webhook without valid signature returns 400
"""
import io
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://no-changes-mobile.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

UNPAID = ("alex+test1@jaleter.app", "password123")
PREMIUM = ("demo@jaleter.com", "DemoOKn6EzMtN2!")
ADMIN = ("support@jaleter.com", "Tarik0731!")


def _login(email: str, password: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert "token" in body, f"No token in login response: {body}"
    return body["token"]


def _headers(token: str):
    return {"Authorization": f"Bearer {token}"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def unpaid_token():
    try:
        tok = _login(*UNPAID)
    except AssertionError:
        pytest.skip("Unpaid seed user login failed; cannot run paywall tests")
    # If somehow already premium, register a fresh user
    r = requests.get(f"{API}/user/membership", headers=_headers(tok), timeout=15)
    if r.status_code == 200 and r.json().get("active"):
        email = f"iter77-unpaid-{uuid.uuid4().hex[:8]}@jaletertest.com"
        rr = requests.post(f"{API}/auth/register", json={"name": "iter77 unpaid", "email": email, "password": "password123"}, timeout=30)
        assert rr.status_code == 200, f"register failed: {rr.status_code} {rr.text[:200]}"
        tok = rr.json()["token"]
    return tok


@pytest.fixture(scope="module")
def premium_token():
    try:
        return _login(*PREMIUM)
    except AssertionError:
        pytest.skip("Premium seed user login failed")


@pytest.fixture(scope="module")
def admin_token():
    try:
        return _login(*ADMIN)
    except AssertionError:
        pytest.skip("Admin seed user login failed")


# ---------- Basics ----------
class TestUnpaidBasics:
    def test_login_and_membership_inactive(self, unpaid_token):
        r = requests.get(f"{API}/user/membership", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("active") is False, f"Expected active:false, got {body}"


# ---------- Gated routes must return 402 for unpaid user ----------
GATED_GET = [
    "/accounts",
    "/accounts/all",
    "/accounts/transactions",
    "/plaid/accounts",
    "/networth/history",
]

GATED_POST_JSON = [
    ("/accounts/sync", {}),
    ("/accounts/manual", {"name": "TEST", "type": "checking", "balance": 100.0}),
    ("/plaid/link-token", {}),
    ("/coach/chat", {"message": "hi"}),
    ("/notifications/evaluate-budget", {}),
    ("/accounts/transactions/match-transfers", {}),
]


class TestUnpaidGating:
    @pytest.mark.parametrize("path", GATED_GET)
    def test_gated_get_returns_402(self, unpaid_token, path):
        r = requests.get(f"{API}{path}", headers=_headers(unpaid_token), timeout=20)
        assert r.status_code == 402, f"{path} expected 402, got {r.status_code} {r.text[:200]}"
        body = r.json()
        detail = body.get("detail") or {}
        assert isinstance(detail, dict), f"{path}: detail is not a dict: {detail!r}"
        assert detail.get("error") == "payment_required", f"{path}: {detail}"
        assert "subscription_status" in detail, f"{path}: no subscription_status in {detail}"

    @pytest.mark.parametrize("path,payload", GATED_POST_JSON)
    def test_gated_post_json_returns_402(self, unpaid_token, path, payload):
        r = requests.post(f"{API}{path}", json=payload, headers=_headers(unpaid_token), timeout=20)
        assert r.status_code == 402, f"{path} expected 402, got {r.status_code} {r.text[:200]}"
        body = r.json()
        detail = body.get("detail") or {}
        assert detail.get("error") == "payment_required", f"{path}: {detail}"
        assert "subscription_status" in detail, f"{path}: {detail}"

    def test_statements_preview_multipart_returns_402(self, unpaid_token):
        files = {"file": ("stmt.csv", io.BytesIO(b"Date,Description,Amount\n2025-01-01,test,-1.0\n"), "text/csv")}
        r = requests.post(f"{API}/statements/preview", files=files, headers=_headers(unpaid_token), timeout=30)
        assert r.status_code == 402, f"expected 402, got {r.status_code} {r.text[:200]}"
        detail = (r.json() or {}).get("detail") or {}
        assert detail.get("error") == "payment_required"
        assert "subscription_status" in detail

    def test_accounts_import_multipart_returns_402(self, unpaid_token):
        files = {"file": ("stmt.csv", io.BytesIO(b"Date,Description,Amount\n2025-01-01,test,-1.0\n"), "text/csv")}
        # accounts/import may require additional form fields; we only care that gate fires first
        data = {"account_id": "test", "rows_json": "[]"}
        r = requests.post(f"{API}/accounts/import", files=files, data=data, headers=_headers(unpaid_token), timeout=30)
        assert r.status_code == 402, f"expected 402, got {r.status_code} {r.text[:200]}"
        detail = (r.json() or {}).get("detail") or {}
        assert detail.get("error") == "payment_required"
        assert "subscription_status" in detail


# ---------- Non-gated routes must return 200 for unpaid user ----------
class TestUnpaidNotGated:
    def test_auth_me_ok(self, unpaid_token):
        r = requests.get(f"{API}/auth/me", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_membership_ok(self, unpaid_token):
        r = requests.get(f"{API}/user/membership", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_support_tickets_ok(self, unpaid_token):
        r = requests.get(f"{API}/support/tickets", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_notifications_prefs_ok(self, unpaid_token):
        r = requests.get(f"{API}/notifications/prefs", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_coaching_bookings_ok(self, unpaid_token):
        r = requests.get(f"{API}/coaching/bookings", headers=_headers(unpaid_token), timeout=15)
        assert r.status_code == 200, r.text

    def test_payments_checkout_returns_url(self, unpaid_token):
        r = requests.post(
            f"{API}/payments/checkout",
            json={"product": "jaleter_premium", "platform": "web"},
            headers=_headers(unpaid_token),
            timeout=30,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        url = body.get("url") or body.get("checkout_url") or body.get("session_url")
        assert url and isinstance(url, str) and url.startswith("http"), f"Expected stripe URL, got {body}"


# ---------- Premium user must pass gate ----------
class TestPremium:
    def test_membership_active(self, premium_token):
        r = requests.get(f"{API}/user/membership", headers=_headers(premium_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("active") is True, r.json()

    @pytest.mark.parametrize("path", ["/accounts", "/accounts/all", "/accounts/transactions", "/networth/history"])
    def test_gated_get_returns_200(self, premium_token, path):
        r = requests.get(f"{API}{path}", headers=_headers(premium_token), timeout=30)
        assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"


# ---------- Admin must bypass gate ----------
class TestAdmin:
    def test_admin_bypasses_gate(self, admin_token):
        r = requests.get(f"{API}/accounts", headers=_headers(admin_token), timeout=20)
        assert r.status_code == 200, f"admin should bypass, got {r.status_code} {r.text[:200]}"


# ---------- Stripe webhook without signature ----------
class TestWebhook:
    def test_webhook_missing_signature_returns_400(self):
        r = requests.post(
            f"{API}/payments/webhook",
            data=b'{"id":"evt_test","type":"checkout.session.completed"}',
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:200]}"

    def test_webhook_bad_signature_returns_400(self):
        r = requests.post(
            f"{API}/payments/webhook",
            data=b'{"id":"evt_test","type":"checkout.session.completed"}',
            headers={"Content-Type": "application/json", "Stripe-Signature": "t=1,v1=deadbeef"},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:200]}"
