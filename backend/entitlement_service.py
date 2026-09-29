"""
Jaleter Premium entitlement — Apple In-App Purchase + Google Play Billing ONLY.

Sources of truth (evaluated server-side on every premium request):
  1. `iap_premium_expires_at`  — synced from the store-verified RevenueCat
     entitlement (POST /api/iap/sync). Renewals extend it; cancellation keeps
     access until the paid period ends; expiry lapses naturally.
  2. `premium_permanent`       — App Review / demo accounts only (never sold).
  3. Grandfathered Stripe members — Premium was sold via Stripe on the web
     until June 2026. Those members keep access until the period they already
     paid for ends (`subscription_current_period_end`), then must subscribe
     through the App Store / Google Play. No renewals, no new Stripe checkouts.

Stripe is NOT a Premium billing method anymore — it remains only for the
separate $75/hour coaching sessions (payments_service.py).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

# Grandfathered Stripe states that still count until the paid period ends.
_LEGACY_STRIPE_STATES = {"active", "trialing", "past_due"}


def _future(dt) -> bool:
    if not isinstance(dt, datetime):
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt > datetime.now(timezone.utc)


def has_iap_membership(user: dict) -> bool:
    """Apple / Google subscription (RevenueCat) active right now."""
    return bool(user) and _future(user.get("iap_premium_expires_at"))


def has_permanent_membership(user: dict) -> bool:
    return bool(user) and bool(user.get("premium_permanent"))


def has_legacy_stripe_membership(user: dict) -> bool:
    """Grandfathered web (Stripe) member whose already-paid period has not
    ended yet. Requires an explicit period end — no open-ended grants."""
    if not user or user.get("subscription_status") not in _LEGACY_STRIPE_STATES:
        return False
    return _future(user.get("subscription_current_period_end"))


def has_active_membership(user: dict) -> bool:
    """True when the user is entitled to Jaleter Premium RIGHT NOW."""
    return (
        has_iap_membership(user)
        or has_permanent_membership(user)
        or has_legacy_stripe_membership(user)
    )


def membership_source(user: dict) -> Optional[str]:
    """'iap' | 'legacy_stripe' | 'admin' | None — drives the Membership screen."""
    if has_iap_membership(user):
        return "iap"
    if has_permanent_membership(user):
        return "admin"
    if has_legacy_stripe_membership(user):
        return "legacy_stripe"
    if user and user.get("is_admin"):
        return "admin"
    return None


def period_end(user: dict) -> Optional[datetime]:
    """The date the current entitlement lapses (for display only)."""
    src = membership_source(user)
    if src == "iap":
        return user.get("iap_premium_expires_at")
    if src == "legacy_stripe":
        return user.get("subscription_current_period_end")
    return None
