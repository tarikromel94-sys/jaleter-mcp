# Jaleter — Apple App Review Submission Kit

This document is ready to copy into App Store Connect during submission.
Update the placeholder demo password with the value output by
`python -m scripts.seed_demo_account` after you run it against production.

---

## App Review Information

**Sign-In required:** YES

**Demo user (paste into App Store Connect):**
- Email: `applereview@jaleter.com`
- Password: `JaleterReview2026!`

This dedicated App Review account is seeded automatically on every backend
startup with PERMANENT Premium (server-side entitlement, period end 2099),
so reviewers can access every gated feature (Dashboard, Budget, Activity,
Reports, Wealth/Net Worth, Set Aside, Legacy BUILD/GROW, Coach AI, Plaid,
Settings, Notifications, Support, Reset Data, Delete Account, Membership)
without completing a real payment. Tapping the membership purchase button
returns "already active" — it never opens Stripe checkout. If a reviewer
deletes the account, it is re-created on the next backend restart.

(Legacy alternative: `demo@jaleter.com` — password from seed_demo_account.py.)

---

## Review Notes (copy verbatim)

Jaleter is a personal finance tracker that unifies bank transactions
(via Plaid + optional SimpleFIN), category-based budgets, savings goals,
and net-worth reporting. Premium ($90 / year) unlocks Coach AI, server-
evaluated budget alerts, weekly push digests, and multi-format statement
imports.

Premium is sold on our website at jaleter.com via Stripe Checkout. No
Apple in-app purchase is used. This is permitted under App Review
Guideline 3.1.1(a) for United States storefront apps (May 2025 update).

### How to test WITHOUT paying
1. Launch Jaleter.
2. Tap "Log in" → sign in with the demo credentials provided above.
3. All Premium features are already unlocked. Try Coach AI (Tabs → Coach),
   view the Budget grid, and check Reports.

### How to test the paid subscription flow (optional)
1. Log in as any account.
2. Tap Membership → "Start membership — $90 / year".
3. Stripe Checkout opens in an SFSafariViewController.
4. Complete payment with a real card (or use Stripe's test card
   `4242 4242 4242 4242` if the environment is test-mode).
5. The browser redirects back to the app via `jaleter://checkout`.
6. The app polls `/api/user/membership`; within ~60 s the app shows
   "Membership activated." Server-side, our Stripe webhook is the sole
   writer of the `subscription_status` field — the client can never
   grant its own Premium entitlement.

### Sign-in options
- Email + Password (JWT).
- Sign in with Google (Emergent-managed OAuth).
- Sign in with Apple (native SIWA).

Every sign-in method lands on the same `users` collection keyed by email.

### Account deletion (Guideline 5.1.1(v))
1. Settings → Support → "Delete Account".
2. Enter your account password.
3. Confirm.

Deletion cascades server-side and purges:
- User profile + JWT sessions
- All bank transactions, budgets, goals, notifications, device tokens,
  imported statements, alert-state, cached snapshots
- Active Stripe subscription (immediate cancel + customer deletion)
- Every linked Plaid item (`/item/remove` at Plaid + local cache wipe)
- Sign in with Apple refresh token (revoked at Apple, best-effort per
  Apple's guideline).

### Financial data source
Plaid production for real bank connections. SimpleFIN Bridge as an
optional alternative. No mock data ships in the release build.

### Coach AI safety
Coach AI is powered by an external LLM (OpenAI). Prompts and responses
are moderated by the provider's built-in safety layer. The app never
exposes bank credentials, Plaid access tokens, or Stripe secrets to
the model — prompts include only categorical summaries.

### Privacy and permissions
- Face ID / Touch ID — optional device lock for the app (NSFaceIDUsage
  string in Info.plist).
- Push notifications — opt-in per feature (budget alerts, weekly digest,
  daily check-in, goal / tax reminders). Nothing is sent by default.
- No location, camera, microphone, contacts, calendar, or motion access
  is requested.

Privacy policy: https://jaleter.com/privacy
Terms of service: https://jaleter.com/terms

---

## App Privacy questionnaire (App Store Connect)

Answer these items in the "App Privacy" section of App Store Connect:

| Data type          | Collected? | Linked to identity? | Tracking? | Purposes |
|--------------------|------------|---------------------|-----------|----------|
| Email address      | YES        | YES                 | NO        | App Functionality |
| Name               | YES        | YES                 | NO        | App Functionality |
| Financial info     | YES        | YES                 | NO        | App Functionality |
| Purchase history   | YES        | YES                 | NO        | App Functionality |
| User content       | YES        | YES                 | NO        | App Functionality |
| Device ID          | YES        | YES                 | NO        | App Functionality (push routing) |
| Coarse location    | NO         | —                   | —         | — |
| Precise location   | NO         | —                   | —         | — |
| Contacts           | NO         | —                   | —         | — |
| Health / fitness   | NO         | —                   | —         | — |
| Sensitive info     | NO         | —                   | —         | — |
| Contact info other than email/name | NO | — | — | — |

Data types "Financial info" and "Purchase history" are linked to the
user's Jaleter account (Plaid connections + Stripe subscription record).
Nothing is used for third-party advertising or tracking.

---

## Subscription disclosure (visible in-app)

The MembershipScreen already renders the following disclosure directly
under the "Start membership" CTA:

> Membership is billed by Stripe at $90.00 USD per year and renews
> automatically until you cancel. Cancel anytime from the Manage
> subscription screen or at jaleter.com/billing.

This satisfies App Store guideline 3.1.2 (subscription disclosure of
price, length, and auto-renewal terms).

---

## Version metadata

- Display name: Jaleter
- Bundle ID: `com.emergent.nochangesmobile.fl0fmc`
- Version: 1.0.0
- Build number: (auto-incremented by EAS on each iOS build)
- Storefront: United States (initial launch)
- Category: Finance
- Age rating: 4+ (financial content only; no ads, gambling, or user-
  generated public content)

---

## Pre-submission checklist (run through before hitting "Submit for Review")

- [ ] `STRIPE_WEBHOOK_SECRET` rotated to real Stripe production value in
      Emergent Deploy panel. Verify by opening any customer's dashboard
      after a successful test $1 subscription and confirming
      `subscription_status='active'`.
- [ ] Sign in with Apple capability enabled on the App ID in Apple
      Developer Portal, and the provisioning profile regenerated.
- [ ] `EXPO_PUBLIC_BACKEND_URL` for the production EAS build points to
      the production API host (not `preview.emergentagent.com`).
- [ ] `EMERGENT_PUSH_KEY` rotated from `placeholder` to the real
      Emergent-managed production key.
- [ ] `SUPPORT_ADMIN_PASSWORD` rotated to a strong value (≥14 chars).
- [ ] `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` set in the
      production backend env (optional but recommended for the Apple
      SIWA account-deletion revoke path).
- [ ] Demo user seeded via `python -m scripts.seed_demo_account` and the
      generated password pasted into App Review Information.
- [ ] `https://jaleter.com/privacy` and `https://jaleter.com/terms`
      load correctly and describe Plaid, Stripe, email, push, and Coach
      AI usage accurately.
- [ ] TestFlight build installed on a real device and verified: login,
      Google login, Apple login, account creation, Plaid link, Stripe
      purchase → Premium activation, Sign in with Apple → account
      delete → login blocked.

Once every box is checked, submit via App Store Connect.
