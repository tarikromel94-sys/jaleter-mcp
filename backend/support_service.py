"""Customer Support System — Phase 1.

Ticket lifecycle:
    open → in_progress → waiting_on_user → resolved → closed

- All attachments are stored inline as base64 (max 5 MB per file, validated by
  the caller). This trades DB size for zero external-storage dependencies.
- Admin gating uses the `is_admin` boolean flag on the `users` collection.
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any, Optional, List
import uuid

from fastapi import HTTPException
from pydantic import BaseModel, Field


ALLOWED_CATEGORIES = {'general', 'bug', 'billing', 'bank_help', 'privacy', 'delete_account', 'other'}
ALLOWED_PRIORITIES = {'low', 'normal', 'high', 'urgent'}
ALLOWED_STATUS = {'open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'}
ALLOWED_ATTACHMENT_MIMES = {'image/png', 'image/jpeg', 'image/jpg', 'application/pdf'}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5 MB


# ---- Pydantic models --------------------------------------------------------
class AttachmentIn(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    mime_type: str = Field(min_length=1, max_length=100)
    data_base64: str = Field(min_length=1)


class TicketCreate(BaseModel):
    subject: str = Field(min_length=2, max_length=200)
    category: str = Field(default='general')
    priority: str = Field(default='normal')
    description: str = Field(min_length=2, max_length=8000)
    attachments: List[AttachmentIn] = Field(default_factory=list)


class ReplyCreate(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    attachments: List[AttachmentIn] = Field(default_factory=list)


class AdminUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None


class AdminNoteCreate(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


# ---- Helpers ----------------------------------------------------------------
def _validate_choice(value: str, allowed: set, label: str) -> str:
    v = (value or '').strip().lower()
    if v not in allowed:
        raise HTTPException(status_code=400, detail=f'Invalid {label}: {value}')
    return v


def _validate_attachment(a: AttachmentIn) -> dict[str, Any]:
    mime = (a.mime_type or '').lower()
    if mime not in ALLOWED_ATTACHMENT_MIMES:
        raise HTTPException(status_code=400, detail=f'Attachment type not allowed: {mime}')
    # base64 length ~ 4/3 * bytes. Pre-check length before decoding to avoid abuse.
    if len(a.data_base64) > int(MAX_ATTACHMENT_BYTES * 4 / 3) + 32:
        raise HTTPException(status_code=413, detail='Attachment exceeds 5 MB limit.')
    try:
        raw = base64.b64decode(a.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail='Attachment is not valid base64.')
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail='Attachment exceeds 5 MB limit.')
    return {
        'attachment_id': uuid.uuid4().hex,
        'filename': a.filename.strip()[:200],
        'mime_type': mime,
        'size_bytes': len(raw),
        'data_base64': a.data_base64,
        'created_at': datetime.now(timezone.utc),
    }


def _new_ticket_id() -> str:
    # Human-friendly short ticket identifier
    return 'T-' + uuid.uuid4().hex[:8].upper()


async def _next_ticket_number(db) -> int:
    """Atomic auto-incrementing ticket number."""
    doc = await db.support_counters.find_one_and_update(
        {'_id': 'tickets'},
        {'$inc': {'seq': 1}},
        upsert=True,
        return_document=True,
    )
    return int(doc.get('seq', 1)) if doc else 1


def _serialize_ticket(t: dict[str, Any], include_body: bool = True) -> dict[str, Any]:
    out = {
        'ticket_id': t.get('ticket_id'),
        'ticket_number': t.get('ticket_number'),
        'user_id': t.get('user_id'),
        'user_email': t.get('user_email'),
        'user_name': t.get('user_name'),
        'subject': t.get('subject'),
        'category': t.get('category'),
        'priority': t.get('priority'),
        'status': t.get('status'),
        'assigned_to': t.get('assigned_to'),
        'created_at': (t.get('created_at').isoformat() if isinstance(t.get('created_at'), datetime) else t.get('created_at')),
        'updated_at': (t.get('updated_at').isoformat() if isinstance(t.get('updated_at'), datetime) else t.get('updated_at')),
        'reply_count': len(t.get('replies') or []),
        'attachment_count': len(t.get('attachments') or []) + sum(len(r.get('attachments') or []) for r in (t.get('replies') or [])),
    }
    if include_body:
        out['description'] = t.get('description')
        out['attachments'] = [_serialize_attachment(a) for a in (t.get('attachments') or [])]
        out['replies'] = [_serialize_reply(r) for r in (t.get('replies') or [])]
    return out


def _serialize_reply(r: dict[str, Any]) -> dict[str, Any]:
    return {
        'reply_id': r.get('reply_id'),
        'author_id': r.get('author_id'),
        'author_name': r.get('author_name'),
        'is_admin': bool(r.get('is_admin')),
        'is_private': bool(r.get('is_private')),
        'message': r.get('message'),
        'created_at': (r.get('created_at').isoformat() if isinstance(r.get('created_at'), datetime) else r.get('created_at')),
        'attachments': [_serialize_attachment(a) for a in (r.get('attachments') or [])],
    }


def _serialize_attachment(a: dict[str, Any]) -> dict[str, Any]:
    return {
        'attachment_id': a.get('attachment_id'),
        'filename': a.get('filename'),
        'mime_type': a.get('mime_type'),
        'size_bytes': a.get('size_bytes'),
        # data_base64 is intentionally included so users can preview inline; consider
        # a separate GET route for large attachments if this becomes a bandwidth issue.
        'data_base64': a.get('data_base64'),
    }


# ---- Core operations -------------------------------------------------------
async def create_ticket(db, user: dict, payload: TicketCreate) -> dict[str, Any]:
    category = _validate_choice(payload.category, ALLOWED_CATEGORIES, 'category')
    priority = _validate_choice(payload.priority, ALLOWED_PRIORITIES, 'priority')
    now = datetime.now(timezone.utc)
    number = await _next_ticket_number(db)
    ticket = {
        'ticket_id': _new_ticket_id(),
        'ticket_number': number,
        'user_id': user['user_id'],
        'user_email': user.get('email'),
        'user_name': user.get('name'),
        'subject': payload.subject.strip(),
        'category': category,
        'priority': priority,
        'status': 'open',
        'assigned_to': None,
        'description': payload.description.strip(),
        'attachments': [_validate_attachment(a) for a in (payload.attachments or [])],
        'replies': [],
        'created_at': now,
        'updated_at': now,
    }
    await db.support_tickets.insert_one(dict(ticket))
    return _serialize_ticket(ticket)


async def list_user_tickets(db, user: dict) -> list[dict[str, Any]]:
    cursor = db.support_tickets.find({'user_id': user['user_id']}, {'_id': 0}).sort('created_at', -1)
    return [_serialize_ticket(t, include_body=False) async for t in cursor]


async def get_ticket_for_user(db, user: dict, ticket_id: str) -> dict[str, Any]:
    doc = await db.support_tickets.find_one({'ticket_id': ticket_id, 'user_id': user['user_id']}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Ticket not found.')
    # Strip admin-only private notes from user view
    doc = dict(doc)
    doc['replies'] = [r for r in (doc.get('replies') or []) if not r.get('is_private')]
    return _serialize_ticket(doc)


async def add_user_reply(db, user: dict, ticket_id: str, payload: ReplyCreate) -> dict[str, Any]:
    doc = await db.support_tickets.find_one({'ticket_id': ticket_id, 'user_id': user['user_id']}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Ticket not found.')
    if doc.get('status') == 'closed':
        raise HTTPException(status_code=400, detail='Ticket is closed. Please open a new ticket.')
    reply = {
        'reply_id': uuid.uuid4().hex,
        'author_id': user['user_id'],
        'author_name': user.get('name') or user.get('email'),
        'is_admin': False,
        'is_private': False,
        'message': payload.message.strip(),
        'attachments': [_validate_attachment(a) for a in (payload.attachments or [])],
        'created_at': datetime.now(timezone.utc),
    }
    new_status = 'in_progress' if doc.get('status') in ('waiting_on_user', 'resolved') else doc.get('status', 'open')
    await db.support_tickets.update_one(
        {'ticket_id': ticket_id},
        {'$push': {'replies': reply}, '$set': {'updated_at': datetime.now(timezone.utc), 'status': new_status}},
    )
    return _serialize_reply(reply)


# ---- Admin ops --------------------------------------------------------------
def _require_admin(user: dict) -> None:
    if not user.get('is_admin'):
        raise HTTPException(status_code=403, detail='Admin only.')


async def admin_list_tickets(db, user: dict, status: Optional[str] = None, limit: int = 100) -> list[dict[str, Any]]:
    _require_admin(user)
    query: dict[str, Any] = {}
    if status:
        query['status'] = _validate_choice(status, ALLOWED_STATUS, 'status')
    cursor = db.support_tickets.find(query, {'_id': 0}).sort('created_at', -1).limit(min(max(limit, 1), 500))
    return [_serialize_ticket(t, include_body=False) async for t in cursor]


async def admin_get_ticket(db, user: dict, ticket_id: str) -> dict[str, Any]:
    _require_admin(user)
    doc = await db.support_tickets.find_one({'ticket_id': ticket_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Ticket not found.')
    return _serialize_ticket(doc)


async def admin_update_ticket(db, user: dict, ticket_id: str, payload: AdminUpdate) -> dict[str, Any]:
    _require_admin(user)
    updates: dict[str, Any] = {}
    if payload.status is not None:
        updates['status'] = _validate_choice(payload.status, ALLOWED_STATUS, 'status')
    if payload.priority is not None:
        updates['priority'] = _validate_choice(payload.priority, ALLOWED_PRIORITIES, 'priority')
    if payload.assigned_to is not None:
        updates['assigned_to'] = payload.assigned_to.strip() or None
    if not updates:
        raise HTTPException(status_code=400, detail='No fields to update.')
    updates['updated_at'] = datetime.now(timezone.utc)
    result = await db.support_tickets.find_one_and_update(
        {'ticket_id': ticket_id}, {'$set': updates}, return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail='Ticket not found.')
    return _serialize_ticket({**result, '_id': None})


async def admin_add_reply(db, user: dict, ticket_id: str, payload: ReplyCreate, private: bool = False) -> dict[str, Any]:
    _require_admin(user)
    doc = await db.support_tickets.find_one({'ticket_id': ticket_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Ticket not found.')
    reply = {
        'reply_id': uuid.uuid4().hex,
        'author_id': user['user_id'],
        'author_name': user.get('name') or user.get('email') or 'Support',
        'is_admin': True,
        'is_private': bool(private),
        'message': payload.message.strip(),
        'attachments': [_validate_attachment(a) for a in (payload.attachments or [])],
        'created_at': datetime.now(timezone.utc),
    }
    # Public admin reply: move ticket to waiting_on_user unless already resolved/closed.
    new_status = doc.get('status', 'open')
    if not private and new_status not in ('resolved', 'closed'):
        new_status = 'waiting_on_user'
    await db.support_tickets.update_one(
        {'ticket_id': ticket_id},
        {'$push': {'replies': reply}, '$set': {'updated_at': datetime.now(timezone.utc), 'status': new_status}},
    )
    return _serialize_reply(reply)


# ---- Admin bootstrap --------------------------------------------------------
async def ensure_admin_seed(db, hash_password, new_user_id, email: str, password: str, name: str = 'Jaleter Support') -> None:
    """Idempotently ensure a support admin account exists with is_admin=True."""
    email_l = email.lower().strip()
    existing = await db.users.find_one({'email': email_l})
    if existing:
        # If flag missing, add it. Do NOT reset password on existing accounts.
        if not existing.get('is_admin'):
            await db.users.update_one({'user_id': existing['user_id']}, {'$set': {'is_admin': True}})
        return
    doc = {
        'user_id': new_user_id(),
        'name': name,
        'email': email_l,
        'password_hash': hash_password(password),
        'provider': 'password',
        'is_admin': True,
        'created_at': datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
