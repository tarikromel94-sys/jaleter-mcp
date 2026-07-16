# Jaleter — Smart Budgeting (Expo Port)

## Overview
This is a 1:1 port of the user-supplied Jaleter React web app (`main.jsx` + `styles.css`) into a React Native / Expo mobile app. The web version cannot run on this Expo-only platform, so the same design, screens, content, and interactions were rebuilt using RN components.

## Screens Implemented
Onboarding flow: **Welcome → Onboarding (Faith/Both/Motivation) → Signup → FirstConnect (SimpleFIN) → Paywall → App**
Main app (bottom nav): **Home dashboard, Budget, Transactions, Net Worth, More**
More sub-screens: **Legacy (retirement projection), Coaching, Membership, Settings**

## Key Features
- Gold-on-cream luxury theme with linear gradient buttons (`expo-linear-gradient`)
- Serif headings (Georgia — Playfair Display fallback), Ionicons throughout
- Sample data (4 purpose buckets: Give / Steward / Grow / Enjoy, 3 income sources, 15 transactions, assets & liabilities)
- Interactive Budget with expandable categories, month/year toggle, live budget-vs-actual progress
- Transactions with add/edit/delete via bottom-sheet Modal, income/expense filter
- Net Worth with cash-committed-available breakdown and hide-values toggle
- Legacy projection with 5yr/10yr/20yr/Retirement pills and contribution stepper
- Settings: experience picker, appearance (Light/System/Dark), alerts toggle, logout back to Welcome
- Daily-quote engine with 60+ curated Faith / Motivation / Focus items (`quoteLibrary.ts`)

## Trade-offs vs Web Source
- Serif font uses system Georgia (was Playfair Display from Google Fonts)
- Custom SVG chart on Net Worth simplified; range slider in Legacy replaced with +/− stepper (RN has no native `<input type="range">`)
- Some finer visual flourishes (radial gradients, box-shadows) approximated with flat colors + linear gradients
- CSV export removed (browser-only API); dark theme toggle wired via Settings but full dark-palette parity is minimal

## Files
- `/app/frontend/app/index.tsx` — full app (all screens, state, styles)
- `/app/frontend/src/quoteLibrary.ts` — curated quote engine
- `/app/frontend/src/jaleterTheme.ts` — design tokens
- `/app/frontend/app/_layout.tsx` — kept unchanged (icon-font prewarming)
