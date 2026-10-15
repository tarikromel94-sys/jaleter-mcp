"""
Seed a Premium test user with Plaid-style bank transactions for Smart
Categorization QA. Usage (from /app/backend):
    python scripts/seed_categorization_demo.py [email] [password]
Prints the credentials. Idempotent for the same email.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
API = 'http://localhost:8001/api'


def plaid_row(uid: str, acct: str, eid: str, desc: str, merchant: str | None, amount: float, detailed: str, primary: str, days_ago: int, sysc: str | None = None):
    now = datetime.now(timezone.utc)
    return {
        'user_id': uid, 'account_id': acct, 'external_id': eid, 'provider': 'plaid', 'link_id': 'item_demo',
        'org_name': 'Demo Bank', 'amount': amount, 'currency': 'USD', 'date': now - timedelta(days=days_ago),
        'description': desc, 'merchant': merchant, 'category': primary, 'pending': False,
        'system_category': sysc, 'system_category_auto': sysc, 'is_transfer': sysc == 'transfer',
        'raw': {'personal_finance_category': {'detailed': detailed, 'primary': primary}},
    }


async def main():
    email = (sys.argv[1] if len(sys.argv) > 1 else f'smartcat_{uuid.uuid4().hex[:6]}@jaleter.example.com').lower()
    password = sys.argv[2] if len(sys.argv) > 2 else 'Passw0rd!xyz'
    r = requests.post(API + '/auth/register', json={'name': 'Smart Cat QA', 'email': email, 'password': password})
    if r.status_code != 200:
        r = requests.post(API + '/auth/login', json={'email': email, 'password': password})
    tok = r.json()['token']
    H = {'Authorization': 'Bearer ' + tok}
    exp = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
    requests.post(API + '/iap/sync', json={'active': True, 'expires_at': exp, 'product_id': 'demo', 'platform': 'ios'}, headers=H)
    db = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    u = await db.users.find_one({'email': email}, {'user_id': 1})
    uid = u['user_id']
    acct = 'acct_demo_checking'
    rows = [
        plaid_row(uid, acct, 'demo_kroger_1', 'KROGER #0412 ATLANTA GA', 'Kroger', -86.42, 'FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK', 2),
        plaid_row(uid, acct, 'demo_chipotle_1', 'CHIPOTLE 0442', 'Chipotle Mexican Grill', -14.85, 'FOOD_AND_DRINK_RESTAURANT', 'FOOD_AND_DRINK', 3),
        plaid_row(uid, acct, 'demo_amazon_1', 'AMAZON.COM*2K4LP', 'Amazon', -62.10, 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'GENERAL_MERCHANDISE', 4),
        plaid_row(uid, acct, 'demo_petsmart_1', 'PETSMART #221', 'PetSmart', -41.00, 'GENERAL_MERCHANDISE_PET_SUPPLIES', 'GENERAL_MERCHANDISE', 5),
        plaid_row(uid, acct, 'demo_payroll_1', 'ACME CORP PAYROLL', None, 2450.00, 'INCOME_WAGES', 'INCOME', 6),
        plaid_row(uid, acct, 'demo_transfer_1', 'ONLINE TRANSFER TO SAVINGS', None, -500.00, 'TRANSFER_OUT_ACCOUNT_TRANSFER', 'TRANSFER_OUT', 7, 'transfer'),
        plaid_row(uid, acct, 'demo_ccpay_1', 'CHASE CREDIT CRD AUTOPAY', None, -320.00, 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 'LOAN_PAYMENTS', 8, 'credit_card_payment'),
        plaid_row(uid, acct, 'demo_kroger_refund', 'KROGER #0412 REFUND', 'Kroger', 12.00, 'FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK', 1),
        plaid_row(uid, acct, 'demo_shell_1', 'SHELL OIL 57444221', 'Shell', -48.20, 'TRANSPORTATION_GAS', 'TRANSPORTATION', 9),
        plaid_row(uid, acct, 'demo_statefarm_1', 'STATE FARM INSURANCE', 'State Farm', -121.50, 'GENERAL_SERVICES_INSURANCE', 'GENERAL_SERVICES', 10),
    ]
    for row in rows:
        await db.bank_transactions.update_one({'user_id': uid, 'external_id': row['external_id']}, {'$set': row}, upsert=True)
    await db.merchant_rules.delete_many({'user_id': uid})
    print(f'EMAIL={email}\nPASSWORD={password}\nUSER_ID={uid}\nTOKEN={tok}\nrows={len(rows)}')


if __name__ == '__main__':
    asyncio.run(main())
