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
    if amt <= threshold:
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
        metadata={'amount': amt, 'merchant': merchant, 'threshold': threshold},
    )


# ---- Device registration -----------------------------------------------
# NOTE: Device registration is now handled by push_service.register_push
# and delegated to the Emergent relay (SuprSend). We do not persist tokens
# locally — send_push(recipients=[user_id]) resolves them upstream.
