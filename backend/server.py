from fastapi import FastAPI, APIRouter, HTTPException, Request, status, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import jwt, JWTError, jwk
from jose.exceptions import ExpiredSignatureError, JWTClaimsError
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import json
import uuid
import secrets
import logging
import httpx

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded


def _client_key(request: Request) -> str:  # noqa: F821 - Request is imported later
    """Return the real client IP for rate-limiting.

    Behind Kubernetes ingress, `request.client.host` is the pod IP so every
    caller collapses to one key. Ingress sets `X-Forwarded-For`; the leftmost
    value is the original client. Falls back to remote address if no header
    (e.g. local dev without a proxy). Any bad input → falls back safely.
    """
    try:
        xff = request.headers.get('x-forwarded-for', '').strip()
        if xff:
            first = xff.split(',')[0].strip()
            if first:
                return first
    except Exception:  # noqa: BLE001
        pass
    return get_remote_address(request)
# IMPORTANT: load .env BEFORE importing modules that read env at module level
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from email_service import (
    build_delete_confirmation_email,
    build_password_reset_email,
    build_verification_email,
    is_configured as email_ready,
    send_email,
)
# Legacy alias — many call-sites still reference `sendgrid_ready`. The email
# provider is now Emergent-managed Resend, but the check is functionally the
# same: "do we have a working provider configured?".
sendgrid_ready = email_ready
from simplefin_service import (
    SimpleFinError,
    claim_setup_token,
    decrypt as sf_decrypt,
    encrypt as sf_encrypt,
    fetch_accounts as sf_fetch_accounts,
    map_transaction as sf_map_transaction,
)
import plaid_service
from plaid_service import PlaidError
import support_service
from support_service import (
    TicketCreate,
    ReplyCreate,
    AdminUpdate,
    AdminNoteCreate,
)
from providers import ProviderError, build_registry, catalog as provider_catalog
from fastapi import File, UploadFile, Form
from payments_service import (
    PRODUCTS,
    create_checkout_session as pay_create_session,
    fetch_and_sync_status as pay_fetch_status,
    create_pending_booking as pay_create_booking,
    list_user_bookings as pay_list_bookings,
    get_membership_status as pay_membership_status,
)

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = 'HS256'
JWT_EXPIRE_MIN = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '10080'))
EMERGENT_SESSION_URL = 'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data'

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=['bcrypt'], deprecated='auto')

# Rate limiter — protects auth endpoints from brute force
limiter = Limiter(key_func=_client_key, default_limits=[])

app = FastAPI()
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={'detail': 'Too many attempts. Please try again in a minute.'})


api_router = APIRouter(prefix='/api')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ------- Models -------
class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    user_id: str
    name: str
    email: EmailStr
    provider: str  # 'password' | 'google'
    picture: Optional[str] = None
    is_admin: bool = False
    email_verified: bool = False


class AuthResponse(BaseModel):
    user: UserPublic
    token: str


class EmergentSessionRequest(BaseModel):
    session_id: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=200)


class SimpleFinLinkRequest(BaseModel):
    setup_token: str


class SupportRequest(BaseModel):
    institution: str = Field(min_length=1, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=2000)


class ProviderLinkRequest(BaseModel):
    provider: str
    payload: dict = Field(default_factory=dict)


# ------- Helpers -------
def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(pw, hashed)
    except Exception:
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MIN)
    return jwt.encode({'sub': subject, 'exp': expire}, JWT_SECRET, algorithm=JWT_ALG)


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


def public_user(u: dict) -> UserPublic:
    return UserPublic(
        user_id=u['user_id'],
        name=u['name'],
        email=u['email'],
        provider=u.get('provider', 'password'),
        picture=u.get('picture'),
        is_admin=bool(u.get('is_admin')),
        email_verified=bool(u.get('email_verified')),
    )


async def _resolve_by_jwt(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        return None
    user_id = payload.get('sub')
    if not user_id:
        return None
    return await db.users.find_one({'user_id': user_id}, {'_id': 0})


async def _resolve_by_google_session(session_token: str) -> Optional[dict]:
    row = await db.user_sessions.find_one({'session_token': session_token}, {'_id': 0})
    if not row:
        return None
    exp = row.get('expires_at')
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            await db.user_sessions.delete_one({'session_token': session_token})
            return None
    return await db.users.find_one({'user_id': row['user_id']}, {'_id': 0})


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Not authenticated')
    token = auth_header.split(' ', 1)[1].strip()
    user = await _resolve_by_jwt(token) or await _resolve_by_google_session(token)
    if not user:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    return user


# ------- Startup: indexes -------
@app.on_event('startup')
async def _startup():
    await db.users.create_index('email', unique=True)
    await db.users.create_index('user_id', unique=True)
    await db.user_sessions.create_index('session_token', unique=True)
    await db.user_sessions.create_index('user_id')
    await db.user_sessions.create_index('expires_at', expireAfterSeconds=0)
    await db.password_resets.create_index('token', unique=True)
    await db.password_resets.create_index('expires_at', expireAfterSeconds=0)
    await db.linked_accounts.create_index([('user_id', 1)])
    await db.linked_accounts.create_index([('user_id', 1), ('provider', 1)])
    await db.bank_transactions.create_index([('user_id', 1), ('account_id', 1), ('external_id', 1)], unique=True)
    await db.bank_transactions.create_index([('user_id', 1), ('provider', 1), ('external_id', 1)])
    await db.bank_transactions.create_index([('user_id', 1), ('date', -1)])
    await db.support_requests.create_index([('user_id', 1), ('created_at', -1)])
    await db.payment_transactions.create_index('session_id', unique=True)
    await db.payment_transactions.create_index([('user_id', 1), ('created_at', -1)])
    await db.coaching_bookings.create_index('booking_id', unique=True)
    await db.coaching_bookings.create_index([('user_id', 1), ('scheduled_at', -1)])
    # Plaid
    await db.plaid_items.create_index('item_id', unique=True)
    await db.plaid_items.create_index([('user_id', 1)])
    # Wealth account overrides (Jaleter category + custom name per Plaid account)
    await db.account_overrides.create_index([('user_id', 1), ('account_id', 1)], unique=True)
    # Support tickets
    await db.support_tickets.create_index('ticket_id', unique=True)
    await db.support_tickets.create_index([('user_id', 1), ('created_at', -1)])
    await db.support_tickets.create_index([('status', 1), ('created_at', -1)])
    # Seed the primary admin account (idempotent)
    try:
        await support_service.ensure_admin_seed(
            db,
            hash_password=hash_password,
            new_user_id=new_user_id,
            email='support@jaleter.com',
            password='Tarik0731!',
            name='Jaleter Support',
        )
    except Exception as e:  # noqa: BLE001
        logger.warning('Support admin seed skipped: %s', e)


@app.on_event('shutdown')
async def _shutdown():
    client.close()


# ------- Routes -------
@api_router.get('/')
async def root():
    return {'message': 'Jaleter API', 'status': 'ok'}


@api_router.post('/auth/register')
@limiter.limit('10/minute')
async def register(payload: RegisterRequest, request: Request):
    existing = await db.users.find_one({'email': payload.email.lower()}, {'_id': 0})
    if existing:
        raise HTTPException(status_code=400, detail='Email already registered')
    user_id = new_user_id()
    doc = {
        'user_id': user_id,
        'name': payload.name.strip(),
        'email': payload.email.lower(),
        'password_hash': hash_password(payload.password),
        'provider': 'password',
        'email_verified': False,
        'created_at': datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
    # Auto-issue a verification token (best-effort — email delivery is a no-op
    # when SendGrid keys are absent so token is returned in dev only).
    verification_token = None
    try:
        verification_token = secrets.token_urlsafe(32)
        await db.email_verifications.insert_one({
            'token': verification_token,
            'user_id': user_id,
            'email': payload.email.lower(),
            'created_at': datetime.now(timezone.utc),
            'expires_at': datetime.now(timezone.utc) + timedelta(hours=24),
            'used': False,
        })
        if email_ready():
            subject, html, _ = build_verification_email(payload.name.strip(), verification_token)
            await send_email(payload.email.lower(), subject, html)
    except Exception as e:  # noqa: BLE001
        logger.warning('email verification issue on register: %s', e)
    token = create_access_token(user_id)
    doc.pop('_id', None)
    resp = AuthResponse(user=public_user(doc), token=token)
    # In dev (no email provider) surface the token so QA can proceed; suppressed in prod.
    if verification_token and not email_ready():
        return {**resp.model_dump(), 'dev_verification_token': verification_token}
    return resp


@api_router.post('/auth/verify-email')
@limiter.limit('20/minute')
async def verify_email(request: Request, payload: dict):
    """Verify a user's email using the token from the verification link.

    We fetch the token, ensure it isn't expired or already used, then set
    `email_verified: True` on the user and mark the token consumed.
    """
    token_val = (payload.get('token') or '').strip()
    if not token_val:
        raise HTTPException(status_code=400, detail='Missing verification token')
    row = await db.email_verifications.find_one({'token': token_val, 'used': False})
    if not row:
        raise HTTPException(status_code=400, detail='Invalid or expired verification link')
    exp = row.get('expires_at')
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail='Verification link has expired')
    await db.users.update_one({'user_id': row['user_id']}, {'$set': {'email_verified': True}})
    await db.email_verifications.update_one({'token': token_val}, {'$set': {'used': True, 'used_at': datetime.now(timezone.utc)}})
    return {'ok': True}


@api_router.post('/auth/resend-verification')
@limiter.limit('3/minute')
async def resend_verification(request: Request, current_user: dict = Depends(get_current_user)):
    """Re-issue a verification token for the signed-in user."""
    if current_user.get('email_verified'):
        return {'ok': True, 'already_verified': True}
    verification_token = secrets.token_urlsafe(32)
    await db.email_verifications.insert_one({
        'token': verification_token,
        'user_id': current_user['user_id'],
        'email': current_user['email'],
        'created_at': datetime.now(timezone.utc),
        'expires_at': datetime.now(timezone.utc) + timedelta(hours=24),
        'used': False,
    })
    if email_ready():
        subject, html, _ = build_verification_email(current_user.get('name', ''), verification_token)
        await send_email(current_user['email'], subject, html)
        return {'ok': True}
    # Dev-only: return the token for testing when email is not configured.
    return {'ok': True, 'dev_verification_token': verification_token}


@api_router.post('/auth/login', response_model=AuthResponse)
@limiter.limit('5/minute')
async def login(payload: LoginRequest, request: Request):
    user = await db.users.find_one({'email': payload.email.lower()}, {'_id': 0})
    if not user or not user.get('password_hash'):
        raise HTTPException(status_code=401, detail='Invalid email or password')
    if not verify_password(payload.password, user['password_hash']):
        raise HTTPException(status_code=401, detail='Invalid email or password')
    token = create_access_token(user['user_id'])
    return AuthResponse(user=public_user(user), token=token)


@api_router.delete('/auth/delete-account')
@limiter.limit('3/minute')
async def delete_account(request: Request, current_user: dict = Depends(get_current_user)):
    """Fully purge a user account — profile, sessions, financial data, and Plaid.

    Password-provider users MUST re-enter their password (sent in the JSON body
    as `{ "password": "..." }`) as a soft "sudo" check before deletion proceeds.
    Google / Apple users are exempt because the OAuth session token is proof.

    Steps (best-effort; nothing here should raise a 500 unless auth failed):
      1. Verify password (password-provider only)
      2. Send goodbye email (best-effort)
      3. Revoke every Plaid item at Plaid (`/item/remove`), then delete local rows
      4. Delete every cached bank transaction for the user
      5. Delete linked_accounts, snaptrade_users/accounts, support tickets/replies, payments
      6. Delete sessions, password_resets, email_verifications
      7. Finally delete the user row itself
    """
    user_id = current_user['user_id']
    # 1. Password re-verification for password-provider accounts.
    provider = (current_user.get('provider') or 'password').lower()
    if provider == 'password':
        body: dict = {}
        try:
            body = await request.json()
        except Exception:
            body = {}
        supplied = (body.get('password') or '').strip() if isinstance(body, dict) else ''
        if not supplied:
            raise HTTPException(status_code=400, detail='Password required to delete your account.')
        pw_hash = current_user.get('password_hash')
        if not pw_hash or not verify_password(supplied, pw_hash):
            raise HTTPException(status_code=401, detail='Incorrect password.')

    # 2. Send goodbye email BEFORE we blow away the user row (best-effort).
    try:
        if email_ready() and current_user.get('email'):
            subject, html, _ = build_delete_confirmation_email(current_user.get('name', ''))
            await send_email(current_user['email'], subject, html)
    except Exception as e:  # noqa: BLE001
        logger.warning('delete-account: goodbye email failed: %s', e)

    deleted: dict[str, int] = {}
    # 3. Plaid items — try to revoke each token remotely, then delete locally.
    items = await db.plaid_items.find({'user_id': user_id}).to_list(length=100)
    plaid_revoked = 0
    plaid_revoke_errors = 0
    for item in items:
        try:
            plain_token = plaid_service.decrypt(item['access_token_encrypted'])
            await plaid_service._post('/item/remove', {'access_token': plain_token})
            plaid_revoked += 1
        except Exception as e:  # noqa: BLE001
            plaid_revoke_errors += 1
            logger.warning('plaid revoke failed during delete-account: %s', e)
    r = await db.plaid_items.delete_many({'user_id': user_id}); deleted['plaid_items'] = r.deleted_count
    # 4. Cached transactions
    r = await db.bank_transactions.delete_many({'user_id': user_id}); deleted['bank_transactions'] = r.deleted_count
    # 5. Other linked-financial-data collections
    for coll in ('linked_accounts', 'snaptrade_accounts', 'snaptrade_users',
                 'support_tickets', 'support_requests', 'coaching_bookings',
                 'payment_transactions', 'coach_messages', 'account_overrides'):
        try:
            r = await db[coll].delete_many({'user_id': user_id}); deleted[coll] = r.deleted_count
        except Exception as e:  # noqa: BLE001
            logger.warning('delete-account: failed on %s: %s', coll, e)
    # 6. Sessions + tokens
    for coll in ('user_sessions', 'password_resets', 'email_verifications'):
        try:
            r = await db[coll].delete_many({'user_id': user_id}); deleted[coll] = r.deleted_count
        except Exception:
            pass
    # 7. Finally the user record
    r = await db.users.delete_one({'user_id': user_id}); deleted['users'] = r.deleted_count
    return {
        'ok': True,
        'user_id': user_id,
        'plaid_items_revoked': plaid_revoked,
        'plaid_revoke_errors': plaid_revoke_errors,
        'deleted_counts': deleted,
    }


@api_router.get('/auth/me', response_model=UserPublic)
async def me(current_user: dict = Depends(get_current_user)):
    return public_user(current_user)


@api_router.post('/auth/logout')
async def logout(request: Request):
    auth_header = request.headers.get('Authorization', '')
    if auth_header.lower().startswith('bearer '):
        token = auth_header.split(' ', 1)[1].strip()
        await db.user_sessions.delete_one({'session_token': token})
    return {'ok': True}


@api_router.post('/auth/emergent/session', response_model=AuthResponse)
async def emergent_session(payload: EmergentSessionRequest):
    """Client passes the session_id from Emergent's redirect; we validate with Emergent and upsert the user."""
    async with httpx.AsyncClient(timeout=15.0) as hx:
        r = await hx.get(EMERGENT_SESSION_URL, headers={'X-Session-ID': payload.session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail='Invalid Emergent session')
    data = r.json()
    email = (data.get('email') or '').lower()
    if not email:
        raise HTTPException(status_code=400, detail='Emergent response missing email')

    existing = await db.users.find_one({'email': email}, {'_id': 0})
    if existing:
        user_id = existing['user_id']
        await db.users.update_one(
            {'user_id': user_id},
            {'$set': {'name': data.get('name') or existing.get('name'), 'picture': data.get('picture'), 'provider': existing.get('provider', 'google')}},
        )
        user = await db.users.find_one({'user_id': user_id}, {'_id': 0})
    else:
        user_id = new_user_id()
        user = {
            'user_id': user_id,
            'name': data.get('name') or email.split('@')[0],
            'email': email,
            'picture': data.get('picture'),
            'provider': 'google',
            'created_at': datetime.now(timezone.utc),
        }
        await db.users.insert_one(dict(user))

    session_token = data.get('session_token')
    if not session_token:
        raise HTTPException(status_code=502, detail='Emergent did not return a session token')

    await db.user_sessions.update_one(
        {'session_token': session_token},
        {'$set': {
            'session_token': session_token,
            'user_id': user_id,
            'expires_at': datetime.now(timezone.utc) + timedelta(days=7),
            'created_at': datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return AuthResponse(user=public_user(user), token=session_token)


# ---------------- Sign in with Apple ----------------
APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
APPLE_ISSUER = 'https://appleid.apple.com'
APPLE_AUDIENCES = [a.strip() for a in os.environ.get('APPLE_AUDIENCES', '').split(',') if a.strip()]
_apple_jwks_cache: dict = {'fetched_at': 0.0, 'keys': None}


async def _apple_jwks() -> list[dict]:
    now = datetime.now(timezone.utc).timestamp()
    if _apple_jwks_cache['keys'] and now - _apple_jwks_cache['fetched_at'] < 3600:
        return _apple_jwks_cache['keys']
    async with httpx.AsyncClient(timeout=10.0) as hx:
        r = await hx.get(APPLE_JWKS_URL)
        r.raise_for_status()
        keys = r.json().get('keys', [])
    _apple_jwks_cache['keys'] = keys
    _apple_jwks_cache['fetched_at'] = now
    return keys


class AppleAuthRequest(BaseModel):
    identity_token: str
    name: Optional[str] = None
    email: Optional[str] = None


@api_router.post('/auth/apple', response_model=AuthResponse)
async def apple_sign_in(payload: AppleAuthRequest):
    if not APPLE_AUDIENCES:
        raise HTTPException(status_code=500, detail='Apple sign-in is not configured on the server.')
    try:
        header = jwt.get_unverified_header(payload.identity_token)
    except Exception:
        raise HTTPException(status_code=401, detail='Invalid Apple identity token (malformed header).')
    kid = header.get('kid')
    if not kid:
        raise HTTPException(status_code=401, detail='Invalid Apple identity token (missing kid).')
    keys = await _apple_jwks()
    key_dict = next((k for k in keys if k.get('kid') == kid), None)
    if not key_dict:
        # Apple may have rotated — bust cache and retry once
        _apple_jwks_cache['fetched_at'] = 0.0
        keys = await _apple_jwks()
        key_dict = next((k for k in keys if k.get('kid') == kid), None)
    if not key_dict:
        raise HTTPException(status_code=401, detail='Apple identity token signed with unknown key.')

    public_key = jwk.construct(key_dict)
    try:
        claims = jwt.decode(
            payload.identity_token,
            public_key.to_pem().decode(),
            algorithms=['RS256'],
            audience=APPLE_AUDIENCES,
            issuer=APPLE_ISSUER,
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Apple identity token has expired.')
    except JWTClaimsError as e:
        raise HTTPException(status_code=401, detail=f'Apple identity token claims invalid: {e}')
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f'Apple identity token verification failed: {e}')

    apple_sub = claims.get('sub')
    if not apple_sub:
        raise HTTPException(status_code=401, detail='Apple identity token missing subject.')

    token_email = (claims.get('email') or '').lower() or None
    # Apple sometimes returns a private-relay email; still valid.
    is_private_relay = bool(token_email and token_email.endswith('@privaterelay.appleid.com'))

    # Look up existing user by apple_sub first, then by email as a fallback (link accounts).
    user = await db.users.find_one({'apple_sub': apple_sub}, {'_id': 0})
    if not user and token_email:
        user = await db.users.find_one({'email': token_email}, {'_id': 0})

    if user:
        # Never overwrite existing name/email with nulls; only fill missing fields.
        updates: dict = {'apple_sub': apple_sub}
        if not user.get('name') and payload.name:
            updates['name'] = payload.name.strip()
        if not user.get('email') and token_email:
            updates['email'] = token_email
        if 'provider' not in user or not user['provider']:
            updates['provider'] = 'apple'
        if updates:
            await db.users.update_one({'user_id': user['user_id']}, {'$set': updates})
            user = await db.users.find_one({'user_id': user['user_id']}, {'_id': 0})
    else:
        # First sign-in — Apple gives us name/email only ONCE. Persist immediately.
        user_id = new_user_id()
        email_for_record = token_email or (payload.email or '').lower() or None
        user = {
            'user_id': user_id,
            'apple_sub': apple_sub,
            'name': (payload.name or '').strip() or (email_for_record.split('@')[0] if email_for_record else 'Friend'),
            'email': email_for_record,
            'provider': 'apple',
            'email_is_private_relay': is_private_relay,
            'created_at': datetime.now(timezone.utc),
        }
        await db.users.insert_one(dict(user))

    session_token = create_access_token(user['user_id'])
    return AuthResponse(user=public_user(user), token=session_token)


@api_router.post('/auth/forgot-password')
@limiter.limit('3/minute')
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    """Generates a reset token that expires in 30 minutes and emails it via SendGrid.

    If SendGrid is not yet configured (preview mode) the token is returned in the
    response so the app remains testable. When SendGrid IS configured, the token
    is only sent by email and the response contains no `reset_token`.

    Email enumeration is avoided by returning the same response shape for both
    existing and non-existent emails.
    """
    email = payload.email.lower()
    user = await db.users.find_one({'email': email, 'provider': 'password'}, {'_id': 0})
    if not user:
        # Same response shape regardless — do not leak existence.
        return {'ok': True, 'delivered': False}

    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({
        'token': token,
        'user_id': user['user_id'],
        'email': email,
        'expires_at': datetime.now(timezone.utc) + timedelta(minutes=30),
        'used': False,
        'created_at': datetime.now(timezone.utc),
    })

    if email_ready():
        subject, html_body, text_body = build_password_reset_email(user.get('name', ''), token)
        sent, detail = await send_email(email, subject, html_body, text_body)
        logger.info('Password reset email %s for %s (%s)', 'sent' if sent else 'FAILED', email, detail)
        return {'ok': True, 'delivered': sent, 'via': 'emergent-resend'}

    # Preview fallback: email provider not configured. Return the token so the UI
    # flow still works. This branch MUST become unreachable once
    # EMERGENT_EMAIL_KEY is set in production.
    logger.warning('Email not configured; returning reset token in response (dev only). Set EMERGENT_EMAIL_KEY in /app/backend/.env to enable email delivery.')
    return {
        'ok': True,
        'delivered': False,
        'reset_token': token,
        'via': 'dev-fallback',
        'note': 'Email provider not configured. Set EMERGENT_EMAIL_KEY in backend/.env to email reset tokens.',
    }


@api_router.post('/auth/reset-password', response_model=AuthResponse)
@limiter.limit('5/minute')
async def reset_password(payload: ResetPasswordRequest, request: Request):
    row = await db.password_resets.find_one({'token': payload.token, 'used': False}, {'_id': 0})
    if not row:
        raise HTTPException(status_code=400, detail='Invalid or already-used reset link')
    exp = row.get('expires_at')
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail='Reset link has expired')
    new_hash = hash_password(payload.new_password)
    await db.users.update_one({'user_id': row['user_id']}, {'$set': {'password_hash': new_hash}})
    await db.password_resets.update_one({'token': payload.token}, {'$set': {'used': True}})
    # Invalidate any existing Google sessions for the account (optional hardening).
    await db.user_sessions.delete_many({'user_id': row['user_id']})
    user = await db.users.find_one({'user_id': row['user_id']}, {'_id': 0})
    token = create_access_token(row['user_id'])
    return AuthResponse(user=public_user(user), token=token)


# ------- SimpleFIN Banking Data -------
def _account_summary(linked_id: str, org_name: str, org_domain: Optional[str], acc: dict, last_sync: Optional[datetime]) -> dict:
    try:
        balance = float(acc.get('balance') or 0)
    except (TypeError, ValueError):
        balance = 0.0
    bd_ts = acc.get('balance-date')
    balance_date = datetime.fromtimestamp(int(bd_ts), tz=timezone.utc).isoformat() if bd_ts else None
    return {
        'link_id': linked_id,
        'account_id': acc.get('id'),
        'name': acc.get('name') or 'Account',
        'currency': acc.get('currency') or 'USD',
        'balance': balance,
        'balance_date': balance_date,
        'org_name': org_name,
        'org_domain': org_domain,
        'last_sync_at': last_sync.isoformat() if last_sync else None,
    }


@api_router.post('/accounts/simplefin/link')
async def simplefin_link(payload: SimpleFinLinkRequest, request: Request, current_user: dict = Depends(get_current_user)):
    try:
        access_url = await claim_setup_token(payload.setup_token)
    except SimpleFinError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        account_set = await sf_fetch_accounts(access_url, balances_only=True)
    except SimpleFinError as e:
        raise HTTPException(status_code=502, detail=str(e))
    org = account_set.get('org') or {}
    accounts = account_set.get('accounts') or []
    try:
        access_encrypted = sf_encrypt(access_url)
    except SimpleFinError as e:
        raise HTTPException(status_code=500, detail=f'Encryption not configured: {e}')
    doc = {
        'user_id': current_user['user_id'],
        'provider': 'simplefin',
        'access_url_encrypted': access_encrypted,
        'org_name': org.get('name'),
        'org_domain': org.get('domain'),
        'account_ids': [a.get('id') for a in accounts if a.get('id')],
        'created_at': datetime.now(timezone.utc),
        'last_sync_at': None,
        'last_sync_start_date': None,
    }
    result = await db.linked_accounts.insert_one(doc)
    return {
        'link_id': str(result.inserted_id),
        'org_name': org.get('name'),
        'linked_count': len(doc['account_ids']),
        'accounts': [_account_summary(str(result.inserted_id), org.get('name') or '', org.get('domain'), a, None) for a in accounts],
    }


@api_router.get('/accounts')
async def list_accounts(current_user: dict = Depends(get_current_user)):
    cursor = db.linked_accounts.find(
        {
            'user_id': current_user['user_id'],
            '$or': [{'provider': {'$exists': False}}, {'provider': 'simplefin'}],
        },
        {'access_url_encrypted': 1, 'org_name': 1, 'org_domain': 1, 'last_sync_at': 1},
    )
    docs = await cursor.to_list(length=50)
    summaries: list[dict] = []
    for doc in docs:
        link_id = str(doc['_id'])
        try:
            access_url = sf_decrypt(doc['access_url_encrypted'])
            account_set = await sf_fetch_accounts(access_url, balances_only=True)
        except SimpleFinError as e:
            summaries.append({'link_id': link_id, 'org_name': doc.get('org_name'), 'error': str(e)})
            continue
        org = account_set.get('org') or {}
        for acc in account_set.get('accounts') or []:
            summaries.append(_account_summary(link_id, org.get('name') or doc.get('org_name') or '', org.get('domain') or doc.get('org_domain'), acc, doc.get('last_sync_at')))
    return {'accounts': summaries}


@api_router.post('/accounts/sync')
async def sync_accounts(current_user: dict = Depends(get_current_user)):
    cursor = db.linked_accounts.find({
        'user_id': current_user['user_id'],
        '$or': [{'provider': {'$exists': False}}, {'provider': 'simplefin'}],
    })
    docs = await cursor.to_list(length=50)
    return await _sync_docs(current_user, docs)


@api_router.post('/accounts/link/{link_id}/sync')
async def sync_single(link_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId
    try:
        oid = ObjectId(link_id)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail='Invalid link id')
    doc = await db.linked_accounts.find_one({'_id': oid, 'user_id': current_user['user_id']})
    if not doc:
        raise HTTPException(status_code=404, detail='Linked account not found')
    if doc.get('provider') and doc['provider'] != 'simplefin':
        raise HTTPException(status_code=400, detail=f"Sync not supported for provider '{doc['provider']}'")
    return await _sync_docs(current_user, [doc])


async def _sync_docs(current_user: dict, docs: list) -> dict:
    total_new = 0
    errors: list[dict] = []
    now_ts = int(datetime.now(timezone.utc).timestamp())
    for doc in docs:
        try:
            access_url = sf_decrypt(doc['access_url_encrypted'])
            account_set = await sf_fetch_accounts(access_url, balances_only=False, start_date=doc.get('last_sync_start_date'))
        except SimpleFinError as e:
            errors.append({'link_id': str(doc['_id']), 'error': str(e)})
            continue
        org_name = (account_set.get('org') or {}).get('name') or doc.get('org_name') or 'SimpleFIN'
        for acc in account_set.get('accounts') or []:
            account_id = acc.get('id')
            for txn in acc.get('transactions') or []:
                mapped = sf_map_transaction(current_user['user_id'], account_id, org_name, txn)
                try:
                    result = await db.bank_transactions.update_one(
                        {'user_id': mapped['user_id'], 'account_id': mapped['account_id'], 'external_id': mapped['external_id']},
                        {'$setOnInsert': mapped},
                        upsert=True,
                    )
                    if result.upserted_id:
                        total_new += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning('bank_transactions upsert failed: %s', e)
        await db.linked_accounts.update_one(
            {'_id': doc['_id']},
            {'$set': {'last_sync_at': datetime.now(timezone.utc), 'last_sync_start_date': now_ts}},
        )
    return {'synced': total_new, 'errors': errors}


@api_router.delete('/accounts/link/{link_id}')
async def unlink(link_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId
    try:
        oid = ObjectId(link_id)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail='Invalid link id')
    res = await db.linked_accounts.delete_one({'_id': oid, 'user_id': current_user['user_id']})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Linked account not found')
    return {'ok': True, 'note': 'Remove this app from your SimpleFIN Bridge dashboard to fully revoke access.'}


@api_router.get('/accounts/transactions')
async def list_bank_transactions(current_user: dict = Depends(get_current_user), limit: int = 50):
    cursor = db.bank_transactions.find(
        {'user_id': current_user['user_id']},
        {'_id': 0, 'user_id': 0, 'raw': 0},
    ).sort('date', -1).limit(min(max(limit, 1), 200))
    return {'transactions': [{**t, 'date': t['date'].isoformat() if isinstance(t.get('date'), datetime) else t.get('date')} async for t in cursor]}


# ------- SnapTrade OAuth Callback -------
@api_router.post('/accounts/snaptrade/callback')
async def snaptrade_callback(current_user: dict = Depends(get_current_user)):
    """Called by the app after the SnapTrade Connection Portal redirects back
    to `jaleter://snaptrade-callback`. We simply trigger a sync so the newly
    authorized brokerage account materializes in `/api/accounts/all`.
    """
    provider = _provider_registry.get('snaptrade')
    if not provider or not provider.is_configured():
        raise HTTPException(status_code=503, detail='SnapTrade not configured')
    try:
        result = await provider.sync(current_user['user_id'])
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {'ok': True, **result}


# ------- Modular Provider Layer -------
_provider_registry = build_registry(db)


@api_router.get('/providers')
async def list_providers():
    return {'providers': provider_catalog(_provider_registry)}


@api_router.post('/accounts/link')
@limiter.limit('10/minute')
async def provider_link(payload: ProviderLinkRequest, request: Request, current_user: dict = Depends(get_current_user)):
    """Modular link endpoint. Currently delegates SimpleFIN to its existing route.
    For 'snaptrade' returns a redirect_uri (or 503 if not configured)."""
    if payload.provider == 'simplefin':
        setup_token = (payload.payload or {}).get('setup_token')
        if not setup_token:
            raise HTTPException(status_code=400, detail='setup_token required for SimpleFIN')
        return await simplefin_link(SimpleFinLinkRequest(setup_token=setup_token), request=request, current_user=current_user)
    if payload.provider not in _provider_registry:
        raise HTTPException(status_code=400, detail=f'Unknown provider: {payload.provider}')
    provider = _provider_registry[payload.provider]
    if not provider.is_configured():
        raise HTTPException(status_code=503, detail=f'{provider.label} is not yet configured.')
    try:
        return await provider.link(current_user['user_id'], payload.payload or {})
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.post('/accounts/import')
async def import_transactions(
    file: UploadFile = File(...),
    account_name: Optional[str] = Form(default=None),
    current_user: dict = Depends(get_current_user),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail='Uploaded file is empty')
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail='File larger than 5MB')
    provider = _provider_registry['file']
    try:
        result = await provider.import_file(current_user['user_id'], file.filename or 'upload', file.content_type, raw, account_name)  # type: ignore[attr-defined]
        return result
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get('/accounts/all')
async def list_all_accounts(current_user: dict = Depends(get_current_user)):
    """Combines SimpleFIN, SnapTrade, and File-import balances into one list.
    Never raises on provider failures — returns per-source error entries instead."""
    combined: list[dict] = []
    # SimpleFIN via existing endpoint helper
    try:
        sf_data = await list_accounts(current_user)  # type: ignore[func-returns-value]
        for row in sf_data.get('accounts', []):
            combined.append({**row, 'provider': 'simplefin', 'kind': 'bank'})
    except Exception as e:  # noqa: BLE001
        combined.append({'provider': 'simplefin', 'error': str(e)})
    # File & SnapTrade providers
    for pid in ('file', 'snaptrade'):
        p = _provider_registry.get(pid)
        if not p or not p.is_configured():
            continue
        try:
            rows = await p.list_accounts(current_user['user_id'])
            for row in rows:
                combined.append({**row, 'provider': pid, 'kind': 'investment' if pid == 'snaptrade' else 'file'})
        except Exception as e:  # noqa: BLE001
            combined.append({'provider': pid, 'error': str(e)})
    # Plaid
    try:
        rows = await _plaid_list_accounts_for_user(current_user['user_id'])
        for row in rows:
            combined.append({**row, 'provider': 'plaid', 'kind': 'bank'})
    except Exception as e:  # noqa: BLE001
        combined.append({'provider': 'plaid', 'error': str(e)})
    return {'accounts': combined}


# ------------------------------------------------------------------
# Account overrides — per-user rename + reclassification of a Plaid account
# ------------------------------------------------------------------
class AccountOverridePayload(BaseModel):
    override_category: Optional[str] = Field(default=None)
    override_name: Optional[str] = Field(default=None, max_length=64)
    # User must acknowledge switching between asset<->liability sides.
    allow_side_switch: bool = False


@api_router.get('/accounts/categories')
async def list_account_categories():
    """Return the canonical list of Jaleter account categories the frontend
    should render in the reclassification picker.

    Grouped by side (assets/liabilities) so the UI can show them naturally."""
    def pack(slug: str) -> dict:
        return {
            'slug': slug,
            'label': wealth_service.CATEGORY_LABELS.get(slug, slug),
            'is_asset': wealth_service.is_asset(slug),
        }
    return {
        'assets': [pack(s) for s in ('cash', 'investments', 'real_estate', 'vehicles', 'other_assets')],
        'liabilities': [pack(s) for s in ('credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities')],
    }


@api_router.patch('/accounts/{account_id}')
@limiter.limit('30/minute')
async def update_account_override(
    account_id: str,
    payload: AccountOverridePayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Set (or clear) the user's rename + reclassification for a Plaid account.

    Passing `override_name=""` or `override_category=""` clears that field.
    Category changes that cross the asset/liability boundary require
    `allow_side_switch: true` — this matches spec #3 ("clear warning or
    controlled rule" before treating a liability as an asset).
    """
    if not account_id.strip():
        raise HTTPException(status_code=400, detail='Missing account_id')

    # Validate category if provided (empty string means "clear override").
    new_cat = (payload.override_category or '').strip().lower() or None
    if new_cat is not None and new_cat not in wealth_service.ALL_CATEGORIES:
        raise HTTPException(status_code=400, detail=f'Unknown category: {new_cat!r}')

    # Verify the account belongs to this user (IDOR guard) by looking it up
    # in the live Plaid account list. This also gives us the auto_category so
    # we can enforce the side-switch guard.
    live = await _plaid_list_accounts_for_user(current_user['user_id'])
    match = next((r for r in live if r.get('account_id') == account_id), None)
    if not match:
        raise HTTPException(status_code=404, detail='Account not found for this user')

    # Side-switch guard.
    if new_cat is not None:
        current_side_is_asset = wealth_service.is_asset(match.get('category') or 'other_assets')
        new_side_is_asset = wealth_service.is_asset(new_cat)
        if current_side_is_asset != new_side_is_asset and not payload.allow_side_switch:
            raise HTTPException(
                status_code=409,
                detail={
                    'error': 'side_switch_requires_confirmation',
                    'message': (
                        'Reclassifying between an asset and a liability changes how the '
                        'balance affects Net Worth. Send `allow_side_switch: true` to confirm.'
                    ),
                    'current_category': match.get('category'),
                    'new_category': new_cat,
                },
            )

    new_name = payload.override_name
    if new_name is not None:
        new_name = new_name.strip() or None

    set_doc: dict = {'updated_at': datetime.now(timezone.utc)}
    unset_doc: dict = {}
    if new_cat is None and payload.override_category is not None:
        unset_doc['override_category'] = ''
    elif new_cat:
        set_doc['override_category'] = new_cat
    if new_name is None and payload.override_name is not None:
        unset_doc['override_name'] = ''
    elif new_name:
        set_doc['override_name'] = new_name

    update: dict = {
        '$set': {**set_doc, 'user_id': current_user['user_id'], 'account_id': account_id},
        '$setOnInsert': {'created_at': datetime.now(timezone.utc)},
    }
    if unset_doc:
        update['$unset'] = unset_doc
    await db.account_overrides.update_one(
        {'user_id': current_user['user_id'], 'account_id': account_id},
        update,
        upsert=True,
    )
    # Re-fetch the (now-updated) account row so the client can render immediately.
    live = await _plaid_list_accounts_for_user(current_user['user_id'])
    updated = next((r for r in live if r.get('account_id') == account_id), None)
    return {'ok': True, 'account': updated}


@api_router.delete('/accounts/{account_id}/override')
async def clear_account_override(account_id: str, current_user: dict = Depends(get_current_user)):
    """Reset both the rename + reclassification for an account (reverts to
    Plaid's automatic classification)."""
    await db.account_overrides.delete_one({
        'user_id': current_user['user_id'], 'account_id': account_id,
    })
    live = await _plaid_list_accounts_for_user(current_user['user_id'])
    updated = next((r for r in live if r.get('account_id') == account_id), None)
    return {'ok': True, 'account': updated}


# ------- Unsupported-institution requests -------
@api_router.post('/support/requests')
async def submit_support_request(payload: SupportRequest, current_user: dict = Depends(get_current_user)):
    doc = {
        'user_id': current_user['user_id'], 'user_email': current_user.get('email'),
        'institution': payload.institution.strip(),
        'notes': (payload.notes or '').strip(),
        'created_at': datetime.now(timezone.utc), 'status': 'open',
    }
    result = await db.support_requests.insert_one(doc)
    if email_ready():
        admin_email = os.getenv('SUPPORT_ADMIN_EMAIL') or _sender_admin_fallback()
        if admin_email:
            subject = f'[Jaleter] Institution request: {doc["institution"]}'
            text = f"User: {doc['user_email']}\nInstitution: {doc['institution']}\nNotes: {doc['notes'] or '(none)'}"
            html = f"<p>User: <strong>{doc['user_email']}</strong></p><p>Institution: <strong>{doc['institution']}</strong></p><p>Notes: {doc['notes'] or '(none)'}</p>"
            await send_email(admin_email, subject, html, text)
    return {'ok': True, 'request_id': str(result.inserted_id)}


def _sender_admin_fallback() -> Optional[str]:
    # Prefer explicit SUPPORT_ADMIN_EMAIL. Legacy SENDGRID_FROM_EMAIL kept as
    # a fallback for backwards compatibility with older environments.
    from_email = os.getenv('SENDGRID_FROM_EMAIL', '').strip()
    return from_email or None


@api_router.get('/support/requests')
async def list_support_requests(current_user: dict = Depends(get_current_user)):
    # Users see only their own requests. Admin dashboard would filter differently.
    cursor = db.support_requests.find({'user_id': current_user['user_id']}, {'_id': 0, 'user_id': 0}).sort('created_at', -1)
    return {'requests': [{**r, 'created_at': r['created_at'].isoformat() if isinstance(r.get('created_at'), datetime) else r.get('created_at')} async for r in cursor]}


# ------- Payments & Coaching (Stripe hosted checkout) -------
class CheckoutRequest(BaseModel):
    product: str  # 'coaching_session' | 'jaleter_premium'
    platform: str = 'mobile'  # 'mobile' | 'web'
    scheduled_at: Optional[str] = None  # ISO-8601, required when product == coaching_session


@api_router.get('/payments/products')
async def list_products():
    return {'products': [
        {'key': k, 'name': v['name'], 'amount': v['amount'], 'currency': v['currency'], 'kind': v['kind']}
        for k, v in PRODUCTS.items()
    ]}


@api_router.post('/payments/checkout')
async def payments_checkout(payload: CheckoutRequest, request: Request, current_user: dict = Depends(get_current_user)):
    if payload.product not in PRODUCTS:
        raise HTTPException(status_code=400, detail='Unknown product')
    platform = payload.platform if payload.platform in ('mobile', 'web') else 'mobile'

    # Determine origin for web return URLs (respect proxy headers set by the ingress)
    forwarded_proto = request.headers.get('x-forwarded-proto') or request.url.scheme
    forwarded_host = request.headers.get('x-forwarded-host') or request.headers.get('host') or ''
    origin = f'{forwarded_proto}://{forwarded_host}' if forwarded_host else ''

    booking = None
    if payload.product == 'coaching_session':
        try:
            booking = await pay_create_booking(db, current_user, payload.scheduled_at)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await pay_create_session(
            db, current_user, payload.product, platform, origin, booking=booking,
        )
    except Exception as e:
        logger.exception('Stripe checkout creation failed')
        raise HTTPException(status_code=502, detail=f'Payment provider error: {e}')

    return {**result, 'booking_id': booking['booking_id'] if booking else None}


@api_router.get('/payments/status/{session_id}')
async def payments_status(session_id: str, current_user: dict = Depends(get_current_user)):
    txn = await db.payment_transactions.find_one(
        {'session_id': session_id, 'user_id': current_user['user_id']},
        {'_id': 0},
    )
    if not txn:
        raise HTTPException(status_code=404, detail='Checkout session not found.')
    try:
        return await pay_fetch_status(db, session_id)
    except Exception as e:
        logger.exception('Stripe status lookup failed')
        raise HTTPException(status_code=502, detail=f'Payment provider error: {e}')


@api_router.get('/coaching/bookings')
async def coaching_bookings(current_user: dict = Depends(get_current_user)):
    rows = await pay_list_bookings(db, current_user['user_id'])
    return {'bookings': rows}


@api_router.get('/user/membership')
async def user_membership(current_user: dict = Depends(get_current_user)):
    return await pay_membership_status(db, current_user)


# Public download endpoint for Jaleter WordPress landing assets.
# Files live at /app/JALETER_* (project root). No auth — these are marketing assets.
from fastapi.responses import FileResponse as _FileResponse  # local alias, avoid top-level import churn
_ALLOWED_DOWNLOADS = {
    "wp-landing": ("/app/JALETER_WORDPRESS_LANDING.html", "text/html; charset=utf-8", "JALETER_WORDPRESS_LANDING.html"),
    "brand-guide": ("/app/JALETER_BRAND_STYLE_GUIDE.md", "text/markdown; charset=utf-8", "JALETER_BRAND_STYLE_GUIDE.md"),
    "readme": ("/app/JALETER_PACKAGE_README.md", "text/markdown; charset=utf-8", "JALETER_PACKAGE_README.md"),
    "package": ("/app/JALETER_PACKAGE.zip", "application/zip", "JALETER_PACKAGE.zip"),
}

@api_router.get("/download/{key}")
async def download_asset(key: str):
    entry = _ALLOWED_DOWNLOADS.get(key)
    if not entry:
        raise HTTPException(status_code=404, detail="Not found")
    path, media, filename = entry
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File missing")
    return _FileResponse(path, media_type=media, filename=filename)


# ============================================================================
# PLAID BANKING INTEGRATION
# ============================================================================
class PlaidExchangeRequest(BaseModel):
    public_token: str
    institution_name: Optional[str] = None
    institution_id: Optional[str] = None


def _plaid_webhook_url(request: Request) -> Optional[str]:
    """Best-effort public webhook URL derived from the incoming request."""
    forwarded_proto = request.headers.get('x-forwarded-proto') or request.url.scheme
    forwarded_host = request.headers.get('x-forwarded-host') or request.headers.get('host') or ''
    if not forwarded_host or 'localhost' in forwarded_host or '127.0.0.1' in forwarded_host:
        return None
    return f'{forwarded_proto}://{forwarded_host}/api/plaid/webhook'


async def _plaid_list_accounts_for_user(user_id: str) -> list[dict]:
    cursor = db.plaid_items.find({'user_id': user_id})
    items = await cursor.to_list(length=100)
    # Load user's overrides once so we can merge them onto every row.
    overrides_cursor = db.account_overrides.find({'user_id': user_id})
    override_map: dict[str, dict] = {}
    async for od in overrides_cursor:
        aid = od.get('account_id')
        if aid:
            override_map[aid] = od
    rows: list[dict] = []
    for item in items:
        item_id = item.get('item_id')
        try:
            token = plaid_service.decrypt(item['access_token_encrypted'])
            accts = await plaid_service.fetch_accounts(token)
        except PlaidError as e:
            rows.append({'link_id': item_id, 'org_name': item.get('institution_name'), 'error': str(e)})
            continue
        org_name = item.get('institution_name') or 'Bank'
        org_domain = item.get('institution_domain')
        last_sync = item.get('last_sync_at')
        for a in accts:
            balances = a.get('balances') or {}
            balance = balances.get('current')
            if balance is None:
                balance = balances.get('available') or 0
            try:
                balance = float(balance or 0)
            except (TypeError, ValueError):
                balance = 0.0
            plaid_type = a.get('type')
            plaid_subtype = a.get('subtype')
            auto_category = wealth_service.classify_plaid(plaid_type, plaid_subtype)
            auto_name = a.get('name') or a.get('official_name') or 'Account'
            account_id = a.get('account_id')
            eff_cat, eff_name, cat_over, name_over = wealth_service.merge_override(
                auto_category, auto_name, override_map.get(account_id or ''),
            )
            # Liability balances from Plaid can arrive as absolute values; we
            # normalise here so the frontend can render them as positive
            # magnitudes inside the correct section without guessing.
            display_balance = abs(balance) if wealth_service.is_liability(eff_cat) else balance
            rows.append({
                'link_id': item_id,
                'account_id': account_id,
                'name': eff_name,
                'auto_name': auto_name,
                'currency': balances.get('iso_currency_code') or 'USD',
                'balance': display_balance,
                'raw_balance': balance,
                'balance_date': None,
                'org_name': org_name,
                'org_domain': org_domain,
                'last_sync_at': last_sync.isoformat() if isinstance(last_sync, datetime) else last_sync,
                'mask': a.get('mask'),
                # Jaleter classification
                'category': eff_cat,
                'category_label': wealth_service.CATEGORY_LABELS.get(eff_cat, eff_cat),
                'auto_category': auto_category,
                'category_overridden': cat_over,
                'name_overridden': name_over,
                'is_asset': wealth_service.is_asset(eff_cat),
                'is_liability': wealth_service.is_liability(eff_cat),
                # Plaid metadata (kept so users can see the original classification)
                'plaid_type': plaid_type,
                'plaid_subtype': plaid_subtype,
                # Legacy fields — retained temporarily so existing frontend
                # code still works during Phase 2 rollout.
                'subtype': plaid_subtype,
                'type': plaid_type,
            })
    return rows


@api_router.get('/plaid/status')
async def plaid_status():
    return {
        'configured': plaid_service.is_configured(),
        'env': plaid_service.PLAID_ENV,
        'products': plaid_service.PLAID_PRODUCTS,
        'country_codes': plaid_service.PLAID_COUNTRY_CODES,
    }


@api_router.post('/plaid/link-token')
@limiter.limit('20/minute')
async def plaid_link_token(request: Request, current_user: dict = Depends(get_current_user)):
    webhook = _plaid_webhook_url(request)
    try:
        data = await plaid_service.create_link_token(current_user['user_id'], webhook_url=webhook)
    except PlaidError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return data


@api_router.post('/plaid/exchange-public-token')
async def plaid_exchange(payload: PlaidExchangeRequest, current_user: dict = Depends(get_current_user)):
    if not payload.public_token:
        raise HTTPException(status_code=400, detail='public_token is required')
    try:
        exchange = await plaid_service.exchange_public_token(payload.public_token)
    except PlaidError as e:
        raise HTTPException(status_code=502, detail=str(e))
    access_token = exchange['access_token']
    item_id = exchange['item_id']
    try:
        encrypted = plaid_service.encrypt(access_token)
    except PlaidError as e:
        raise HTTPException(status_code=500, detail=str(e))
    # Enrich institution info if id was provided
    inst_name = (payload.institution_name or '').strip() or None
    inst_domain = None
    if payload.institution_id:
        info = await plaid_service.fetch_institution(payload.institution_id)
        inst_name = inst_name or info.get('name')
        inst_domain = (info.get('url') or '').replace('https://', '').replace('http://', '').split('/', 1)[0] or None
    now = datetime.now(timezone.utc)
    await db.plaid_items.update_one(
        {'item_id': item_id},
        {'$set': {
            'user_id': current_user['user_id'],
            'item_id': item_id,
            'access_token_encrypted': encrypted,
            'institution_id': payload.institution_id,
            'institution_name': inst_name or 'Bank',
            'institution_domain': inst_domain,
            'cursor': '',
            'created_at': now,
            'updated_at': now,
            'last_sync_at': None,
        }},
        upsert=True,
    )
    return {'item_id': item_id, 'institution_name': inst_name or 'Bank'}


@api_router.get('/plaid/accounts')
async def plaid_accounts(current_user: dict = Depends(get_current_user)):
    rows = await _plaid_list_accounts_for_user(current_user['user_id'])
    return {'accounts': rows}


async def _plaid_sync_item(user_id: str, item: dict) -> dict:
    try:
        token = plaid_service.decrypt(item['access_token_encrypted'])
    except PlaidError as e:
        return {'item_id': item.get('item_id'), 'error': str(e)}
    try:
        result = await plaid_service.sync_transactions(token, item.get('cursor') or '')
    except PlaidError as e:
        return {'item_id': item.get('item_id'), 'error': str(e)}
    org_name = item.get('institution_name') or 'Bank'
    item_id = item['item_id']
    added = 0
    for txn in (result['added'] or []) + (result['modified'] or []):
        mapped = plaid_service.map_plaid_transaction(user_id, item_id, txn.get('account_id') or '', org_name, txn)
        try:
            up = await db.bank_transactions.update_one(
                {'user_id': mapped['user_id'], 'account_id': mapped['account_id'], 'external_id': mapped['external_id']},
                {'$set': mapped},
                upsert=True,
            )
            if up.upserted_id:
                added += 1
        except Exception as e:  # noqa: BLE001
            logger.warning('bank_transactions upsert failed (plaid): %s', e)
    for txn in result['removed'] or []:
        try:
            await db.bank_transactions.delete_one({
                'user_id': user_id, 'account_id': txn.get('account_id') or '', 'external_id': txn.get('transaction_id') or ''
            })
        except Exception as e:  # noqa: BLE001
            logger.warning('bank_transactions delete failed (plaid): %s', e)
    await db.plaid_items.update_one(
        {'item_id': item_id},
        {'$set': {'cursor': result['cursor'], 'last_sync_at': datetime.now(timezone.utc), 'updated_at': datetime.now(timezone.utc)}},
    )
    return {'item_id': item_id, 'synced': added}


@api_router.post('/plaid/sync')
async def plaid_sync(current_user: dict = Depends(get_current_user), item_id: Optional[str] = None):
    query: dict = {'user_id': current_user['user_id']}
    if item_id:
        query['item_id'] = item_id
    items = await db.plaid_items.find(query).to_list(length=50)
    results = []
    for item in items:
        results.append(await _plaid_sync_item(current_user['user_id'], item))
    total_added = sum(r.get('synced', 0) for r in results)
    return {'synced': total_added, 'items': results}


@api_router.delete('/plaid/item/{item_id}')
async def plaid_unlink(item_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.plaid_items.find_one({'item_id': item_id, 'user_id': current_user['user_id']})
    if not doc:
        raise HTTPException(status_code=404, detail='Linked item not found')
    # Best-effort remote revoke; we always delete locally.
    try:
        token = plaid_service.decrypt(doc['access_token_encrypted'])
        await plaid_service._post('/item/remove', {'access_token': token})
    except Exception as e:  # noqa: BLE001
        logger.info('plaid /item/remove failed (non-fatal): %s', e)
    await db.plaid_items.delete_one({'item_id': item_id, 'user_id': current_user['user_id']})
    # Cascade: remove every cached transaction that belonged to THIS item so
    # unlinking a bank actually wipes its data from the user's Reports/Budget.
    tx_del = await db.bank_transactions.delete_many({
        'user_id': current_user['user_id'],
        'link_id': item_id,
    })
    return {'ok': True, 'transactions_deleted': tx_del.deleted_count}


@api_router.post('/plaid/webhook')
async def plaid_webhook(request: Request):
    """Plaid webhook receiver — verifies signature, ACKs, then syncs.

    Signature verification (per Plaid docs — https://plaid.com/docs/api/webhooks/webhook-verification/):
      1. Read the `Plaid-Verification` header (a JWT signed with ES256).
      2. Decode the header without verifying to grab its `kid`.
      3. Fetch the public JWK for that `kid` from `/webhook_verification_key/get`.
         (Plaid rotates keys; we do not cache aggressively — 1 extra HTTP call per
         webhook is fine at our scale and avoids a stale-cache footgun.)
      4. Verify the JWT signature + `iat` freshness (< 5 min old).
      5. Confirm the body's SHA-256 hash matches the JWT's `request_body_sha256` claim.
      6. Only then process the event.

    Any verification failure returns 401 — we NEVER touch the DB for unverified
    webhooks (was the P3 IDOR-adjacent hardening item from the security audit).
    """
    raw_body = await request.body()
    verification_header = request.headers.get('plaid-verification') or ''
    if not verification_header:
        # Reject unauthenticated webhooks. In sandbox testing you can temporarily
        # comment this out; in production, this closes the P3 finding.
        raise HTTPException(status_code=401, detail='missing Plaid-Verification header')
    try:
        import jwt as pyjwt  # PyJWT — separate from python-jose used elsewhere.
        unverified_header = pyjwt.get_unverified_header(verification_header)
        kid = unverified_header.get('kid')
        alg = unverified_header.get('alg')
        if alg != 'ES256' or not kid:
            raise ValueError('unexpected JWT header')
        # Fetch the current signing key from Plaid.
        key_resp = await plaid_service._post('/webhook_verification_key/get', {'key_id': kid})
        jwk = key_resp.get('key')
        if not jwk:
            raise ValueError('no key returned from Plaid')
        from jwt.algorithms import ECAlgorithm
        public_key = ECAlgorithm.from_jwk(jwk)  # type: ignore[arg-type]
        claims = pyjwt.decode(verification_header, public_key, algorithms=['ES256'])
        # Freshness — reject if older than 5 min
        iat = int(claims.get('iat', 0))
        if iat <= 0 or (datetime.now(timezone.utc).timestamp() - iat) > 300:
            raise ValueError('webhook stale')
        # Body integrity — sha256 of raw body must match claim
        import hashlib
        body_hash = hashlib.sha256(raw_body).hexdigest()
        if claims.get('request_body_sha256') != body_hash:
            raise ValueError('body hash mismatch')
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.warning('plaid webhook verification failed: %s', e)
        raise HTTPException(status_code=401, detail='invalid webhook signature')

    try:
        payload = json.loads(raw_body.decode('utf-8'))
    except Exception:
        raise HTTPException(status_code=400, detail='invalid webhook body')
    item_id = payload.get('item_id')
    webhook_type = payload.get('webhook_type')
    if item_id and webhook_type in {
        'SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE',
        'HISTORICAL_UPDATE', 'TRANSACTIONS_REMOVED',
    }:
        item = await db.plaid_items.find_one({'item_id': item_id})
        if item:
            try:
                await _plaid_sync_item(item['user_id'], item)
            except Exception as e:  # noqa: BLE001
                logger.warning('plaid webhook sync failed: %s', e)
    return {'ok': True}


# ============================================================================
# CUSTOMER SUPPORT SYSTEM
# ============================================================================
@api_router.post('/support/tickets')
@limiter.limit('20/minute')
async def support_create_ticket(payload: TicketCreate, request: Request, current_user: dict = Depends(get_current_user)):
    return await support_service.create_ticket(db, current_user, payload)


@api_router.get('/support/tickets')
async def support_list_tickets(current_user: dict = Depends(get_current_user)):
    return {'tickets': await support_service.list_user_tickets(db, current_user)}


@api_router.get('/support/tickets/{ticket_id}')
async def support_get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    return await support_service.get_ticket_for_user(db, current_user, ticket_id)


@api_router.post('/support/tickets/{ticket_id}/reply')
@limiter.limit('30/minute')
async def support_reply_ticket(ticket_id: str, payload: ReplyCreate, request: Request, current_user: dict = Depends(get_current_user)):
    return await support_service.add_user_reply(db, current_user, ticket_id, payload)


# ---- Admin endpoints -------------------------------------------------------
@api_router.get('/support/admin/tickets')
async def support_admin_list(current_user: dict = Depends(get_current_user), status_filter: Optional[str] = None, limit: int = 100):
    return {'tickets': await support_service.admin_list_tickets(db, current_user, status=status_filter, limit=limit)}


@api_router.get('/support/admin/tickets/{ticket_id}')
async def support_admin_get(ticket_id: str, current_user: dict = Depends(get_current_user)):
    return await support_service.admin_get_ticket(db, current_user, ticket_id)


@api_router.patch('/support/admin/tickets/{ticket_id}')
async def support_admin_update(ticket_id: str, payload: AdminUpdate, current_user: dict = Depends(get_current_user)):
    return await support_service.admin_update_ticket(db, current_user, ticket_id, payload)


@api_router.post('/support/admin/tickets/{ticket_id}/reply')
async def support_admin_reply(ticket_id: str, payload: ReplyCreate, current_user: dict = Depends(get_current_user)):
    return await support_service.admin_add_reply(db, current_user, ticket_id, payload, private=False)


@api_router.post('/support/admin/tickets/{ticket_id}/note')
async def support_admin_note(ticket_id: str, payload: AdminNoteCreate, current_user: dict = Depends(get_current_user)):
    reply_payload = ReplyCreate(message=payload.note)
    return await support_service.admin_add_reply(db, current_user, ticket_id, reply_payload, private=True)


# ------------------------------------------------------------------
# Coach AI — GPT 5.6 Terra via Emergent LLM Key
# ------------------------------------------------------------------
import coach_ai_service
import wealth_service


class CoachChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    context: Optional[dict] = None
    session_id: Optional[str] = None


@api_router.post('/coach/chat')
@limiter.limit('20/minute')
async def coach_chat(request: Request, payload: CoachChatRequest, current_user: dict = Depends(get_current_user)):
    """Ask Jaleter Coach a question. Multi-turn — pass the same session_id
    (or omit to get the user's default one) to maintain history.

    Persists the user turn AND the assistant turn in `coach_messages` so the
    frontend can render history on cold start."""
    user_id = current_user['user_id']
    session_id = (payload.session_id or coach_ai_service.default_session_id(user_id)).strip()
    now = datetime.now(timezone.utc)
    # Fetch PRIOR conversation (before we insert the new user turn) so we can
    # replay it into the model — emergentintegrations LlmChat is stateless per
    # request, so we must inline history ourselves for multi-turn continuity.
    prior_cursor = db.coach_messages.find(
        {'user_id': user_id, 'session_id': session_id},
        {'_id': 0, 'role': 1, 'content': 1, 'created_at': 1},
    ).sort('created_at', 1).limit(40)
    prior_history: list[dict] = []
    async for m in prior_cursor:
        prior_history.append({'role': m.get('role'), 'content': m.get('content')})
    # Store user message first (so history survives if the LLM call fails).
    await db.coach_messages.insert_one({
        'session_id': session_id,
        'user_id': user_id,
        'role': 'user',
        'content': payload.message,
        'created_at': now,
    })
    try:
        answer = await coach_ai_service.chat_answer(
            session_id=session_id,
            user_id=user_id,
            message=payload.message,
            context=payload.context or {},
            history=prior_history,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error('coach chat failed for %s: %s', user_id, exc)
        # Roll back the orphaned user turn so history stays clean.
        try:
            await db.coach_messages.delete_one({
                'session_id': session_id, 'user_id': user_id,
                'role': 'user', 'content': payload.message, 'created_at': now,
            })
        except Exception:
            pass
        raise HTTPException(status_code=502, detail='Coach is temporarily unavailable. Please try again.')
    await db.coach_messages.insert_one({
        'session_id': session_id,
        'user_id': user_id,
        'role': 'assistant',
        'content': answer,
        'created_at': datetime.now(timezone.utc),
    })
    return {'session_id': session_id, 'answer': answer, 'model': coach_ai_service.MODEL_NAME}


@api_router.get('/coach/history')
async def coach_history(session_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    user_id = current_user['user_id']
    sid = (session_id or coach_ai_service.default_session_id(user_id)).strip()
    cursor = db.coach_messages.find(
        {'user_id': user_id, 'session_id': sid},
        {'_id': 0, 'user_id': 0},
    ).sort('created_at', 1).limit(200)
    messages = []
    async for m in cursor:
        if isinstance(m.get('created_at'), datetime):
            m['created_at'] = m['created_at'].isoformat()
        messages.append(m)
    return {'session_id': sid, 'messages': messages, 'model': coach_ai_service.MODEL_NAME}


@api_router.post('/coach/reset')
@limiter.limit('10/minute')
async def coach_reset(request: Request, current_user: dict = Depends(get_current_user)):
    """Start a fresh chat — deletes the current default-session history."""
    user_id = current_user['user_id']
    sid = coach_ai_service.default_session_id(user_id)
    await db.coach_messages.delete_many({'user_id': user_id, 'session_id': sid})
    return {'ok': True, 'session_id': sid}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
