"""Weekly digest — Sunday 6PM local, Premium-only, push-only, deterministic.

Design:
    * APScheduler `AsyncIOScheduler` runs once per hour on the hour (:00).
      Cheap sweep. For each Premium user whose stored IANA timezone puts
      their local time inside `[18:00, 19:00)` on Sunday, compute + send
      the digest (once per week).
    * Dedup: `weekly_digest_state` collection keyed by
      `u/<user_id>/<local_iso_year>-W<local_iso_week>`. Insert-if-absent.
    * Content is generated from data ALREADY on the server:
        - This-week vs last-week total spend (Plaid `bank_transactions`,
          non-transfer, positive amounts) using the user's local week
          window (Sunday 18:00 boundary is included in "this week").
        - Count of transactions this week + count of large-transaction
          notifications fired this week.
        - Count of budget alerts (80% / 100%) fired this week.
        - Top merchant by spend this week (Plaid merchant_name or name).
    * All monetary math uses `Decimal` for correctness.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from pymongo.errors import DuplicateKeyError

from push_service import send_push

logger = logging.getLogger(__name__)

# Global scheduler handle so we can shut down cleanly and so tests can peek.
_scheduler: Optional[AsyncIOScheduler] = None


def _fmt_money(x: Decimal | float | int) -> str:
    x = Decimal(x)
    q = x.quantize(Decimal("0.01"))
    # No cents when it's exactly whole for cleaner push copy.
    if q == q.to_integral_value():
        return f"${int(q):,}"
    return f"${q:,.2f}"


def _local_week_bounds(now_local: datetime) -> tuple[datetime, datetime, datetime, datetime, str]:
    """Return (this_start, this_end_exclusive, prev_start, prev_end_exclusive, week_key).

    Week is Monday 00:00 → next Monday 00:00 in the user's local time zone.
    ISO week key is `YYYY-Www` (used purely for dedup, not for display).
    We invoke this AT Sunday 18:00, so `this_start` is 6 days + 18h earlier.
    """
    # Anchor Monday 00:00 of the current ISO week.
    monday = (now_local - timedelta(days=now_local.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    this_start = monday
    this_end = monday + timedelta(days=7)
    prev_start = monday - timedelta(days=7)
    prev_end = monday
    iso = now_local.isocalendar()
    week_key = f"{iso[0]}-W{iso[1]:02d}"
    return this_start, this_end, prev_start, prev_end, week_key


async def _week_totals(db, user_id: str, start_utc: datetime, end_utc: datetime) -> dict[str, Any]:
    """Compute total spend, txn count, and top merchant for a UTC window."""
    q = {
        "user_id": user_id,
        "date": {
            "$gte": start_utc.strftime("%Y-%m-%d"),
            "$lt": end_utc.strftime("%Y-%m-%d"),
        },
    }
    total = Decimal("0")
    count = 0
    per_merchant: dict[str, Decimal] = {}
    cursor = db.bank_transactions.find(q, {"amount": 1, "system_category": 1, "is_transfer": 1, "merchant_name": 1, "name": 1})
    async for tx in cursor:
        if tx.get("system_category") == "transfer" or tx.get("is_transfer"):
            continue
        amt = Decimal(str(tx.get("amount") or 0))
        if amt <= 0:
            continue  # spend only
        total += amt
        count += 1
        merch = (tx.get("merchant_name") or tx.get("name") or "Unknown").strip()
        per_merchant[merch] = per_merchant.get(merch, Decimal("0")) + amt
    top_merchant = None
    top_amount = Decimal("0")
    for m, v in per_merchant.items():
        if v > top_amount:
            top_amount = v
            top_merchant = m
    return {"total": total, "count": count, "top_merchant": top_merchant, "top_amount": top_amount}


async def _alerts_this_week(db, user_id: str, start_utc: datetime, end_utc: datetime) -> dict[str, int]:
    """Count budget alerts + large transactions fired in the UTC window."""
    q = {
        "user_id": user_id,
        "created_at": {"$gte": start_utc, "$lt": end_utc},
    }
    budget = await db.notifications.count_documents({**q, "type": {"$in": ["category_80", "category_100"]}})
    large = await db.notifications.count_documents({**q, "type": "large_transaction"})
    return {"budget_alerts": budget, "large_txns": large}


def _build_body(this_wk: dict, prev_wk: dict, alert_counts: dict) -> tuple[str, str]:
    total_now = Decimal(this_wk["total"])
    total_prev = Decimal(prev_wk["total"])
    count = int(this_wk["count"])
    delta = total_now - total_prev
    if count == 0 and total_prev == 0:
        title = "Your weekly Jaleter summary"
        body = "No spending activity this week. Enjoy the calm."
        return title, body
    parts: list[str] = [f"You spent {_fmt_money(total_now)} across {count} txn{'s' if count != 1 else ''}"]
    if total_prev > 0:
        pct = int(round(float(abs(delta) / total_prev * 100))) if total_prev else 0
        if delta < 0:
            parts.append(f"— down {_fmt_money(-delta)} ({pct}%) vs last week")
        elif delta > 0:
            parts.append(f"— up {_fmt_money(delta)} ({pct}%) vs last week")
        else:
            parts.append("— flat vs last week")
    tail_bits: list[str] = []
    top = this_wk.get("top_merchant")
    if top and this_wk.get("top_amount", 0) > 0:
        tail_bits.append(f"Top: {top} ({_fmt_money(this_wk['top_amount'])})")
    ba = int(alert_counts.get("budget_alerts", 0))
    lt = int(alert_counts.get("large_txns", 0))
    if ba:
        tail_bits.append(f"{ba} budget alert{'s' if ba != 1 else ''}")
    if lt:
        tail_bits.append(f"{lt} large txn{'s' if lt != 1 else ''}")
    body = ". ".join([" ".join(parts), *tail_bits])
    if not body.endswith("."):
        body += "."
    return "Your weekly Jaleter summary", body


async def _is_premium_active(user: dict) -> bool:
    """Match the server-side gate used by `require_active_membership`."""
    import entitlement_service
    if user.get("is_admin"):
        return False  # admins don't get digest — they're not paying subscribers
    return bool(entitlement_service.has_active_membership(user))


async def send_weekly_digest(db, user: dict) -> dict[str, Any]:
    """Compute + send the digest for one user. Returns a small report dict."""
    user_id = user["user_id"]
    tz_name = user.get("timezone") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)
    this_start_local, this_end_local, prev_start_local, prev_end_local, week_key = _local_week_bounds(now_local)

    # Dedup: attempt to insert the state row. If it already exists, bail.
    state_id = f"u/{user_id}/{week_key}"
    try:
        await db.weekly_digest_state.insert_one(
            {"_id": state_id, "user_id": user_id, "week_key": week_key, "created_at": now_utc},
        )
    except DuplicateKeyError:
        return {"skipped": "already_sent", "week_key": week_key}

    # Convert local windows → UTC for querying.
    this_start_utc = this_start_local.astimezone(timezone.utc)
    this_end_utc = this_end_local.astimezone(timezone.utc)
    prev_start_utc = prev_start_local.astimezone(timezone.utc)
    prev_end_utc = prev_end_local.astimezone(timezone.utc)

    this_wk = await _week_totals(db, user_id, this_start_utc, this_end_utc)
    prev_wk = await _week_totals(db, user_id, prev_start_utc, prev_end_utc)
    alert_counts = await _alerts_this_week(db, user_id, this_start_utc, this_end_utc)
    title, body = _build_body(this_wk, prev_wk, alert_counts)

    # Persist a notification record (inbox) + attempt push delivery. Failure
    # of push MUST NOT roll back the notification row (parity with alerts).
    ntf = {
        "user_id": user_id,
        "type": "weekly_digest",
        "title": title,
        "body": body,
        "category_id": None,
        "transaction_id": None,
        "budget_period": None,
        "delivery_status": "queued",
        "provider_message_id": None,
        "created_at": now_utc,
        "sent_at": None,
        "read_at": None,
        "metadata": {
            "week_key": week_key,
            "total_this_week": float(this_wk["total"]),
            "total_prev_week": float(prev_wk["total"]),
            "txn_count": int(this_wk["count"]),
            "top_merchant": this_wk.get("top_merchant"),
            "top_amount": float(this_wk.get("top_amount") or 0),
            "budget_alerts": int(alert_counts.get("budget_alerts", 0)),
            "large_txns": int(alert_counts.get("large_txns", 0)),
        },
    }
    ins = await db.notifications.insert_one(ntf)
    ntf_id = str(ins.inserted_id)

    push_status = "failed"
    provider_msg = None
    try:
        result = await send_push(
            recipients=[user_id],
            data={"title": title, "message": body, "action_url": "/notifications"},
            idempotency_key=state_id,
        )
        if isinstance(result, dict) and not result.get("error"):
            push_status = "sent"
            provider_msg = result.get("id") or result.get("message_id") or result.get("request_id")
    except Exception as e:  # noqa: BLE001
        logger.warning("weekly digest push failed for %s: %s", user_id, e)

    await db.notifications.update_one(
        {"_id": ins.inserted_id},
        {"$set": {"delivery_status": push_status, "provider_message_id": str(provider_msg) if provider_msg else None, "sent_at": datetime.now(timezone.utc)}},
    )
    return {"user_id": user_id, "notification_id": ntf_id, "week_key": week_key, "push_status": push_status, "title": title, "body": body}


async def sweep_and_send(db) -> dict[str, Any]:
    """Iterate active Premium users whose local time is Sunday 18:00–18:59.

    Called by APScheduler once per hour. Safe to call more often — dedup
    prevents duplicate sends.
    """
    now_utc = datetime.now(timezone.utc)
    sent = 0
    skipped = 0
    considered = 0
    # Only consider users with a subscription_status set (fast filter).
    cursor = db.users.find(
        {"$or": [
            {"subscription_status": {"$in": ["active", "trialing", "past_due"]}},
            {"premium_expires_at": {"$gt": now_utc}},
        ]},
        {"_id": 0, "user_id": 1, "timezone": 1, "alert_prefs": 1, "subscription_status": 1,
         "premium_expires_at": 1, "is_admin": 1, "subscription_current_period_end": 1},
    )
    async for user in cursor:
        considered += 1
        tz_name = user.get("timezone") or "UTC"
        try:
            tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            tz = ZoneInfo("UTC")
        now_local = now_utc.astimezone(tz)
        # Fire only Sunday 18:00–18:59 local (weekday: Mon=0 … Sun=6).
        if now_local.weekday() != 6 or now_local.hour != 18:
            continue
        prefs = (user.get("alert_prefs") or {})
        if prefs.get("enabled", True) is False:
            skipped += 1
            continue
        if prefs.get("weeklyDigest", True) is False:
            skipped += 1
            continue
        if not await _is_premium_active(user):
            skipped += 1
            continue
        try:
            res = await send_weekly_digest(db, user)
            if res.get("skipped"):
                skipped += 1
            else:
                sent += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("weekly digest failed for %s: %s", user.get("user_id"), e)
    return {"considered": considered, "sent": sent, "skipped": skipped}


def start_scheduler(db) -> None:
    global _scheduler
    if _scheduler is not None:
        return
    # Allow tests / low-value envs to disable.
    if os.environ.get("WEEKLY_DIGEST_DISABLED", "").lower() in ("1", "true", "yes"):
        logger.info("Weekly digest scheduler disabled via env")
        return
    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        sweep_and_send,
        CronTrigger(minute=0),  # every hour on the hour
        kwargs={"db": db},
        id="weekly_digest_sweep",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    # Alert email digest sweep — flushes queued daily/weekly alert emails at
    # 18:00 local per user (see budget_alert_service.sweep_alert_email_digests).
    from budget_alert_service import sweep_alert_email_digests  # noqa: WPS433
    sched.add_job(
        sweep_alert_email_digests,
        CronTrigger(minute=10),  # hourly, offset from the weekly sweep
        kwargs={"db": db},
        id="alert_email_digest_sweep",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("Weekly digest scheduler started (hourly sweep, Sunday 18:00 local delivery)")


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
