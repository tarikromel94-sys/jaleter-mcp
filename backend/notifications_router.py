"""FastAPI router for budget alerts, notification inbox, and alert prefs.

Kept as a small file so `server.py` mounts it with a one-line include.
Delegates all logic to `budget_alert_service`.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import budget_alert_service as bas

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications")


def _auth():
    from server import get_current_user  # noqa: WPS433 - lazy to avoid circular
    return get_current_user


def _db():
    from server import db  # noqa: WPS433
    return db


# ---------- Prefs -------------------------------------------------------
@router.get("/prefs")
async def get_prefs(current_user: dict = Depends(_auth())):
    return await bas.get_user_alert_prefs(_db(), current_user["user_id"])


class PerCategoryPref(BaseModel):
    p50: bool = False
    p80: bool = True
    exceeded: bool = True


class SingleExpensePref(BaseModel):
    enabled: bool = False
    threshold: float = 200


class PrefsBody(BaseModel):
    enabled: bool = True
    perCategory: dict[str, PerCategoryPref] = Field(default_factory=dict)
    singleExpense: SingleExpensePref = Field(default_factory=SingleExpensePref)


@router.put("/prefs")
async def put_prefs(body: PrefsBody, current_user: dict = Depends(_auth())):
    db = _db()
    normalized = {
        "enabled": bool(body.enabled),
        "perCategory": {k: v.model_dump() for k, v in body.perCategory.items()},
        "singleExpense": body.singleExpense.model_dump(),
    }
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"alert_prefs": normalized}},
    )
    return normalized


# ---------- Notification Inbox -----------------------------------------
def _serialize_notification(n: dict) -> dict:
    n = dict(n)
    if isinstance(n.get("_id"), ObjectId):
        n["id"] = str(n["_id"])
    else:
        n["id"] = str(n.get("_id"))
    n.pop("_id", None)
    for k in ("created_at", "sent_at", "read_at"):
        v = n.get(k)
        if v and hasattr(v, "isoformat"):
            n[k] = v.isoformat()
    return n


@router.get("")
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = False,
    current_user: dict = Depends(_auth()),
):
    db = _db()
    q: dict[str, Any] = {"user_id": current_user["user_id"]}
    if unread_only:
        q["read_at"] = None
    cursor = db.notifications.find(q).sort("created_at", -1).limit(limit)
    items = [_serialize_notification(n) async for n in cursor]
    return {"notifications": items}


@router.get("/unread-count")
async def unread_count(current_user: dict = Depends(_auth())):
    db = _db()
    n = await db.notifications.count_documents(
        {"user_id": current_user["user_id"], "read_at": None},
    )
    return {"unread": n}


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: dict = Depends(_auth())):
    db = _db()
    try:
        oid = ObjectId(notification_id)
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Invalid notification id")
    from datetime import datetime, timezone
    res = await db.notifications.update_one(
        {"_id": oid, "user_id": current_user["user_id"]},
        {"$set": {"read_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@router.post("/mark-all-read")
async def mark_all_read(current_user: dict = Depends(_auth())):
    db = _db()
    from datetime import datetime, timezone
    res = await db.notifications.update_many(
        {"user_id": current_user["user_id"], "read_at": None},
        {"$set": {"read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "updated": res.modified_count}


# ---------- Evaluators (called by frontend on data mutation) ----------
class CategoryTotal(BaseModel):
    sub_id: str
    name: str
    parent_name: Optional[str] = None
    spent: float = 0
    budget: float = 0


class EvaluateBudgetBody(BaseModel):
    period: Optional[str] = None  # YYYY-MM; defaults to current UTC month
    categories: list[CategoryTotal] = Field(default_factory=list)


@router.post("/evaluate-budget")
async def evaluate_budget(body: EvaluateBudgetBody, current_user: dict = Depends(_auth())):
    """Evaluate 50/80/100 threshold alerts for the given subcategory totals.

    Server dedupes via `alert_state`: repeat evaluations with the same
    input do not re-fire alerts. Returns any notifications created *in
    this call* (may be empty).
    """
    db = _db()
    totals = {
        c.sub_id: {
            "name": c.name,
            "parent_name": c.parent_name,
            "spent": c.spent,
            "budget": c.budget,
        }
        for c in body.categories
    }
    created = await bas.evaluate_budget_alerts_for_user(
        db, current_user["user_id"], category_totals=totals, period=body.period,
    )
    return {"created": [_serialize_notification(n) for n in created]}


class EvaluateTransactionBody(BaseModel):
    id: Optional[str] = None
    transaction_id: Optional[str] = None
    amount: float
    name: Optional[str] = None
    description: Optional[str] = None
    merchant_name: Optional[str] = None
    account_name: Optional[str] = None


@router.post("/evaluate-transaction")
async def evaluate_transaction(body: EvaluateTransactionBody, current_user: dict = Depends(_auth())):
    tx = body.model_dump(exclude_none=True)
    n = await bas.evaluate_transaction_alert(_db(), current_user["user_id"], tx)
    return {"created": _serialize_notification(n) if n else None}
