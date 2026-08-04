# Jaleter — Smart Budgeting (Expo Port)

## Overview
1:1 port of the user's Jaleter React web app to an Expo React Native mobile app, extended with full auth, forgot-password, banking-data providers, file import and support requests.

## Providers (Modular Financial Data Layer)
Abstract `Provider` interface at `/app/backend/providers/base.py`. Registry at `/app/backend/providers/__init__.py`.

| Provider | Kinds | Status | Path |
|---|---|---|---|
| **Plaid** | checking / savings / credit / loan | LIVE (sandbox — real link tokens issued, 48 sandbox tx synced in tests) | `plaid_service.py` |
| **SimpleFIN** | checking / savings / credit / loan | LIVE backend, hidden in UI (migration to Plaid) | `simplefin_service.py` |
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
- `POST /api/support/requests` — user requests an unsupported institution (legacy path; still used for institution requests)
- `GET  /api/support/requests` — user's own institution requests

### Support Ticketing (Phase 1 — new)
- `POST /api/support/tickets` — create ticket `{subject, category, priority, description, attachments[]}`; attachments are base64 (PNG/JPEG/PDF, ≤5 MB each). Ticket-numbers auto-increment via `support_counters`.
- `GET  /api/support/tickets` — user's own tickets (list, no bodies)
- `GET  /api/support/tickets/{id}` — full detail (private admin notes stripped)
- `POST /api/support/tickets/{id}/reply` — user reply (auto-transitions `waiting_on_user`/`resolved` → `in_progress`)
- `GET  /api/support/admin/tickets[?status_filter=…]` — admin dashboard list (all users)
- `GET  /api/support/admin/tickets/{id}` — admin detail (includes private notes)
- `PATCH /api/support/admin/tickets/{id}` — update `status` / `priority` / `assigned_to`
- `POST /api/support/admin/tickets/{id}/reply` — public admin reply (auto-transitions → `waiting_on_user`)
- `POST /api/support/admin/tickets/{id}/note` — private admin-only note
- Admin gating: `users.is_admin === true`. Seed user `support@jaleter.com / Tarik0731!` is created idempotently on backend startup.

### Plaid (new)
- `GET  /api/plaid/status` — public status (configured/env/products/country_codes)
- `POST /api/plaid/link-token` — issues a short-lived `link_token` (rate-limited 20/min)
- `POST /api/plaid/exchange-public-token` — swaps `public_token` for a Fernet-encrypted `access_token` stored in `plaid_items`
- `GET  /api/plaid/accounts` — returns accounts across all Plaid items (balances, name, mask, subtype)
- `POST /api/plaid/sync[?item_id=…]` — runs `/transactions/sync` pagination + cursor persistence; upserts into `bank_transactions` with `provider:'plaid'`; deletes removed txns
- `DELETE /api/plaid/item/{item_id}` — best-effort remote `/item/remove` + local delete
- `POST /api/plaid/webhook` — accepts Plaid webhooks; background-syncs items on `SYNC_UPDATES_AVAILABLE`, `DEFAULT_UPDATE`, `TRANSACTIONS_REMOVED`, etc.

## Screens
- Auth (login/register/reset)
- Home, Budget (3-col + yearly), Transactions, Legacy, More
- Legacy: 8 timeframes (1/2/3/5/10/20/**30**yr + Retirement) + **cumulative year-by-year toggle**. State (timeframe/contribution/hypothetical/cumulative) is persisted via STORAGE_KEY.
- **Reports** (new, from More): window pills (1M/3M/6M/12M/YTD/All) + INCOME/EXPENSE/NET tiles + 5 sections: Income vs Expense pie, Category pie, Top subcategories bars, Monthly trend chart, Top merchants list. Hand-rolled SVG charts via `react-native-svg` — zero extra deps.
- Settings + **Help & Support** sheet — Phase 1-4 complete:
  - Hub with GET-HELP grid (Bank Help Center / Report a Bug / Billing Help / Privacy Request / Delete Account) + general Contact Support + My Requests
  - Structured forms: Bug (summary/steps/expected/actual + auto device+version), Privacy (4-option radio), Delete Account (typed DELETE confirmation → ticket with 30-day process disclosure), Billing (issue type + amount/ref + jaleter.com deep link), Bank Help Center (Plaid tip + CSV/OFX tip + 11 per-bank guides + open-ticket CTA)
  - Admin dashboard (list, filter by status, PATCH status/priority/assignee, public reply, private notes)

## MongoDB Collections
- `users` (now includes `is_admin: bool`), `user_sessions`, `password_resets`
- `linked_accounts` (SimpleFIN), `plaid_items` (unique on `item_id`, indexed on `user_id`)
- `bank_transactions` (unique on `user_id+account_id+external_id`; secondary on `user_id+provider+external_id`, and `user_id+date`)
- `snaptrade_users`, `snaptrade_accounts`
- `support_requests` (legacy institution requests)
- `support_tickets` (unique on `ticket_id`; secondary on `user_id+created_at`, `status+created_at`)
- `support_counters` (auto-incrementing ticket numbers)

## Env (`/app/backend/.env`)
- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRE_MINUTES`
- `SIMPLEFIN_ENC_KEY` (Fernet — encrypts SimpleFIN Access URLs and, by fallback, Plaid access tokens)
- `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET`, `PLAID_ENV=sandbox`, `PLAID_PRODUCTS=auth,transactions`, `PLAID_COUNTRY_CODES=US`
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
