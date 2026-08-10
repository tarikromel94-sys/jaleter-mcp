"""Tests for /api/admin/retention/* endpoints + retention math.

Uses real Mongo (via motor on the same MONGO_URL/DB_NAME) to seed
"aged" docs and verify retention deletes / preserves per policy.
"""
import os
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL') or os.environ.get('EXPO_BACKEND_URL')
if not BASE_URL:
    # Fallback for tests: read from frontend/.env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().strip('"')
                break
BASE_URL = BASE_URL.rstrip('/')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']

ADMIN_EMAIL = 'support@jaleter.com'
ADMIN_PASS = 'Tarik0731!'
USER_EMAIL = 'alex+test1@jaleter.app'
USER_PASS = 'password123'


@pytest.fixture(scope='module')
def db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope='module')
def admin_token():
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f'admin login failed: {r.status_code} {r.text}'
    return r.json()['token']


@pytest.fixture(scope='module')
def user_token():
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': USER_EMAIL, 'password': USER_PASS}, timeout=30)
    assert r.status_code == 200, f'user login failed: {r.status_code} {r.text}'
    return r.json()['token']


@pytest.fixture(scope='module')
def real_user_id(user_token):
    r = requests.get(f'{BASE_URL}/api/auth/me', headers={'Authorization': f'Bearer {user_token}'}, timeout=30)
    assert r.status_code == 200
    return r.json()['user_id']


# --- 1. Auth guard: no token ---
def test_retention_run_no_auth():
    r = requests.post(f'{BASE_URL}/api/admin/retention/run', timeout=30)
    assert r.status_code in (401, 403), f'expected 401/403, got {r.status_code}'


# --- 2. Non-admin -> 403 ---
def test_retention_run_non_admin(user_token):
    r = requests.post(
        f'{BASE_URL}/api/admin/retention/run',
        headers={'Authorization': f'Bearer {user_token}'},
        timeout=30,
    )
    assert r.status_code == 403, f'expected 403, got {r.status_code} {r.text}'
    assert 'Admin access required' in r.text


# --- 3. Admin -> 200 with structured report ---
def test_retention_run_admin_structure(admin_token):
    r = requests.post(
        f'{BASE_URL}/api/admin/retention/run',
        headers={'Authorization': f'Bearer {admin_token}'},
        timeout=60,
    )
    assert r.status_code == 200, f'expected 200, got {r.status_code} {r.text}'
    rep = r.json()
    for k in ('started_at', 'retention_days', 'cutoff', 'policies', 'orphans',
              'finished_at', 'duration_ms', 'total_deleted'):
        assert k in rep, f'missing key: {k}'
    assert rep['retention_days'] == 30
    assert isinstance(rep['policies'], list) and len(rep['policies']) >= 5
    collections = {p['collection'] for p in rep['policies']}
    for expected in ('password_resets', 'email_verifications',
                     'payment_transactions', 'coach_messages', 'support_tickets'):
        assert expected in collections, f'missing policy: {expected}'
    for p in rep['policies']:
        assert 'collection' in p and 'deleted' in p
        assert isinstance(p['deleted'], int) and p['deleted'] >= 0
    assert isinstance(rep['orphans'], list)


# --- 4. Retention math correctness ---
def _run_purge(admin_token):
    r = requests.post(
        f'{BASE_URL}/api/admin/retention/run',
        headers={'Authorization': f'Bearer {admin_token}'},
        timeout=60,
    )
    assert r.status_code == 200
    return r.json()


def test_retention_math_password_resets(admin_token, db, real_user_id):
    old = {'token': 'TEST_pr_old_40d', 'user_id': real_user_id, 'created_at': datetime.now(timezone.utc) - timedelta(days=40)}
    fresh = {'token': 'TEST_pr_fresh_5d', 'user_id': real_user_id, 'created_at': datetime.now(timezone.utc) - timedelta(days=5)}
    db.password_resets.insert_one(old)
    db.password_resets.insert_one(fresh)
    _run_purge(admin_token)
    assert db.password_resets.find_one({'token': 'TEST_pr_old_40d'}) is None, 'aged password_reset was NOT purged'
    assert db.password_resets.find_one({'token': 'TEST_pr_fresh_5d'}) is not None, 'fresh password_reset was wrongly purged'
    db.password_resets.delete_one({'token': 'TEST_pr_fresh_5d'})


def test_retention_math_payment_transactions(admin_token, db, real_user_id):
    old_completed = {
        'session_id': 'TEST_pay_completed_40d',
        'user_id': real_user_id,
        'status': 'completed',
        'created_at': datetime.now(timezone.utc) - timedelta(days=40),
    }
    old_open = {
        'session_id': 'TEST_pay_open_40d',
        'user_id': real_user_id,
        'status': 'open',
        'created_at': datetime.now(timezone.utc) - timedelta(days=40),
    }
    db.payment_transactions.insert_one(old_completed)
    db.payment_transactions.insert_one(old_open)
    _run_purge(admin_token)
    assert db.payment_transactions.find_one({'session_id': 'TEST_pay_completed_40d'}) is not None, 'completed payment (40d) wrongly purged'
    assert db.payment_transactions.find_one({'session_id': 'TEST_pay_open_40d'}) is None, 'open payment (40d) not purged'
    db.payment_transactions.delete_one({'session_id': 'TEST_pay_completed_40d'})


def test_retention_math_coach_messages(admin_token, db, real_user_id):
    old = {'user_id': real_user_id, 'role': 'user', 'content': 'TEST_coach_40d',
           'created_at': datetime.now(timezone.utc) - timedelta(days=40)}
    db.coach_messages.insert_one(old)
    _run_purge(admin_token)
    assert db.coach_messages.find_one({'content': 'TEST_coach_40d'}) is None


def test_retention_networth_snapshots_preserved(admin_token, db, real_user_id):
    doc = {
        'user_id': real_user_id,
        'date_key': '2020-01-01',
        'taken_at': datetime.now(timezone.utc) - timedelta(days=2000),
        'total': 12345.0,
        '_test_marker': 'TEST_nw_ancient',
    }
    db.net_worth_snapshots.insert_one(doc)
    _run_purge(admin_token)
    assert db.net_worth_snapshots.find_one({'_test_marker': 'TEST_nw_ancient'}) is not None, (
        'net_worth_snapshots must NEVER be purged by retention'
    )
    db.net_worth_snapshots.delete_one({'_test_marker': 'TEST_nw_ancient'})


# --- 5. Orphan sweep ---
def test_orphan_sweep_bank_transactions(admin_token, db):
    # Insert bank_transaction with user_id that does not exist in `users`.
    orphan_uid = 'test-orphan-uid-xyz'
    db.users.delete_many({'user_id': orphan_uid})  # ensure not present
    db.bank_transactions.insert_one({
        'user_id': orphan_uid,
        'transaction_id': 'TEST_orphan_txn_1',
        'amount': 1.23,
        'created_at': datetime.now(timezone.utc),
    })
    rep = _run_purge(admin_token)
    # verify deletion
    assert db.bank_transactions.find_one({'transaction_id': 'TEST_orphan_txn_1'}) is None, 'orphan bank_transaction not deleted'
    # verify report entry
    bt = next((o for o in rep['orphans'] if o['collection'] == 'bank_transactions'), None)
    assert bt is not None, 'orphans report missing bank_transactions entry'
    assert bt.get('orphan_users', 0) >= 1


# --- 6. Audit collection status endpoint ---
def test_retention_status_endpoint(admin_token):
    r = requests.get(
        f'{BASE_URL}/api/admin/retention/status',
        headers={'Authorization': f'Bearer {admin_token}'},
        timeout=30,
    )
    assert r.status_code == 200, f'status failed: {r.status_code} {r.text}'
    body = r.json()
    assert 'runs' in body and isinstance(body['runs'], list)


def test_retention_status_non_admin(user_token):
    r = requests.get(
        f'{BASE_URL}/api/admin/retention/status',
        headers={'Authorization': f'Bearer {user_token}'},
        timeout=30,
    )
    assert r.status_code == 403


# --- 8. Regression: core endpoints still work ---
def test_regression_auth_me(user_token):
    r = requests.get(f'{BASE_URL}/api/auth/me', headers={'Authorization': f'Bearer {user_token}'}, timeout=30)
    assert r.status_code == 200


def test_regression_networth_history(user_token):
    r = requests.get(
        f'{BASE_URL}/api/networth/history?range=month',
        headers={'Authorization': f'Bearer {user_token}'},
        timeout=30,
    )
    assert r.status_code == 200


def test_regression_plaid_sync(user_token):
    r = requests.post(
        f'{BASE_URL}/api/plaid/sync',
        headers={'Authorization': f'Bearer {user_token}'},
        timeout=30,
    )
    # Should not 500; 200 or 400 (no plaid item) are acceptable
    assert r.status_code in (200, 400, 404), f'plaid/sync returned {r.status_code}: {r.text}'
