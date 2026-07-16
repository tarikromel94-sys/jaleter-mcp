from fastapi import FastAPI, APIRouter, HTTPException, Request, status, Depends
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
import logging
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = 'HS256'
JWT_EXPIRE_MIN = int(os.environ.get('ACCESS_TOKEN_EXPIRE_MINUTES', '10080'))
EMERGENT_SESSION_URL = 'https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data'

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

pwd_ctx = CryptContext(schemes=['bcrypt'], deprecated='auto')

app = FastAPI()
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


@app.on_event('shutdown')
async def _shutdown():
    client.close()


# ------- Routes -------
@api_router.get('/')
async def root():
    return {'message': 'Jaleter API', 'status': 'ok'}


@api_router.post('/auth/register', response_model=AuthResponse)
async def register(payload: RegisterRequest):
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
async def login(payload: LoginRequest):
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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
