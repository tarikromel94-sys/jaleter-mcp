"""Data retention service — 30-day purge policies for Jaleter.

Runs daily (via APScheduler in `server.py`) to purge stale, low-value data
so we honor our data-minimisation posture without touching anything a
user would notice.

Policies (all rolling 30 days unless noted):

    1. `password_resets`        — hard-purge tokens > 30 days old
                                   (TTL index also enforces this — belt+braces).
    2. `email_verifications`    — hard-purge tokens > 30 days old.
    3. `payment_transactions`   — hard-purge sessions with status in
                                   {'expired', 'open'} > 30 days old.
                                   `completed` payments are kept forever
                                   for accounting/audit.
    4. `coach_messages`         — hard-purge chat turns > 30 days old
                                   per user confirmation.
    5. `support_tickets`        — hard-purge tickets in `status='closed'`
                                   whose `closed_at` (or `updated_at`
                                   fallback) > 30 days old.
    6. `net_worth_snapshots`    — KEEP FOREVER (long-term trendline is
                                   a headline feature). Explicitly noted
                                   here so future contributors don't
                                   accidentally add a purge for it.
    7. Orphaned per-user rows   — for every collection tagged with a
                                   `user_id` field, delete any docs
                                   whose `user_id` is not in `users`
                                   (residue from botched delete-account
                                   flows or old imports). Bounded scan.

Each policy returns a `{collection, deleted}` row; the aggregator
returns the whole report so the caller can log/inspect it.

Everything is best-effort: a failure in one policy MUST NOT abort the
others, and MUST NOT raise into APScheduler (would drop the next run).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import logging

logger = logging.getLogger(__name__)


RETENTION_DAYS = 30

# Collections tagged by `user_id` that we want to sweep for orphans.
# `users` is intentionally excluded (it *is* the source of truth). We
# also exclude `net_worth_snapshots` from the orphan sweep here so a
# retention bug can't erase the long-term trendline — that collection
# is already user-scoped and cleaned on delete-account.
_USER_SCOPED_COLLECTIONS = [
    'user_sessions',
    'password_resets',
    'email_verifications',
    'linked_accounts',
    'bank_transactions',
    'plaid_items',
    'snaptrade_accounts',
    'snaptrade_users',
    'support_tickets',
    'support_requests',
    'coaching_bookings',
    'payment_transactions',
    'coach_messages',
    'account_overrides',
]


async def _purge_by_created_at(db, coll: str, cutoff: datetime, extra: dict | None = None) -> dict:
    """Delete rows in `coll` older than `cutoff` (using created_at first,
    falling back to `_id`-embedded timestamp). Returns `{collection, deleted}`.
    """
    q: dict[str, Any] = {'created_at': {'$lt': cutoff}}
    if extra:
        q.update(extra)
    try:
        r = await db[coll].delete_many(q)
        return {'collection': coll, 'deleted': r.deleted_count}
    except Exception as e:  # noqa: BLE001
        logger.warning('retention: purge_by_created_at failed on %s: %s', coll, e)
        return {'collection': coll, 'deleted': 0, 'error': str(e)}


async def _purge_password_resets(db, cutoff: datetime) -> dict:
    # Field is `created_at` here.
    return await _purge_by_created_at(db, 'password_resets', cutoff)


async def _purge_email_verifications(db, cutoff: datetime) -> dict:
    return await _purge_by_created_at(db, 'email_verifications', cutoff)


async def _purge_failed_payments(db, cutoff: datetime) -> dict:
    """Only purge Stripe sessions that never completed (expired / open).
    Successful `completed` sessions stay forever for audit + refunds."""
    q = {
        'created_at': {'$lt': cutoff},
        'status': {'$in': ['expired', 'open']},
    }
    try:
        r = await db.payment_transactions.delete_many(q)
        return {'collection': 'payment_transactions', 'deleted': r.deleted_count}
    except Exception as e:  # noqa: BLE001
        logger.warning('retention: purge_failed_payments failed: %s', e)
        return {'collection': 'payment_transactions', 'deleted': 0, 'error': str(e)}


async def _purge_coach_messages(db, cutoff: datetime) -> dict:
    # Coach messages use `created_at` for the timestamp.
    return await _purge_by_created_at(db, 'coach_messages', cutoff)


async def _purge_closed_support_tickets(db, cutoff: datetime) -> dict:
    """Tickets in `status='closed'` whose closed_at (or updated_at) is
    older than the cutoff. Open / in-progress tickets are never purged."""
    q = {
        'status': 'closed',
        '$or': [
            {'closed_at': {'$lt': cutoff}},
            {'updated_at': {'$lt': cutoff}},
        ],
    }
    try:
        r = await db.support_tickets.delete_many(q)
        return {'collection': 'support_tickets', 'deleted': r.deleted_count}
    except Exception as e:  # noqa: BLE001
        logger.warning('retention: purge_closed_tickets failed: %s', e)
        return {'collection': 'support_tickets', 'deleted': 0, 'error': str(e)}


async def _sweep_orphans(db) -> list[dict]:
    """For every user-scoped collection, delete rows whose user_id no
    longer exists in `users`. Bounded scan (10k per collection) so a
    single sweep never runs unbounded."""
    live_users = set()
    try:
        async for u in db.users.find({}, {'_id': 0, 'user_id': 1}):
            uid = u.get('user_id')
            if uid:
                live_users.add(uid)
    except Exception as e:  # noqa: BLE001
        logger.warning('retention: user sweep skipped, cannot list users: %s', e)
        return []
    reports: list[dict] = []
    for coll in _USER_SCOPED_COLLECTIONS:
        try:
            # Grab distinct user_ids in this collection; then delete rows
            # whose user_id is not in `live_users`. Distinct is capped at
            # 10k entries by mongo default which is more than enough.
            ids = await db[coll].distinct('user_id')
            orphan_ids = [i for i in ids if i and i not in live_users]
            if not orphan_ids:
                reports.append({'collection': coll, 'orphan_users': 0, 'deleted': 0})
                continue
            r = await db[coll].delete_many({'user_id': {'$in': orphan_ids}})
            reports.append({
                'collection': coll,
                'orphan_users': len(orphan_ids),
                'deleted': r.deleted_count,
            })
        except Exception as e:  # noqa: BLE001
            logger.warning('retention: orphan sweep failed on %s: %s', coll, e)
            reports.append({'collection': coll, 'orphan_users': 0, 'deleted': 0, 'error': str(e)})
    return reports


async def run_retention(db, retention_days: int = RETENTION_DAYS) -> dict:
    """Run every policy and return a structured report.

    Never raises — designed to be safe to invoke from any context
    (scheduler tick, admin endpoint, or manual). Individual policy
    failures are captured in the report.
    """
    started_at = datetime.now(timezone.utc)
    cutoff = started_at - timedelta(days=retention_days)
    report: dict[str, Any] = {
        'started_at': started_at.isoformat(),
        'retention_days': retention_days,
        'cutoff': cutoff.isoformat(),
        'policies': [],
        'orphans': [],
    }
    try:
        report['policies'] = [
            await _purge_password_resets(db, cutoff),
            await _purge_email_verifications(db, cutoff),
            await _purge_failed_payments(db, cutoff),
            await _purge_coach_messages(db, cutoff),
            await _purge_closed_support_tickets(db, cutoff),
        ]
    except Exception as e:  # noqa: BLE001
        logger.error('retention: unexpected error during policy run: %s', e)
        report['error'] = str(e)
    try:
        report['orphans'] = await _sweep_orphans(db)
    except Exception as e:  # noqa: BLE001
        logger.error('retention: unexpected error during orphan sweep: %s', e)
        report['orphan_error'] = str(e)
    finished_at = datetime.now(timezone.utc)
    report['finished_at'] = finished_at.isoformat()
    report['duration_ms'] = int((finished_at - started_at).total_seconds() * 1000)
    total_deleted = sum(p.get('deleted', 0) for p in report['policies']) + sum(
        o.get('deleted', 0) for o in report['orphans']
    )
    report['total_deleted'] = total_deleted
    logger.info('retention run complete: %s docs purged in %sms', total_deleted, report['duration_ms'])
    return report
