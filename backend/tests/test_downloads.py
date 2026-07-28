"""Tests for Jaleter public download endpoints and regression check on auth."""
import os
import pytest
import requests

# Use internal backend URL per the task instructions (proxy strips /api and forwards to 8001).
# Also verify externally via EXPO_BACKEND_URL.
INTERNAL_URL = "http://localhost:8001"
EXTERNAL_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


# ---------- Download endpoints ----------

@pytest.mark.parametrize("key,expected_media,expected_filename,expected_min_size,expected_max_size", [
    ("wp-landing", "text/html", "JALETER_WORDPRESS_LANDING.html", 20_000, 30_000),
    ("brand-guide", "text/markdown", "JALETER_BRAND_STYLE_GUIDE.md", 10_000, 15_000),
    ("readme", "text/markdown", "JALETER_PACKAGE_README.md", 2_500, 4_000),
    ("package", "application/zip", "JALETER_PACKAGE.zip", 10_000, 20_000),
])
def test_download_asset(client, key, expected_media, expected_filename, expected_min_size, expected_max_size):
    r = client.get(f"{INTERNAL_URL}/api/download/{key}", timeout=15)
    assert r.status_code == 200, f"Expected 200 for {key}, got {r.status_code}: {r.text[:200]}"
    ct = r.headers.get("content-type", "")
    assert expected_media in ct, f"Content-Type mismatch for {key}: got '{ct}', expected substring '{expected_media}'"

    # Content-Disposition should suggest filename
    cd = r.headers.get("content-disposition", "")
    assert expected_filename in cd, f"Content-Disposition should include filename '{expected_filename}', got '{cd}'"

    # File size sanity check
    size = len(r.content)
    assert expected_min_size <= size <= expected_max_size, (
        f"File size for {key} = {size} bytes not in expected range [{expected_min_size}, {expected_max_size}]"
    )


def test_download_package_is_valid_zip(client):
    r = client.get(f"{INTERNAL_URL}/api/download/package", timeout=15)
    assert r.status_code == 200
    # Verify ZIP magic bytes PK\x03\x04
    assert r.content[:4] == b"PK\x03\x04", f"Not a valid ZIP file. First bytes: {r.content[:8]!r}"


def test_download_nonexistent_returns_404(client):
    r = client.get(f"{INTERNAL_URL}/api/download/nonexistent", timeout=10)
    assert r.status_code == 404
    data = r.json()
    assert data.get("detail") == "Not found", f"Unexpected detail: {data}"


def test_download_no_auth_required(client):
    # Explicitly send NO Authorization header — should still work
    r = client.get(f"{INTERNAL_URL}/api/download/readme", timeout=10, headers={})
    assert r.status_code == 200, f"Public endpoint should not require auth. Got {r.status_code}"


# ---------- External URL verification (public preview URL) ----------

@pytest.mark.skipif(not EXTERNAL_URL, reason="EXPO_BACKEND_URL not set")
def test_download_via_external_url(client):
    r = client.get(f"{EXTERNAL_URL}/api/download/readme", timeout=20)
    assert r.status_code == 200, f"External URL failed: {r.status_code}"
    assert "text/markdown" in r.headers.get("content-type", "")


# ---------- Regression: auth still works ----------

def test_auth_login_regression(client):
    r = client.post(
        f"{INTERNAL_URL}/api/auth/login",
        json={"email": "alex+test1@jaleter.app", "password": "password123"},
        timeout=15,
    )
    # Should either succeed (200) or, if user not seeded, return a proper 401 — NOT 404/500
    assert r.status_code in (200, 401), f"Unexpected status: {r.status_code} body={r.text[:200]}"
    if r.status_code == 200:
        data = r.json()
        assert "token" in data, f"Login 200 but no token: {data}"
        assert "user" in data, f"Login 200 but no user: {data}"
