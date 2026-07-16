"""Tests for modular provider layer: /api/providers, /api/accounts/link,
/api/accounts/import, /api/accounts/all, /api/support/requests."""
from __future__ import annotations

import io
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL') or '').rstrip('/')
assert BASE_URL, 'EXPO_PUBLIC_BACKEND_URL must be set'

CREDS = {'email': 'alex+test1@jaleter.app', 'password': 'password123'}


# ---------- fixtures ----------
@pytest.fixture(scope='module')
def api_client():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    return s


@pytest.fixture(scope='module')
def auth_headers(api_client):
    r = api_client.post(f'{BASE_URL}/api/auth/login', json=CREDS, timeout=20)
    assert r.status_code == 200, f'login failed: {r.status_code} {r.text}'
    token = r.json()['token']
    return {'Authorization': f'Bearer {token}'}


# ---------- /api/providers ----------
class TestProviders:
    def test_list_providers_public(self, api_client):
        r = api_client.get(f'{BASE_URL}/api/providers', timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert 'providers' in body
        by_id = {p['id']: p for p in body['providers']}
        assert set(by_id.keys()) == {'simplefin', 'snaptrade', 'file'}, by_id.keys()
        assert by_id['simplefin']['configured'] is True
        assert by_id['snaptrade']['configured'] is False
        assert by_id['file']['configured'] is True
        # kinds arrays
        assert isinstance(by_id['simplefin']['kinds'], list) and len(by_id['simplefin']['kinds']) > 0
        assert isinstance(by_id['snaptrade']['kinds'], list) and 'brokerage' in by_id['snaptrade']['kinds']
        assert isinstance(by_id['file']['kinds'], list) and 'csv' in by_id['file']['kinds']


# ---------- /api/accounts/link ----------
class TestAccountsLink:
    def test_link_snaptrade_inert_503(self, api_client, auth_headers):
        r = api_client.post(
            f'{BASE_URL}/api/accounts/link',
            json={'provider': 'snaptrade', 'payload': {}},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 503, r.text
        detail = r.json().get('detail', '')
        assert 'SnapTrade' in detail and 'not yet configured' in detail

    def test_link_unknown_provider_400(self, api_client, auth_headers):
        r = api_client.post(
            f'{BASE_URL}/api/accounts/link',
            json={'provider': 'unknown', 'payload': {}},
            headers=auth_headers, timeout=15,
        )
        assert r.status_code == 400
        assert 'Unknown provider' in r.json().get('detail', '')

    def test_link_simplefin_invalid_token_400(self, api_client, auth_headers):
        r = api_client.post(
            f'{BASE_URL}/api/accounts/link',
            json={'provider': 'simplefin', 'payload': {'setup_token': 'notreal'}},
            headers=auth_headers, timeout=20,
        )
        assert r.status_code == 400, r.text
        assert 'Invalid Setup Token format' in r.json().get('detail', '')


# ---------- /api/accounts/import ----------
CSV_SAMPLE = (
    'Date,Description,Amount\n'
    '2025-01-05,STARBUCKS COFFEE,-6.25\n'
    '2025-01-06,Payroll Deposit,1500.00\n'
    '2025-01-07,Comcast Internet,-89.99\n'
)


class TestAccountsImport:
    imported_link_id: str = ''
    imported_balance: float = 0.0

    def test_import_csv_success(self, auth_headers):
        files = {'file': (f'TEST_import_{uuid.uuid4().hex[:6]}.csv', CSV_SAMPLE, 'text/csv')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['format'] == 'csv'
        assert 'link_id' in body and body['link_id'].startswith('file-')
        cols = body['detected_columns']
        assert 'date' in cols and 'amount' in cols and 'description' in cols
        assert body['inserted'] >= 3
        assert body['duplicates'] == 0
        expected = round(-6.25 + 1500.00 + -89.99, 2)
        assert round(float(body['balance']), 2) == expected
        TestAccountsImport.imported_link_id = body['link_id']
        TestAccountsImport.imported_balance = float(body['balance'])

    def test_import_csv_duplicate_dedup(self, auth_headers):
        # Re-upload identical CSV → all dedup
        files = {'file': ('TEST_dupe.csv', CSV_SAMPLE, 'text/csv')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # New link row is created but the transactions themselves must dedup
        # against previously imported ones via external_id hash (which is
        # date|amount|description-based, so identical for same rows).
        # NOTE: Because file provider inserts a NEW link_id per upload and the
        # external_id uniqueness in bank_transactions is scoped by
        # (user_id, account_id, external_id) — where account_id == link_id —
        # duplicates would NOT be detected across separate uploads.  Verify
        # the expected behaviour per the review-request assertion.
        assert body['inserted'] == 0, f"expected inserted=0 got {body['inserted']} (provider not scoping dedup across link_ids?)"
        assert body['duplicates'] >= 3

    def test_import_bad_headers_400(self, auth_headers):
        bad = 'foo,bar,baz\n1,2,3\n'
        files = {'file': ('TEST_bad.csv', bad, 'text/csv')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=20,
        )
        assert r.status_code == 400, r.text
        assert 'Could not identify Date and Amount columns' in r.json().get('detail', '')

    def test_import_ofx_success_or_400(self, auth_headers):
        # Minimal OFX 1.0 SGML — ofxparse tolerates this; if it fails, endpoint returns 400.
        ofx = (
            'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\n'
            'ENCODING:USASCII\nCHARSET:1252\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n'
            '<OFX><BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>'
            '<STMTRS><CURDEF>USD</CURDEF><BANKACCTFROM><BANKID>121000358</BANKID><ACCTID>1234567</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>'
            '<BANKTRANLIST><DTSTART>20250101</DTSTART><DTEND>20250131</DTEND>'
            '<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250105</DTPOSTED><TRNAMT>-25.50</TRNAMT><FITID>t-001</FITID><NAME>OFX COFFEE</NAME></STMTTRN>'
            '<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20250110</DTPOSTED><TRNAMT>1000.00</TRNAMT><FITID>t-002</FITID><NAME>OFX PAYROLL</NAME></STMTTRN>'
            '</BANKTRANLIST><LEDGERBAL><BALAMT>974.50</BALAMT><DTASOF>20250131</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
        )
        files = {'file': ('TEST_sample.ofx', ofx, 'application/x-ofx')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=30,
        )
        # Either succeeds with format='ofx' or ofxparse fails → 400 with the specific detail
        if r.status_code == 200:
            body = r.json()
            assert body['format'] == 'ofx'
        else:
            assert r.status_code == 400, r.text
            assert 'Could not parse OFX/QFX/QBO file' in r.json().get('detail', '')

    def test_import_too_large_413(self, auth_headers):
        big = ('Date,Description,Amount\n' + ('2025-01-01,x,1.00\n' * 400_000)).encode()
        # roughly ~6MB
        assert len(big) > 5 * 1024 * 1024
        files = {'file': ('TEST_big.csv', io.BytesIO(big), 'text/csv')}
        r = requests.post(
            f'{BASE_URL}/api/accounts/import',
            headers={'Authorization': auth_headers['Authorization']},
            files=files, timeout=60,
        )
        assert r.status_code == 413, f'expected 413 got {r.status_code} {r.text[:200]}'


# ---------- /api/support/requests ----------
class TestSupportRequests:
    created_ids: list[str] = []

    def test_create_support_request(self, api_client, auth_headers):
        payload = {'institution': 'TEST_Chime', 'notes': 'Please add support.'}
        r = api_client.post(
            f'{BASE_URL}/api/support/requests', json=payload, headers=auth_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get('ok') is True
        assert body.get('request_id')
        TestSupportRequests.created_ids.append(body['request_id'])

    def test_list_support_requests_scoped(self, api_client, auth_headers):
        r = api_client.get(f'{BASE_URL}/api/support/requests', headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        requests_list = r.json().get('requests', [])
        assert isinstance(requests_list, list)
        # Our just-created one must be present
        insts = [x.get('institution') for x in requests_list]
        assert 'TEST_Chime' in insts, insts


# ---------- /api/accounts/all ----------
class TestAccountsAll:
    def test_combined_accounts_shape(self, api_client, auth_headers):
        r = api_client.get(f'{BASE_URL}/api/accounts/all', headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert 'accounts' in body and isinstance(body['accounts'], list)
        # every row must have a 'provider' key
        for row in body['accounts']:
            assert 'provider' in row, row
        providers = {row['provider'] for row in body['accounts']}
        # snaptrade must NOT appear (inert, is_configured False → skipped)
        assert 'snaptrade' not in providers, providers
        # After our CSV import, a file-provider account should exist
        file_rows = [r for r in body['accounts'] if r.get('provider') == 'file']
        assert file_rows, f'expected at least one file-provider account, got {body["accounts"]}'


# ---------- auth regression ----------
class TestAuthRegression:
    def test_login_and_me(self, api_client):
        r = api_client.post(f'{BASE_URL}/api/auth/login', json=CREDS, timeout=15)
        assert r.status_code == 200
        token = r.json()['token']
        me = api_client.get(f'{BASE_URL}/api/auth/me', headers={'Authorization': f'Bearer {token}'}, timeout=15)
        assert me.status_code == 200
        assert me.json().get('email') == CREDS['email']

    def test_logout(self, api_client):
        r = api_client.post(f'{BASE_URL}/api/auth/login', json=CREDS, timeout=15)
        token = r.json()['token']
        out = api_client.post(f'{BASE_URL}/api/auth/logout', headers={'Authorization': f'Bearer {token}'}, timeout=15)
        assert out.status_code == 200
        assert out.json().get('ok') is True

    def test_simplefin_accounts_still_works(self, api_client, auth_headers):
        r = api_client.get(f'{BASE_URL}/api/accounts', headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert 'accounts' in r.json()

    def test_forgot_password_rate_limited_or_ok(self, api_client):
        # Just verifies endpoint exists and returns 2xx or 429 (rate-limited)
        r = api_client.post(
            f'{BASE_URL}/api/auth/forgot-password', json={'email': CREDS['email']}, timeout=15,
        )
        assert r.status_code in (200, 429), r.text
