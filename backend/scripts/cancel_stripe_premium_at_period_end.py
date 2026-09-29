"""
One-off migration: stop legacy Stripe Premium subscriptions from renewing.

Jaleter Premium moved to Apple IAP / Google Play Billing (June 2026).
Members who bought on the web keep access until the period they already
paid for ends (grandfathered — see entitlement_service.py), then subscribe
in the app. This script sets `cancel_at_period_end=true` on every live
legacy Premium subscription in the connected Stripe account and mirrors the
flag onto the matching Jaleter user rows. Coaching is one-off (never a
subscription) and is untouched.

Usage (from /app/backend):
    python scripts/cancel_stripe_premium_at_period_end.py --dry-run
    python scripts/cancel_stripe_premium_at_period_end.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / '.env', override=True)  # .env live key beats pod test key

import stripe_legacy  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main(dry_run: bool) -> None:
    report = stripe_legacy.cancel_premium_at_period_end(dry_run=dry_run)
    db = AsyncIOMotorClient(os.environ['MONGO_URL'], tz_aware=True)[os.environ['DB_NAME']]
    mirrored = 0
    if not dry_run:
        for row in report['subs']:
            q = {'stripe_subscription_id': row['id']}
            if row.get('user_id'):
                q = {'$or': [q, {'user_id': row['user_id']}]}
            res = await db.users.update_many(q, {'$set': {
                'subscription_cancel_at_period_end': True,
                'legacy_stripe_grandfathered_at': datetime.now(timezone.utc),
            }})
            mirrored += res.modified_count
    report['users_mirrored'] = mirrored
    report['dry_run'] = dry_run
    print(json.dumps(report, indent=2, default=str))


if __name__ == '__main__':
    asyncio.run(main('--dry-run' in sys.argv))
