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
from pymongo.errors import DuplicateKeyError

from push_service import send_push

logger = logging.getLogger(__name__)


def current_period() -> str:
    """Budget period key. Calendar month YYYY-MM in device-local terms."""
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


async def get_user_alert_prefs(db, user_id: str) -> dict:
    u = await db.users.find_one({'user_id': user_id}, {'_id': 0, 'alert_prefs': 1}) or {}
    p = u.get('alert_prefs') or {}
    return {
        'master': bool(p.get('budget_alerts_enabled', True)),
        'p80': bool(p.get('budget_80_enabled', True)),
        'p100': bool(p.get('budget_100_enabled', True)),
        'large_enabled': bool(p.get('large_transaction_enabled', True)),
        # threshold stored as integer cents server-side, min $1
        'large_cents': max(100, int(p.get('large_transaction_cents', 50000) or 50000)),
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


async def _emit(db, *, user_id: str, key: str, title: str, body: str,
                 ntype: str, category_id: Optional[str], transaction_id: Optional[str],
                 period: Optional[str], metadata: dict) -> Optional[dict]:
    """Claim → record → send. Returns notification doc or None if suppressed."""
    if not await _claim(db, key):
        return None
    n = await _record_notification(db, user_id=user_id, ntype=ntype, title=title, body=body,
                                   category_id=category_id, transaction_id=transaction_id,
                                   period=period, metadata=metadata)
    status, msg_id = await _send_push(db, user_id, title, body,
                                      {'type': ntype, 'notification_id': str(n['_id']),
                                       'category_id': category_id, 'transaction_id': transaction_id})
    await db.notifications.update_one(
        {'_id': n['_id']},
        {'$set': {'delivery_status': status, 'sent_at': datetime.now(timezone.utc),
                  'provider_message_id': msg_id}},
    )
    return n


# ---- Category threshold evaluation --------------------------------------
async def evaluate_budget_alerts_for_user(db, user_id: str, *,
                                          category_totals: Optional[dict[str, dict]] = None) -> list[dict]:
    """category_totals is `{ category_id: {'name','spent','budget'} }`.
    Caller supplies pre-computed totals (from existing budget code) so we
    never re-implement categorization. Returns list of created notifications."""
    prefs = await get_user_alert_prefs(db, user_id)
    if not prefs['master'] or not category_totals:
        return []
    period = current_period()
    out: list[dict] = []
    for cat_id, row in category_totals.items():
        budget = float(row.get('budget') or 0)
        spent = float(row.get('spent') or 0)
        name = row.get('name') or 'Category'
        if budget <= 0:
            continue
        pct = spent / budget
        # 100%+ wins over 80% when both cross in one event.
        if pct >= 1.0 and prefs['p100']:
            over = spent - budget
            n = await _emit(
                db, user_id=user_id,
                key=f"u/{user_id}/{period}/{cat_id}/category_100",
                title="Budget exceeded",
                body=f"{name} is ${over:,.2f} over budget. You've spent ${spent:,.2f} of your ${budget:,.2f} monthly budget.",
                ntype='category_100', category_id=cat_id, transaction_id=None, period=period,
                metadata={'spent': spent, 'budget': budget, 'pct': pct},
            )
            if n: out.append(n)
        elif pct >= 0.80 and prefs['p80']:
            remaining = budget - spent
            n = await _emit(
                db, user_id=user_id,
                key=f"u/{user_id}/{period}/{cat_id}/category_80",
                title="Budget warning",
                body=f"You've used {int(pct*100)}% of your {name} budget — ${spent:,.2f} of ${budget:,.2f}. ${remaining:,.2f} remaining.",
                ntype='category_80', category_id=cat_id, transaction_id=None, period=period,
                metadata={'spent': spent, 'budget': budget, 'pct': pct},
            )
            if n: out.append(n)
    return out


# ---- Large-transaction evaluation ---------------------------------------
async def evaluate_transaction_alert(db, user_id: str, tx: dict) -> Optional[dict]:
    """Fires the large-transaction alert if applicable + not already sent.

    `tx` shape (minimal): {id or transaction_id, amount, description|name, merchant_name?, account_name?, date}
    Money uses positive spend amounts. Refunds/deposits (amount < 0) are ignored.
    """
    prefs = await get_user_alert_prefs(db, user_id)
    if not (prefs['master'] and prefs['large_enabled']):
        return None
    tx_id = tx.get('id') or tx.get('transaction_id')
    if not tx_id:
        return None
    amt = float(tx.get('amount') or 0)
    if amt <= 0:
        return None  # only outgoing spend triggers large-transaction alerts
    amt_cents = int(round(amt * 100))
    if amt_cents < prefs['large_cents']:
        return None
    merchant = tx.get('merchant_name') or tx.get('description') or tx.get('name') or 'Merchant'
    acct = tx.get('account_name') or 'your account'
    body = f"A ${amt:,.2f} transaction from {merchant} posted to {acct}."
    return await _emit(
        db, user_id=user_id,
        key=f"u/{user_id}/tx/{tx_id}/large_transaction",
        title="Large transaction detected",
        body=body,
        ntype='large_transaction', category_id=None, transaction_id=str(tx_id), period=None,
        metadata={'amount': amt, 'merchant': merchant},
    )


# ---- Device registration -----------------------------------------------
# NOTE: Device registration is now handled by push_service.register_push
# and delegated to the Emergent relay (SuprSend). We do not persist tokens
# locally — send_push(recipients=[user_id]) resolves them upstream.
