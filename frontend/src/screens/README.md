# Screens Extraction Roadmap

This directory will hold each screen extracted from the monolithic `/app/frontend/app/index.tsx`.

## Status
The full extraction requires three ordered phases. Phase 1 was completed for
Support (see `../support/`) as a pilot pattern.

### Phase 0 — UI kit extraction (BLOCKER for Phase 1)
Before any screen can move, ~800 lines of shared helpers currently in
`app/index.tsx` need to move to `src/uiKit/`:

- **`src/uiKit/theme.ts`** — `C`, `D`, `useThemed`, `useDark`
- **`src/uiKit/storage.ts`** — `storage` (with the AsyncStorage/localStorage fallback)
- **`src/uiKit/styles.ts`** — the massive `s = StyleSheet.create({...})` at the bottom of index.tsx (~500 lines)
- **`src/uiKit/components.tsx`** — `Sheet`, `PageHeader`, `PeriodPills`, `GoldButton`, `CircleBtn`, `SafeAreaBg`, `Sparkle`, `MONEY` helper
- **`src/uiKit/BillingWebsiteNotice.tsx`** — the "billing lives at jaleter.com" pressable
- **`src/uiKit/constants.ts`** — `STORAGE_KEY`, `LEGACY_STORAGE_KEYS`

Once done, `app/index.tsx` shrinks by ~800 lines and every screen file can
`import { s, useThemed, PageHeader } from '@/src/uiKit'`.

### Phase 1 — screens extraction (in priority order)
Each screen becomes its own file under `src/screens/`. Order chosen by
"largest gain per line" and by how self-contained they already are:

1. `LegacyScreen.tsx` (~170 lines) — recently overhauled, cleanest boundaries
2. `MembershipScreen.tsx` (~35 lines)
3. `CoachingScreen.tsx` (~85 lines)
4. `MoreScreen.tsx` (~40 lines)
5. `SettingsScreen.tsx` (~200 lines)
6. `NetWorthScreen.tsx` (~250 lines)
7. `TransactionsScreen.tsx` (~265 lines)
8. `BudgetScreen.tsx` (~560 lines)
9. `HomeScreen.tsx` (~340 lines)
10. `LoginScreen.tsx` / `SignupScreen.tsx` / `WelcomeScreen.tsx` (auth flow)

### Phase 2 — sheets extraction
`AccountLinkSheet` (~250 lines) and any remaining sheets move to
`src/sheets/`.

## Design principle
`app/index.tsx` should shrink to only **`MainApp` + hydration + top-level
routing** — think a router file, not a screen file. Target size: ≤400 lines.

## Why not one big move
The monolith uses `s`, `useThemed`, and shared components inline. Moving
screens without first extracting the UI kit would create circular imports
between `app/index.tsx` and `src/screens/*`. Phase 0 is a prerequisite.
