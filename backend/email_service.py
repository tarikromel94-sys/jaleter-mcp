"""Email helper for Jaleter — powered by Emergent-managed Resend.

The platform provisions `EMERGENT_EMAIL_KEY` and owns the verified sending
domain, so no user-supplied API key or verified sender is required. We simply
POST to the integration proxy with our brand name as `from_name`.

Public API (kept compatible with the previous SendGrid module):
    - `is_configured() -> bool`   : True when EMERGENT_EMAIL_KEY is set.
    - `send_email(to, subject, html, text) -> (bool, str)`  : async, best-effort.
    - Builders that return `(subject, html_body, text_body)`:
        * build_password_reset_email(name, reset_token)
        * build_verification_email(name, verify_token)
        * build_delete_confirmation_email(name)
"""
from __future__ import annotations

import logging
import os
from typing import Tuple

import httpx

logger = logging.getLogger(__name__)

# Constant — never read from env so it survives deployment.
EMAIL_BASE_URL = os.environ.get(
    "EMERGENT_EMAIL_BASE_URL", "https://integrations.emergentagent.com"
)
_BRAND = "Jaleter"


def _from_name() -> str:
    return os.getenv("EMAIL_FROM_NAME", _BRAND).strip() or _BRAND


def is_configured() -> bool:
    """Ready to send when the Emergent email key is present in the environment."""
    return bool(os.getenv("EMERGENT_EMAIL_KEY", "").strip())


async def send_email(to: str, subject: str, html: str, text: str | None = None) -> Tuple[bool, str]:
    """Send transactional email via the Emergent-managed Resend proxy.

    Async + non-blocking (uses httpx.AsyncClient). Best-effort — never raises.
    Returns (sent, detail). `text` is accepted for signature compatibility but
    the proxy only requires `html`.
    """
    key = os.getenv("EMERGENT_EMAIL_KEY", "").strip()
    if not key:
        logger.warning("EMERGENT_EMAIL_KEY not set — skipping email to %s (subject=%r)", to, subject)
        return False, "Email not configured"
    payload = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": _from_name(),
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": key},
                json=payload,
            )
        if 200 <= resp.status_code < 300:
            return True, "sent"
        logger.error("Emergent email proxy returned %s for %s: %s", resp.status_code, to, resp.text[:200])
        return False, f"proxy status {resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        logger.error("Emergent email send failed for %s: %s", to, exc)
        return False, f"Email error: {exc.__class__.__name__}"


# ---------------- HTML builders (inline CSS, table-safe) ----------------
def _shell(inner_html: str, header_label: str) -> str:
    return f"""<!doctype html><html><body style="margin:0;padding:0;font-family:Georgia,serif;color:#171611;background:#faf8f3">
      <div style="max-width:560px;margin:0 auto;padding:24px">
        <div style="background:#fffdf9;border:1px solid #ebe5dc;border-radius:14px;padding:28px">
          <div style="font-size:26px;color:#c49450;font-weight:600">Jaleter</div>
          <div style="letter-spacing:1.6px;font-size:11px;color:#b18245;margin-top:6px">{header_label}</div>
          {inner_html}
        </div>
        <div style="text-align:center;color:#a29a8f;font-size:11px;margin-top:14px">
          Sent by Jaleter · <a href="https://jaleter.com" style="color:#b18245;text-decoration:none">jaleter.com</a>
        </div>
      </div>
    </body></html>"""


def build_password_reset_email(name: str, reset_token: str) -> Tuple[str, str, str]:
    subject = "Reset your Jaleter password"
    friendly = name or "there"
    text = (
        f"Hi {friendly},\n\n"
        f"We received a request to reset the password on your Jaleter account.\n\n"
        f"Your reset token (valid for 30 minutes):\n{reset_token}\n\n"
        f"Open the Jaleter app, tap 'Forgot password?' then 'Reset password', "
        f"and paste the token above along with your new password.\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"— The Jaleter team"
    )
    inner = f"""<p>Hi <strong>{friendly}</strong>,</p>
      <p>We received a request to reset the password on your Jaleter account. Your reset token is:</p>
      <div style="font-family:Menlo,Consolas,monospace;background:#f5efe5;border:1px solid #e2d3bd;border-radius:10px;padding:14px;font-size:14px;word-break:break-all">{reset_token}</div>
      <p style="color:#77726b;font-size:13px">Valid for 30 minutes. Open the Jaleter app, tap <em>Forgot password?</em> → <em>Reset password</em>, and paste this token along with your new password.</p>
      <p style="color:#928c83;font-size:12px">If you didn't request this, you can safely ignore this email — your password will stay the same.</p>
      <p style="color:#928c83;font-size:12px">— The Jaleter team</p>"""
    return subject, _shell(inner, "PASSWORD RESET"), text


def build_verification_email(name: str, verify_token: str) -> Tuple[str, str, str]:
    subject = "Verify your Jaleter email"
    friendly = name or "there"
    verify_link = f"https://jaleter.com/verify-email?token={verify_token}"
    text = (
        f"Hi {friendly},\n\n"
        f"Welcome to Jaleter. To finish setting up your account, please verify your email.\n\n"
        f"Verify link (valid for 24 hours):\n{verify_link}\n\n"
        f"Or paste this token into the app when prompted:\n{verify_token}\n\n"
        f"— The Jaleter team"
    )
    inner = f"""<p>Hi <strong>{friendly}</strong>,</p>
      <p>Welcome to Jaleter. To finish setting up your account, please verify your email address.</p>
      <p style="margin:22px 0">
        <a href="{verify_link}" style="background:#c49450;color:#fffdf9;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Verify my email</a>
      </p>
      <p style="color:#77726b;font-size:13px">Or copy-paste this token into the app if the button doesn't work:</p>
      <div style="font-family:Menlo,Consolas,monospace;background:#f5efe5;border:1px solid #e2d3bd;border-radius:10px;padding:14px;font-size:14px;word-break:break-all">{verify_token}</div>
      <p style="color:#928c83;font-size:12px">This link expires in 24 hours. If you didn't create a Jaleter account, you can safely ignore this email.</p>
      <p style="color:#928c83;font-size:12px">— The Jaleter team</p>"""
    return subject, _shell(inner, "EMAIL VERIFICATION"), text


def build_payment_failed_email(name: str, amount_label: str | None, retry_date_label: str | None) -> Tuple[str, str, str]:
    """Friendly billing-lapse notice sent when a membership renewal payment
    fails. Access continues during Stripe's retry window (past_due grace),
    so the tone is helpful — not alarming."""
    subject = "Action needed: your Jaleter membership payment didn't go through"
    friendly = name or "there"
    amount_line = f" of {amount_label}" if amount_label else ""
    retry_line = (
        f"We'll automatically try again on {retry_date_label}."
        if retry_date_label
        else "We'll automatically retry over the next few days."
    )
    billing_url = "https://jaleter.com/billing"
    text = (
        f"Hi {friendly},\n\n"
        f"We tried to renew your Jaleter membership, but the payment{amount_line} didn't go through. "
        f"This usually happens when a card has expired or was replaced.\n\n"
        f"Your access is still active — {retry_line}\n\n"
        f"To keep everything running smoothly, please update your payment method:\n"
        f"{billing_url}\n\n"
        f"You can also update it in the app: More → Membership → Manage billing.\n\n"
        f"If you have any questions, just reply or contact support@jaleter.com — we're happy to help.\n\n"
        f"— The Jaleter team"
    )
    inner = f"""<p>Hi <strong>{friendly}</strong>,</p>
      <p>We tried to renew your Jaleter membership, but the payment{amount_line} didn't go through. This usually happens when a card has expired or was replaced.</p>
      <p><strong>Your access is still active.</strong> {retry_line}</p>
      <p style="margin:22px 0">
        <a href="{billing_url}" style="background:#c49450;color:#fffdf9;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Update payment method</a>
      </p>
      <p style="color:#77726b;font-size:13px">You can also update it in the app: <em>More → Membership → Manage billing</em>.</p>
      <p style="color:#928c83;font-size:12px">Questions? Contact <a href="mailto:support@jaleter.com" style="color:#b18245">support@jaleter.com</a> — we're happy to help.</p>
      <p style="color:#928c83;font-size:12px">— The Jaleter team</p>"""
    return subject, _shell(inner, "MEMBERSHIP BILLING"), text


def build_delete_confirmation_email(name: str) -> Tuple[str, str, str]:
    subject = "Your Jaleter account has been deleted"
    friendly = name or "there"
    text = (
        f"Hi {friendly},\n\n"
        f"Your Jaleter account and all associated data have been permanently deleted "
        f"per your request. This includes profile info, budgets, linked bank connections, "
        f"transactions, and support tickets.\n\n"
        f"If this wasn't you, please contact support@jaleter.com immediately.\n\n"
        f"Thank you for using Jaleter.\n\n— The Jaleter team"
    )
    inner = f"""<p>Hi <strong>{friendly}</strong>,</p>
      <p>Your Jaleter account and all associated data have been permanently deleted per your request.</p>
      <p>This includes your profile, budgets, net-worth entries, linked bank connections, cached transactions, and support tickets.</p>
      <p style="color:#77726b;font-size:13px">If this wasn't you, please contact <a href="mailto:support@jaleter.com" style="color:#b18245">support@jaleter.com</a> immediately.</p>
      <p style="color:#928c83;font-size:12px">Thank you for using Jaleter.<br/>— The Jaleter team</p>"""
    return subject, _shell(inner, "ACCOUNT DELETED"), text
