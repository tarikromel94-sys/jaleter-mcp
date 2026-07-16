# Jaleter — Smart Budgeting (Expo Port)

## Overview
1:1 port of the user's Jaleter React web app to an Expo React Native mobile app, extended with full auth, forgot-password, banking-data providers, file import and support requests.

## Providers (Modular Financial Data Layer)
Abstract `Provider` interface at `/app/backend/providers/base.py`. Registry at `/app/backend/providers/__init__.py`.

| Provider | Kinds | Status | Path |
|---|---|---|---|
| **SimpleFIN** | checking / savings / credit / loan | LIVE (real Bridge demo verified) | `simplefin_service.py` |
| **SnapTrade** | brokerage / retirement / investment | INERT — activates when `SNAPTRADE_CLIENT_ID` + `SNAPTRADE_CONSUMER_KEY` set | `providers/snaptrade_provider.py` |
| **File** | csv / ofx / qfx / qbo | LIVE (multipart upload, ofxparse + csv) | `providers/file_provider.py` |

MX / Finicity can drop in by implementing the same interface — no user-facing changes needed.

## Backend Endpoints
### Auth (from earlier iterations)
- `POST /api/auth/register|login|logout|forgot-password|reset-password|emergent/session`
- `GET  /api/auth/me`

### Accounts (this iteration + previous)
- `GET  /api/providers` — public catalog
- `POST /api/accounts/link` — modular router (rate-limited 10/min)
- `POST /api/accounts/simplefin/link` — direct SimpleFIN legacy path
- `GET  /api/accounts` — SimpleFIN balances only (filters by `provider: simplefin`)
- `POST /api/accounts/sync` — SimpleFIN refresh (also filters)
- `DELETE /api/accounts/link/{link_id}` — unlink
- `POST /api/accounts/import` — multipart CSV/OFX/QFX/QBO upload with column detection, dedup, auto-categorization, balance calc
- `GET  /api/accounts/all` — combined SimpleFIN + File + SnapTrade rows (SnapTrade skipped if inert)
- `GET  /api/accounts/transactions?limit=N` — normalized transaction list

### Support
- `POST /api/support/requests` — user requests an unsupported institution; if SendGrid is configured, admin is also emailed
- `GET  /api/support/requests` — user's own requests

## MongoDB Collections
- `users`, `user_sessions`, `password_resets`
- `linked_accounts` (indexed on `user_id`; secondary on `user_id + provider`)
- `bank_transactions` (unique on `user_id+account_id+external_id`; secondary on `user_id+provider+external_id` for file dedup, and `user_id+date`)
- `snaptrade_users`, `snaptrade_accounts`
- `support_requests`

## Env (`/app/backend/.env`)
- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- `SIMPLEFIN_ENC_KEY` (Fernet — encrypts Access URLs at rest)
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` (empty = dev-fallback)
- `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` (empty = inert)

## Frontend
- `/app/frontend/app/index.tsx` — full app (all screens + state machine)
- `/app/frontend/src/AuthContext.tsx` — auth + `apiCall` helper
- `/app/frontend/src/quoteLibrary.ts`, `/app/frontend/src/jaleterTheme.ts`
- `/app/frontend/app/_layout.tsx` — Playfair Display + icon prewarm

### Screens
Welcome → Onboarding → Signup / Login / Forgot / Reset → FirstConnect (SimpleFIN or skip) → Paywall → App (Home, Budget, Transactions, Net Worth, More → Legacy/Coaching/Membership/Settings)

### Settings → Linked Accounts (new)
Three-option menu:
1. Connect a bank via SimpleFIN
2. Upload CSV / OFX / QFX / QBO (via `expo-document-picker`)
3. Request an unsupported institution

### Net Worth Assets
Seeded sample rows (Cash, Investments, Real Estate, Vehicles) are now APPENDED with real linked-account balances from `GET /api/accounts/all`. Icons per provider (link / trending-up / document-attach). Total updates automatically.

## Docs
- `/app/memory/test_credentials.md` — test credentials + endpoint reference
- Backend tests: `/app/backend/tests/test_providers.py`, `test_regression_fixes.py`, `test_password_reset.py`, `test_backend_auth.py`, `test_simplefin.py`
