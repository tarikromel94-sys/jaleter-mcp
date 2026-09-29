# WHAT TARIK NEEDS TO DO NEXT
Jaleter Premium — $89.99/year auto-renewing subscription (single plan, both stores).

## ARCHITECTURE (final, June 2026)
- iPhone → Apple In-App Purchase → Jaleter Premium entitlement → Plaid + all premium features
- Android → Google Play Billing → Jaleter Premium entitlement → Plaid + all premium features
- Coaching ($75/hr) → Stripe on jaleter.com → coaching only
- **There is NO Stripe path for Premium anymore.** Web visitors on jaleter.com/membership
  create an account and are sent to the App Store / Google Play to subscribe in-app.
- Existing web (Stripe) members are grandfathered until the period they already paid
  for ends (their Stripe subscription was set to cancel-at-period-end on Sep 29 2026;
  the only live one runs to Sep 6 2027). After that they subscribe in the app. Their
  account + data are untouched.
- Server-side validation: RevenueCat validates receipts with Apple/Google using the
  credentials you upload to its dashboard (below). The app forwards the verified
  entitlement (expiry date) to `POST /api/iap/sync`; the backend stores it on the
  account and every premium API (incl. Plaid) checks it. Renewals extend it, cancel
  keeps access until the paid period ends, expiry lapses automatically. No private
  keys live in the app — only RevenueCat public SDK keys.

## STRIPE DASHBOARD (one-time cleanup)
- Developers → Webhooks: delete the endpoint `.../api/payments/webhook` (route removed;
  it only served Premium subscriptions). Coaching uses Stripe Checkout polling, no webhook.
- Payment Links: remove any Premium/membership Payment Link from jaleter.com — link to
  jaleter.com/membership (this app's `/membership` route) or the store badges instead.
- Do NOT delete the "Jaleter Annual Membership" product until Sep 2027 (grandfathered member).

⚠️ **PRODUCT ID — READ FIRST**
You asked for the store product ID `jaleter_premium_annual`. Jaleter uses the
**Emergent-managed RevenueCat** integration, which auto-generated its own product
identifiers (visible in your RevenueCat dashboard:
https://app.revenuecat.com/projects/projc2004c36 → Products).
The store product IDs you create in App Store Connect and Google Play Console
**must match the exact product IDs shown in the RevenueCat dashboard** — one for
the App Store app, one for the Play Store app. The app itself never hardcodes
product IDs (it loads the `default` offering → `$rc_annual` package), so the ID
text is invisible to your customers; only you and store reviewers ever see it.

Your two options:
- **Option A (recommended, zero risk):** In ASC and Play Console, create the
  subscription using the exact product ID shown in the RevenueCat dashboard for
  each store app. Nothing else changes. Works immediately.
- **Option B (if you insist on `jaleter_premium_annual`):** In the RevenueCat
  dashboard you'd manually create new App Store/Play Store products with that
  identifier, attach them to the `pro` entitlement, and swap them into the
  `$rc_annual` package of the `default` offering. This deviates from the
  Emergent-managed structure and future automated pricing updates may not track
  them — tell the agent BEFORE doing this so it can be coordinated.

---

## APPLE APP STORE CONNECT
1. **Paid Applications Agreement** — App Store Connect → Business (Agreements,
   Tax, Banking). Must be signed, with banking + tax info complete. Purchases
   silently fail without this. THIS IS THE #1 BLOCKER.
2. **Create the subscription** — ASC → Your App → Monetization → Subscriptions:
   - Create a **Subscription Group** (e.g. "Jaleter Premium") if none exists.
   - Inside it, create an **Auto-Renewable Subscription** with the **product ID
     from the RevenueCat dashboard** (see note above), duration **1 year**.
   - Price: pick the **$89.99 USD** tier (Apple auto-fills other territories).
   - Localization: Display name "Jaleter Premium", description (e.g. "Full
     access to insights, goals, premium tools and priority support").
   - **Review screenshot** of the paywall + review notes are required before
     the subscription can be submitted.
3. **Upload credentials to RevenueCat** (dashboard → Apps → your iOS app):
   - In-App Purchase Key (.p8): https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/in-app-purchase-key-configuration
   - App Store Connect API Key: https://www.revenuecat.com/docs/service-credentials/itunesconnect-app-specific-shared-secret/app-store-connect-api-key-configuration
4. **Attach subscription to the app version** — when submitting the build for
   review, add the new subscription to the same submission (first-time IAPs
   are reviewed together with a build).
5. **Sandbox testing** — create a Sandbox tester (Users & Access → Sandbox),
   install via TestFlight, open the paywall, verify the real localized $89.99
   loads, buy with the sandbox account, confirm premium unlocks, then test
   Restore Purchase.
6. **App review account** — Jaleter.appreview@gmail.com / Jaleter029496! is
   permanently premium server-side; include it in the review notes.

## GOOGLE PLAY CONSOLE
1. **Payments profile** — Play Console → Setup → Payments profile must be
   active: https://support.google.com/googleplay/android-developer/answer/7161426
2. **Create the subscription** — Play Console → Your App → Monetize →
   Subscriptions → Create subscription:
   - Product ID: the **exact ID from the RevenueCat dashboard** for your Play
     app (see note above).
   - Name: "Jaleter Premium".
   - Add a **Base plan**: id e.g. `annual`, **Auto-renewing**, billing period
     **Yearly (P1Y)**, price **$89.99 USD** (Google converts other currencies —
     review them once).
   - **Activate** both the subscription AND the base plan (a created-but-
     inactive base plan returns no products to the app).
3. **Upload credentials to RevenueCat** (dashboard → Apps → your Android app):
   - Play service-account JSON: https://www.revenuecat.com/docs/service-credentials/creating-play-service-credentials
   - Note: after granting the service account access, Google can take up to
     ~24-36h to propagate; "product not found" errors early on are normal.
4. **Upload an .aab to a testing track** (Internal testing) — Play Billing only
   works for builds distributed by Google Play, not sideloaded APKs.
5. **License testers** — Play Console → Settings → License testing: add your
   Gmail; testers purchase with test cards (not charged) and subscriptions
   renew on an accelerated schedule.

## EMERGENT
1. All app-side work is DONE — RevenueCat SDK, entitlement sync to the
   backend (`POST /api/iap/sync`), hard server-side paywall, Restore Purchase,
   luxury paywall design, $89.99 pricing in RevenueCat.
2. **Deploy** the latest code (Publish button, top right) and **generate new
   iOS + Android builds** from the deployment panel.
3. FAQ section of the payments panel has the full RevenueCat go-live steps.
4. Do NOT edit EXPO_PUBLIC_REVENUECAT_* keys in frontend/.env — they are real.
5. Optional env for the web page + production-web paywall store buttons (set in the
   deploy config once the listings are live): `EXPO_PUBLIC_APP_STORE_URL`,
   `EXPO_PUBLIC_PLAY_STORE_URL` (default to https://jaleter.com/app).

## CREDENTIALS / KEYS THE AGENT CANNOT CREATE (you must provide/upload)
| Store | What | Where it goes |
|---|---|---|
| Apple | In-App Purchase Key (.p8) + Key ID + Issuer ID | RevenueCat dashboard → Apps → iOS app |
| Apple | App Store Connect API Key (.p8) | RevenueCat dashboard → Apps → iOS app |
| Apple | Auto-renewable subscription (product ID from RC dashboard, $89.99, 1 yr, subscription group) | App Store Connect → Monetization |
| Apple | Paid Applications Agreement + banking + tax | App Store Connect → Business |
| Google | Service-account JSON with Play Developer API + Financial data access | RevenueCat dashboard → Apps → Android app |
| Google | Subscription (product ID from RC dashboard) + yearly base plan $89.99, ACTIVATED | Play Console → Monetize |
| Google | Payments profile | Play Console → Setup |
Nothing else is needed on the backend: no Apple shared secret / Google keys are stored
in Jaleter's servers — RevenueCat holds them.

## READY TO SUBMIT (final checklist)
- [ ] Apple: Paid Apps agreement active (banking + tax complete)
- [ ] Apple: annual subscription created at $89.99, in a subscription group,
      with localization + review screenshot
- [ ] Apple: .p8 IAP key + ASC API key uploaded to RevenueCat
- [ ] Apple: sandbox purchase + restore verified on TestFlight
- [ ] Google: payments profile active
- [ ] Google: subscription + yearly base plan created at $89.99 and ACTIVATED
- [ ] Google: service-account JSON uploaded to RevenueCat
- [ ] Google: internal-testing purchase verified with a license tester
- [ ] Both: paywall shows the real localized store price (not the fallback)
- [ ] Both: review notes include the demo account
      (Jaleter.appreview@gmail.com / Jaleter029496!)
- [ ] Submit iOS build + subscription for review together
- [ ] Submit Android release from the testing track to production
