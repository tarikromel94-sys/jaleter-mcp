# Jaleter — Smart Budgeting (Expo Port)

## Overview
1:1 port of the user-supplied Jaleter React web app into a React Native / Expo mobile app, now with full authentication.

## Auth (This Iteration)
- **JWT email/password**: `passlib[bcrypt]` for hashing, `python-jose` for JWTs, 7-day access tokens
- **Emergent-managed Google Auth**: one-tap sign-in, session token exchanged for local user record
- Login + Register + Logout screens gate the entire app
- Token persisted via `expo-secure-store` (`@/src/utils/storage.secureGet/secureSet` under key `jaleter_auth_token`)
- Unified `/api/auth/me` endpoint accepts either JWT or Emergent session_token in `Authorization: Bearer …` header

## Backend
- `/app/backend/server.py` — FastAPI + Motor (MongoDB async)
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/emergent/session`
- MongoDB collections: `users` (unique email + user_id), `user_sessions` (TTL on `expires_at`)
- Env in `/app/backend/.env`: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRE_MINUTES`

## Frontend
- `/app/frontend/app/index.tsx` — full app (all screens + state machine)
- `/app/frontend/src/AuthContext.tsx` — `AuthProvider`, `useAuth()`, `loginWithGoogle`, cold-start session restore
- `/app/frontend/src/quoteLibrary.ts` — 60+ curated Faith / Motivation / Focus messages
- `/app/frontend/src/jaleterTheme.ts` — design tokens, Light + Dark palettes
- `/app/frontend/app/_layout.tsx` — Playfair Display font loading + icon prewarm (preserved)

## Screens
Onboarding: Welcome → Onboarding (Faith/Both/Motivation) → Signup → Login → FirstConnect (SimpleFIN) → Paywall  
Main app: Home dashboard, Budget, Transactions, Net Worth, More (Legacy / Coaching / Membership / Settings)

## Features
- Gold-on-cream luxury theme, Playfair Display serif headings, Ionicons
- Sample data (13 subcategories, 15 transactions, assets/liabilities)
- Interactive Budget with expandable purpose buckets
- Transactions with add/edit/delete (bottom-sheet modal)
- Net Worth with cash-committed-available breakdown, hide-values eye toggle
- Legacy projection with 5/10/20/Retirement pills and contribution stepper
- Settings: experience picker, Light/System/Dark appearance, budget alerts, linked accounts, notifications, terms, privacy, logout
- Working dark theme across every screen (`ThemeCtx` + `useThemed()` helper)
- AsyncStorage persistence of UI prefs; SecureStore persistence of auth token

## Files Reference
- `/app/memory/test_credentials.md` — test JWT user + endpoint reference
