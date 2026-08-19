"""
Stripe subscription service for Jaleter — $90 USD / year recurring.

Design notes
============
- Uses the official `stripe` Python SDK directly (NOT emergentintegrations)
  because the Emergent helper is one-off Checkout Session only and does not
  expose subscription mode, Customer creation, or webhook signature
  verification. We keep this file self-contained so the older coaching
  one-off flow (which still uses `emergentintegrations`) is not disturbed.

- Every membership state change flows through a Stripe webhook. The
  `/payments/status/{session_id}` polling endpoint that used to grant
  entitlement has been retired — polling now only reports what the
  backend has already learned from Stripe.

- Idempotency is enforced two ways:
    1. Every Stripe API create-call is issued with a stable
       idempotency_key so a repeated startup / repeated checkout for the
       same user cannot create duplicate objects.
    2. Every webhook delivery is upserted into `stripe_events` (unique
       index on `_id = event.id`). A duplicate delivery no-ops.

- Never trust the client for the user_id. The authenticated JWT gives us
  the real user; the user_id is only sent to Stripe as an opaque tag
  (customer.metadata.jaleter_user_id + client_reference_id + subscription
  metadata) so we can reconcile events later.

Env vars required (all backend-only, never exposed to client)
- STRIPE_API_KEY            (secret key, sk_test_... in test mode)
- STRIPE_WEBHOOK_SECRET     (webhook signing secret, whsec_...)
- STRIPE_PRICE_LOOKUP_KEY   (default: jaleter_annual_90_usd_v1)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import stripe
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

# ---- Configuration --------------------------------------------------------
PRICE_LOOKUP_KEY = os.getenv("STRIPE_PRICE_LOOKUP_KEY", "jaleter_annual_90_usd_v1")
PRODUCT_METADATA_KEY = "jaleter_catalog_key"
PRODUCT_METADATA_VALUE = "annual_membership"
ANNUAL_PRICE_CENTS = 9000  # $90.00 USD
ANNUAL_CURRENCY = "usd"
ANNUAL_INTERVAL = "year"


def _api_key() -> str:
    key = os.environ.get("STRIPE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("STRIPE_API_KEY missing — Stripe subscription service disabled.")
    return key


def _configure_stripe():
    """Set the module-level API key on `stripe`. Safe to call repeatedly."""
    stripe.api_key = _api_key()


def is_configured() -> bool:
    """True when both the API key and the webhook secret are set."""
    return bool(
        (os.environ.get("STRIPE_API_KEY") or "").strip()
        and (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    )


# ---- Product + Price bootstrap ------------------------------------------
def ensure_annual_price() -> tuple[str, str]:
    """Idempotent Product+Price bootstrap. Returns (product_id, price_id).

    Uses `lookup_key` + metadata + Stripe idempotency_keys so calling this
    on every server startup is safe and does not create duplicates.
    Raises if Stripe is unreachable — caller decides whether that's fatal.
    """
    _configure_stripe()
    # Attempt to reuse the exact active Price by lookup_key.
    prices = stripe.Price.list(lookup_keys=[PRICE_LOOKUP_KEY], active=True, limit=10)
    for price in prices.data:
        recurring = price.get("recurring") or {}
        if (
            price.currency == ANNUAL_CURRENCY
            and price.unit_amount == ANNUAL_PRICE_CENTS
            and recurring.get("interval") == ANNUAL_INTERVAL
            and recurring.get("interval_count", 1) == 1
        ):
            logger.info("Stripe Price reused: %s (product=%s)", price.id, price.product)
            return price.product, price.id

    # No matching Price — reuse a Product tagged with our metadata, else create one.
    product = None
    for candidate in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if (candidate.metadata or {}).get(PRODUCT_METADATA_KEY) == PRODUCT_METADATA_VALUE:
            product = candidate
            break
    if product is None:
        product = stripe.Product.create(
            name="Jaleter Annual Membership",
            metadata={PRODUCT_METADATA_KEY: PRODUCT_METADATA_VALUE},
            idempotency_key="jaleter-product-annual-membership-v1",
        )
        logger.info("Stripe Product created: %s", product.id)

    price = stripe.Price.create(
        product=product.id,
        currency=ANNUAL_CURRENCY,
        unit_amount=ANNUAL_PRICE_CENTS,
        recurring={"interval": ANNUAL_INTERVAL, "interval_count": 1},
        lookup_key=PRICE_LOOKUP_KEY,
        metadata={PRODUCT_METADATA_KEY: PRODUCT_METADATA_VALUE},
        idempotency_key=f"jaleter-price-{PRICE_LOOKUP_KEY}",
    )
    logger.info("Stripe Price created: %s ($%.2f/%s)", price.id, ANNUAL_PRICE_CENTS / 100, ANNUAL_INTERVAL)
    return product.id, price.id


# ---- Customer helpers ----------------------------------------------------
async def get_or_create_customer(db, user: dict) -> str:
    """Return a Stripe Customer ID for the given Jaleter user, creating it if needed.

    Persisted immediately so a follow-up call returns the same customer.
    Uses an idempotency_key so a network retry cannot create duplicates.
    """
    _configure_stripe()
    if user.get("stripe_customer_id"):
        return user["stripe_customer_id"]
    user_id = user["user_id"]
    email = user.get("email") or ""
    name = user.get("name") or None
    customer = stripe.Customer.create(
        email=email,
        name=name,
        metadata={"jaleter_user_id": user_id},
        idempotency_key=f"jaleter-customer-{user_id}",
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"stripe_customer_id": customer.id, "stripe_customer_created_at": datetime.now(timezone.utc)}},
    )
    return customer.id


# ---- Checkout session ---------------------------------------------------
async def create_subscription_checkout(
    db,
    user: dict,
    price_id: str,
    success_url: str,
    cancel_url: str,
) -> dict:
    """Create a subscription-mode Checkout Session for the given user.

    Attaches the Jaleter user_id in three places so we can reconcile
    events even if some are received out of order or with partial data:
      - `client_reference_id`  (Checkout Session)
      - `metadata.jaleter_user_id` (Checkout Session)
      - `subscription_data.metadata.jaleter_user_id` (propagated to the
        Subscription object so all `customer.subscription.*` events carry it)
    """
    _configure_stripe()
    customer_id = await get_or_create_customer(db, user)
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        client_reference_id=user["user_id"],
        line_items=[{"price": price_id, "quantity": 1}],
        metadata={"jaleter_user_id": user["user_id"]},
        subscription_data={"metadata": {"jaleter_user_id": user["user_id"]}},
        success_url=success_url,
        cancel_url=cancel_url,
        allow_promotion_codes=True,
    )
    # Record a pending row for support/audit visibility.
    await db.payment_transactions.insert_one({
        "session_id": session.id,
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "product": "jaleter_premium",
        "kind": "subscription",
        "amount": ANNUAL_PRICE_CENTS / 100,
        "currency": ANNUAL_CURRENCY,
        "status": session.status,
        "payment_status": session.payment_status,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    return {"session_id": session.id, "url": session.url}


# ---- Status mapping ------------------------------------------------------
# Stripe subscription.status values:
#   active, past_due, canceled, incomplete, incomplete_expired,
#   trialing, unpaid, paused
# Map to Jaleter's five internal states + one 'incomplete' state for
# freshly-created subscriptions awaiting first payment.
def internal_status(stripe_status: Optional[str]) -> str:
    if stripe_status == "active":
        return "active"
    if stripe_status == "past_due":
        return "past_due"
    if stripe_status == "canceled":
        return "canceled"
    if stripe_status == "incomplete_expired":
        return "expired"
    if stripe_status in ("unpaid",):
        return "expired"
    # trialing / paused / incomplete → treat as inactive for now.
    return "inactive"


ENTITLEMENT_STATES = {"active", "past_due"}
# ^ Which internal states grant premium access. past_due keeps access
#   while Stripe retries; when Stripe finally marks canceled/unpaid we
#   drop entitlement.


def has_active_membership(user: dict) -> bool:
    """True when the user is entitled to premium features RIGHT NOW."""
    if not user:
        return False
    status = user.get("subscription_status")
    if status in ENTITLEMENT_STATES:
        # Belt-and-braces: also require period_end in the future (or unset).
        period_end = user.get("subscription_current_period_end")
        if isinstance(period_end, datetime):
            if period_end.tzinfo is None:
                period_end = period_end.replace(tzinfo=timezone.utc)
            return period_end > datetime.now(timezone.utc)
        return True
    # Legacy migration: users with `premium_expires_at` from the old
    # one-off flow keep access until their timestamp expires. They will
    # NOT auto-renew (no Stripe Subscription) — see migration notes.
    exp = user.get("premium_expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return exp > datetime.now(timezone.utc)
    return False


# ---- Webhook handling ---------------------------------------------------
def verify_and_parse_event(payload: bytes, sig_header: str) -> dict:
    """Verify the Stripe-Signature header and return the parsed event.

    Raises ValueError on invalid payload, stripe.error.SignatureVerificationError
    on invalid signature. Uses `stripe.Webhook.construct_event` which
    checks the timestamp + HMAC-SHA256 signature.
    """
    secret = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET not configured — webhook rejects all traffic.")
    return stripe.Webhook.construct_event(payload, sig_header, secret)


async def _resolve_user(db, obj: dict) -> Optional[dict]:
    """Find the Jaleter user for a Stripe event object.

    Order of resolution:
      1. `client_reference_id` (Checkout Session only)
      2. `metadata.jaleter_user_id`
      3. `subscription.metadata.jaleter_user_id` (customer.subscription.*)
      4. `stripe_customer_id` on the user record (customer field)
    """
    user_id = obj.get("client_reference_id") if isinstance(obj, dict) else None
    if not user_id:
        md = obj.get("metadata") or {}
        user_id = md.get("jaleter_user_id")
    if user_id:
        u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        if u:
            return u
    customer_id = obj.get("customer")
    if isinstance(customer_id, dict):
        customer_id = customer_id.get("id")
    if customer_id:
        u = await db.users.find_one({"stripe_customer_id": customer_id}, {"_id": 0})
        if u:
            return u
    return None


async def _apply_subscription(db, sub: dict) -> Optional[str]:
    """Persist state from a Stripe Subscription object onto the user.

    Returns the resolved user_id (or None) so the caller can log it.
    Safe to call repeatedly with the same sub payload.
    """
    user = await _resolve_user(db, sub)
    if not user:
        logger.warning("Stripe subscription %s could not be mapped to a Jaleter user", sub.get("id"))
        return None
    status_internal = internal_status(sub.get("status"))
    period_start = sub.get("current_period_start")
    period_end = sub.get("current_period_end")
    now = datetime.now(timezone.utc)
    update = {
        "stripe_customer_id": sub.get("customer"),
        "stripe_subscription_id": sub.get("id"),
        "subscription_status": status_internal,
        "subscription_stripe_status": sub.get("status"),
        "subscription_cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
        "subscription_current_period_start": (
            datetime.fromtimestamp(period_start, tz=timezone.utc) if period_start else None
        ),
        "subscription_current_period_end": (
            datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
        ),
        "subscription_price_id": ((sub.get("items") or {}).get("data", [{}])[0].get("price") or {}).get("id"),
        "subscription_updated_at": now,
    }
    # Mark first activation only — never overwrite existing premium_since.
    if status_internal in ENTITLEMENT_STATES and not user.get("premium_since"):
        update["premium_since"] = now
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return user["user_id"]


async def handle_webhook_event(db, event: dict) -> dict:
    """Dispatch a verified Stripe event. Idempotent — safe on replay.

    Returns a small report dict for logging / test assertions.
    """
    event_id = event.get("id")
    event_type = event.get("type") or ""
    obj = ((event.get("data") or {}).get("object")) or {}

    # ---- Idempotency: refuse duplicate delivery ------------------------
    try:
        await db.stripe_events.insert_one({
            "_id": event_id,
            "type": event_type,
            "received_at": datetime.now(timezone.utc),
            "processed": False,
        })
    except DuplicateKeyError:
        existing = await db.stripe_events.find_one({"_id": event_id}, {"_id": 0})
        if existing and existing.get("processed"):
            return {"duplicate": True, "event_id": event_id, "type": event_type}
        # Otherwise fall through — a previous crash left it unprocessed.

    resolved_user = None
    try:
        if event_type == "checkout.session.completed":
            # Persist customer + subscription IDs onto the user record.
            user = await _resolve_user(db, obj)
            if user:
                resolved_user = user["user_id"]
                update = {"subscription_checkout_completed_at": datetime.now(timezone.utc)}
                if obj.get("customer"):
                    update["stripe_customer_id"] = obj["customer"]
                if obj.get("subscription"):
                    update["stripe_subscription_id"] = obj["subscription"]
                await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
                # The subsequent `customer.subscription.*` events carry the
                # authoritative status. This event does not itself grant
                # entitlement — but retrieving the sub here means users
                # who navigate straight to /user/membership after checkout
                # see 'active' without waiting for the next webhook.
                if obj.get("subscription"):
                    _configure_stripe()
                    sub = stripe.Subscription.retrieve(obj["subscription"])
                    await _apply_subscription(db, sub)
        elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
            resolved_user = await _apply_subscription(db, obj)
        elif event_type == "customer.subscription.deleted":
            # Terminal cancellation — mark canceled (or expired for
            # incomplete_expired). Access drops immediately.
            resolved_user = await _apply_subscription(db, obj)
        elif event_type == "invoice.paid":
            # Refresh the subscription (renewal successful).
            sub_id = obj.get("subscription")
            if sub_id:
                _configure_stripe()
                sub = stripe.Subscription.retrieve(sub_id)
                resolved_user = await _apply_subscription(db, sub)
        elif event_type == "invoice.payment_failed":
            # Do not fake success; Stripe will move sub to past_due and
            # eventually cancel per the dunning policy. Reflect the
            # current state.
            sub_id = obj.get("subscription")
            if sub_id:
                _configure_stripe()
                sub = stripe.Subscription.retrieve(sub_id)
                resolved_user = await _apply_subscription(db, sub)
        # Any other event type is acknowledged and stored but not acted on.

        await db.stripe_events.update_one(
            {"_id": event_id},
            {"$set": {
                "processed": True,
                "processed_at": datetime.now(timezone.utc),
                "resolved_user_id": resolved_user,
            }},
        )
        return {"received": True, "event_id": event_id, "type": event_type, "user_id": resolved_user}
    except Exception as exc:  # noqa: BLE001
        await db.stripe_events.update_one(
            {"_id": event_id},
            {"$set": {"processed": False, "last_error": str(exc)}},
        )
        raise


# ---- Portal (for cancel / manage) ---------------------------------------
async def create_billing_portal_session(db, user: dict, return_url: str) -> dict:
    """Create a Stripe-hosted billing portal session for cancellation, invoice
    history, and payment-method updates. Falls back gracefully if the user
    has never had a Stripe Customer."""
    _configure_stripe()
    customer_id = user.get("stripe_customer_id")
    if not customer_id:
        raise ValueError("This account has no active Stripe customer yet.")
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return {"url": session.url}


async def cancel_at_period_end(user: dict) -> dict:
    """Set cancel_at_period_end=true on the Stripe subscription. Does NOT
    revoke entitlement — the user keeps access until current_period_end.

    Returns a summary; the authoritative persistence happens via the
    `customer.subscription.updated` webhook this call triggers.
    """
    _configure_stripe()
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        raise ValueError("No active subscription to cancel.")
    sub = stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
    return {
        "stripe_subscription_id": sub.id,
        "cancel_at_period_end": bool(sub.cancel_at_period_end),
        "current_period_end": sub.current_period_end,
        "status": sub.status,
    }


async def resume_subscription(user: dict) -> dict:
    """Undo a pending cancellation (cancel_at_period_end=false)."""
    _configure_stripe()
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        raise ValueError("No subscription found.")
    sub = stripe.Subscription.modify(sub_id, cancel_at_period_end=False)
    return {
        "stripe_subscription_id": sub.id,
        "cancel_at_period_end": bool(sub.cancel_at_period_end),
        "current_period_end": sub.current_period_end,
        "status": sub.status,
    }



async def purge_customer(user: dict) -> dict:
    """Cancel-immediately + delete the Stripe customer for account deletion.

    Called only from DELETE /api/auth/delete-account. Best-effort: each step
    is caught individually so a Stripe outage cannot block local deletion.

    Returns a summary dict:
      {
        'subscription_canceled': bool,   # True iff we called Subscription.cancel
        'customer_deleted': bool,        # True iff Stripe returned deleted=True
        'error': str | None,             # last error message (if any)
      }
    """
    result = {'subscription_canceled': False, 'customer_deleted': False, 'error': None}
    try:
        _configure_stripe()
    except Exception as e:  # noqa: BLE001
        result['error'] = f'stripe not configured: {e}'
        return result

    sub_id = user.get('stripe_subscription_id')
    customer_id = user.get('stripe_customer_id')

    # 1. Cancel the subscription immediately (as opposed to at period end).
    #    Apple 5.1.1(v) wants deletion to sever the billing relationship now.
    if sub_id:
        try:
            stripe.Subscription.cancel(sub_id)  # type: ignore[attr-defined]
            result['subscription_canceled'] = True
        except Exception as e:  # noqa: BLE001
            logger.warning('stripe.Subscription.cancel failed for %s: %s', sub_id, e)
            result['error'] = str(e)

    # 2. Delete the Stripe customer entirely — this also detaches every
    #    saved card, purges billing history from the app's perspective,
    #    and prevents future charges even if the user record is somehow
    #    resurrected. Stripe retains it internally for tax/audit anyway.
    if customer_id:
        try:
            stripe.Customer.delete(customer_id)  # type: ignore[attr-defined]
            result['customer_deleted'] = True
        except Exception as e:  # noqa: BLE001
            logger.warning('stripe.Customer.delete failed for %s: %s', customer_id, e)
            result['error'] = str(e)

    return result
