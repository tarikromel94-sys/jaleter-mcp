"""Explicit regression tests for the two fixes shipped after iteration_7.

Fix #1: GET /api/accounts and POST /api/accounts/sync must filter linked_accounts
        by provider ∈ {simplefin, missing} so file-provider rows do not KeyError.
Fix #2: file-provider deduplicates by (user_id, provider, external_id), so
        re-uploading the same CSV yields inserted=0, duplicates>=N.
Also verifies no backend traceback is written during the calls.
"""
from __future__ import annotations

import os
import subprocess
import time
import uuid

import pytest
import requests

BASE_URL = (os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL') or '').rstrip('/')
assert BASE_URL, 'EXPO_PUBLIC_BACKEND_URL must be set'

CREDS = {'email': 'alex+test1@jaleter.app', 'password': 'password123'}

CSV_A = (
    'Date,Description,Amount\n'
    '2025-02-01,REGRESSION COFFEE,-4.50\n'
    '2025-02-02,REGRESSION SALARY,2000.00\n'
    '2025-02-03,REGRESSION UTIL,-125.75\n'
)

# Different content → should NOT dedup against CSV_A
CSV_B = (
    'Date,Description,Amount\n'
    f'2025-03-05,DIFF_A_{uuid.uuid4().hex[:6]},-11.11\n'
    f'2025-03-06,DIFF_B_{uuid.uuid4().hex[:6]},22.22\n'
)


@pytest.fixture(scope='module')
def token():
    r = requests.post(f'{BASE_URL}/api/auth/login', json=CREDS, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()['token']


@pytest.fixture(scope='module')
def auth_headers(token):
    return {'Authorization': f'Bearer {token}'}


def _read_backend_err_size() -> int:
    try:
        out = subprocess.check_output(
            ['bash', '-lc', 'ls -la /var/log/supervisor/backend.err.log 2>/dev/null | awk "{print \\$5}"'],
        ).decode().strip()
        return int(out) if out.isdigit() else 0
    except Exception:
        return 0


def _read_backend_err_since(offset: int) -> str:
    try:
        out = subprocess.check_output(
            ['bash', '-lc', f'tail -c +{offset + 1} /var/log/supervisor/backend.err.log 2>/dev/null || true'],
        ).decode('utf-8', errors='replace')
        return out
    except Exception:
        return ''


class TestRegressionFix1_ListAccounts:
    """After a file import exists, /api/accounts must still return 200."""

    def test_seed_file_provider_row_then_list(self, auth_headers):
        # Seed with a CSV upload
        files = {'file': (f'TEST_REGR_{uuid.uuid4().hex[:6]}.csv', CSV_A, 'text/csv')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=30,
        )
        assert r.status_code == 200, r.text

        # Snapshot err log size BEFORE listing
        before = _read_backend_err_size()

        # Now the crash-prone call
        r = requests.get(f'{BASE_URL}/api/accounts', headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'accounts' in body and isinstance(body['accounts'], list)
        # No file-provider row should leak into simplefin listing
        for row in body['accounts']:
            assert row.get('provider', 'simplefin') != 'file', row

        # Confirm no new traceback landed in err log
        time.sleep(0.2)
        new_tail = _read_backend_err_since(before)
        assert 'KeyError' not in new_tail, new_tail[-800:]
        assert 'access_url_encrypted' not in new_tail, new_tail[-800:]
        assert 'Traceback' not in new_tail, new_tail[-800:]

    def test_sync_survives_file_provider_rows(self, auth_headers):
        before = _read_backend_err_size()
        r = requests.post(f'{BASE_URL}/api/accounts/sync', headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'synced' in body and 'errors' in body
        assert isinstance(body['errors'], list)

        time.sleep(0.2)
        new_tail = _read_backend_err_since(before)
        assert 'KeyError' not in new_tail, new_tail[-800:]
        assert 'access_url_encrypted' not in new_tail, new_tail[-800:]
        assert 'Traceback' not in new_tail, new_tail[-800:]


class TestRegressionFix2_FileDedup:
    """Re-uploading same CSV → 0 inserted, N duplicates.
    A different CSV → still inserts fresh rows."""

    def test_reupload_same_csv_dedups(self, auth_headers):
        payload = (
            'Date,Description,Amount\n'
            f'2025-04-01,DEDUP_ROW_A_{uuid.uuid4().hex[:6]},-10.00\n'
            f'2025-04-02,DEDUP_ROW_B_{uuid.uuid4().hex[:6]},20.00\n'
            f'2025-04-03,DEDUP_ROW_C_{uuid.uuid4().hex[:6]},-30.00\n'
        )
        # First upload
        r1 = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files={'file': (f'TEST_DEDUP_{uuid.uuid4().hex[:6]}.csv', payload, 'text/csv')},
            timeout=30,
        )
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert b1['inserted'] == 3, b1
        assert b1['duplicates'] == 0, b1

        # Second upload — same content, different filename
        r2 = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files={'file': (f'TEST_DEDUP_2_{uuid.uuid4().hex[:6]}.csv', payload, 'text/csv')},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        b2 = r2.json()
        assert b2['inserted'] == 0, f'expected inserted=0 got {b2}'
        assert b2['duplicates'] >= 3, f'expected duplicates>=3 got {b2}'

    def test_upload_different_csv_inserts_fresh(self, auth_headers):
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files={'file': (f'TEST_DIFF_{uuid.uuid4().hex[:6]}.csv', CSV_B, 'text/csv')},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['inserted'] >= 2, body
        assert body['duplicates'] == 0, body


class TestFinalPasswordPreservation:
    """Confirm alex+test1@jaleter.app / password123 still works at the very end."""

    def test_login_still_password123(self):
        r = requests.post(f'{BASE_URL}/api/auth/login', json=CREDS, timeout=15)
        assert r.status_code == 200, r.text
        assert 'token' in r.json()
