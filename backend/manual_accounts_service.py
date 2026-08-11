"""Manual wealth accounts — user-created rows that live alongside Plaid
inside the Wealth tree.

Data model (collection `manual_accounts`):
    { user_id, id (uuid), category (one of wealth_service categories),
      name, balance (float; assets positive, liabilities positive-magnitude),
      institution (str, optional), notes (str, optional),
      created_at, updated_at }

Public surface — one CRUD function per operation. The endpoint layer in
`server.py` wraps these with auth + JSON serialization. Balance sign is
normalised to positive magnitudes (Plaid does the same for liabilities)
so the frontend can render every row inside the correct section without
having to guess.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
import uuid
import logging

import wealth_service

logger = logging.getLogger(__name__)


VALID_CATEGORIES = set(wealth_service.CATEGORY_LABELS.keys())


def _sanitize(payload: dict) -> dict:
    """Coerce user input into safe types + reject unknown categories."""
    cat = str(payload.get('category') or '').strip().lower()
    if cat not in VALID_CATEGORIES:
        raise ValueError(f'Unknown category: {cat!r}')
    try:
        balance = float(payload.get('balance') or 0)
    except (TypeError, ValueError):
        balance = 0.0
    # Liabilities are always positive magnitude — mirror what
    # `_plaid_list_accounts_for_user` does for Plaid rows.
    balance = abs(balance) if wealth_service.is_liability(cat) else balance
    name = str(payload.get('name') or '').strip() or 'Manual account'
    institution = (payload.get('institution') or '').strip() or None
    notes = (payload.get('notes') or '').strip() or None
    return {
        'category': cat,
        'name': name[:120],
        'balance': round(balance, 2),
        'institution': institution[:120] if institution else None,
        'notes': notes[:1000] if notes else None,
    }


async def create(db, user_id: str, payload: dict) -> dict:
    doc = _sanitize(payload)
    now = datetime.now(timezone.utc)
    doc.update({
        'user_id': user_id,
        'id': str(uuid.uuid4()),
        'created_at': now,
        'updated_at': now,
    })
    await db.manual_accounts.insert_one(doc)
    return _row_out(doc)


async def update(db, user_id: str, account_id: str, payload: dict) -> Optional[dict]:
    # Only sanitize the fields the caller actually sent, so partial edits
    # (e.g. balance-only) don't wipe out the name or notes.
    fields: dict[str, Any] = {}
    if 'category' in payload:
        san = _sanitize({**payload, 'category': payload['category']})
        fields['category'] = san['category']
        # Re-normalise the balance sign against the new category — a
        # liability moved to Cash keeps its magnitude but stays positive.
        fields['balance'] = san['balance']
    if 'balance' in payload and 'balance' not in fields:
        try:
            bal = float(payload.get('balance') or 0)
        except (TypeError, ValueError):
            bal = 0.0
        # Fetch existing category for liability sign normalisation.
        existing = await db.manual_accounts.find_one({'user_id': user_id, 'id': account_id})
        cat = fields.get('category') or (existing or {}).get('category') or 'cash'
        fields['balance'] = round(abs(bal) if wealth_service.is_liability(cat) else bal, 2)
    if 'name' in payload:
        fields['name'] = str(payload.get('name') or '').strip()[:120] or 'Manual account'
    if 'institution' in payload:
        inst = (payload.get('institution') or '').strip()
        fields['institution'] = inst[:120] or None
    if 'notes' in payload:
        notes = (payload.get('notes') or '').strip()
        fields['notes'] = notes[:1000] or None
    if not fields:
        # No-op — return the current row so callers can render.
        row = await db.manual_accounts.find_one({'user_id': user_id, 'id': account_id})
        return _row_out(row) if row else None
    fields['updated_at'] = datetime.now(timezone.utc)
    res = await db.manual_accounts.update_one(
        {'user_id': user_id, 'id': account_id},
        {'$set': fields},
    )
    if res.matched_count == 0:
        return None
    row = await db.manual_accounts.find_one({'user_id': user_id, 'id': account_id})
    return _row_out(row) if row else None


async def delete(db, user_id: str, account_id: str) -> bool:
    res = await db.manual_accounts.delete_one({'user_id': user_id, 'id': account_id})
    return res.deleted_count == 1


async def list_all(db, user_id: str) -> list[dict]:
    """Return every manual account for a user in the same shape as
    `_plaid_list_accounts_for_user` rows so the frontend can treat them
    uniformly. `provider: 'manual'` distinguishes them for merge/dedupe
    detection and edit/delete affordances."""
    cursor = db.manual_accounts.find({'user_id': user_id}).sort('created_at', 1)
    docs = await cursor.to_list(length=500)
    return [_row_out(d) for d in docs]


def _row_out(doc: dict | None) -> dict:
    """Shape a manual_accounts doc into the row-shape expected by
    `GET /api/accounts/all` (matches Plaid rows minus Plaid-only fields)."""
    if not doc:
        return {}
    cat = doc.get('category') or 'cash'
    return {
        'provider': 'manual',
        # Manual accounts don't have a Plaid link_id — use a stable
        # deterministic value so the frontend keying stays consistent.
        'link_id': f'manual::{doc.get("id")}',
        'account_id': doc.get('id'),
        'id': doc.get('id'),
        'name': doc.get('name'),
        'auto_name': doc.get('name'),
        'currency': 'USD',
        'balance': float(doc.get('balance') or 0),
        'raw_balance': float(doc.get('balance') or 0),
        'org_name': doc.get('institution') or 'Manual',
        'org_domain': None,
        'last_sync_at': (doc.get('updated_at').isoformat()
                        if hasattr(doc.get('updated_at'), 'isoformat')
                        else doc.get('updated_at')),
        'mask': None,
        'category': cat,
        'category_label': wealth_service.CATEGORY_LABELS.get(cat, cat),
        'auto_category': cat,
        'category_overridden': False,
        'name_overridden': False,
        'is_asset': wealth_service.is_asset(cat),
        'is_liability': wealth_service.is_liability(cat),
        'notes': doc.get('notes'),
        # Consumer-friendly status label used by the Wealth row.
        'status': 'Manual',
    }
