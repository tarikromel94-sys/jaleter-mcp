"""
Iteration 23 — Support Phase 2/3/4 backend regression.

Focus: verify /api/support/tickets accepts the four new "specialized" categories
(bug, privacy, delete_account, billing) with a structured description body,
and verify admin endpoints remain gated behind is_admin=true.
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://no-changes-mobile.preview.emergentagent.com").rstrip("/")
USER_EMAIL = "alex+test1@jaleter.app"
USER_PASSWORD = "password123"
ADMIN_EMAIL = "support@jaleter.com"
ADMIN_PASSWORD = "Tarik0731!"


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD}, timeout=15)
    if r.status_code != 200:
        # If user doesn't exist yet, register
        rr = requests.post(f"{BASE_URL}/api/auth/register", json={"name": "Alex Ward", "email": USER_EMAIL, "password": USER_PASSWORD}, timeout=15)
        assert rr.status_code in (200, 201), f"register failed: {rr.status_code} {rr.text}"
        return rr.json()["token"]
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["user"].get("is_admin") is True, "admin user must have is_admin=true"
    return body["token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Ticket creation: 4 new specialized categories ----------
@pytest.mark.parametrize("category,subject_prefix,priority,extra_labels", [
    ("bug", "[Bug] TEST_iter23", "high", ["Summary", "Steps to reproduce", "Expected behavior", "Actual behavior", "Device / version"]),
    ("privacy", "[Privacy] TEST_iter23", "high", ["Requested action", "Additional context"]),
    ("delete_account", "[Delete Account] TEST_iter23 Close", "urgent", ["Confirmation", "Process"]),
    ("billing", "[Billing] TEST_iter23", "high", ["Issue type", "Amount (USD)"]),
])
def test_create_specialized_ticket(user_token, category, subject_prefix, priority, extra_labels):
    subject = f"{subject_prefix} {uuid.uuid4().hex[:6]}"
    description = "\n\n".join([f"{lbl}:\nsome value for {lbl}" for lbl in extra_labels])
    payload = {
        "subject": subject,
        "category": category,
        "priority": priority,
        "description": description,
        "attachments": [],
    }
    r = requests.post(f"{BASE_URL}/api/support/tickets", headers=_hdr(user_token), json=payload, timeout=15)
    assert r.status_code in (200, 201), f"{category} create failed: {r.status_code} {r.text}"
    body = r.json()
    assert body["category"] == category
    assert body["priority"] == priority
    assert body["subject"] == subject
    # ensure structured description round-trips
    for lbl in extra_labels:
        assert f"{lbl}:" in body.get("description", ""), f"{category}: missing label {lbl}"

    # GET verify persistence
    tid = body["ticket_id"]
    g = requests.get(f"{BASE_URL}/api/support/tickets/{tid}", headers=_hdr(user_token), timeout=15)
    assert g.status_code == 200
    assert g.json()["category"] == category


# ---------- Admin endpoints stay gated ----------
def test_admin_list_forbidden_for_regular_user(user_token):
    r = requests.get(f"{BASE_URL}/api/support/admin/tickets", headers=_hdr(user_token), timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403 for non-admin, got {r.status_code}"


def test_admin_list_ok_for_admin(admin_token):
    r = requests.get(f"{BASE_URL}/api/support/admin/tickets", headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "tickets" in body
    assert isinstance(body["tickets"], list)


def test_admin_note_forbidden_for_regular_user(user_token, admin_token):
    # Pick any ticket owned by admin listing
    r = requests.get(f"{BASE_URL}/api/support/admin/tickets", headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200
    tickets = r.json().get("tickets", [])
    if not tickets:
        pytest.skip("no tickets to test note gating against")
    tid = tickets[0]["ticket_id"]
    rr = requests.post(
        f"{BASE_URL}/api/support/admin/tickets/{tid}/note",
        headers=_hdr(user_token),
        json={"note": "should be blocked"},
        timeout=15,
    )
    assert rr.status_code in (401, 403), f"expected 401/403, got {rr.status_code}"


def test_admin_status_patch_ok(admin_token):
    # Create a ticket first as admin to have something to patch
    payload = {"subject": f"TEST_iter23 admin patch {uuid.uuid4().hex[:6]}", "category": "general", "priority": "low", "description": "seed for patch"}
    c = requests.post(f"{BASE_URL}/api/support/tickets", headers=_hdr(admin_token), json=payload, timeout=15)
    assert c.status_code in (200, 201)
    tid = c.json()["ticket_id"]
    p = requests.patch(f"{BASE_URL}/api/support/admin/tickets/{tid}", headers=_hdr(admin_token), json={"status": "in_progress"}, timeout=15)
    assert p.status_code == 200
    g = requests.get(f"{BASE_URL}/api/support/admin/tickets/{tid}", headers=_hdr(admin_token), timeout=15)
    assert g.status_code == 200
    assert g.json()["status"] == "in_progress"
