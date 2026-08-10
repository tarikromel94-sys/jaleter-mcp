"""Net Worth service — canonical totals + historical snapshots for Jaleter.

Provides three responsibilities:

    1. compute_totals(db, user_id)  — sum every linked Plaid account
       (respecting per-user overrides / categories) into a single
       {total_assets, total_liabilities, net_worth} dict. This is the
       server-side mirror of the frontend's "Single Source of Truth"
       math and MUST stay in sync with `_plaid_list_accounts_for_user`.
    2. save_snapshot(db, user_id, totals, source) — persist one daily
       snapshot per user (upsert by UTC calendar day so multiple syncs
       on the same day overwrite the latest values without inflating the
       chart).
    3. get_history(db, user_id, range_key) — return the ordered list of
       snapshots for the requested range (`month`, `quarter`, `year`).
       Automatically backfills a "today" snapshot for users who have no
       history yet so the chart never renders empty on first load.

The collection is `net_worth_snapshots` with schema:
    { user_id, date_key (YYYY-MM-DD UTC), taken_at (datetime), total_assets,
      total_liabilities, net_worth, source }
Unique on (user_id, date_key) — same-day resync overwrites.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


RANGE_TO_DAYS: dict[str, int] = {
    'month': 30,
    'quarter': 90,
    'year': 365,
}


def _utc_date_key(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%d')


def _sum_row(row: dict) -> tuple[float, float]:
    """Given a Plaid account row from `_plaid_list_accounts_for_user`,
    return `(asset_amount, liability_amount)`. Balances have already been
    normalised (liabilities → absolute magnitude) upstream, so we just
    route by side."""
    try:
        bal = float(row.get('balance') or 0)
    except (TypeError, ValueError):
        bal = 0.0
    if row.get('is_liability'):
        return 0.0, abs(bal)
    if row.get('is_asset'):
        return bal, 0.0
    # Unknown row (provider error) — ignore in totals.
    return 0.0, 0.0


async def compute_totals(db, user_id: str, plaid_rows: Optional[list[dict]] = None) -> dict:
    """Return {total_assets, total_liabilities, net_worth} for a user.

    `plaid_rows` can be passed in to avoid a second Plaid round-trip when
    the caller already fetched them (e.g. right after a sync). When None,
    the caller is responsible for supplying rows via the `_plaid_list_
    accounts_for_user` helper — this module intentionally does not import
    from `server.py` to avoid a circular import.
    """
    total_assets = 0.0
    total_liabilities = 0.0
    for row in (plaid_rows or []):
        if row.get('error'):
            continue
        a, l = _sum_row(row)
        total_assets += a
        total_liabilities += l
    # Round to cents so JSON is clean and comparisons work.
    total_assets = round(total_assets, 2)
    total_liabilities = round(total_liabilities, 2)
    net_worth = round(total_assets - total_liabilities, 2)
    return {
        'total_assets': total_assets,
        'total_liabilities': total_liabilities,
        'net_worth': net_worth,
    }


async def save_snapshot(
    db,
    user_id: str,
    totals: dict,
    source: str,
    taken_at: Optional[datetime] = None,
) -> dict:
    """Upsert one snapshot for the given user for today's UTC calendar
    day. Same-day writes overwrite the previous value so the chart shows
    at most one point per day (per user's confirmed preference).
    """
    taken_at = taken_at or datetime.now(timezone.utc)
    date_key = _utc_date_key(taken_at)
    doc = {
        'user_id': user_id,
        'date_key': date_key,
        'taken_at': taken_at,
        'total_assets': float(totals.get('total_assets') or 0),
        'total_liabilities': float(totals.get('total_liabilities') or 0),
        'net_worth': float(totals.get('net_worth') or 0),
        'source': source,
    }
    try:
        await db.net_worth_snapshots.update_one(
            {'user_id': user_id, 'date_key': date_key},
            {'$set': doc, '$setOnInsert': {'created_at': taken_at}},
            upsert=True,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning('save_snapshot failed for user %s: %s', user_id, e)
    return doc


async def get_history(
    db,
    user_id: str,
    range_key: str,
    live_totals: Optional[dict] = None,
) -> dict:
    """Return snapshot history for the requested range.

    - `range_key` in {"month", "quarter", "year"} (defaults to month).
    - If `live_totals` is provided AND today has no persisted snapshot,
      we insert one on the fly so the chart always includes a "today"
      point. This gives brand-new users an immediate anchor and prevents
      the classic "empty chart on first load" experience.
    - Returned points are ordered oldest→newest, with ISO timestamps.
    """
    days = RANGE_TO_DAYS.get(range_key, RANGE_TO_DAYS['month'])
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    today_key = _utc_date_key()

    # Backfill today's snapshot if the user has no row for today yet.
    if live_totals is not None:
        existing_today = await db.net_worth_snapshots.find_one(
            {'user_id': user_id, 'date_key': today_key}
        )
        if not existing_today:
            await save_snapshot(db, user_id, live_totals, source='auto_backfill')

    cursor = db.net_worth_snapshots.find(
        {'user_id': user_id, 'taken_at': {'$gte': cutoff}},
        {'_id': 0, 'user_id': 0},
    ).sort('taken_at', 1)
    docs = await cursor.to_list(length=1000)
    points: list[dict] = []
    for d in docs:
        ta = d.get('taken_at')
        if isinstance(ta, datetime):
            iso = ta.astimezone(timezone.utc).isoformat()
        else:
            iso = str(ta) if ta else None
        points.append({
            'date_key': d.get('date_key'),
            'taken_at': iso,
            'total_assets': d.get('total_assets'),
            'total_liabilities': d.get('total_liabilities'),
            'net_worth': d.get('net_worth'),
            'source': d.get('source'),
        })
    return {
        'range': range_key,
        'days': days,
        'points': points,
        'latest': points[-1] if points else None,
    }
