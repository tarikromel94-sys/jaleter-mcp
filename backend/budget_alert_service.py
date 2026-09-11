"""Budget alert + push notification service for Jaleter.

Deterministic (no LLM) evaluator. Two entry points:
  - evaluate_budget_alerts_for_user(db, user_id): 80% + 100% category checks
  - evaluate_transaction_alert(db, user_id, tx): large-transaction check

Dedupe via `alert_state` collection with composite `_id`:
  "u/{user_id}/{period}/{category}/{type}"  (budget threshold alerts)
  "u/{user_id}/tx/{transaction_id}/{type}"  (large-transaction alerts)

Delivery via Expo Push API (Emergent-managed). Failed sends are recorded
but do not raise — evaluation is fire-and-forget from ingest paths.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pymongo.errors import DuplicateKeyError

from push_service import send_push
from email_service import send_email, build_alert_email, build_alert_digest_email

logger = logging.getLogger(__name__)


def current_period() -> str:
    """Budget period key. Calendar month YYYY-MM in device-local terms."""
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


async def get_user_alert_prefs(db, user_id: str) -> dict:
    """Return the raw alerts blob stored on the user record.

    Blob shape (matches the frontend):
      { enabled: bool,
        perCategory: { [sub_id]: {p50: bool, p80: bool, exceeded: bool} },
        singleExpense: { enabled: bool, threshold: number } }

    Sensible defaults if missing: enabled=True, no per-sub overrides
    (server evaluator falls back to defaults p50=off/p80=on/100=on),
    singleExpense disabled at $200.
    """
    u = await db.users.find_one({'user_id': user_id}, {'_id': 0, 'alert_prefs': 1}) or {}
    p = u.get('alert_prefs') or {}
    return {
        'enabled': bool(p.get('enabled', True)),
        'perCategory': dict(p.get('perCategory') or {}),
        'singleExpense': {
            'enabled': bool((p.get('singleExpense') or {}).get('enabled', False)),
            'threshold': float((p.get('singleExpense') or {}).get('threshold') or 200),
        },
        'weeklyDigest': bool(p.get('weeklyDigest', True)),
        'emailFrequency': p.get('emailFrequency') if p.get('emailFrequency') in ('instant', 'daily', 'weekly') else 'instant',
    }


def _sub_prefs(prefs: dict, sub_id: str) -> dict:
    """Per-subcategory alert config with new-user defaults (p50=off, p80=on, 100=on)."""
    conf = (prefs.get('perCategory') or {}).get(sub_id) or {}
    return {
        'p50': bool(conf.get('p50', False)),
        'p80': bool(conf.get('p80', True)),
        'exceeded': bool(conf.get('exceeded', True)),
    }


async def _record_notification(db, *, user_id: str, ntype: str, title: str, body: str,
                               category_id: Optional[str] = None, transaction_id: Optional[str] = None,
                               period: Optional[str] = None, metadata: Optional[dict] = None) -> dict:
    doc = {
        'user_id': user_id, 'type': ntype, 'title': title, 'body': body,
        'category_id': category_id, 'transaction_id': transaction_id,
        'budget_period': period, 'delivery_status': 'created',
        'created_at': datetime.now(timezone.utc), 'read_at': None,
        'metadata': metadata or {},
    }
    r = await db.notifications.insert_one(doc)
    doc['_id'] = r.inserted_id
    return doc


async def _send_push(db, user_id: str, title: str, body: str, data: dict) -> tuple[str, Optional[str]]:
    """Deliver via Emergent-managed push (SuprSend relay). No token storage.
    Returns (status, provider_message_id)."""
    try:
        result = await send_push(
            recipients=[user_id],
            data={"title": title, "message": body, **data},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning('Push transport error: %s', e)
        return ('failed', None)
    if isinstance(result, dict) and result.get('error'):
        return ('failed', None)
    msg_id = None
    if isinstance(result, dict):
        msg_id = result.get('id') or result.get('message_id') or result.get('request_id')
    return ('sent', str(msg_id) if msg_id else None)


async def _claim(db, key: str) -> bool:
    """Idempotent claim of an alert slot. Returns True iff first time."""
    try:
        await db.alert_state.insert_one({'_id': key, 'at': datetime.now(timezone.utc)})
        return True
    except DuplicateKeyError:
        return False


async def _send_alert_email(db, user_id: str, title: str, body: str, ntype: str) -> str:
    """Deliver the alert via Emergent-managed Resend to the user's account
    email. Returns 'sent' | 'failed' | 'skipped' (no email on record)."""
    u = await db.users.find_one({'user_id': user_id}, {'_id': 0, 'email': 1, 'name': 1}) or {}
    email = (u.get('email') or '').strip()
    if not email:
        return 'skipped'
    try:
        subject, html, text = build_alert_email(u.get('name') or '', title, body, ntype)
        ok, detail = await send_email(email, subject, html, text)
        if not ok:
            logger.warning('Alert email to %s failed: %s', email, detail)
        return 'sent' if ok else 'failed'
    except Exception as e:  # noqa: BLE001
        logger.warning('Alert email error for %s: %s', user_id, e)
        return 'failed'


async def _emit(db, *, user_id: str, key: str, title: str, body: str,
                 ntype: str, category_id: Optional[str], transaction_id: Optional[str],
                 period: Optional[str], metadata: dict, email_mode: str = 'instant') -> Optional[dict]:
    """Claim → record → deliver (push + email). Returns the notification doc
    or None if the dedupe key was already claimed. Push always fires
    immediately; email fires now when email_mode='instant', otherwise the
    record is queued (email_status='queued') for the daily/weekly digest
    sweep. Overall delivery_status is 'sent' when at least one channel
    succeeded."""
    if not await _claim(db, key):
        return None
    n = await _record_notification(db, user_id=user_id, ntype=ntype, title=title, body=body,
                                   category_id=category_id, transaction_id=transaction_id,
                                   period=period, metadata=metadata)
    push_status, msg_id = await _send_push(db, user_id, title, body,
                                           {'type': ntype, 'notification_id': str(n['_id']),
                                            'category_id': category_id, 'transaction_id': transaction_id})
    if email_mode == 'instant':
        email_status = await _send_alert_email(db, user_id, title, body, ntype)
    else:
        email_status = 'queued'
    if push_status == 'sent' or email_status == 'sent':
        overall = 'sent'
    elif email_status == 'queued':
        overall = 'queued'
    else:
        overall = 'failed'
    await db.notifications.update_one(
        {'_id': n['_id']},
        {'$set': {'delivery_status': overall, 'push_status': push_status,
                  'email_status': email_status, 'sent_at': datetime.now(timezone.utc),
                  'provider_message_id': msg_id}},
    )
    n.update({'delivery_status': overall, 'push_status': push_status, 'email_status': email_status})
    return n


# ---- Category threshold evaluation --------------------------------------
async def evaluate_budget_alerts_for_user(db, user_id: str, *,
                                          category_totals: Optional[dict[str, dict]] = None,
                                          period: Optional[str] = None) -> list[dict]:
    """Evaluate 50 / 80 / 100 threshold alerts for a set of subcategories.

    `category_totals` shape:
      { <sub_id>: {'name': str, 'spent': float, 'budget': float,
                    'parent_name'?: str} }
    Only subcategories with `budget > 0` trigger. Uses per-sub prefs (with
    defaults p50=off, p80=on, 100=on). 100%+ takes precedence over 80%,
    which takes precedence over 50% within a single evaluation call.
    """
    prefs = await get_user_alert_prefs(db, user_id)
    if not prefs['enabled'] or not category_totals:
        return []
    email_mode = prefs.get('emailFrequency', 'instant')
    period = period or current_period()
    out: list[dict] = []
    for sub_id, row in category_totals.items():
        budget = float(row.get('budget') or 0)
        spent = float(row.get('spent') or 0)
        if budget <= 0:
            continue
        name = row.get('name') or 'Category'
        parent = row.get('parent_name')
        display = f"{parent} · {name}" if parent else name
        conf = _sub_prefs(prefs, sub_id)
        pct = spent / budget
        # 100%+ wins over 80% wins over 50% in a single tick.
        if pct >= 1.0 and conf['exceeded']:
            over = spent - budget
            # Exact match (within a cent) is "fully used", NEVER "exceeded".
            if over > 0.005:
                title = "Budget exceeded"
                body = f"{display} is ${over:,.2f} over budget. You've spent ${spent:,.2f} of your ${budget:,.2f} monthly budget."
            else:
                title = "Budget fully used"
                body = f"{display} has used 100% of its ${budget:,.2f} monthly budget — you're right on budget."
            n = await _emit(
                db, user_id=user_id,
                key=f"u/{user_id}/{period}/{sub_id}/category_100",
                title=title,
                body=body,
                ntype='category_100', category_id=sub_id, transaction_id=None, period=period,
                metadata={'spent': spent, 'budget': budget, 'pct': pct, 'name': display},
                email_mode=email_mode,
            )
            if n: out.append(n)
        elif pct >= 0.80 and conf['p80']:
            remaining = budget - spent
            n = await _emit(
                db, user_id=user_id,
                key=f"u/{user_id}/{period}/{sub_id}/category_80",
                title="Budget warning",
                body=f"You've used {int(pct*100)}% of your {display} budget — ${spent:,.2f} of ${budget:,.2f}. ${remaining:,.2f} remaining.",
                ntype='category_80', category_id=sub_id, transaction_id=None, period=period,
                metadata={'spent': spent, 'budget': budget, 'pct': pct, 'name': display},
                email_mode=email_mode,
            )
            if n: out.append(n)
        elif pct >= 0.50 and conf['p50']:
            n = await _emit(
                db, user_id=user_id,
                key=f"u/{user_id}/{period}/{sub_id}/category_50",
                title="Budget check-in",
                body=f"You've used {int(pct*100)}% of your {display} budget — ${spent:,.2f} of ${budget:,.2f}.",
                ntype='category_50', category_id=sub_id, transaction_id=None, period=period,
                metadata={'spent': spent, 'budget': budget, 'pct': pct, 'name': display},
                email_mode=email_mode,
            )
            if n: out.append(n)
    return out


# ---- Large-transaction evaluation ---------------------------------------
async def evaluate_transaction_alert(db, user_id: str, tx: dict) -> Optional[dict]:
    """Fires the large-transaction alert if applicable + not already sent.

    `tx` shape (minimal): {id or transaction_id, amount, description|name, merchant_name?, account_name?}
    Amount must be a positive spend value. Refunds/deposits (amount<=0) are
    filtered by callers before invoking this (never re-classify here).
    """
    prefs = await get_user_alert_prefs(db, user_id)
    single = prefs.get('singleExpense') or {}
    if not (prefs['enabled'] and single.get('enabled')):
        return None
    threshold = float(single.get('threshold') or 0)
    if threshold <= 0:
        return None
    tx_id = tx.get('id') or tx.get('transaction_id')
    if not tx_id:
        return None
    amt = float(tx.get('amount') or 0)
    if amt <= 0:
        return None  # only outgoing spend triggers large-transaction alerts
    if amt < threshold:
        return None  # fires at the threshold or above ("$500 or more")
    merchant = tx.get('merchant_name') or tx.get('description') or tx.get('name') or 'Merchant'
    acct = tx.get('account_name') or 'your account'
    body = f"A ${amt:,.2f} transaction from {merchant} posted to {acct}."
    return await _emit(
        db, user_id=user_id,
        key=f"u/{user_id}/tx/{tx_id}/large_transaction",
        title="Large transaction detected",
        body=body,
        ntype='large_transaction', category_id=None, transaction_id=str(tx_id), period=None,
        metadata={'amount': amt, 'merchant': merchant, 'threshold': threshold},
        email_mode=prefs.get('emailFrequency', 'instant'),
    )


# ---- Email digest (daily / weekly alert emails) --------------------------
ALERT_EMAIL_TYPES = ('category_50', 'category_80', 'category_100', 'large_transaction')


async def flush_user_alert_digest(db, user: dict, freq_label: str) -> dict:
    """Send ONE combined email covering every queued alert for this user.

    On success the queued notifications flip to email_status='sent' and
    delivery_status='sent'. On send failure they STAY 'queued' so the next
    sweep retries. Returns a small report dict."""
    user_id = user['user_id']
    q = {'user_id': user_id, 'email_status': 'queued', 'type': {'$in': list(ALERT_EMAIL_TYPES)}}
    items = await db.notifications.find(q).sort('created_at', 1).to_list(length=200)
    if not items:
        return {'skipped': 'empty'}
    email = (user.get('email') or '').strip()
    ids = [i['_id'] for i in items]
    if not email:
        await db.notifications.update_many({'_id': {'$in': ids}}, {'$set': {'email_status': 'skipped'}})
        return {'skipped': 'no_email'}
    subject, html, text = build_alert_digest_email(
        user.get('name') or '', [(i.get('title') or '', i.get('body') or '') for i in items], freq_label)
    ok, detail = await send_email(email, subject, html, text)
    if not ok:
        logger.warning('Alert digest email to %s failed: %s', email, detail)
        return {'sent': False, 'count': len(items), 'detail': detail}
    await db.notifications.update_many(
        {'_id': {'$in': ids}},
        {'$set': {'email_status': 'sent', 'delivery_status': 'sent',
                  'digest_sent_at': datetime.now(timezone.utc)}},
    )
    return {'sent': True, 'count': len(items)}


async def sweep_alert_email_digests(db) -> dict:
    """Hourly sweep: flush queued alert emails per each user's frequency.

    daily  → any day, 18:00–18:59 local
    weekly → Sunday,  18:00–18:59 local
    instant (user switched back with leftovers queued) → flush immediately.
    The queued→sent transition is the dedupe; scheduler max_instances=1
    prevents concurrent double-sends."""
    now_utc = datetime.now(timezone.utc)
    flushed = 0
    considered = 0
    user_ids = await db.notifications.distinct(
        'user_id', {'email_status': 'queued', 'type': {'$in': list(ALERT_EMAIL_TYPES)}})
    for uid in user_ids:
        user = await db.users.find_one(
            {'user_id': uid}, {'_id': 0, 'user_id': 1, 'email': 1, 'name': 1, 'timezone': 1, 'alert_prefs': 1})
        if not user:
            continue
        considered += 1
        freq = ((user.get('alert_prefs') or {}).get('emailFrequency')) or 'instant'
        try:
            tz = ZoneInfo(user.get('timezone') or 'UTC')
        except ZoneInfoNotFoundError:
            tz = ZoneInfo('UTC')
        now_local = now_utc.astimezone(tz)
        due = (
            (freq == 'daily' and now_local.hour == 18)
            or (freq == 'weekly' and now_local.weekday() == 6 and now_local.hour == 18)
            or freq == 'instant'
        )
        if not due:
            continue
        try:
            res = await flush_user_alert_digest(db, user, freq if freq in ('daily', 'weekly') else 'daily')
            if res.get('sent'):
                flushed += 1
        except Exception as e:  # noqa: BLE001
            logger.warning('alert digest flush failed for %s: %s', uid, e)
    return {'considered': considered, 'flushed': flushed}


# ---- Device registration -----------------------------------------------
# NOTE: Device registration is now handled by push_service.register_push
# and delegated to the Emergent relay (SuprSend). We do not persist tokens
# locally — send_push(recipients=[user_id]) resolves them upstream.
