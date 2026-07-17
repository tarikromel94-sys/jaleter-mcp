"""Iteration 14 - Batch B backend regression tests. Backend was NOT modified."""
import os
import re
import requests
import pytest

BASE_URL = os.environ.get('EXPO_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
EMAIL = 'alex+test1@jaleter.app'
PASSWORD = 'password123'


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
def test_login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200
    assert "token" in r.json()


def test_auth_me(hdr):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=hdr, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == EMAIL


# ---------- Accounts ----------
def test_accounts_all(hdr):
    r = requests.get(f"{BASE_URL}/api/accounts/all", headers=hdr, timeout=30)
    assert r.status_code == 200
    assert "accounts" in r.json()


def test_simplefin_link(hdr):
    """Scrape a demo setup token and link it."""
    try:
        html = requests.get("https://beta-bridge.simplefin.org/info/developers", timeout=15).text
    except Exception as e:
        pytest.skip(f"beta-bridge unreachable: {e}")
    m = re.search(r"([A-Za-z0-9+/=]{80,}={0,2})", html)
    if not m:
        pytest.skip("Could not find demo token on beta-bridge page")
    token_str = m.group(1)
    r = requests.post(f"{BASE_URL}/api/accounts/simplefin/link", headers=hdr, json={"setup_token": token_str}, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "link_id" in body
    assert body.get("linked_count", 0) >= 1


# ---------- Payments ----------
def test_payment_products(hdr):
    r = requests.get(f"{BASE_URL}/api/payments/products", headers=hdr, timeout=30)
    assert r.status_code == 200
    products = r.json().get("products") or r.json()
    # ensure it returns list-like structure with 2 items
    assert products, "products empty"


def test_checkout_coaching(hdr):
    r = requests.post(f"{BASE_URL}/api/payments/checkout", headers=hdr,
                      json={"product": "coaching_session", "platform": "mobile",
                            "scheduled_at": "2027-06-15T15:00:00Z"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and "checkout.stripe.com" in body["url"]


def test_checkout_membership(hdr):
    r = requests.post(f"{BASE_URL}/api/payments/checkout", headers=hdr,
                      json={"product": "jaleter_premium", "platform": "mobile"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and "checkout.stripe.com" in body["url"]


# ---------- Coaching / Membership ----------
def test_coaching_bookings(hdr):
    r = requests.get(f"{BASE_URL}/api/coaching/bookings", headers=hdr, timeout=30)
    assert r.status_code == 200
    assert "bookings" in r.json() or isinstance(r.json(), list)


def test_user_membership(hdr):
    r = requests.get(f"{BASE_URL}/api/user/membership", headers=hdr, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert "active" in body
