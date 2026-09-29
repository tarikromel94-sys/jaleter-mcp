"""
Stripe — legacy Premium wind-down helpers ONLY.

Jaleter Premium is no longer sold or renewed through Stripe (Apple IAP /
Google Play Billing only since June 2026). This module keeps the two Stripe
calls we still legitimately need for members who bought on the web before
the switch:

  * `cancel_premium_at_period_end` — one-off migration: stop every legacy
    Premium subscription from renewing (member keeps access until the paid
    period ends). Coaching is never a Stripe subscription, so it is untouched.
  * `purge_customer` — account deletion: cancel immediately + delete the
    Stripe customer so no orphaned billing relationship survives
    (Apple guideline 5.1.1(v)).

Coaching payments live in payments_service.py (emergentintegrations).
"""

from __future__ import annotations

import logging
import os

import stripe

logger = logging.getLogger(__name__)

# Identifies the legacy Premium catalog objects created by the old
# stripe_service bootstrap — used to make sure we never touch anything else.
PREMIUM_PRICE_LOOKUP_KEY = os.getenv("STRIPE_PRICE_LOOKUP_KEY", "jaleter_annual_90_usd_v1")
PREMIUM_PRODUCT_METADATA = ("jaleter_catalog_key", "annual_membership")


def _configure() -> None:
    key = (os.environ.get("STRIPE_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("STRIPE_API_KEY missing")
    stripe.api_key = key


_product_cache: dict[str, bool] = {}


def _is_premium_product(product_id: str) -> bool:
    if product_id not in _product_cache:
        try:
            md = stripe.Product.retrieve(product_id).get("metadata") or {}
            _product_cache[product_id] = md.get(PREMIUM_PRODUCT_METADATA[0]) == PREMIUM_PRODUCT_METADATA[1]
        except Exception:  # noqa: BLE001
            _product_cache[product_id] = False
    return _product_cache[product_id]


def _is_premium_subscription(sub: dict) -> bool:
    items = ((sub.get("items") or {}).get("data")) or []
    for item in items:
        price = item.get("price") or {}
        if price.get("lookup_key") == PREMIUM_PRICE_LOOKUP_KEY:
            return True
        product = price.get("product")
        if isinstance(product, str) and _is_premium_product(product):
            return True
    return False


def cancel_premium_at_period_end(dry_run: bool = False) -> dict:
    """Set cancel_at_period_end=true on every live legacy Premium subscription.

    Returns {'scanned', 'premium', 'updated', 'already', 'skipped_other', 'subs': [...]}.
    Idempotent — safe to re-run.
    """
    _configure()
    report = {"scanned": 0, "premium": 0, "updated": 0, "already": 0, "skipped_other": 0, "subs": []}
    subs = stripe.Subscription.list(status="all", limit=100)
    for sub in subs.auto_paging_iter():
        report["scanned"] += 1
        if sub.get("status") not in ("active", "trialing", "past_due"):
            continue
        if not _is_premium_subscription(sub):
            report["skipped_other"] += 1
            continue
        report["premium"] += 1
        row = {
            "id": sub["id"],
            "customer": sub.get("customer"),
            "status": sub.get("status"),
            "period_end": sub.get("current_period_end") or (((sub.get("items") or {}).get("data") or [{}])[0].get("current_period_end")),
            "user_id": (sub.get("metadata") or {}).get("jaleter_user_id"),
        }
        if sub.get("cancel_at_period_end"):
            report["already"] += 1
            row["action"] = "already_scheduled"
        elif dry_run:
            row["action"] = "would_cancel_at_period_end"
        else:
            stripe.Subscription.modify(sub["id"], cancel_at_period_end=True)
            report["updated"] += 1
            row["action"] = "cancel_at_period_end_set"
        report["subs"].append(row)
    return report


async def purge_customer(user: dict) -> dict:
    """Cancel-immediately + delete the Stripe customer for account deletion.
    Best-effort: each step is caught so a Stripe outage cannot block deletion."""
    result = {"subscription_canceled": False, "customer_deleted": False, "error": None}
    try:
        _configure()
    except Exception as e:  # noqa: BLE001
        result["error"] = f"stripe not configured: {e}"
        return result
    sub_id = user.get("stripe_subscription_id")
    customer_id = user.get("stripe_customer_id")
    if sub_id:
        try:
            stripe.Subscription.cancel(sub_id)  # type: ignore[attr-defined]
            result["subscription_canceled"] = True
        except Exception as e:  # noqa: BLE001
            logger.warning("stripe.Subscription.cancel failed for %s: %s", sub_id, e)
            result["error"] = str(e)
    if customer_id:
        try:
            stripe.Customer.delete(customer_id)  # type: ignore[attr-defined]
            result["customer_deleted"] = True
        except Exception as e:  # noqa: BLE001
            logger.warning("stripe.Customer.delete failed for %s: %s", customer_id, e)
            result["error"] = str(e)
    return result
