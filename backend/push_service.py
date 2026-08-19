"""Emergent Managed Push Notifications (SuprSend relay).

All upstream calls use the shared X-Push-Key header and go to the Emergent
relay. Frontend never talks to the relay directly.

Public API:
  - router: FastAPI router exposing POST /api/register-push
  - send_push(recipients, data, idempotency_key=None): fire-and-forget helper
    for backend event handlers. Do NOT store device tokens in our DB — the
    relay resolves them internally by user_id.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

# Shared async client — reused across requests for connection pooling.
_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)

router = APIRouter(prefix="/api")


class RegisterPushBody(BaseModel):
    user_id: str = Field(..., min_length=1)
    platform: str = Field(..., min_length=1)  # "android" | "ios"
    device_token: str = Field(..., min_length=1)


def _require_current_user():
    """Auth dependency is wired lazily to avoid circular import with server.py."""
    from server import get_current_user  # noqa: WPS433
    return get_current_user


@router.post("/register-push", status_code=201)
async def register_push(
    body: RegisterPushBody,
    current_user: dict = Depends(_require_current_user()),
):
    # Enforce user_id in body matches the authenticated user (prevents spoofing).
    if body.user_id != current_user.get("user_id"):
        raise HTTPException(status_code=403, detail="user_id mismatch")
    try:
        resp = await _client.post(
            "/api/v1/push/users/register",
            json=body.model_dump(),
        )
    except httpx.HTTPError as e:
        logger.warning("Push register transport error: %s", e)
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    if resp.status_code == 401:
        logger.error("EMERGENT_PUSH_KEY missing or invalid at register")
        raise HTTPException(status_code=500, detail="Push key missing or invalid")
    if resp.status_code >= 500:
        logger.warning("Push register upstream 5xx: %s", resp.text[:200])
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    if resp.status_code >= 400:
        logger.warning("Push register upstream 4xx (%s): %s", resp.status_code, resp.text[:200])
        # Do not crash caller — surface as generic client error.
        raise HTTPException(status_code=400, detail="Push register rejected")
    return {"status": "registered"}


async def send_push(
    recipients: list[str],
    data: dict,
    idempotency_key: Optional[str] = None,
) -> dict:
    """Trigger a push via the Emergent relay.

    Args:
        recipients: list of user_id strings (max 100 per call).
        data: must include `title` and `message`. Optional: `subtext`,
            `image_url` (HTTPS), `action_url` (deep link path or URL),
            `channel_id` (Android), `sound` (iOS — opt-in).
        idempotency_key: optional; recommended for retriable events.

    Returns the parsed JSON response (or empty dict on non-JSON). Raises
    ValueError for invalid input; callers should try/except so push
    failures never block the primary operation.
    """
    if not recipients:
        return {"skipped": "no_recipients"}
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")

    payload: dict = {"recipients": list(recipients), "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key

    try:
        resp = await _client.post("/api/v1/push/trigger", json=payload)
    except httpx.HTTPError as e:
        logger.warning("Push trigger transport error: %s", e)
        return {"error": "transport", "message": str(e)}

    if resp.status_code == 401:
        logger.error("EMERGENT_PUSH_KEY missing or invalid at trigger")
        return {"error": "unauthorized"}
    if resp.status_code >= 500:
        logger.warning("Push trigger upstream 5xx: %s", resp.text[:200])
        return {"error": "upstream_5xx"}
    if resp.status_code >= 400:
        logger.warning("Push trigger upstream 4xx (%s): %s", resp.status_code, resp.text[:200])
        return {"error": "upstream_4xx", "status": resp.status_code}
    try:
        return resp.json() or {"status": "ok"}
    except Exception:  # noqa: BLE001
        return {"status": "ok"}



async def unregister_all_tokens_for_user(db, user_id: str) -> dict:
    """Unregister every Expo device token for a user (called on delete-account).

    Best-effort: we ALWAYS purge the local `device_tokens` collection so the
    same tokens are not reused. The Emergent relay call is fire-and-forget —
    on failure the tokens will simply age out on their next 30-day rotation.
    """
    tokens = await db.device_tokens.find({"user_id": user_id}).to_list(length=100)
    upstream_ok = 0
    upstream_err = 0
    for row in tokens:
        tok = row.get("expo_push_token") or row.get("device_token")
        if not tok:
            continue
        try:
            resp = await _client.post(
                "/api/v1/push/unregister",
                json={"user_id": user_id, "device_token": tok},
            )
            if resp.status_code < 400:
                upstream_ok += 1
            else:
                upstream_err += 1
        except Exception as e:  # noqa: BLE001
            upstream_err += 1
            logger.warning("Push unregister failed for %s: %s", user_id, e)
    # Local purge unconditional — caller also nukes the collection but this
    # keeps the function safe to call from other flows (device rotation, etc.)
    try:
        await db.device_tokens.delete_many({"user_id": user_id})
    except Exception as e:  # noqa: BLE001
        logger.warning("Local device_tokens purge failed for %s: %s", user_id, e)
    return {"upstream_ok": upstream_ok, "upstream_err": upstream_err, "count": len(tokens)}
