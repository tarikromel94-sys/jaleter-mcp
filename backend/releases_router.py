"""App release announcements.

Endpoints:
  GET  /api/app/version      — PUBLIC: latest published release (in-app banner)
  GET  /api/admin/releases   — admin: recent release history
  POST /api/admin/releases   — admin: two-step publish (preview → confirm).
                               Optionally emails customers. The email blast is
                               idempotent per version — it can only run once.

Collection `app_releases` (_id = version string):
  { published, published_at, published_by, notes, critical, audience,
    ios_url, android_url, email_sent, emailed_at,
    email_sent_count, email_failed_count }
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from email_service import send_email, build_app_update_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

_VER_RE = re.compile(r"^\d+(\.\d+){0,3}$")


def _auth():
    from server import get_current_user  # noqa: WPS433 — lazy, avoids circular
    return get_current_user


def _db():
    from server import db  # noqa: WPS433
    return db


def _audience_query(audience: str) -> dict:
    """Users with a usable email; 'premium' narrows to active members."""
    q: dict = {"email": {"$exists": True, "$nin": [None, ""]}}
    if audience == "premium":
        now = datetime.now(timezone.utc)
        q = {"$and": [q, {"$or": [
            {"subscription_status": {"$in": ["active", "trialing", "past_due"]}},
            {"premium_expires_at": {"$gt": now}},
        ]}]}
    return q


def _serialize(rel: dict) -> dict:
    out = dict(rel)
    out["version"] = out.pop("_id")
    for k in ("published_at", "emailed_at"):
        v = out.get(k)
        if v and hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out


@router.get("/app/version")
async def app_version():
    """PUBLIC — the in-app update banner polls this on launch/foreground."""
    db = _db()
    rel = await db.app_releases.find_one({"published": True}, sort=[("published_at", -1)])
    if not rel:
        return {"version": None}
    return {
        "version": rel["_id"],
        "critical": bool(rel.get("critical")),
        "notes": rel.get("notes") or "",
        "ios_url": rel.get("ios_url"),
        "android_url": rel.get("android_url"),
    }


@router.get("/admin/releases")
async def list_releases(current_user: dict = Depends(_auth())):
    if not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = _db()
    rows = await db.app_releases.find({}).sort("published_at", -1).to_list(length=20)
    return {"releases": [_serialize(r) for r in rows]}


class PublishBody(BaseModel):
    version: str
    notes: Optional[str] = None
    audience: str = "all"        # all | premium
    critical: bool = False
    send_email: bool = True
    confirm: bool = False        # False → preview only (recipient count)
    ios_url: Optional[str] = None
    android_url: Optional[str] = None


@router.post("/admin/releases")
async def publish_release(body: PublishBody, current_user: dict = Depends(_auth())):
    if not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    db = _db()
    version = body.version.strip().lstrip("vV")
    if not _VER_RE.match(version):
        raise HTTPException(400, "Version must look like 1.2.0")
    audience = "premium" if body.audience == "premium" else "all"
    q = _audience_query(audience)
    recipient_count = await db.users.count_documents(q)
    existing = await db.app_releases.find_one({"_id": version})

    # Step 1 — preview. Nothing is written or sent.
    if not body.confirm:
        return {
            "preview": True,
            "version": version,
            "audience": audience,
            "recipient_count": recipient_count,
            "already_published": bool(existing),
            "email_already_sent": bool(existing and existing.get("email_sent")),
        }

    # Step 2 — confirmed publish. Email blast is once-per-version, ever.
    if body.send_email and existing and existing.get("email_sent"):
        raise HTTPException(
            409,
            f"Version {version} customers were already emailed on "
            f"{existing.get('emailed_at')}. Re-sending is blocked to prevent duplicates.",
        )
    now = datetime.now(timezone.utc)
    await db.app_releases.update_one(
        {"_id": version},
        {"$set": {
            "published": True, "published_at": now,
            "published_by": current_user.get("email") or current_user.get("user_id"),
            "notes": (body.notes or "").strip(), "critical": bool(body.critical),
            "audience": audience, "ios_url": body.ios_url, "android_url": body.android_url,
        }},
        upsert=True,
    )
    sent = 0
    failed = 0
    if body.send_email:
        cursor = db.users.find(q, {"_id": 0, "email": 1, "name": 1})
        async for u in cursor:
            subject, html, text = build_app_update_email(u.get("name") or "")
            try:
                ok, _detail = await send_email(u["email"], subject, html, text)
            except Exception as e:  # noqa: BLE001
                ok = False
                logger.warning("update email failed for %s: %s", u.get("email"), e)
            if ok:
                sent += 1
            else:
                failed += 1
        await db.app_releases.update_one(
            {"_id": version},
            {"$set": {"email_sent": True, "emailed_at": datetime.now(timezone.utc),
                      "email_sent_count": sent, "email_failed_count": failed}},
        )
        logger.info("Release %s announced: %d sent, %d failed (audience=%s)",
                    version, sent, failed, audience)
    return {
        "published": True, "version": version, "audience": audience,
        "critical": bool(body.critical), "email_attempted": bool(body.send_email),
        "email_sent_count": sent, "email_failed_count": failed,
    }
