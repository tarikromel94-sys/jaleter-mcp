"""SendGrid email helper for Jaleter.

If SENDGRID_API_KEY or SENDGRID_FROM_EMAIL is missing/empty, `send_email` logs a
warning and returns (False, "SendGrid not configured") without raising, so the
password-reset flow can still function in preview environments before the user
provisions SendGrid.
"""
from __future__ import annotations

import logging
import os
from typing import Tuple

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

logger = logging.getLogger(__name__)


def _sender() -> tuple[str, str]:
    return (os.getenv('SENDGRID_FROM_EMAIL', '').strip(), os.getenv('SENDGRID_FROM_NAME', 'Jaleter').strip() or 'Jaleter')


def is_configured() -> bool:
    return bool(os.getenv('SENDGRID_API_KEY', '').strip()) and bool(_sender()[0])


def send_email(to: str, subject: str, html: str, text: str) -> Tuple[bool, str]:
    """Returns (sent, detail). Never raises — email is best-effort."""
    api_key = os.getenv('SENDGRID_API_KEY', '').strip()
    from_email, from_name = _sender()
    if not api_key or not from_email:
        logger.warning('SendGrid not configured: skipping email to %s (subject=%r)', to, subject)
        return False, 'SendGrid not configured'
    try:
        message = Mail(
            from_email=(from_email, from_name),
            to_emails=to,
            subject=subject,
            html_content=html,
            plain_text_content=text,
        )
        client = SendGridAPIClient(api_key)
        response = client.send(message)
        ok = 200 <= int(response.status_code) < 300
        if not ok:
            logger.error('SendGrid returned %s for %s', response.status_code, to)
            return False, f'SendGrid status {response.status_code}'
        return True, 'sent'
    except Exception as exc:  # noqa: BLE001
        logger.error('SendGrid send failed for %s: %s', to, exc)
        return False, f'SendGrid error: {exc.__class__.__name__}'


def build_password_reset_email(name: str, reset_token: str) -> tuple[str, str, str]:
    """Returns (subject, html_body, text_body). Uses a copy-pasteable token
    (Expo apps commonly don't have universal deep links configured)."""
    subject = 'Reset your Jaleter password'
    text = (
        f"Hi {name or 'there'},\n\n"
        f"We received a request to reset the password on your Jaleter account.\n\n"
        f"Your reset token (valid for 30 minutes):\n"
        f"{reset_token}\n\n"
        f"Open the Jaleter app, tap 'Forgot password?' then 'Reset password', "
        f"and paste the token above along with your new password.\n\n"
        f"If you didn't request this, you can safely ignore this email.\n\n"
        f"— The Jaleter team"
    )
    html = f"""<!doctype html><html><body style=\"font-family:Georgia,serif;color:#171611;background:#faf8f3;padding:24px\">
    <div style=\"max-width:520px;margin:0 auto;background:#fffdf9;border:1px solid #ebe5dc;border-radius:14px;padding:28px\">
      <div style=\"font-size:26px;color:#c49450;font-weight:600\">Jaleter</div>
      <div style=\"letter-spacing:1.6px;font-size:11px;color:#b18245;margin-top:6px\">PASSWORD RESET</div>
      <p>Hi <strong>{name or 'there'}</strong>,</p>
      <p>We received a request to reset the password on your Jaleter account. Your reset token is:</p>
      <div style=\"font-family:Menlo,Consolas,monospace;background:#f5efe5;border:1px solid #e2d3bd;border-radius:10px;padding:14px;font-size:14px;word-break:break-all\">{reset_token}</div>
      <p style=\"color:#77726b;font-size:13px\">Valid for 30 minutes. Open the Jaleter app, tap <em>Forgot password?</em> → <em>Reset password</em>, and paste this token along with your new password.</p>
      <p style=\"color:#928c83;font-size:12px\">If you didn't request this, you can safely ignore this email — your password will stay the same.</p>
      <p style=\"color:#928c83;font-size:12px\">— The Jaleter team</p>
    </div></body></html>"""
    return subject, html, text
