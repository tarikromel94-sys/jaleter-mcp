"""
Stripe Checkout + Coaching booking service.

Uses emergentintegrations' StripeCheckout helper (routes through the Emergent
test proxy when the api key is `sk_test_emergent`). We use one-time `payment`
mode for both products; the annual Premium membership is a fixed one-time
$75 charge that grants a 365-day entitlement stored in MongoDB.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionRequest,
    CheckoutStatusResponse,
)

# Server-side product catalog. NEVER trust amounts sent from the client.
PRODUCTS = {
    'coaching_session': {
        'name': 'Coaching Session (30 min)',
        'amount': 50.0,
        'currency': 'usd',
        'kind': 'coaching',
    },
    'jaleter_premium': {
        'name': 'Jaleter Annual Membership',
        'amount': 90.0,
        'currency': 'usd',
        'kind': 'membership',
    },
}

PremiumEntitlementDays = 365


def get_stripe_client(webhook_url: Optional[str] = None) -> StripeCheckout:
    api_key = os.environ.get('STRIPE_API_KEY', '').strip()
    if not api_key:
        raise RuntimeError('Stripe is not configured (STRIPE_API_KEY missing).')
    return StripeCheckout(api_key=api_key, webhook_url=webhook_url)


def new_transaction_id() -> str:
    return f"pay_{uuid.uuid4().hex[:16]}"


def build_success_cancel_urls(origin: str, platform: str) -> tuple[str, str]:
    """
    Choose success/cancel URLs based on where the checkout was initiated.

    Native mobile app -> `jaleter://` deep links
    Web preview       -> the request `origin` + `/?checkout=success|cancel`
    """
    if platform == 'mobile':
        success = 'jaleter://checkout/success?session_id={CHECKOUT_SESSION_ID}'
        cancel = 'jaleter://checkout/cancel?session_id={CHECKOUT_SESSION_ID}'
    else:
        base = origin.rstrip('/') or 'https://example.com'
        success = f'{base}/?checkout=success&session_id={{CHECKOUT_SESSION_ID}}'
        cancel = f'{base}/?checkout=cancel&session_id={{CHECKOUT_SESSION_ID}}'
    return success, cancel


async def create_checkout_session(
    db,
    user: dict,
    product_key: str,
    platform: Literal['mobile', 'web'],
    origin: str,
    booking: Optional[dict] = None,
) -> dict:
    if product_key not in PRODUCTS:
        raise ValueError(f'Unknown product: {product_key}')
    product = PRODUCTS[product_key]

    txn_id = new_transaction_id()
    success_url, cancel_url = build_success_cancel_urls(origin, platform)

    stripe = get_stripe_client()

    metadata = {
        'txn_id': txn_id,
        'user_id': user['user_id'],
        'user_email': user['email'],
        'product': product_key,
        'kind': product['kind'],
    }
    if booking is not None:
        metadata['booking_id'] = booking['booking_id']
        if booking.get('scheduled_at'):
            metadata['scheduled_at'] = booking['scheduled_at']

    req = CheckoutSessionRequest(
        amount=product['amount'],
        currency=product['currency'],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
    )
    resp = await stripe.create_checkout_session(req)

    # Persist a pending transaction record BEFORE returning to the client.
    doc = {
        'txn_id': txn_id,
        'session_id': resp.session_id,
        'user_id': user['user_id'],
        'user_email': user['email'],
        'product': product_key,
        'kind': product['kind'],
        'amount': product['amount'],
        'currency': product['currency'],
        'status': 'pending',
        'payment_status': 'unpaid',
        'platform': platform,
        'metadata': metadata,
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc),
    }
    if booking is not None:
        doc['booking_id'] = booking['booking_id']
    await db.payment_transactions.insert_one(doc)

    return {
        'session_id': resp.session_id,
        'url': resp.url,
        'txn_id': txn_id,
        'amount': product['amount'],
        'currency': product['currency'],
        'product_name': product['name'],
    }


async def fetch_and_sync_status(db, session_id: str) -> dict:
    """
    Retrieve latest Checkout Session status from Stripe and apply
    idempotent side effects (grant membership / confirm booking) on
    the first time we observe payment_status == 'paid'.
    """
    txn = await db.payment_transactions.find_one({'session_id': session_id}, {'_id': 0})
    if not txn:
        raise LookupError('Unknown checkout session')

    stripe = get_stripe_client()
    status: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)

    updates = {
        'status': status.status or txn.get('status'),
        'payment_status': status.payment_status or txn.get('payment_status'),
        'amount_total': status.amount_total,
        'updated_at': datetime.now(timezone.utc),
    }

    just_paid = (
        status.payment_status == 'paid'
        and txn.get('payment_status') != 'paid'
    )

    await db.payment_transactions.update_one(
        {'session_id': session_id}, {'$set': updates}
    )

    if just_paid:
        await _apply_paid_side_effects(db, txn)

    merged = {**txn, **updates}
    return {
        'session_id': session_id,
        'status': merged['status'],
        'payment_status': merged['payment_status'],
        'amount_total': merged.get('amount_total'),
        'currency': merged.get('currency'),
        'product': merged.get('product'),
        'product_name': PRODUCTS.get(merged.get('product', ''), {}).get('name'),
        'booking_id': merged.get('booking_id'),
    }


async def _apply_paid_side_effects(db, txn: dict) -> None:
    """Grant entitlements the first time we see the transaction as paid."""
    kind = txn.get('kind')
    user_id = txn['user_id']
    now = datetime.now(timezone.utc)

    if kind == 'membership':
        # Extend or start a 365-day premium membership
        user = await db.users.find_one({'user_id': user_id}, {'_id': 0})
        current_expiry = None
        if user and user.get('premium_expires_at'):
            exp = user['premium_expires_at']
            if isinstance(exp, datetime):
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                current_expiry = exp
        start_from = current_expiry if (current_expiry and current_expiry > now) else now
        new_expiry = start_from + timedelta(days=PremiumEntitlementDays)
        await db.users.update_one(
            {'user_id': user_id},
            {'$set': {
                'premium_expires_at': new_expiry,
                'premium_last_purchase_at': now,
            }},
        )

    if kind == 'coaching' and txn.get('booking_id'):
        await db.coaching_bookings.update_one(
            {'booking_id': txn['booking_id']},
            {'$set': {'status': 'confirmed', 'paid_at': now, 'txn_id': txn['txn_id']}},
        )


# ---------------- Coaching bookings ----------------

def new_booking_id() -> str:
    return f"book_{uuid.uuid4().hex[:12]}"


async def create_pending_booking(db, user: dict, scheduled_at_iso: str | None) -> dict:
    # scheduled_at is optional (users may schedule via Calendly separately).
    dt = None
    if scheduled_at_iso:
        try:
            dt = datetime.fromisoformat(scheduled_at_iso.replace('Z', '+00:00'))
        except Exception:
            raise ValueError('Invalid scheduled_at (expected ISO-8601)')
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt < datetime.now(timezone.utc) - timedelta(days=1):
            raise ValueError('Please choose a time in the future.')

    booking_id = new_booking_id()
    doc = {
        'booking_id': booking_id,
        'user_id': user['user_id'],
        'user_email': user['email'],
        'user_name': user.get('name'),
        'scheduled_at': dt.isoformat() if dt else None,
        'scheduled_via': 'calendly' if not dt else 'in_app',
        'status': 'pending_payment',
        'created_at': datetime.now(timezone.utc),
    }
    await db.coaching_bookings.insert_one(doc)
    return {'booking_id': booking_id, 'scheduled_at': doc['scheduled_at']}


async def list_user_bookings(db, user_id: str) -> list[dict]:
    cursor = db.coaching_bookings.find(
        {'user_id': user_id}, {'_id': 0}
    ).sort('scheduled_at', -1).limit(20)
    out = []
    async for row in cursor:
        if isinstance(row.get('created_at'), datetime):
            row['created_at'] = row['created_at'].isoformat()
        if isinstance(row.get('paid_at'), datetime):
            row['paid_at'] = row['paid_at'].isoformat()
        out.append(row)
    return out


async def get_membership_status(db, user: dict) -> dict:
    exp = user.get('premium_expires_at')
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        active = exp > datetime.now(timezone.utc)
        return {
            'active': active,
            'expires_at': exp.isoformat(),
            'plan': 'jaleter_premium_annual' if active else None,
        }
    return {'active': False, 'expires_at': None, 'plan': None}
