"""Tests for expanded Statement Import feature (CSV/XLSX/OFX/QFX flexible mapping).

Covers:
  - Auth gating on /api/statements/preview + /api/accounts/import
  - Auto-detection: Chase, Bank of America (parens/$/commas),
    Wells Fargo (Debit+Credit), UK-style Money Out/Money In
  - Unknown-headers mapping fallback (`needs_mapping`, fingerprint)
  - XLSX + OFX parsing
  - Preview vs. commit isolation (no DB writes on preview)
  - Saved-mapping reuse (auto-succeeds on second file with same fingerprint)
  - Plain-language errors (empty, oversize, garbage, malformed override_mapping)
  - Regression on original /api/accounts/import route
"""

import io
import os
import uuid
from datetime import datetime

import pytest
import requests
from openpyxl import Workbook
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://no-changes-mobile.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')


# --------------- fixtures ---------------

@pytest.fixture(scope='module')
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope='module')
def user_ctx(db):
    """Fresh registered user for the whole module — cleaned up at teardown."""
    email = f'TEST_stmt+{uuid.uuid4().hex[:8]}@jaleter.app'
    r = requests.post(
        f'{BASE_URL}/api/auth/register',
        json={'name': 'TEST Stmt Import', 'email': email, 'password': 'password123!'},
        timeout=20,
    )
    assert r.status_code == 200, f'register failed: {r.status_code} {r.text}'
    data = r.json()
    token = data['token']
    uid = data['user']['user_id']
    yield {'token': token, 'user_id': uid, 'email': email, 'headers': {'Authorization': f'Bearer {token}'}}
    # cleanup
    try:
        db.saved_mappings.delete_many({'user_id': uid})
        db.bank_transactions.delete_many({'user_id': uid})
        db.linked_accounts.delete_many({'user_id': uid})
        db.users.delete_one({'user_id': uid})
    except Exception as e:
        print(f'cleanup warn: {e}')


# --------------- helpers ---------------

def _post_preview(user_ctx, filename, content, mime='text/csv', override_mapping=None, auth=True):
    files = {'file': (filename, content, mime)}
    data = {}
    if override_mapping is not None:
        data['override_mapping'] = override_mapping
    headers = user_ctx['headers'] if auth else {}
    return requests.post(f'{BASE_URL}/api/statements/preview', headers=headers, files=files, data=data, timeout=30)


def _post_import(user_ctx, filename, content, mime='text/csv', override_mapping=None, account_name=None, auth=True):
    files = {'file': (filename, content, mime)}
    data = {}
    if override_mapping is not None:
        data['override_mapping'] = override_mapping
    if account_name:
        data['account_name'] = account_name
    headers = user_ctx['headers'] if auth else {}
    return requests.post(f'{BASE_URL}/api/accounts/import', headers=headers, files=files, data=data, timeout=30)


# --------------- 1. Auth gating ---------------

class TestAuthGating:
    def test_preview_requires_auth(self):
        r = requests.post(f'{BASE_URL}/api/statements/preview',
                          files={'file': ('a.csv', b'x,y\n1,2\n', 'text/csv')}, timeout=15)
        assert r.status_code == 401, f'expected 401, got {r.status_code} {r.text}'

    def test_import_requires_auth(self):
        r = requests.post(f'{BASE_URL}/api/accounts/import',
                          files={'file': ('a.csv', b'x,y\n1,2\n', 'text/csv')}, timeout=15)
        assert r.status_code == 401, f'expected 401, got {r.status_code} {r.text}'


# --------------- 2. Format detection & parsing ---------------

CHASE_CSV = b"""Details,Posting Date,Description,Amount,Type,Balance
DEBIT,07/15/2025,STARBUCKS #1234,-5.75,DEBIT_CARD,1234.56
CREDIT,07/14/2025,DIRECT DEPOSIT,2500.00,ACH_CREDIT,1240.31
"""

BOA_CSV = b'''Date,Description,Amount,Running Bal.
07/15/2025,"STARBUCKS","($5.75)","$1,234.56"
07/14/2025,"PAYROLL","$2,500.00","$1,240.31"
'''

WELLS_CSV = b"""Posted Date,Description,Debit,Credit
07/15/2025,STARBUCKS,5.75,
07/14/2025,PAYROLL,,2500.00
"""

UK_CSV = b"""Transaction Date,Details,Money Out,Money In,Balance
15/07/2025,STARBUCKS,5.75,,1234.56
14/07/2025,SALARY,,2500.00,1240.31
"""

WEIRD_CSV = b"""When,What,Money
07/15/2025,STARBUCKS,-5.75
07/14/2025,PAYROLL,2500.00
"""


class TestFormatDetection:
    def test_a_chase_style(self, user_ctx):
        r = _post_preview(user_ctx, 'chase.csv', CHASE_CSV)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p['format'] == 'csv'
        assert p['transaction_count'] == 2, p
        assert p['needs_mapping'] is False
        m = p['detected_mapping']
        assert m.get('date') == 'Posting Date', m
        assert m.get('description') == 'Description', m
        assert m.get('amount') == 'Amount', m

    def test_b_boa_parens_dollars_commas(self, user_ctx):
        r = _post_preview(user_ctx, 'boa.csv', BOA_CSV)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p['transaction_count'] == 2, p
        sample = p['sample']
        # First row = STARBUCKS -5.75, second = PAYROLL 2500.00 (from file order)
        amounts = {s['description']: s['amount'] for s in sample}
        assert amounts.get('STARBUCKS') == -5.75, amounts
        assert amounts.get('PAYROLL') == 2500.0, amounts
        assert p['total_debits'] == 5.75, p['total_debits']
        assert p['total_credits'] == 2500.0, p['total_credits']

    def test_c_wells_debit_credit(self, user_ctx):
        r = _post_preview(user_ctx, 'wells.csv', WELLS_CSV)
        assert r.status_code == 200, r.text
        p = r.json()
        m = p['detected_mapping']
        assert 'debit' in m and 'credit' in m, m
        assert 'amount' not in m, m
        by_desc = {s['description']: s['amount'] for s in p['sample']}
        assert by_desc.get('STARBUCKS') == -5.75, by_desc
        assert by_desc.get('PAYROLL') == 2500.0, by_desc

    def test_d_uk_money_out_in(self, user_ctx):
        r = _post_preview(user_ctx, 'uk.csv', UK_CSV)
        assert r.status_code == 200, r.text
        p = r.json()
        m = p['detected_mapping']
        assert m.get('date') == 'Transaction Date', m
        assert m.get('debit') == 'Money Out', m
        assert m.get('credit') == 'Money In', m
        assert m.get('description') == 'Details', m
        by_desc = {s['description']: s['amount'] for s in p['sample']}
        assert by_desc.get('STARBUCKS') == -5.75, by_desc
        assert by_desc.get('SALARY') == 2500.0, by_desc

    def test_e_unknown_headers_and_override(self, user_ctx):
        r = _post_preview(user_ctx, 'weird.csv', WEIRD_CSV)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p['needs_mapping'] is True, p
        assert p['transaction_count'] == 0, p
        assert p['headers'] == ['When', 'What', 'Money'], p['headers']
        fp = p['fingerprint']
        assert isinstance(fp, str) and len(fp) == 24, fp
        # hex check
        int(fp, 16)

        # override_mapping should now parse
        r2 = _post_preview(
            user_ctx, 'weird.csv', WEIRD_CSV,
            override_mapping='{"date":"When","description":"What","amount":"Money"}',
        )
        assert r2.status_code == 200, r2.text
        p2 = r2.json()
        assert p2['needs_mapping'] is False, p2
        assert p2['transaction_count'] == 2, p2

    def test_f_xlsx(self, user_ctx):
        wb = Workbook()
        ws = wb.active
        ws.append(['Transaction Date', 'Description', 'Amount'])
        ws.append(['2025-07-15', 'STARBUCKS', -5.75])
        ws.append(['2025-07-14', 'PAYROLL', 2500.00])
        buf = io.BytesIO()
        wb.save(buf)
        raw = buf.getvalue()
        r = _post_preview(
            user_ctx, 'a.xlsx', raw,
            mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p['format'] == 'xlsx', p
        assert p['transaction_count'] == 2, p


# --------------- 3. Preview vs commit isolation ---------------

class TestPreviewVsCommit:
    def test_preview_writes_nothing(self, user_ctx, db):
        before = db.bank_transactions.count_documents({'user_id': user_ctx['user_id']})
        r = _post_preview(user_ctx, 'chase.csv', CHASE_CSV)
        assert r.status_code == 200, r.text
        after = db.bank_transactions.count_documents({'user_id': user_ctx['user_id']})
        assert after == before, f'preview changed DB count: {before} -> {after}'

    def test_import_commits(self, user_ctx, db):
        before = db.bank_transactions.count_documents({'user_id': user_ctx['user_id']})
        r = _post_import(user_ctx, 'chase.csv', CHASE_CSV, account_name='TEST Chase')
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['inserted'] == 2, body
        after = db.bank_transactions.count_documents({'user_id': user_ctx['user_id']})
        assert after - before == 2, f'expected +2 tx, got {before} -> {after}'


# --------------- 4. Saved-mapping reuse ---------------

class TestSavedMappingReuse:
    def test_saved_mapping_flow(self, user_ctx, db):
        # 1. Import weird file with explicit override -> should insert & save mapping.
        r = _post_import(
            user_ctx, 'weird.csv', WEIRD_CSV,
            override_mapping='{"date":"When","description":"What","amount":"Money"}',
            account_name='TEST Weird',
        )
        assert r.status_code == 200, r.text
        assert r.json().get('inserted', 0) >= 1, r.json()

        # 2. Verify Mongo row — look up by the weird fingerprint specifically
        # since previous tests may have saved other mappings (e.g. Chase).
        # Recompute fingerprint via preview to be exact.
        pv = _post_preview(user_ctx, 'weird.csv', WEIRD_CSV,
                           override_mapping='{"date":"When","description":"What","amount":"Money"}')
        fp = pv.json()['fingerprint']
        saved = db.saved_mappings.find_one({'user_id': user_ctx['user_id'], 'fingerprint': fp})
        assert saved is not None, 'saved_mappings row missing for weird fingerprint'
        assert saved.get('fingerprint') == fp, saved
        assert saved.get('mapping', {}).get('date') == 'When', saved.get('mapping')
        assert saved.get('header_sample') == ['When', 'What', 'Money'], saved.get('header_sample')

        # 3. Preview WITHOUT override — should auto-reuse the saved mapping.
        r2 = _post_preview(user_ctx, 'weird.csv', WEIRD_CSV)
        assert r2.status_code == 200, r2.text
        p2 = r2.json()
        assert p2['needs_mapping'] is False, p2
        assert p2['transaction_count'] == 2, p2
        assert p2['detected_mapping'].get('date') == 'When', p2['detected_mapping']


# --------------- 5. Plain-language errors ---------------

class TestErrors:
    def test_empty_file(self, user_ctx):
        r = _post_preview(user_ctx, 'empty.csv', b'')
        assert r.status_code == 400, r.text
        assert 'empty' in r.json().get('detail', '').lower(), r.json()

    def test_oversize_file(self, user_ctx):
        big = b'a,b\n' + (b'1,2\n' * (2 * 1024 * 1024))  # ~8 MB
        r = _post_preview(user_ctx, 'big.csv', big)
        assert r.status_code == 413, f'expected 413, got {r.status_code} {r.text[:200]}'
        assert '5 MB' in r.json().get('detail', ''), r.json()

    def test_garbage_bytes_csv(self, user_ctx):
        # Random binary bytes with a .csv extension.
        r = _post_preview(user_ctx, 'garbage.csv', bytes(range(256)) * 4)
        # Should either 400 with a friendly message OR 200 with needs_mapping=true (no rows).
        assert r.status_code in (200, 400), r.text
        if r.status_code == 400:
            detail = r.json().get('detail', '')
            assert 'Traceback' not in detail and 'File "' not in detail, f'raw traceback leaked: {detail}'
        else:
            body = r.json()
            assert body.get('transaction_count', 0) == 0, body

    def test_malformed_override_mapping(self, user_ctx):
        r = _post_preview(
            user_ctx, 'chase.csv', CHASE_CSV,
            override_mapping='{not valid json',
        )
        assert r.status_code == 400, r.text
        detail = r.json().get('detail', '')
        assert 'override_mapping' in detail and 'valid JSON' in detail, detail


# --------------- 6. OFX passthrough ---------------

OFX_TEXT = b"""OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<DTSERVER>20250715120000</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>0</TRNUID>
<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<STMTRS><CURDEF>USD</CURDEF>
<BANKACCTFROM><BANKID>111000000</BANKID><ACCTID>1234567890</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20250701</DTSTART><DTEND>20250715</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250715</DTPOSTED><TRNAMT>-5.75</TRNAMT>
<FITID>TXN-1</FITID><NAME>STARBUCKS</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1234.56</BALAMT><DTASOF>20250715</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
"""


class TestOFX:
    def test_ofx_preview(self, user_ctx):
        r = _post_preview(user_ctx, 'sample.ofx', OFX_TEXT, mime='application/x-ofx')
        assert r.status_code == 200, r.text
        p = r.json()
        assert p['format'] == 'ofx', p
        assert p['transaction_count'] == 1, p


# --------------- 7. Regression on old /api/accounts/import route ---------------

class TestLegacyImport:
    def test_old_route_still_works(self, user_ctx, db):
        # Clean prior test data so we can assert exactly +2.
        db.bank_transactions.delete_many({'user_id': user_ctx['user_id']})
        r = _post_import(user_ctx, 'chase_legacy.csv', CHASE_CSV, account_name='TEST Chase Legacy')
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['inserted'] == 2, body
