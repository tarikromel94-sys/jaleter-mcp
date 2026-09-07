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
- Admin gating: `users.is_admin === true`. Seed admin (email + password) is provisioned idempotently on backend startup via `SUPPORT_ADMIN_EMAIL` and `SUPPORT_ADMIN_PASSWORD` env vars — credentials are never committed to source. See `/app/memory/test_credentials.md` (git-ignored) for local dev credentials.

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
  - Hub with GET-HELP grid (Bank Help Center / Report a Bug / Billing Help / Privacy Request) + general Contact Support + My Requests
  - Structured forms: Bug (summary/steps/expected/actual + auto device+version), Privacy (4-option radio), Billing (issue type + amount/ref + jaleter.com deep link), Bank Help Center (Plaid tip + CSV/OFX tip + 11 per-bank guides + open-ticket CTA)
  - Delete Account moved OUT of Support (June 2026): now a prominent button in Settings → Danger Zone (below Log Out) that opens the DeleteAccountMode sheet (password re-auth + typed DELETE → immediate `DELETE /api/auth/delete-account` cascade). Support FAQ updated to point there.
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
Welcome → Onboarding → Signup / Login / Forgot / Reset → Membership Required paywall → App (Home, Budget, Transactions, Net Worth, More → Legacy/Coaching/Membership/Settings)

## Hard Server-Side Membership Paywall (June 2026)- Access model: app is free to download; ALL financial features require an active $90/yr Stripe membership (hard paywall for everyone, user-confirmed).
- Backend is source of truth: `require_active_membership` (402) now protects ~18 financial routes (accounts, transactions, sync, statement import/preview, manual accounts, overrides, Plaid, net worth history, Coach AI, notification evaluators). Admin bypass retained. `trialing` now counts as entitled alongside `active`/`past_due`; cancel keeps access until period end.
- Open routes (login only): auth, /user/membership, payments (checkout/webhook/portal/cancel/resume), support, notifications prefs/inbox, coaching bookings, reset-data, delete-account.
- Frontend: "Unlock Jaleter" Membership Required screen (no bypass) — benefits list, "Continue to Jaleter.com" (backend-created user-linked Stripe Checkout; fallback opens EXPO_PUBLIC_JALETER_SUBSCRIPTION_URL), "Refresh Membership", "Already a member? Sign in" (switch account). FirstConnect onboarding screen removed.
- Routing: every login/signup/session-restore calls GET /api/user/membership → active = dashboard, inactive = paywall. Cached verdict (`jaleter-membership-v1`) only speeds startup; server always re-validates. Any 402 anywhere kicks the app back to the paywall via a global handler in AuthContext.callApi.
- Paywall UX polish (June 2026, user-requested): footer shows "Signed in as {email}" + "Not you? Sign out" (testID paywall-signout) — never "Already a member? Sign in" since the screen only renders for authenticated users. AppState foreground listener auto-rechecks membership (pay on jaleter.com → return → auto-unlock; Refresh Membership is backup only). MainApp holds a splash (testID membership-routing) whenever a signed-in user is on any non-app/non-paywall stage so members never glimpse Welcome/Login.

### Settings → Linked Accounts (new)
Three-option menu:
1. Connect a bank via SimpleFIN
2. Upload CSV / OFX / QFX / QBO (via `expo-document-picker`)
3. Request an unsupported institution

### Net Worth Assets
Seeded sample rows (Cash, Investments, Real Estate, Vehicles) are now APPENDED with real linked-account balances from `GET /api/accounts/all`. Icons per provider (link / trending-up / document-attach). Total updates automatically.

## Code Architecture (post L2 modularization, June 2026)
- `frontend/app/index.tsx` reduced 6,733 → ~1,050 lines: only App root + MainApp orchestrator (state, persistence, membership routing, 402 handler).
- Extracted verbatim: `src/screens/AppLockScreens.tsx` (AppLockGate/ForgotPinModal/AppLockConfigure/loadAppLock), `AuthScreens.tsx` (Welcome/Onboarding/Signup/Login/Forgot/Reset), `PaywallScreen.tsx` (Paywall), `HomeScreen.tsx`, `BudgetScreen.tsx` (BudgetScreen+BudgetGrid+xlsx/csv exports), `TransactionsScreen.tsx` (TransactionsScreen + exported TxForm), `LegacyScreen.tsx`, `MoreScreens.tsx` (Coaching/Membership/More), `SettingsScreen.tsx` (Settings+ResetAppDataModal+LegalSheet+NotificationsSheet+AccountLinkSheet+pickAndImport); `src/components/BottomNav.tsx`, `BillingWebsiteNotice.tsx`; `src/hooks/usePayment.ts` (usePayment+formatBookingDate); `src/utils/budgetModel.ts` (Tx/Category types + seed data + month/allocation math), `legacyMath.ts` (DEFAULT_LEGACY_RATE/hypoContributions/longTermInvestment). Sparkle moved into appShared.
- Deleted dead code: BackgroundArtwork, GoldRibbon, shortTermCash, upcomingCoachingSlots, CALENDLY_URL. Fixed latent missing Platform/Alert imports in NetWorthScreen.
- Known pre-existing tsc type errors (runtime-safe, predate refactor): hypoFrequency literal in index.tsx, expo-file-system cacheDirectory/EncodingType typings + t.textInk in BudgetScreen.

## Membership Welcome/Receipt Email (June 2026)
- `build_membership_welcome_email` (email_service.py) — branded "Welcome to Jaleter — your membership is active ✦" with receipt card ($ amount from Stripe price, period-end date, sub reference), benefits list, billing management links.
- `_send_welcome_email` called from `_apply_subscription` (stripe_service.py) when status becomes active/trialing — once per customer via `users.membership_welcome_email_at` flag (webhook replays, renewals, reconciles never re-send; past_due never triggers). Fires through BOTH the webhook path and the ?refresh=1 reconcile path.

## Billing Lapse Emails (June 2026)- `invoice.payment_failed` webhook → `_send_payment_failed_email` (stripe_service.py): friendly Resend email via `build_payment_failed_email` (email_service.py) with amount, retry date, jaleter.com/billing CTA; throttled to 1 per 20h via `users.last_payment_failed_email_at`; access retained during past_due grace.

## Budget/Legacy/Keyboard fixes (June 2026)
- Budget status convention (everywhere): Actual < Budget = under; Actual = Budget = "On Budget/Fully Used" (amber 100% badge, never OVER); Actual > Budget = Over (red). Applied to sub badge, category bar (BudgetScreen 996/1035), and backend push alerts (budget_alert_service: "Budget fully used" vs "Budget exceeded", $0.005 tolerance).
- Legacy BUILD (and Home BUILD preview) start from Available Cash = Total Cash − Set Aside (props `availableCash`); chip label "AVAILABLE CASH"; drill-down row "Available Cash (Total − Set Aside)". Set Aside buckets are a subset of Total Cash — never double-counted.
- Keyboard UX: react-native-keyboard-controller@1.18.5 (bundled in Expo Go SDK 54). KeyboardProvider wraps root Stack (_layout.tsx); shared `Sheet` (appShared) uses KeyboardAwareScrollView bottomOffset=24 → covers ALL amount sheets (Budget set, TxForm, Wealth buckets/manual accounts/investments, Legacy contrib/hypo); LegacyScreen main scroll is KeyboardAwareScrollView bottomOffset=90 for inline age inputs. No-op on web. Real-device validation pending (user, iPhone).

## Membership payment resilience (June 2026, post double-charge incident)
- Incident: user paid twice in prod (webhooks not reaching prod backend — placeholder STRIPE_WEBHOOK_SECRET). Remediation: duplicate sub canceled + $90 refunded via live Stripe API; kept sub active → 2027-09-06.
- `reconcile_membership_from_stripe` (stripe_service.py): queries Stripe directly, ranks subs (active>trialing>past_due>incomplete>paused), applies best. Used by `GET /user/membership?refresh=1` (Refresh button + paywall mount/foreground) and the checkout duplicate guard → missed webhooks self-heal.
- Duplicate guard in POST /payments/checkout (jaleter_premium): returns {already_active:true} or {processing:true} instead of a second Checkout session.
- ACH/bank-debit "Payment Processing": users.membership_processing set on checkout.session.completed w/ payment_status unpaid; cleared by checkout.session.async_payment_succeeded / async_payment_failed / invoice.paid. /user/membership exposes `processing`. Paywall shows amber processing card + disabled pay button.
- Stripe Dashboard webhook events required in PROD: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed → endpoint https://no-changes-mobile.emergent.host/api/payments/webhook; STRIPE_WEBHOOK_SECRET must be real in prod env.

## Apple Sign-In (RESTORED June 2026)
- User enabled the capability on App ID com.emergent.nochangesmobile.fl0fmc (active App Store profile includes the entitlement, exp. 2027-08-25).
- app.json: `ios.usesAppleSignIn: true`; `expo-apple-authentication@8.0.8`; AppleSignInButton (AuthScreens.tsx, shown on Signup + Login, iOS-native only); `loginWithApple` in AuthContext → `POST /api/auth/apple` (backend verifies identity token vs Apple JWKS). Satisfies Apple Guideline 5.1.1(v) alongside Google Sign-In. Needs TestFlight build for end-to-end validation.

## Reset App Data vs Delete Account (updated June 2026)
- Reset (POST /user/reset-data): keeps login/Plaid/subscription; wipes user-scoped: bank_transactions, transactions, budgets/cells/categories/income_sources, goals, restricted_buckets (Set Aside), account_overrides, **manual_accounts**, **net_worth_snapshots**, coach_messages, reclassify_runs, legacy_snapshots, digests/alerts/notifications, import_mappings + unsets finalized_budget_months/wealth_overrides/legacy_state. (June 2026 fix: manual_accounts was missing → manual investment survived reset.)
- Delete Account cascade now also purges manual_accounts, net_worth_snapshots, restricted_buckets, reclassify_runs (plus everything it already removed: Stripe cancel, Plaid revoke, all user-scoped collections, sessions, user doc → anonymized billing_receipts).

## Wealth Cash Policy + Import Delete (Sept 2026)
- Total Cash = manual cash (user-entered 'cash' asset row in Wealth) + Plaid/linked cash ONLY. Activity/manual/imported transactions NEVER move Wealth cash (removed the old income−expense "syncedCash"). Statement-import (provider 'file') rows are excluded from all Wealth aggregations (dedupedLinked filter) — imports feed Activity/Budget/Reports only, but still appear under Settings → Linked Accounts.
- DELETE /accounts/link/{link_id}: string link_ids (file/snaptrade) route through provider.unlink (file provider also deletes that import's bank_transactions); ObjectId fallback for legacy SimpleFIN rows. Previously 400'd on file links (ObjectId parse) — that was the broken trash button.

## Docs
- `/app/memory/test_credentials.md` — test credentials + endpoint reference
- Backend tests: `/app/backend/tests/test_providers.py`, `test_regression_fixes.py`, `test_password_reset.py`, `test_backend_auth.py`, `test_simplefin.py`
