from fastapi import FastAPI, APIRouter, HTTPException, Request, status, Depends
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import jwt, JWTError
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import uuid
import secrets
import logging
import httpx

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# IMPORTANT: load .env BEFORE importing modules that read env at module level
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from email_service import build_password_reset_email, is_configured as sendgrid_ready, send_email
from simplefin_service import (
    SimpleFinError,
    claim_setup_token,
    decrypt as sf_decrypt,
    encrypt as sf_encrypt,
    fetch_accounts as sf_fetch_accounts,
    map_transaction as sf_map_transaction,
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
limiter = Limiter(key_func=get_remote_address, default_limits=[])

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


@app.on_event('shutdown')
async def _shutdown():
    client.close()


# ------- Routes -------
@api_router.get('/')
async def root():
    return {'message': 'Jaleter API', 'status': 'ok'}


@api_router.post('/auth/register', response_model=AuthResponse)
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
        'created_at': datetime.now(timezone.utc),
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id)
    doc.pop('_id', None)
    return AuthResponse(user=public_user(doc), token=token)


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

    if sendgrid_ready():
        subject, html_body, text_body = build_password_reset_email(user.get('name', ''), token)
        sent, detail = send_email(email, subject, html_body, text_body)
        logger.info('Password reset email %s for %s (%s)', 'sent' if sent else 'FAILED', email, detail)
        return {'ok': True, 'delivered': sent, 'via': 'sendgrid'}

    # Preview fallback: SendGrid not configured. Return the token so the UI
    # flow still works. This branch MUST become unreachable once
    # SENDGRID_API_KEY + SENDGRID_FROM_EMAIL are set in production.
    logger.warning('SENDGRID not configured; returning reset token in response (dev only). Set SENDGRID_API_KEY+SENDGRID_FROM_EMAIL in /app/backend/.env to enable email delivery.')
    return {
        'ok': True,
        'delivered': False,
        'reset_token': token,
        'via': 'dev-fallback',
        'note': 'SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL in backend/.env to email reset tokens.',
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
    return {'accounts': combined}


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
    if sendgrid_ready():
        admin_email = os.getenv('SUPPORT_ADMIN_EMAIL') or _sender_admin_fallback()
        if admin_email:
            subject = f'[Jaleter] Institution request: {doc["institution"]}'
            text = f"User: {doc['user_email']}\nInstitution: {doc['institution']}\nNotes: {doc['notes'] or '(none)'}"
            html = f"<p>User: <strong>{doc['user_email']}</strong></p><p>Institution: <strong>{doc['institution']}</strong></p><p>Notes: {doc['notes'] or '(none)'}</p>"
            send_email(admin_email, subject, html, text)
    return {'ok': True, 'request_id': str(result.inserted_id)}


def _sender_admin_fallback() -> Optional[str]:
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
        if not payload.scheduled_at:
            raise HTTPException(status_code=400, detail='scheduled_at is required for coaching sessions.')
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
