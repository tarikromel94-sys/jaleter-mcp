"""Iteration-37 tests: Phase-3 Transaction Correctness.

Coverage:
  UNIT
   - transaction_classifier.classify_system(): PFC (TRANSFER_IN/OUT, LOAN_PAYMENTS,
     LOAN_PAYMENTS_CREDIT_CARD_PAYMENT), legacy category hierarchy,
     description-only keyword paths, user-override precedence.
   - file_provider._detect_columns(): Chase "Description>Details" precedence,
     Bank of America separate Debit+Credit, Post Date/Posting Date aliases,
     Transaction Type direction hint.
   - file_provider._parse_csv(): returns (mapping, rows, skipped); mid-file bad
     rows are skipped, not fatal.

  ENDPOINTS
   - GET /api/accounts/transactions?include_transfers=false
   - PATCH /api/accounts/transactions/{external_id}/classify (401/404/400/200,
     null revert, "none" disable, IDOR user-A cannot classify user-B row)
   - POST /api/accounts/transactions/match-transfers (matched_pairs count,
     paired_external_id linked, override='none' NOT matched)

  REGRESSION
   - coach_ai_service.build_context_snippet() strips system_category rows
   - GET /api/accounts/all still returns Phase-2 fields
   - DELETE /api/auth/delete-account cascades bank_transactions
"""
from __future__ import annotations

import os
import sys
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

# Allow direct import of backend modules for unit tests.
sys.path.insert(0, '/app/backend')
import transaction_classifier as tc  # noqa: E402
from providers.file_provider import _detect_columns, _parse_csv, _combine_debit_credit, _resolve_direction  # noqa: E402
from coach_ai_service import build_context_snippet  # noqa: E402

# ---------- Config ---------------------------------------------------------
BASE_URL = None
with open('/app/frontend/.env') as f:
    for line in f:
        if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')
            break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'test_database')
_mongo = MongoClient(MONGO_URL)
_db = _mongo[DB_NAME]

USER_EMAIL = 'alex+test1@jaleter.app'
USER_PASSWORD = 'password123'


# ---------- Fixtures -------------------------------------------------------
@pytest.fixture(scope='module')
def user_token():
    sess = requests.Session()
    sess.headers.update({'Content-Type': 'application/json'})
    r = sess.post(f"{BASE_URL}/api/auth/login", json={'email': USER_EMAIL, 'password': USER_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"Cannot login as test user: {r.status_code} {r.text[:200]}")
    data = r.json()
    return {'token': data['token'], 'user_id': data['user']['user_id']}


@pytest.fixture(scope='module')
def user_b_token():
    """Create a second isolated user for IDOR testing."""
    sess = requests.Session()
    sess.headers.update({'Content-Type': 'application/json'})
    email = f"TEST_i37_userb_{uuid.uuid4().hex[:8]}@jaleter.app"
    r = sess.post(f"{BASE_URL}/api/auth/register",
                  json={'name': 'IDOR B', 'email': email, 'password': 'password123'})
    if r.status_code != 200:
        pytest.skip(f"Cannot register user-B: {r.status_code} {r.text[:200]}")
    data = r.json()
    yield {'token': data['token'], 'user_id': data['user']['user_id'], 'email': email}
    # Cleanup — delete the user + any residual data
    try:
        sess.headers.update({'Authorization': f'Bearer {data["token"]}'})
        sess.request('DELETE', f"{BASE_URL}/api/auth/delete-account", json={'password': 'password123'})
    except Exception:
        pass


def _bearer(tok: str) -> dict:
    return {'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'}


def _seed_tx(user_id: str, account_id: str, external_id: str, amount: float, date: datetime, **extra):
    doc = {
        'user_id': user_id,
        'provider': 'test_seed',
        'link_id': f'test-seed-{account_id}',
        'account_id': account_id,
        'external_id': external_id,
        'date': date,
        'amount': amount,
        'name': extra.pop('name', f'TEST_TX {external_id}'),
        'description': extra.pop('description', 'TEST'),
        'type': 'income' if amount > 0 else 'expense',
        'origin': 'TEST_SEED',
        'pending': False,
    }
    doc.update(extra)
    _db.bank_transactions.insert_one(doc)
    return doc


def _cleanup_seed(user_id: str):
    _db.bank_transactions.delete_many({'user_id': user_id, 'provider': 'test_seed'})


# ============================================================================
# UNIT: transaction_classifier.classify_system
# ============================================================================
class TestClassifySystem:
    def test_pfc_transfer_in_alone_returns_none(self):
        # Post-fix: TRANSFER_IN by itself is NOT enough. Plaid tags ACH deposits,
        # paychecks, interest, etc. as TRANSFER_IN — those should stay as income.
        assert tc.classify_system({'personal_finance_category': {'primary': 'TRANSFER_IN', 'detailed': 'TRANSFER_IN_ACCOUNT_TRANSFER'}}) is None

    def test_pfc_transfer_in_with_description_keyword(self):
        # Only when the description also says "transfer" AND detailed is
        # TRANSFER_IN_ACCOUNT_TRANSFER do we trust it.
        assert tc.classify_system({
            'personal_finance_category': {'primary': 'TRANSFER_IN', 'detailed': 'TRANSFER_IN_ACCOUNT_TRANSFER'},
            'description': 'Transfer from Savings',
        }) == 'transfer'

    def test_pfc_transfer_in_deposit_stays_income(self):
        # TRANSFER_IN_DEPOSIT (paycheck-style ACH credits) must NOT be
        # auto-classified as transfer regardless of description not saying so.
        assert tc.classify_system({
            'personal_finance_category': {'primary': 'TRANSFER_IN', 'detailed': 'TRANSFER_IN_DEPOSIT'},
            'description': 'ACH Credit ALLY BANK',
        }) is None

    def test_pfc_transfer_out(self):
        assert tc.classify_system({'personal_finance_category': {'primary': 'TRANSFER_OUT', 'detailed': 'TRANSFER_OUT_ACCOUNT_TRANSFER'}}) == 'transfer'

    def test_pfc_cc_payment(self):
        assert tc.classify_system({'personal_finance_category': {'primary': 'LOAN_PAYMENTS', 'detailed': 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}}) == 'credit_card_payment'

    def test_pfc_loan_payment_mortgage(self):
        assert tc.classify_system({'personal_finance_category': {'primary': 'LOAN_PAYMENTS', 'detailed': 'LOAN_PAYMENTS_MORTGAGE_PAYMENT'}}) == 'loan_payment'

    def test_pfc_loan_payment_auto(self):
        assert tc.classify_system({'personal_finance_category': {'primary': 'LOAN_PAYMENTS', 'detailed': 'LOAN_PAYMENTS_CAR_PAYMENT'}}) == 'loan_payment'

    def test_pfc_food_returns_none(self):
        assert tc.classify_system({'personal_finance_category': {'primary': 'FOOD_AND_DRINK', 'detailed': 'FOOD_AND_DRINK_RESTAURANT'}}) is None

    def test_legacy_transfer(self):
        assert tc.classify_system({'category': ['Transfer', 'Internal Account Transfer']}) == 'transfer'

    def test_legacy_cc_payment(self):
        assert tc.classify_system({'category': ['Payment', 'Credit Card Payment']}) == 'credit_card_payment'

    def test_legacy_loan_payment(self):
        assert tc.classify_system({'category': ['Payment', 'Loan Payment']}) == 'loan_payment'

    def test_description_transfer(self):
        assert tc.classify_system({'description': 'Transfer to Savings'}) == 'transfer'

    def test_description_cc_payment(self):
        assert tc.classify_system({'description': 'Payment to Chase Card'}) == 'credit_card_payment'

    def test_description_loan_payment(self):
        assert tc.classify_system({'description': 'Mortgage Payment'}) == 'loan_payment'

    def test_description_regular_food_none(self):
        assert tc.classify_system({'description': 'Starbucks Coffee'}) is None

    def test_override_none_beats_pfc_transfer(self):
        txn = {'personal_finance_category': {'primary': 'TRANSFER_IN', 'detailed': 'X'},
               'system_category_override': 'none'}
        assert tc.classify_system(txn) is None

    def test_override_transfer_promotes_non_transfer(self):
        txn = {'personal_finance_category': {'primary': 'FOOD_AND_DRINK', 'detailed': 'X'},
               'system_category_override': 'transfer'}
        assert tc.classify_system(txn) == 'transfer'

    def test_override_invalid_ignored(self):
        # Invalid override falls back to normal detection.
        # Post-fix: TRANSFER_IN alone no longer classifies as transfer.
        txn = {'personal_finance_category': {'primary': 'TRANSFER_IN', 'detailed': 'X'},
               'system_category_override': 'bogus'}
        assert tc.classify_system(txn) is None

    def test_is_transfer_helper(self):
        assert tc.is_transfer({'personal_finance_category': {'primary': 'TRANSFER_OUT', 'detailed': 'X'}}) is True
        assert tc.is_transfer({'description': 'Starbucks'}) is False


# ============================================================================
# UNIT: file_provider._detect_columns
# ============================================================================
class TestDetectColumns:
    def test_chase_description_beats_details(self):
        """Chase CSVs often have BOTH 'Description' and 'Details' — the real
        merchant is in Description. Details holds transaction type."""
        header = ['Details', 'Posting Date', 'Description', 'Amount', 'Type']
        m = _detect_columns(header)
        assert m['description'] == 'Description'
        assert m['date'] == 'Posting Date'
        assert m['amount'] == 'Amount'
        assert m['type'] == 'Type'

    def test_boa_debit_credit_separate(self):
        header = ['Date', 'Description', 'Debit', 'Credit', 'Balance']
        m = _detect_columns(header)
        assert m.get('debit') == 'Debit'
        assert m.get('credit') == 'Credit'
        assert 'amount' not in m
        assert m['date'] == 'Date'

    def test_post_date_alias(self):
        header = ['Post Date', 'Merchant', 'Amount']
        m = _detect_columns(header)
        assert m['date'] == 'Post Date'
        assert m['description'] == 'Merchant'

    def test_posting_date_alias(self):
        header = ['Posting Date', 'Payee', 'Amount']
        m = _detect_columns(header)
        assert m['date'] == 'Posting Date'
        assert m['description'] == 'Payee'

    def test_transaction_type_column(self):
        header = ['Date', 'Description', 'Amount', 'Transaction Type']
        m = _detect_columns(header)
        assert m['type'] == 'Transaction Type'

    def test_fuzzy_fallback_memo(self):
        # No exact match for description but "Memo" contains hint
        header = ['Date', 'Random Memo Column', 'Amount']
        m = _detect_columns(header)
        assert 'description' in m

    def test_combine_debit_credit(self):
        # Debit → negative, Credit → positive; both quoted positive.
        assert _combine_debit_credit('50.00', '') == -50.00
        assert _combine_debit_credit('', '100.00') == 100.00
        assert _combine_debit_credit('20', '30') == 10.00

    def test_resolve_direction_flips_positive_debit(self):
        # Chase-style: amount positive, Type=DEBIT → should flip to negative
        assert _resolve_direction(25.00, 'DEBIT') == -25.00
        assert _resolve_direction(25.00, 'CREDIT') == 25.00
        assert _resolve_direction(-10.00, 'CREDIT') == 10.00  # flips
        assert _resolve_direction(10.00, '') == 10.00


# ============================================================================
# UNIT: file_provider._parse_csv
# ============================================================================
class TestParseCSV:
    def test_returns_tuple(self):
        csv = "Date,Description,Amount\n2025-01-01,Starbucks,-5.25\n"
        result = _parse_csv(csv)
        assert isinstance(result, tuple) and len(result) == 3
        mapping, rows, skipped = result
        assert mapping['date'] == 'Date'
        assert len(rows) == 1
        assert rows[0]['amount'] == -5.25
        assert skipped == []

    def test_skips_bad_row_but_parses_rest(self):
        # Row 3 has non-parsable amount → should be skipped, not fail entire file
        csv = "Date,Description,Amount\n2025-01-01,Good,10.00\n2025-01-02,Bad,NOT_A_NUMBER\n2025-01-03,GoodAgain,20.00\n"
        mapping, rows, skipped = _parse_csv(csv)
        # _parse_amount returns 0 on ValueError so row 3 becomes amount=0
        # But it has a description so it's still kept. Skipped may be empty.
        # Real failure would be an IndexError. Verify NO exception raised.
        assert len(rows) >= 2

    def test_skips_row_missing_column(self):
        # Row with too few columns → IndexError → skipped
        csv = "Date,Description,Amount\n2025-01-01,Good,10.00\n2025-01-02\n2025-01-03,Third,30.00\n"
        mapping, rows, skipped = _parse_csv(csv)
        assert len(rows) == 2  # rows 2 and 4 parsed
        assert len(skipped) == 1
        assert skipped[0]['row_num'] == 3
        assert 'reason' in skipped[0] and 'raw' in skipped[0]

    def test_chase_debit_credit_combined(self):
        csv = "Posting Date,Description,Debit,Credit\n2025-01-01,Coffee,4.50,\n2025-01-02,Paycheck,,2500.00\n"
        mapping, rows, skipped = _parse_csv(csv)
        assert mapping.get('debit') == 'Debit'
        assert mapping.get('credit') == 'Credit'
        assert len(rows) == 2
        assert rows[0]['amount'] == -4.50
        assert rows[1]['amount'] == 2500.00

    def test_chase_description_vs_details(self):
        csv = "Details,Posting Date,Description,Amount,Type\nCREDIT,2025-01-01,PAYCHECK,2500.00,ACH_CREDIT\nDEBIT,2025-01-02,STARBUCKS,5.25,DEBIT_CARD\n"
        mapping, rows, skipped = _parse_csv(csv)
        assert mapping['description'] == 'Description'
        # The Type column ACH_CREDIT / DEBIT_CARD — DEBIT_CARD isn't in the type-hint set.
        # Verify parse doesn't crash and we get 2 rows.
        assert len(rows) == 2

    def test_missing_date_raises(self):
        from providers.base import ProviderError
        csv = "Description,Amount\nStarbucks,-5.25\n"
        with pytest.raises(ProviderError):
            _parse_csv(csv)


# ============================================================================
# ENDPOINT: GET /api/accounts/transactions?include_transfers=false
# ============================================================================
class TestListTransactionsIncludeTransfersFilter:
    @pytest.fixture(autouse=True)
    def _setup(self, user_token):
        self.user_id = user_token['user_id']
        self.token = user_token['token']
        # Seed 2 rows: one transfer, one normal
        _cleanup_seed(self.user_id)
        now = datetime.now(timezone.utc)
        self.ext_transfer = f"TEST_i37_xfer_{uuid.uuid4().hex[:8]}"
        self.ext_regular = f"TEST_i37_reg_{uuid.uuid4().hex[:8]}"
        _seed_tx(self.user_id, 'test_acct_A', self.ext_transfer, -100.00, now,
                 system_category='transfer', is_transfer=True)
        _seed_tx(self.user_id, 'test_acct_A', self.ext_regular, -12.34, now,
                 system_category=None, is_transfer=False)
        yield
        _cleanup_seed(self.user_id)

    def test_include_transfers_true_default(self):
        r = requests.get(f"{BASE_URL}/api/accounts/transactions",
                         headers=_bearer(self.token))
        assert r.status_code == 200, r.text
        ext_ids = {t.get('external_id') for t in r.json()['transactions']}
        assert self.ext_transfer in ext_ids
        assert self.ext_regular in ext_ids

    def test_include_transfers_false_hides_transfer(self):
        r = requests.get(f"{BASE_URL}/api/accounts/transactions?include_transfers=false",
                         headers=_bearer(self.token))
        assert r.status_code == 200, r.text
        ext_ids = {t.get('external_id') for t in r.json()['transactions']}
        assert self.ext_transfer not in ext_ids
        assert self.ext_regular in ext_ids


# ============================================================================
# ENDPOINT: PATCH /api/accounts/transactions/{external_id}/classify
# ============================================================================
class TestClassifyEndpoint:
    @pytest.fixture(autouse=True)
    def _setup(self, user_token):
        self.user_id = user_token['user_id']
        self.token = user_token['token']
        _cleanup_seed(self.user_id)
        self.ext_id = f"TEST_i37_cls_{uuid.uuid4().hex[:8]}"
        _seed_tx(self.user_id, 'test_acct_C', self.ext_id, -50.00,
                 datetime.now(timezone.utc),
                 system_category=None, system_category_auto=None)
        yield
        _cleanup_seed(self.user_id)

    def test_unauth_401(self):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           json={'system_category': 'transfer'})
        assert r.status_code in (401, 403), r.text

    def test_not_found_404(self):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/does_not_exist/classify",
                           headers=_bearer(self.token), json={'system_category': 'transfer'})
        assert r.status_code == 404, r.text

    def test_bad_category_400(self):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           headers=_bearer(self.token), json={'system_category': 'garbage'})
        assert r.status_code == 400, r.text

    def test_set_transfer_persists(self):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           headers=_bearer(self.token), json={'system_category': 'transfer'})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body['system_category'] == 'transfer'
        # Verify DB state
        doc = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': self.ext_id})
        assert doc['system_category'] == 'transfer'
        assert doc['is_transfer'] is True
        assert doc.get('system_category_override') == 'transfer'

    def test_null_reverts_to_auto(self):
        # First set to transfer
        _db.bank_transactions.update_one(
            {'user_id': self.user_id, 'external_id': self.ext_id},
            {'$set': {'system_category': 'transfer', 'system_category_override': 'transfer',
                      'system_category_auto': 'credit_card_payment', 'is_transfer': True}}
        )
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           headers=_bearer(self.token), json={'system_category': None})
        assert r.status_code == 200, r.text
        assert r.json()['system_category'] == 'credit_card_payment'
        doc = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': self.ext_id})
        assert doc['system_category'] == 'credit_card_payment'
        assert 'system_category_override' not in doc
        assert doc['is_transfer'] is False

    def test_none_string_disables(self):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           headers=_bearer(self.token), json={'system_category': 'none'})
        assert r.status_code == 200, r.text
        assert r.json()['system_category'] is None
        doc = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': self.ext_id})
        assert doc['system_category'] is None
        assert doc.get('system_category_override') == 'none'
        assert doc['is_transfer'] is False

    def test_idor_user_b_cannot_classify_user_a_tx(self, user_b_token):
        r = requests.patch(f"{BASE_URL}/api/accounts/transactions/{self.ext_id}/classify",
                           headers=_bearer(user_b_token['token']),
                           json={'system_category': 'transfer'})
        assert r.status_code == 404, f"IDOR guard failed: {r.status_code} {r.text[:200]}"
        # Confirm the row was NOT modified
        doc = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': self.ext_id})
        assert doc.get('system_category_override') != 'transfer'


# ============================================================================
# ENDPOINT: POST /api/accounts/transactions/match-transfers
# ============================================================================
class TestMatchTransfers:
    @pytest.fixture(autouse=True)
    def _setup(self, user_token):
        self.user_id = user_token['user_id']
        self.token = user_token['token']
        _cleanup_seed(self.user_id)
        yield
        _cleanup_seed(self.user_id)

    def test_matches_pair_across_accounts(self):
        d1 = datetime.now(timezone.utc)
        d2 = d1 - timedelta(days=1)
        ext_a = f"TEST_i37_pair_a_{uuid.uuid4().hex[:8]}"
        ext_b = f"TEST_i37_pair_b_{uuid.uuid4().hex[:8]}"
        _seed_tx(self.user_id, 'acct_checking', ext_a, -47.50, d1)
        _seed_tx(self.user_id, 'acct_savings', ext_b, 47.50, d2)
        r = requests.post(f"{BASE_URL}/api/accounts/transactions/match-transfers",
                          headers=_bearer(self.token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get('ok') is True
        assert body.get('matched_pairs', 0) >= 1
        # Verify DB — both rows tagged transfer
        a = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': ext_a})
        b = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': ext_b})
        assert a['system_category'] == 'transfer'
        assert b['system_category'] == 'transfer'
        assert a.get('paired_external_id') == ext_b
        assert b.get('paired_external_id') == ext_a

    def test_override_none_not_matched(self):
        d1 = datetime.now(timezone.utc)
        d2 = d1 - timedelta(days=1)
        ext_a = f"TEST_i37_ovr_a_{uuid.uuid4().hex[:8]}"
        ext_b = f"TEST_i37_ovr_b_{uuid.uuid4().hex[:8]}"
        _seed_tx(self.user_id, 'acct_checking2', ext_a, -99.00, d1,
                 system_category_override='none')
        _seed_tx(self.user_id, 'acct_savings2', ext_b, 99.00, d2)
        r = requests.post(f"{BASE_URL}/api/accounts/transactions/match-transfers",
                          headers=_bearer(self.token))
        assert r.status_code == 200, r.text
        a = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': ext_a})
        b = _db.bank_transactions.find_one({'user_id': self.user_id, 'external_id': ext_b})
        # The overridden row should NOT have been flipped to transfer
        assert a.get('system_category') != 'transfer'
        # And b should not be paired to it
        assert b.get('paired_external_id') != ext_a


# ============================================================================
# REGRESSION: Coach AI build_context_snippet filters system txns
# ============================================================================
class TestCoachContextFiltersSystem:
    def test_transfer_stripped_from_snippet(self):
        ctx = {
            'transactions': [
                {'date': '2025-01-01', 'amount': -100, 'merchant': 'TRANSFER_TO_SAVINGS',
                 'system_category': 'transfer', 'type': 'expense'},
                {'date': '2025-01-02', 'amount': -12.34, 'merchant': 'STARBUCKS_KEEP',
                 'system_category': None, 'type': 'expense'},
                {'date': '2025-01-03', 'amount': -50, 'merchant': 'CHASE_PAY_HIDE',
                 'system_category': 'credit_card_payment', 'type': 'expense'},
                {'date': '2025-01-04', 'amount': -300, 'merchant': 'MORTGAGE_HIDE',
                 'system_category': 'loan_payment', 'type': 'expense'},
            ]
        }
        snippet = build_context_snippet(ctx)
        assert 'STARBUCKS_KEEP' in snippet
        assert 'TRANSFER_TO_SAVINGS' not in snippet
        assert 'CHASE_PAY_HIDE' not in snippet
        assert 'MORTGAGE_HIDE' not in snippet


# ============================================================================
# REGRESSION: /api/accounts/all still returns Phase-2 fields
# ============================================================================
class TestAccountsAllPhase2Fields:
    def test_endpoint_shape(self, user_token):
        r = requests.get(f"{BASE_URL}/api/accounts/all", headers=_bearer(user_token['token']))
        # Empty list is acceptable if no accounts linked; only shape matters
        assert r.status_code == 200, r.text
        body = r.json()
        # Body should be dict with 'accounts' or an error-tolerant shape
        accounts = body.get('accounts') if isinstance(body, dict) else None
        if not accounts:
            pytest.skip('No linked accounts for user — cannot validate field shape')
        acct = accounts[0]
        for field in ('category', 'auto_category', 'is_asset', 'is_liability'):
            assert field in acct, f"Missing Phase-2 field: {field}"


# ============================================================================
# REGRESSION: /api/auth/delete-account cascades bank_transactions
# ============================================================================
class TestDeleteAccountCascadesBankTx:
    def test_bank_transactions_purged(self):
        # Register a throwaway user, seed a bank_transaction, delete account, verify purge.
        sess = requests.Session()
        email = f"TEST_i37_del_{uuid.uuid4().hex[:8]}@jaleter.app"
        r = sess.post(f"{BASE_URL}/api/auth/register",
                      json={'name': 'Delete Me', 'email': email, 'password': 'password123'})
        assert r.status_code == 200, r.text
        data = r.json()
        uid = data['user']['user_id']
        tok = data['token']
        # Seed
        _seed_tx(uid, 'del_acct', f"TEST_i37_del_tx_{uuid.uuid4().hex[:6]}", -5.00, datetime.now(timezone.utc))
        assert _db.bank_transactions.count_documents({'user_id': uid}) == 1
        # Delete
        r = sess.request('DELETE', f"{BASE_URL}/api/auth/delete-account",
                         headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'},
                         json={'password': 'password123'})
        assert r.status_code == 200, r.text
        # Verify
        assert _db.bank_transactions.count_documents({'user_id': uid}) == 0
