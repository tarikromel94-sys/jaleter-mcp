# RevenueCat — integrated (Sept 2026)
This file is supposed to serve as a memory to you if you have to interact with user's RevenueCat account via integration proxy at any later point in time.

## Identifiers (from /setup response — copy verbatim)
- rc_project_id: projc2004c36
- apple_app_id: app9607a64afb
- play_app_id: app3f68f132b3
- entitlement_lookup_key: pro
- offering_lookup_key: default
- bundle_id / package_name: com.emergent.nochangesmobile.fl0fmc
- Packages (package -> product_id, current price):
  - $rc_annual -> prodd4613e9ecb   ($89.99 / P1Y, trial: none — updated from $90.00 June 2026)
  - ($rc_monthly was DELETED — Jaleter sells annual only)
- entitlement `pro` attached products (from last /products response):
  prodd4613e9ecb (test store), prodf1aa00de3b + prod8e62fa6e0b (Apple/Play mirrors)
- NOTE: proxy does NOT support custom product identifiers — user wanted
  `jaleter_premium_annual`; store products must instead match the exact IDs
  shown in the RevenueCat dashboard (see /app/memory/WHAT_TARIK_NEEDS_TO_DO_NEXT.md)
- Dashboard: https://app.revenuecat.com/projects/projc2004c36

## Check for project_state in revenuecat status api response. if the project_state is less then project_created, re-fetch RevenueCat playbook via the integration expert tool.
Status check:
`curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/1e687dc6-64a9-4037-ad31-39eec63ee07c/status"`
→ `{"connection_state":"connected","project_state":"...","rc_project_id":"..."}`
(AUTH = the Emergent bearer key from the current playbook — do not store it here.)

## Later updates to user's products (integration proxy apis ONLY — NEVER call the RevenueCat REST API)
- Change price/duration/trial OR add a package (upsert):
  POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/1e687dc6-64a9-4037-ad31-39eec63ee07c/products
  body: {"products":[{"package":"$rc_annual","price":90.00,"currency":"USD",
         "period":"P1Y",
         "prices":[{"amount_micros":90000000,"currency":"USD"}]}]}
  (amount_micros = price × 1,000,000; omit "trial" for none)
- Remove a package:
  DELETE $INTEGRATION_PROXY_URL/internal/revenuecat/projects/1e687dc6-64a9-4037-ad31-39eec63ee07c/products/%24rc_annual
  ($ -> %24)
- Recover identifiers / repopulate .env: re-run the idempotent /setup call.

## App wiring (Jaleter-specific)
- SDK keys in frontend/.env: EXPO_PUBLIC_REVENUECAT_{TEST,IOS,ANDROID}_API_KEY (real values — never blank/replace).
- src/lib/revenuecat.tsx: init (module scope in _layout), SubscriptionProvider (inside QueryClientProvider), useSubscription hook, syncIapToBackend.
- AuthContext: Purchases.logIn(user_id) on every auth path, logOut on sign-out (rcIdentityRef).
- PaywallScreen: iOS/Android + test-store preview show "Subscribe — $90/year" (paywall-iap-buy), Restore Purchases (paywall-iap-restore), test-store confirm step (paywall-iap-confirm-yes/no); Stripe web checkout retained as "Pay on Jaleter.com instead" (paywall-checkout). Production web = Stripe only.
- Backend: POST /api/iap/sync stores iap_premium_expires_at (capped now+400d) on the user; stripe_service.has_active_membership ORs it in → same premium gate as Stripe (require_active_membership, /user/membership, weekly digest, coach). DEVIATION from playbook's client-only gating: Jaleter has a pre-existing HARD server-side paywall, so the entitlement snapshot must be mirrored server-side; index.tsx auto-syncs on every CustomerInfo push (renewals/cancellations handled).

## Taking in-app purchases LIVE — store-side steps (USER does these — agent cannot verify or perform)
Needed ONLY for REAL purchases in published store builds. Test Store
(Expo Go / web preview / dev build) needs none of this.

- Step 1 — Upload App Store / Play Store credentials to the RevenueCat dashboard
  (Home → project → Apps → App name)
  - iOS:
    - In-app purchase key configuration
    https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration
    - App Store Connect API key
    https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/app-store-connect-api-key-configuration
  - Android:
    - Google Play service-account credentials JSON
    https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials
- Step 2 — Set up payment profiles in App Store Connect and Play Console
  - App Store: https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/
  - Play Store: https://support.google.com/googleplay/android-developer/answer/7161426
- Step 3 — Create the matching in-app purchase product in App Store Connect (and Google
  Play) using the SAME product ID shown in the RevenueCat dashboard for $rc_annual
  (auto-renewable annual subscription, $89.99/$90 tier).
  - App Store: https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/
  - Play Store: https://support.google.com/googleplay/android-developer/answer/140504
- Step 4 — Release build → test via TestFlight / Play internal testing → submit for review.

All the steps needed to integrate RevenueCat in the production app are present in the FAQ section of the payments panel.
