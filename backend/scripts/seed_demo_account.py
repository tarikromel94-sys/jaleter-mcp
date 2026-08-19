"""One-shot seed script for the Apple App Review demo account.

Run this ONCE against the production DB after deploying:
    cd /app/backend && python -m scripts.seed_demo_account

It is safe to re-run: the script upserts the demo user and re-activates
Premium for one year from the moment of the run. Anything the user did in
the previous review cycle (transactions, notifications, alerts) is wiped
so reviewers always start from a known-clean state.

Design notes:
- The demo password is generated randomly and printed to stdout on the FIRST
  run only. Re-runs preserve the existing password_hash so screenshots and
  the App Review submission notes stay valid. If you need to force-rotate,
  pass --rotate-password.
- Premium entitlement here is granted directly on the user row (bypassing
  Stripe) so reviewers do not need to complete a real payment. This is
  purely for demo purposes; the production entitlement path (Stripe webhook)
  is unchanged.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import string
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Allow "python -m scripts.seed_demo_account" to import the backend package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / '.env')

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from passlib.context import CryptContext  # noqa: E402

DEMO_EMAIL = os.environ.get('DEMO_ACCOUNT_EMAIL', 'demo@jaleter.com').strip().lower()
DEMO_NAME = 'Jaleter Demo (App Review)'
PW_CTX = CryptContext(schemes=['bcrypt'], deprecated='auto')


def _generate_password() -> str:
    """A memorable-enough demo password meeting Apple's typical demo strength."""
    alphabet = string.ascii_letters + string.digits
    return 'Demo' + ''.join(secrets.choice(alphabet) for _ in range(10)) + '!'


async def main() -> int:
    parser = argparse.ArgumentParser(description='Seed the App Review demo user.')
    parser.add_argument('--rotate-password', action='store_true',
                        help='Force-generate a new password (breaks any existing App Review submission).')
    parser.add_argument('--purge-data', action='store_true', default=True,
                        help='Wipe demo user data so reviewers see a clean slate. Default: on.')
    args = parser.parse_args()

    mongo_url = os.environ['MONGO_URL']
    db_name = os.environ.get('DB_NAME', 'jaleter')
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    now = datetime.now(timezone.utc)
    existing = await db.users.find_one({'email': DEMO_EMAIL})

    if existing and not args.rotate_password:
        user_id = existing['user_id']
        password = None  # unchanged
        password_hash = existing['password_hash']
    else:
        user_id = existing['user_id'] if existing else str(uuid.uuid4())
        password = _generate_password()
        password_hash = PW_CTX.hash(password)

    doc = {
        'user_id': user_id,
        'email': DEMO_EMAIL,
        'name': DEMO_NAME,
        'password_hash': password_hash,
        'provider': 'password',
        'email_verified': True,
        'is_admin': False,
        'created_at': existing.get('created_at') if existing else now,
        'updated_at': now,
        # Grant one full year of Premium so reviewers can see everything gated.
        'subscription_status': 'active',
        'subscription_current_period_end': now + timedelta(days=365),
        'subscription_source': 'demo_seed',
        # Alerts on so reviewers can see the notification UI populated.
        'alerts': {
            'master': True,
            'budget': True,
            'daily_checkin': True,
            'goal_reminder': True,
            'tax_reminder': True,
            'weekly_digest': True,
        },
        'timezone': 'America/New_York',
    }
    await db.users.update_one(
        {'user_id': user_id},
        {'$set': doc},
        upsert=True,
    )

    purged = {}
    if args.purge_data:
        user_scoped = (
            'bank_transactions', 'transactions', 'notifications', 'alert_state',
            'device_tokens', 'linked_accounts', 'plaid_items', 'import_mappings',
            'budget_alert_state', 'weekly_digest_state', 'push_history',
            'legacy_snapshots', 'budget_cells', 'goals', 'categories',
            'income_sources', 'accounts', 'user_sessions', 'coach_messages',
            'coaching_bookings', 'support_tickets', 'support_requests',
            'payment_transactions', 'account_overrides',
        )
        for coll in user_scoped:
            try:
                r = await db[coll].delete_many({'user_id': user_id})
                if r.deleted_count:
                    purged[coll] = r.deleted_count
            except Exception:  # noqa: BLE001
                pass

    client.close()

    print('=' * 60)
    print('JALETER DEMO ACCOUNT SEED — RESULT')
    print('=' * 60)
    print(f'  Email:               {DEMO_EMAIL}')
    if password:
        print(f'  Password:            {password}   <-- COPY THIS INTO APP STORE CONNECT NOW')
        print('  Password change:     Save it in your password manager. Re-runs will preserve the hash unless --rotate-password.')
    else:
        print('  Password:            (unchanged — pass --rotate-password to reset)')
    print(f'  user_id:             {user_id}')
    print(f'  Premium until:       {(now + timedelta(days=365)).isoformat()}')
    print(f'  Data purged:         {purged if purged else "(nothing to purge — first run)"}')
    print('=' * 60)
    print('NEXT: paste the credentials above into App Store Connect →')
    print('       App Review Information → Sign-In required → YES.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
