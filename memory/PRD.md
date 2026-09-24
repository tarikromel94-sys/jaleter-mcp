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
- Web membership page (June 2026, user-requested): new expo-router route `app/membership.tsx` (web-only; native redirects to `/`). Flow: Signup (default, toggle to Login/Forgot/Reset — reuses AuthScreens) → server membership check (`/api/user/membership?refresh=1`) → non-members see the Stripe Paywall → members see a dark/gold "You're all set" screen (download app + sign in with same email → auto-recognized; Manage Billing / Support / Sign Out links). Intended to be linked from jaleter.com or used as jaleter.com/membership on a custom domain.
- Deployment health check (June 2026): PASS. Fixes applied for readiness: App Review seed credentials moved from hardcoded server.py values to backend/.env (APP_REVIEW_EMAIL / APP_REVIEW_PASSWORD — seeding skips gracefully if unset; keep these env vars in the deploy config so the review account persists in prod); openpyxl added to backend/requirements.txt (XLSX statement import); HomeScreen unescaped-apostrophe ESLint errors fixed.
- IAP pricing (June 2026): RevenueCat $rc_annual updated to $89.99/P1Y via integration proxy (was $90); paywall fallback strings now $89.99. KNOWN COSMETIC LIMIT: the RevenueCat Test Store product (web preview/Expo Go only) always displays $79.99 regardless of proxy upserts — real iOS/Android builds display the true localized ASC/Play price. PRODUCT ID CONFLICT: user wants store product id `jaleter_premium_annual` but Emergent-managed RevenueCat auto-generated `prodd4613e9ecb` (+ Apple/Play mirrors) and the proxy cannot set custom IDs — user must create ASC/Play products matching the IDs shown in the RC dashboard (Option A) or manually swap products in the RC dashboard (Option B). Full store checklist: /app/memory/WHAT_TARIK_NEEDS_TO_DO_NEXT.md.
- Paywall brand typography (June 2026, user-requested): wordmark ("Jaleter" title-case), H1 and plan price on PaywallScreen use PlayfairDisplay (F.serifBold from jaleterTheme) to match the brand kit; body/feature text stays system sans.
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
- Sept 2026 rejection FINAL root cause: jwt.decode(audience=<list>) raised 'audience must be a string or None' — fixed with verify_aud=False + manual allow-list check (str/list aud), friendly user-facing error. Also earlier: prod env missing APPLE_AUDIENCES → /auth/apple 500 "not configured". Fixed: code defaults to ['com.emergent.nochangesmobile.fl0fmc','host.exp.Exponent'] (env overrides). No redirect URI needed (native flow). Hide My Email (private relay) + returning users (apple_sub lookup) handled.

## Apple App Review Account (Sept 2026)
- Jaleter.appreview@gmail.com / Jaleter029496! (Apple AND Google review) — idempotently seeded on every backend startup with permanent premium (subscription_status active, period end 2099, is_review_account flag). Same server-side entitlement path as real members (no bypass code). Checkout returns already_active → reviewers never see Stripe. Survives Delete Account (re-seeded on boot). Documented in APP_REVIEW_KIT.md + test_credentials.md.- User enabled the capability on App ID com.emergent.nochangesmobile.fl0fmc (active App Store profile includes the entitlement, exp. 2027-08-25).
- app.json: `ios.usesAppleSignIn: true`; `expo-apple-authentication@8.0.8`; AppleSignInButton (AuthScreens.tsx, shown on Signup + Login, iOS-native only); `loginWithApple` in AuthContext → `POST /api/auth/apple` (backend verifies identity token vs Apple JWKS). Satisfies Apple Guideline 5.1.1(v) alongside Google Sign-In. Needs TestFlight build for end-to-end validation.

## Reset App Data vs Delete Account (updated June 2026)
- Reset (POST /user/reset-data): keeps login/Plaid/subscription; wipes user-scoped: bank_transactions, transactions, budgets/cells/categories/income_sources, goals, restricted_buckets (Set Aside), account_overrides, **manual_accounts**, **net_worth_snapshots**, coach_messages, reclassify_runs, legacy_snapshots, digests/alerts/notifications, import_mappings + unsets finalized_budget_months/wealth_overrides/legacy_state. (June 2026 fix: manual_accounts was missing → manual investment survived reset.)
- Delete Account cascade now also purges manual_accounts, net_worth_snapshots, restricted_buckets, reclassify_runs (plus everything it already removed: Stripe cancel, Plaid revoke, all user-scoped collections, sessions, user doc → anonymized billing_receipts).

## Wealth Cash Policy + Import Delete (Sept 2026)
- Total Cash = manual cash (user-entered 'cash' asset row in Wealth) + Plaid/linked cash ONLY. Activity/manual/imported transactions NEVER move Wealth cash (removed the old income−expense "syncedCash"). Statement-import (provider 'file') rows are excluded from all Wealth aggregations (dedupedLinked filter) — imports feed Activity/Budget/Reports only, but still appear under Settings → Linked Accounts.
- DELETE /accounts/link/{link_id}: string link_ids (file/snaptrade) route through provider.unlink (file provider also deletes that import's bank_transactions); ObjectId fallback for legacy SimpleFIN rows. Previously 400'd on file links (ObjectId parse) — that was the broken trash button.

## Google Play US External Content Links (Sept 2026)
- Owner chose to ENROLL in Google's US External Content Links program (Play Console action, user-side) and keep the Stripe link-out. From Oct 1, 2026: transaction reporting + ~10% service fee on Android-originated sales.
- Code readiness: checkout sends exact Platform.OS → `origin_platform` stored on payment_transactions + Stripe session metadata (query Stripe by metadata.origin_platform='android' for reporting). Link opens in system browser/Custom Tabs (compliant). Possible future requirement: Play Billing Library external-offers dialog API (native module) if Google review demands it.

## Docs
- `/app/memory/test_credentials.md` — test credentials + endpoint reference
- Backend tests: `/app/backend/tests/test_providers.py`, `test_regression_fixes.py`, `test_password_reset.py`, `test_backend_auth.py`, `test_simplefin.py`

## Budget Alert Email Delivery Fix (Sept 2026)
- ROOT CAUSE of "no alerts received": alert pipeline (budget_alert_service._emit) was PUSH-ONLY. In dev/preview EMERGENT_PUSH_KEY=placeholder → every push 401-failed → delivery_status 'failed'; NO email channel existed; and the dedupe claim (alert_state) persisted anyway, blocking re-fires for the rest of the month. Alerts appeared in-app inbox only.
- FIX: `_emit` now delivers via BOTH channels: Emergent push AND Emergent Resend email (`build_alert_email` in email_service.py — same title/body as push). Notification doc records `push_status`, `email_status`, and overall `delivery_status` ('sent' if either channel succeeded). Stale never-delivered alert_state claims (16) were purged so existing crossed thresholds re-fire once.
- E2E VERIFIED (review acct jaleter.appreview@gmail.com): $1,000 budget + $850 spend → category_80 email SENT; $1,100 spend → category_100 email SENT; $250 tx vs $200 threshold → large_transaction email SENT; repeat evaluations → 0 duplicates.
- Push still requires the deployed build (real EMERGENT_PUSH_KEY injected at publish) — expected 'failed' in dev.

## Alert Email Digest Choice (Sept 2026)
- alert_prefs.emailFrequency: 'instant' (default) | 'daily' | 'weekly'. Instant = email per alert as it fires. Daily/weekly = alert emails queued (email_status='queued') and flushed as ONE combined summary email at 18:00 local (Sundays for weekly) by `sweep_alert_email_digests` (hourly APScheduler job at :10, registered in weekly_digest_service.start_scheduler). Push + in-app inbox always fire instantly regardless.
- QA endpoint: POST /api/notifications/email-digest/run-now (flushes current user's queue immediately). Dedupe = queue drain (queued→sent); failed sends stay queued for retry next sweep.
- Builders: email_service.build_alert_digest_email. UI: Settings → Budget Alerts → 'Alert email frequency' PeriodPills (testID alert-email-frequency).
- Tested: 8/8 backend (tests/test_iteration82_email_digest.py) + full SDK 57 frontend regression PASS (all tabs, icons, paywall flow, settings, persistence across reload).

## Keyboard Avoidance for Amount Inputs (Sept 2026)
- Shared `Sheet` (src/utils/appShared.tsx) now wraps content in CORE RN KeyboardAvoidingView (behavior 'padding' on iOS only) — keyboard-controller tracking is unreliable inside RN Modals on iOS. Whole sheet (inputs + Save) lifts above the keyboard, inner KeyboardAwareScrollView still auto-scrolls focused input. Fixes ALL amount sheets: Budget monthly/annual, earn sources, NetWorth buckets/assets/liabilities, Transactions form. SupportSheet got the same KAV wrap; SettingsScreen root ScrollView → KeyboardAwareScrollView (threshold input). iOS lift behavior requires device verification (not web-testable).

## App Release Communications (Sept 2026)
- releases_router.py: GET /api/app/version (PUBLIC — banner polls it), GET/POST /api/admin/releases (is_admin only). Publish = two-step: confirm=false → preview {recipient_count}; confirm=true → upsert app_releases (_id=version) + email blast via build_app_update_email (user's exact copy: "A new Jaleter update is available"). Audience 'all' | 'premium'. Double-send guard: 409 if version already email_sent — email blast can only ever run once per version.
- UpdateBanner.tsx: compares Constants.expoConfig.version vs /api/app/version on mount + AppState active. Newer → dismissible banner (dismissal persisted per-version); critical=true → blocking overlay with store link (ios_url/android_url optional on release). Rendered next to EmailVerificationBanner in index.tsx.
- AdminReleasePanel in SettingsScreen (admin-release-panel testID) — version input, audience pills, critical toggle, Preview → Confirm & Send. Publishing workflow: bump app.json version BEFORE building, then after store release goes live, publish via panel.
- FIX: /api/user/membership now returns active:true for is_admin users (was Stripe-only → admin was stuck on paywall while require_active_membership bypassed — inconsistent). Verified: admin login → dashboard → Settings → panel; 409 guard message renders in panel.

## Apple/Google In-App Purchase — RevenueCat (Sept 2026)
- Emergent-managed RevenueCat: project projc2004c36, entitlement 'pro', package $rc_annual ($90/P1Y; monthly deleted). Full identifiers + proxy API usage in /app/memory/revenuecat.md. SDK keys in frontend/.env (EXPO_PUBLIC_REVENUECAT_*).
- Frontend: src/lib/revenuecat.tsx (module-scope init in _layout + QueryClientProvider + SubscriptionProvider; bindRevenueCatIdentity — logIn on native, configure({apiKey, appUserID}) in browser mode since logIn is a no-op there; onRcIdentityChanged → query invalidation). AuthContext binds identity on every auth path. Paywall: 'Subscribe — <price>/year' (paywall-iap-buy), Restore Purchases (paywall-iap-restore), test-store confirm step, Stripe kept as 'Pay on Jaleter.com instead'; production web = Stripe only.
- Backend: POST /api/iap/sync → users.iap_premium_expires_at; stripe_service.has_active_membership ORs it (same gate as Stripe everywhere). HARDENED: client can only EXTEND premium (monotonic expiry, active:false ignored, 400-day cap) — iteration_84 found client-side revoke data-loss; fixed + retested (iteration_85: zero revoke posts). index.tsx auto-syncs ONLY active snapshots.
- E2E PASS: Test Store purchase → 'Test valid purchase' → dashboard unlocked, /accounts 200, membership active with period_end (test store periods are ~1hr simulated). Restore on no-purchase account shows correct notice. Stripe users + admin unaffected.
- KNOWN MINOR: Test Store displays $79.99 (RC default; upsert to $90 accepted for store products but test-store display price fixed). Real price comes from App Store Connect product — user must create the IAP at $89.99/$90 tier there.
- USER-SIDE to go LIVE (steps in revenuecat.md): upload App Store Connect API key + IAP key to RevenueCat dashboard, create auto-renewable annual sub in ASC with the product ID shown in RC dashboard, payment profile, then build via Publish.

## Sheet Layout Root-Cause Fix (Sept 2026, iteration_86)
- User re-reported hidden amount fields ("Set Sep · Tithe", huge blank gap). TWO root causes fixed in shared Sheet (appShared.tsx):
  1. KeyboardAwareScrollView inside RN Modal mis-measured on iOS and scrolled content out of view → REPLACED with plain ScrollView; the core KeyboardAvoidingView (iOS 'padding') lifts the whole sheet; content is compact and pinned right under the subtitle.
  2. Web-only: RNW modal overlay anchors to the DOCUMENT (page taller than screen) so flex-end pushed sheets ~530px below the fold; slide animation's transform also hijacks position:fixed → backdrop now position:fixed inset 0 on web + animationType 'fade' on web (native keeps 'slide'). Same fix in SupportSheet. Also android softwareKeyboardLayoutMode:'resize' in app.json.
- Verified (iteration_86, all PASS): every sheet app-wide renders fully inside a 390x844 viewport with input directly under subtitle; save/type/close flows work; paywall + IAP UI intact. iOS keyboard-lift itself needs device confirmation.

## Native StoreKit IAP Enforcement on iOS (Sept 2026)
- TestFlight report: paywall opened checkout.stripe.com. Root cause: App Store offering was EMPTY (ASC subscription product + RC store credentials not configured by user yet) and the old paywall silently fell back to the Stripe-only button when annualPkg was null.
- FIXES: (1) On native (Platform !== web) the 'Subscribe — $90/year' IAP button ALWAYS renders; tapping it refetches offerings on demand and surfaces the real StoreKit/ASC error message instead of hiding IAP. (2) Stripe checkout button now HIDDEN on iOS builds (guideline 3.1.1) — replaced with 'Already a member on Jaleter.com? Refresh membership'; Stripe stays on Android/web/test-store. (3) /user/membership now returns 'source' (stripe|iap|admin); MembershipScreen: Stripe portal/cancel/resume only for source=stripe; source=iap gets 'Manage in App Store/Google Play settings' (Linking to store subscription pages) + IAP-billed footer; 'Start membership' Stripe CTA hidden on iOS. stripe_service refactored: has_stripe_membership + has_iap_membership + has_active_membership(or).
- Verified: source detection (none/iap/stripe) via curl; full test-store purchase E2E after refactor → dashboard unlock. USER MUST: redeploy+rebuild, create the ASC auto-renewable sub with the EXACT product ID from the RevenueCat dashboard (Product catalog → Apple app; appeared as pro.annual), upload .p8 IAP key + ASC API key to RC dashboard — until then the new build shows the IAP button with a clear 'store returned no products' message (never Stripe).

## IAP Identity Self-Healing (Sept 2026)
- TestFlight stalled on "Preparing your account for purchase" — identityReady stayed false because the launch-time Purchases.logIn can fail silently on device (network / late module init) with no retry.
- FIX: lib/revenuecat.ensureRcReady(uid) — on Subscribe/Restore tap: checks Purchases.isConfigured(), re-runs initializeRevenueCat() if needed, re-binds identity, fetches CustomerInfo, and returns the REAL error string if the customer is still anonymous. Paywall buyWithStore + restorePurchases call it instead of dead-ending; all failure paths now show actionable messages (identity error vs 'store returned no products' for ASC misconfig).
- Verified in preview: immediate-tap purchase (no settle wait) self-heals and completes. Stripe backend confirmed untouched (checkout/portal/cancel/webhooks all present).

## $79.99 Placeholder Price Explanation (Sept 2026)
- User saw "Subscribe — $79.99/year" on TestFlight. NOT a code price change: with NO ASC product + NO store credentials configured (user confirmed both missing), RevenueCat serves its built-in Test Store placeholder product (fixed at $79.99 — proxy upserts to $90 accepted but do NOT change the Test Store display price; multiple attempts). Once the user creates the ASC auto-renewable sub at the $89.99 tier and uploads .p8 + ASC API key to RC, StoreKit serves the REAL product/price and the placeholder disappears.
- Paywall card headline price now derives from the store product too (annualPkg.priceString, fallback $90) so button & card always agree.
- BLOCKED ON USER: all ASC steps still pending (create product with RC dashboard product ID, localization+price+screenshot to 'Ready to Submit', Paid Apps agreement/banking, upload keys to RC dashboard). App is code-complete for IAP.

## Website Stripe Account-First + Email Claim (Sept 2026)
- User found jaleter.com (their EXTERNAL marketing site, not this codebase) can send buyers straight to a raw Stripe Payment Link → subscription has no jaleter_user_id → app never recognizes it. OUR /api/payments/checkout was always account-first (JWT required, user_id in client_reference_id + session metadata + subscription metadata).
- FIX (backend): stripe_service._claim_customer_by_email — reconcile_membership_from_stripe now, when the user has no stripe_customer_id, searches Stripe Customers by the user's VERIFIED email, adopts an unlinked customer that has a subscription (never one tagged with a different user_id; unique-index safe), tags it with jaleter_user_id, links stripe_customer_id, then syncs the sub. So: payment-link buyer → creates Jaleter account with same email → verifies email → 'Refresh Membership' (or ?refresh=1) → Premium. Verified no-crash for unverified/no-customer users.
- USER-SIDE for jaleter.com: replace raw Stripe payment links with an account-first flow (site should require login before checkout / link into the authenticated checkout). Until then the email-claim fallback covers those buyers.

## Pre-Resubmission Membership Matrix Regression (iteration_87) — ALL PASS
- M1 stripe-source Membership UI (Stripe controls, no store button); M2 iap-source ('Manage in App Store settings', no Stripe controls); M3 paywall card/button price identical; M4 ?refresh=1 unverified email → 200/99ms claim-skip; M5 test-store purchase → unlock. Cleared for resubmission; remaining work is entirely user-side ASC/RC dashboard setup.

## Luxury Dark Paywall Redesign (Sept 2026)
- PaywallScreen fully redesigned per user's attached reference: dark #0a0906 bg, gold #d4af61 accents, JALETER wordmark + tagline, 'Unlock Your Full Potential', 4 feature rows (gold circle icons), ANNUAL PLAN card w/ BEST VALUE badge, LIVE store price + computed 'Equivalent to less than $X/month' (price/12, ceil), gold Subscribe Now CTA, Restore Purchase | Terms | Privacy links (openJaleter terms/privacy), platform-worded auto-renew disclosure, X close (paywall-close → onSwitchAccount), signed-in footer, bottom gold rule + ✦. Removed GoldButton/C/s/PAYWALL_BENEFITS deps; local `d` StyleSheet (intentionally dark in both themes).
- Stripe secondary now WEB-ONLY (hidden on iOS AND Android store builds — Google Play Billing policy). Android IAP = RevenueCat Play Billing (goog_ key, already provisioned; purchase/acknowledge/pending handled by RC SDK).
- Verified in preview: X dismisses to welcome; Subscribe Now → test-store native flow → Premium unlock → dashboard; links row renders; store price is source of truth ($79.99 placeholder until ASC/Play products exist).
- PRODUCT ID CONFLICT (flagged to user, per their STOP instruction): user wants store product ID `jaleter_premium_annual`, but RevenueCat is provisioned with its own identifiers (surfaced as pro.annual). App requests products via RC offering (no hardcoded IDs). Options: (A) use RC dashboard's ID in ASC/Play (recommended, zero changes); (B) manually add `jaleter_premium_annual` products in RC dashboard (both stores), attach to `pro` entitlement + `default` offering annual package, then create matching store products. No app code change either way.
