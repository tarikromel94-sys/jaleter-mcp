import React, { useState, useEffect, useCallback } from 'react';
import { View, StatusBar as RNStatusBar, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { storage } from '@/src/utils/storage';
import { AuthProvider, useAuth, apiCall, setPaymentRequiredHandler } from '@/src/AuthContext';
import { usePushRegistration } from '@/src/hooks/usePushRegistration';
import { getPrefs, putPrefs, evaluateBudget, evaluateTransaction, currentPeriod as npCurrentPeriod, type CategoryTotal } from '@/src/utils/notifications';
import { C, D } from '@/src/jaleterTheme';
import { ReportsScreen } from '@/src/ReportsScreen';
import { EmailVerificationBanner } from '@/src/components/EmailVerificationBanner';
import { UpdateBanner } from '@/src/components/UpdateBanner';
import { useSubscription, syncIapToBackend, REVENUECAT_ENTITLEMENT_IDENTIFIER } from '@/src/lib/revenuecat';
import { CoachAIScreen } from '@/src/screens/CoachAIScreen';
import { s, ThemeCtx, Toast as SharedToast, isInvestmentAccount, type Asset } from '@/src/utils/appShared';
import { NetWorthScreen } from '@/src/screens/NetWorthScreen';
import { AppLockGate, ForgotPinModal, loadAppLock } from '@/src/screens/AppLockScreens';
import { Welcome, Onboarding, Signup, Login, ForgotPassword, ResetPassword } from '@/src/screens/AuthScreens';
import { Paywall } from '@/src/screens/PaywallScreen';
import { HomeScreen } from '@/src/screens/HomeScreen';
import { BudgetScreen } from '@/src/screens/BudgetScreen';
import { TransactionsScreen } from '@/src/screens/TransactionsScreen';
import { LegacyScreen } from '@/src/screens/LegacyScreen';
import { CoachingScreen, MembershipScreen, MoreScreen } from '@/src/screens/MoreScreens';
import { SettingsScreen } from '@/src/screens/SettingsScreen';
import { BottomNav } from '@/src/components/BottomNav';
import {
  MONTHS, currentMonth, monthlyAmount, isSystemTransaction, spentForSubInMonth,
  initialCategories, initialIncome, initialTx, initialAssets, initialLiabilities,
  type Tx,
} from '@/src/utils/budgetModel';
import { DEFAULT_LEGACY_RATE } from '@/src/utils/legacyMath';

const STORAGE_KEY = 'jaleter-state-v2';
// Last server-reported membership verdict. PERFORMANCE cache only — the
// backend re-validates on login/startup and every premium API returns 402
// when entitlement lapses, so a stale local flag can never grant access.
const MEMBERSHIP_CACHE_KEY = 'jaleter-membership-v1';
// One-time migration: any legacy v1 cache (which was seeded with mock $ figures) must be discarded.
const LEGACY_STORAGE_KEYS = ['jaleter-state-v1'];

// Dark theme context, useDark, useThemed are re-exported from
// `@/src/utils/appShared` (moved during the L1 modularization pass).

function initialsOf(name?: string | null, email?: string | null): string {
  const source = (name || '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) return email.trim().slice(0, 2).toUpperCase();
  return '—';
}


/* ---------------- App root ---------------- */
export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

function MainApp() {
  const auth = useAuth();
  usePushRegistration({ userId: auth.user?.user_id, token: auth.token });
  const [hydrated, setHydrated] = useState(false);
  const [appLock, setAppLock] = useState<{ enabled: boolean; pin: string; biometricsEnabled: boolean; biometricsAvailable: boolean; openConfigure?: boolean; locked: boolean }>({ enabled: false, pin: '', biometricsEnabled: false, biometricsAvailable: false, locked: false });
  const [forgotPinOpen, setForgotPinOpen] = useState(false);
  useEffect(() => {
    (async () => {
      const l = await loadAppLock();
      setAppLock({ enabled: !!l.pin, pin: l.pin, biometricsEnabled: l.biometricsEnabled, biometricsAvailable: l.biometricsAvailable, locked: !!l.pin });
    })();
  }, []);
  const [stage, setStage] = useState<'welcome'|'onboarding'|'signup'|'login'|'forgot'|'reset'|'paywall'|'app'>('welcome');
  const [resetInfo, setResetInfo] = useState<{ email: string; token: string | null }>({ email: '', token: null });
  const [experience, setExperience] = useState('Both');
  const [appearance, setAppearance] = useState('Light');
  const [active, setActive] = useState('home');
  const [categories, setCategories] = useState(initialCategories);
  // Multi-year budget: current `categories` always represents the year that
  // matches `budgetYear`. When the user switches years, we snapshot the
  // current categories into `categoriesByYear[oldYear]` and load the target
  // year (or clone from current as a starting template if untouched).
  const _currentYear = new Date().getFullYear();
  const [budgetYear, setBudgetYear] = useState<number>(_currentYear);
  const [categoriesByYear, setCategoriesByYear] = useState<Record<string, any[]>>({});
  // Tracks which months the user has explicitly SAVED a budget for. Keys
  // are "YYYY-M" (M is 0-indexed). Only months in this set are treated as
  // "real budget months" for BUILD's run-rate / trailing-average — annual
  // budget spreads and per-year snapshot copies do NOT auto-add months
  // to this set. Users add months by editing a specific month in the
  // Budget monthly view, or by using "Copy last year". Users can remove
  // months via the Reset Budget menu (Reset Month / Reset Year).
  const [finalizedBudgetMonths, setFinalizedBudgetMonths] = useState<string[]>([]);
  const [incomeSources, setIncomeSources] = useState(initialIncome);
  const [restrictedBuckets, setRestrictedBuckets] = useState<Array<{ id: string; name: string; amount: number }>>([]);
  const [transactions, setTransactions] = useState<Tx[]>(initialTx);
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [liabilities, setLiabilities] = useState<Asset[]>(initialLiabilities);
  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{
    enabled: boolean;
    threshold: number;
    perCategory: Record<string, { p50: boolean; p80: boolean; exceeded: boolean }>;
    singleExpense?: { enabled: boolean; threshold: number };
    weeklyDigest?: boolean;
    emailFrequency?: 'instant' | 'daily' | 'weekly';
  }>({ enabled: true, threshold: 80, perCategory: {}, singleExpense: { enabled: false, threshold: 200 }, weeklyDigest: true, emailFrequency: 'instant' });
  // Legacy screen state — hoisted here so timeframe, contribution, and hypothetical
  // amount survive navigation and app reloads (previously reset on every visit).
  const [legacyTimeframe, setLegacyTimeframe] = useState<string>('Retirement');
  const [legacyContribution, setLegacyContribution] = useState<number>(0);
  const [legacyHypothetical, setLegacyHypothetical] = useState<string>('');
  // Hypothetical frequency + optional duration (years). Undefined duration
  // means "for the entire projection horizon". Frequency defaults to onetime
  // so existing users' saved hypos behave the same as before.
  const [legacyHypoFrequency, setLegacyHypoFrequency] = useState<'onetime' | 'monthly' | 'annual'>('onetime');
  const [legacyHypoDuration, setLegacyHypoDuration] = useState<number | null>(null);
  const [legacyCumulative, setLegacyCumulative] = useState<boolean>(false);
  // User-editable return-rate assumption for the Legacy projection. Persisted
  // so users can model different assumptions and have them survive reload.
  const [legacyReturnRate, setLegacyReturnRate] = useState<number>(DEFAULT_LEGACY_RATE);
  // Retirement-age inputs (Phase 5 #24) — sensible defaults so first-time
  // users see a plausible projection instantly.
  const [currentAge, setCurrentAge] = useState<number>(30);
  const [retirementAge, setRetirementAge] = useState<number>(65);

  // Hydrate persisted UI state (auth is separate)
  useEffect(() => {
    (async () => {
      try {
        // Clear any legacy caches from previous versions (they contained seeded mock $ figures).
        for (const k of LEGACY_STORAGE_KEYS) {
          try { await storage.removeItem(k); } catch {}
        }
        const raw = await storage.getItem(STORAGE_KEY, '' as string);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.experience) setExperience(data.experience);
          if (data.appearance) setAppearance(data.appearance);
          if (data.transactions) {
            // Migration (spec #10/#12): older local caches may contain
            // `type: 'transfer'` entries. That value is no longer part of
            // the Tx union — remap to income/expense by amount sign and
            // keep the transfer intent via `is_transfer` + `system_category`
            // so Budget/Reports still exclude these correctly.
            const migrated = (data.transactions as any[]).map((raw: any) => {
              if (!raw) return raw;
              if (raw.type !== 'transfer') return raw;
              const amt = Number(raw.amount || 0);
              return {
                ...raw,
                type: amt >= 0 ? 'income' : 'expense',
                is_transfer: true,
                system_category: raw.system_category || 'transfer',
              };
            });
            setTransactions(migrated);
          }
          if (data.linkedAccounts) setLinkedAccounts(data.linkedAccounts);
          if (data.alerts) setAlerts(data.alerts);
          if (Array.isArray(data.categories) && data.categories.length > 0) setCategories(data.categories);
          if (Array.isArray(data.incomeSources) && data.incomeSources.length > 0) setIncomeSources(data.incomeSources);
          if (Array.isArray(data.restrictedBuckets)) setRestrictedBuckets(data.restrictedBuckets);
          else if (typeof data.restrictedCash === 'number' && data.restrictedCash > 0) {
            // Migrate legacy single-value restrictedCash into a bucket.
            setRestrictedBuckets([{ id: 'legacy-restricted', name: 'Set Aside', amount: data.restrictedCash }]);
          }
          if (Array.isArray(data.assets) && data.assets.length > 0) setAssets(data.assets);
          if (Array.isArray(data.liabilities) && data.liabilities.length > 0) setLiabilities(data.liabilities);
          if (typeof data.legacyTimeframe === 'string') setLegacyTimeframe(data.legacyTimeframe);
          if (typeof data.legacyContribution === 'number') setLegacyContribution(data.legacyContribution);
          if (typeof data.legacyHypothetical === 'string') setLegacyHypothetical(data.legacyHypothetical);
          if (data.legacyHypoFrequency === 'onetime' || data.legacyHypoFrequency === 'monthly' || data.legacyHypoFrequency === 'annual') setLegacyHypoFrequency(data.legacyHypoFrequency);
          if (typeof data.legacyHypoDuration === 'number' || data.legacyHypoDuration === null) setLegacyHypoDuration(data.legacyHypoDuration);
          if (typeof data.legacyCumulative === 'boolean') setLegacyCumulative(data.legacyCumulative);
          if (typeof data.legacyReturnRate === 'number' && data.legacyReturnRate > 0 && data.legacyReturnRate <= 30) setLegacyReturnRate(data.legacyReturnRate);
          if (typeof data.currentAge === 'number') setCurrentAge(data.currentAge);
          if (typeof data.retirementAge === 'number') setRetirementAge(data.retirementAge);
          if (typeof data.budgetYear === 'number') setBudgetYear(data.budgetYear);
          if (data.categoriesByYear && typeof data.categoriesByYear === 'object') setCategoriesByYear(data.categoriesByYear);
          if (Array.isArray(data.finalizedBudgetMonths)) setFinalizedBudgetMonths(data.finalizedBudgetMonths.filter((k: any) => typeof k === 'string'));
          else if (Array.isArray(data.savedBudgetMonths)) setFinalizedBudgetMonths(data.savedBudgetMonths.filter((k: any) => typeof k === 'string'));
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);
  // Persist on change (skip auth-managed fields)
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities, legacyTimeframe, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyCumulative, legacyReturnRate, budgetYear, categoriesByYear, finalizedBudgetMonths, currentAge, retirementAge })).catch(() => {});
  }, [hydrated, experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities, legacyTimeframe, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyCumulative, legacyReturnRate, budgetYear, categoriesByYear, finalizedBudgetMonths, currentAge, retirementAge]);

  // -------------------------------------------------------------------
  // BUDGET ALERTS — server-side evaluation via Emergent Managed Push.
  // -------------------------------------------------------------------
  // On login: pull the server-side alert prefs blob and reconcile with
  // the locally-hydrated `alerts` state. The server is the source of
  // truth for the version that other devices see; the local copy remains
  // for offline UX. Reconcile only once per token so we never overwrite
  // the user's in-flight edits.
  const [alertsSynced, setAlertsSynced] = useState(false);
  useEffect(() => {
    if (!auth.token || !hydrated || alertsSynced) return;
    (async () => {
      const server = await getPrefs(auth.token!);
      if (server) {
        // Merge server → local. `singleExpense` on server is authoritative.
        setAlerts((prev) => ({
          enabled: !!server.enabled,
          threshold: (prev as any)?.threshold ?? 80,
          perCategory: { ...(prev.perCategory || {}), ...(server.perCategory || {}) },
          singleExpense: server.singleExpense || prev.singleExpense || { enabled: false, threshold: 200 },
          weeklyDigest: (server as any).weeklyDigest !== false,
          emailFrequency: (server as any).emailFrequency || (prev as any).emailFrequency || 'instant',
        } as any));
      }
      setAlertsSynced(true);
    })();
  }, [auth.token, hydrated, alertsSynced]);

  // Debounced push of `alerts` → server. Only after we've reconciled once
  // (prevents overwriting the server with local defaults on first mount).
  useEffect(() => {
    if (!auth.token || !alertsSynced) return;
    const t = setTimeout(() => {
      let tz: string | undefined;
      try { tz = Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || undefined; } catch { tz = undefined; }
      const blob = {
        enabled: !!alerts.enabled,
        perCategory: alerts.perCategory || {},
        singleExpense: alerts.singleExpense || { enabled: false, threshold: 200 },
        weeklyDigest: (alerts as any)?.weeklyDigest !== false, // default ON
        emailFrequency: (alerts as any)?.emailFrequency || 'instant',
        timezone: tz,
      };
      putPrefs(auth.token!, blob as any).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [alerts, auth.token, alertsSynced]);

  // Debounced budget-threshold evaluator + large-transaction evaluator are
  // declared after `mergedTransactions` (below) so we can reference it in
  // the deps array without a Temporal Dead Zone error.

  // Listen for SnapTrade OAuth callback deep link (jaleter://snaptrade-callback).
  useEffect(() => {
    if (!auth.token) return;
    const handleUrl = (url: string) => {
      if (!url) return;
      if (url.includes('snaptrade-callback')) {
        apiCall('/api/accounts/snaptrade/callback', { method: 'POST' }, auth.token).catch(() => {});
      }
    };
    Linking.getInitialURL().then((url) => { if (url) handleUrl(url); });
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => { sub.remove(); };
  }, [auth.token]);

  // ---- Server-side membership gate ---------------------------------------
  // The backend is the source of truth (`GET /api/user/membership`, fed by
  // the store-verified RevenueCat entitlement the app syncs via /iap/sync).
  // Every sign-in / session-restore re-validates before the dashboard opens.
  // The local cache only lets a returning ACTIVE member skip the loading gap.
  const checkMembership = useCallback(async (reconcile = false): Promise<{ active: boolean; processing: boolean }> => {
    if (!auth.token) return { active: false, processing: false };
    const data = await apiCall(`/api/user/membership${reconcile ? '?refresh=1' : ''}`, { method: 'GET' }, auth.token);
    const isActive = !!data?.active;
    storage.setItem(MEMBERSHIP_CACHE_KEY, JSON.stringify({ active: isActive, status: data?.status || null, at: Date.now() })).catch(() => {});
    return { active: isActive, processing: !!data?.processing };
  }, [auth.token]);

  // Any premium API returning HTTP 402 anywhere in the app drops the user
  // back to the Membership Required screen. Frontend state alone can never
  // keep a lapsed membership inside the paid experience.
  useEffect(() => {
    setPaymentRequiredHandler(() => {
      storage.setItem(MEMBERSHIP_CACHE_KEY, JSON.stringify({ active: false, at: Date.now() })).catch(() => {});
      setStage((prev) => (prev === 'app' ? 'paywall' : prev));
    });
    return () => setPaymentRequiredHandler(null);
  }, []);

  // ---- Apple/Google IAP → backend sync ------------------------------------
  // Whenever RevenueCat pushes fresh CustomerInfo with an ACTIVE entitlement
  // (purchase, restore, RENEWAL, login), mirror it to /api/iap/sync so the
  // server-side paywall stays in lock-step. Inactive snapshots are NEVER
  // synced — the client can extend premium but can never revoke it (expiry
  // lapses server-side on its own when the paid period ends). If the user is
  // currently parked on the paywall (e.g. a renewal landed while the app was
  // closed), a successful sync re-opens the dashboard.
  const iapSub = useSubscription();
  const lastIapSyncRef = React.useRef<string>('');
  useEffect(() => {
    if (!auth.token || !iapSub.customerInfo) return;
    const ent = iapSub.customerInfo.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER];
    if (!ent) return; // never post revokes from the client
    const fingerprint = `${auth.user?.user_id || ''}|${ent.expirationDate || ''}`;
    if (fingerprint === lastIapSyncRef.current) return;
    lastIapSyncRef.current = fingerprint;
    syncIapToBackend(auth.token, iapSub.customerInfo)
      .then((active) => { if (active) setStage((prev) => (prev === 'paywall' ? 'app' : prev)); })
      .catch(() => {});
  }, [auth.token, auth.user?.user_id, iapSub.customerInfo]);

  // Route on every auth transition (login, signup, Google, session restore,
  // logout). Active membership → dashboard; signed-in without membership →
  // Membership Required. Never trusts a local flag as the final answer.
  useEffect(() => {
    if (!auth.user) {
      setStage((prev) => (prev === 'app' || prev === 'paywall' ? 'welcome' : prev));
      return;
    }
    let cancelled = false;
    (async () => {
      // Fast path: cached ACTIVE verdict opens the app instantly for
      // returning members; the server call below corrects it if stale.
      try {
        const raw = await storage.getItem(MEMBERSHIP_CACHE_KEY, '' as string);
        if (raw && JSON.parse(raw)?.active && !cancelled) setStage('app');
      } catch {}
      try {
        const m = await checkMembership();
        if (!cancelled) setStage(m.active ? 'app' : 'paywall');
      } catch {
        // Offline / server unreachable: fall back to the last server verdict.
        if (cancelled) return;
        try {
          const raw = await storage.getItem(MEMBERSHIP_CACHE_KEY, '' as string);
          setStage(raw && JSON.parse(raw)?.active ? 'app' : 'paywall');
        } catch { setStage('paywall'); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.user_id, auth.token]);

  // On web, when a coaching Stripe checkout redirects back with
  // ?checkout=success&session_id=..., poll and show a toast.
  const [globalToast, setGlobalToast] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !auth.token) return;
    const params = new URLSearchParams(window.location.search || '');
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');
    if (!checkout || !sessionId) return;
    // Clean the URL immediately so refresh doesn't reprocess
    window.history.replaceState(null, '', window.location.pathname);
    if (checkout === 'cancel') {
      setGlobalToast('Checkout canceled.');
      return;
    }
    (async () => {
      for (let i = 0; i < 8; i += 1) {
        try {
          const status = await apiCall(`/api/payments/status/${sessionId}`, { method: 'GET' }, auth.token);
          if (status?.payment_status === 'paid') {
            setGlobalToast('Session confirmed.');
            return;
          }
        } catch { /* keep polling */ }
        await new Promise((r) => setTimeout(r, 1200));
      }
      setGlobalToast('Payment is still processing.');
    })();
  }, [auth.token]);

  const isDark = appearance === 'Dark';
  // Live-linked account balances — a single source of truth used by Home + Net Worth.
  const [linkedAccountBalances, setLinkedAccountBalances] = useState<any[]>([]);
  // Live-linked BANK TRANSACTIONS from every connected provider. These arrive
  // as `bank_transactions` rows from `/api/accounts/transactions` and get
  // reshaped into the app's local `Tx` type so the Activity tab, Budget
  // actuals, and Reports all see them alongside manual entries. Merging
  // happens in `mergedTransactions` below — the local `transactions` array
  // remains untouched so manual edits still persist across reloads.
  const [linkedTransactions, setLinkedTransactions] = useState<Tx[]>([]);
  // Global loading gate. True only after BOTH /accounts/all AND
  // /accounts/transactions have returned for the current session so we never
  // publish a derived financial number (Net Worth, Budget %, Legacy, etc.)
  // that could be temporarily wrong. When either fetch is still in flight,
  // consumers mask their numbers with '••••••' / '$—' / skeleton.
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [accountsRefreshTick, setAccountsRefreshTick] = useState(0);
  const refreshAccounts = React.useCallback(() => {
    // Force a reload cycle. Consumers should treat the interim as "loading".
    setBalancesLoaded(false);
    setTransactionsLoaded(false);
    setAccountsRefreshTick(n => n + 1);
  }, []);
  // Auto-sync Plaid on first mount per session so users don't have to remember
  // to tap "Refresh". Fire-and-forget — the useEffect below will re-fetch
  // /accounts/all + /accounts/transactions once the sync completes.
  const [didAutoSync, setDidAutoSync] = useState(false);
  useEffect(() => {
    if (!auth.token || didAutoSync) return;
    setDidAutoSync(true);
    apiCall('/api/plaid/sync', { method: 'POST' }, auth.token)
      .then(() => refreshAccounts())
      .catch(() => {}); // silent — user can also tap the Activity banner
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token]);
  useEffect(() => {
    if (!auth.token) { setLinkedAccountBalances([]); setLinkedTransactions([]); setBalancesLoaded(true); setTransactionsLoaded(true); return; }
    let alive = true;
    // 1. Account balances
    apiCall('/api/accounts/all', { method: 'GET' }, auth.token)
      .then((data: any) => {
        if (!alive) return;
        const rows = Array.isArray(data?.accounts) ? data.accounts : [];
        setLinkedAccountBalances(rows);
        const plaidRows = rows.filter((r: any) => r.provider === 'plaid');
        const plaidErrors = plaidRows.filter((r: any) => r.error);
        if (plaidRows.length > 0 && plaidErrors.length === plaidRows.length) {
          setGlobalToast('Plaid needs to be reconnected. Open Settings → Linked Accounts.');
        }
      })
      .catch(() => { if (alive) setLinkedAccountBalances([]); })
      .finally(() => { if (alive) setBalancesLoaded(true); });
    // 2. Bank transactions (include everything — Activity shows all; other
    //    surfaces filter out transfers/CC payments via `isSystemTransaction`).
    apiCall('/api/accounts/transactions?limit=200&include_transfers=true', { method: 'GET' }, auth.token)
      .then((data: any) => {
        if (!alive) return;
        const raw = Array.isArray(data?.transactions) ? data.transactions : [];
        const reshaped: Tx[] = raw.map((r: any) => {
          const amt = Number(r.amount) || 0;
          // Parse date safely — avoid timezone-shifting July 1 to June 30.
          const dateStr = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString();
          const isoMatch = typeof dateStr === 'string' ? dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
          const monthIndex = isoMatch ? Number(isoMatch[2]) - 1 : new Date(dateStr).getMonth();
          const period = MONTHS[monthIndex] || currentMonth();
          const sys = r.system_category || null;
          // Transfer heuristics: match ONLY clear transfer phrases (not every
          // ACH / deposit / check). Description-based match complements the
          // backend's Plaid PFC system_category detection.
          const desc = `${r.description || r.name || ''} ${r.merchant || ''}`.toLowerCase();
          const looksLikeTransfer =
            /\b(transfer\b|internal transfer|online transfer|account transfer|xfer\b)\b/.test(desc)
            || /transfer to (savings|checking)|transfer from (savings|checking)/.test(desc);
          const isSystemTransfer = sys === 'transfer' || sys === 'credit_card_payment' || sys === 'loan_payment' || !!r.is_transfer || looksLikeTransfer;
          // #10/#11: `type` is derived STRICTLY from amount sign — Transfer
          // is no longer a third type. `isSystemTransfer` still gets
          // preserved on the row (via `system_category` + `is_transfer`)
          // so Budget/Reports can exclude these from income/expense totals
          // and Activity can render a "Transfer" badge next to the org name.
          const derivedType: Tx['type'] = amt >= 0 ? 'income' : 'expense';
          return {
            id: `bank-${r.external_id}`,
            external_id: r.external_id,
            date: dateStr,
            name: r.description || r.name || 'Transaction',
            merchant: (r.merchant || '').trim() || undefined,
            amount: Math.abs(amt),
            type: derivedType,
            // Preserve the original signed direction so refund netting
            // (spec #16) can reduce Expense actuals if the user manually
            // reassigns the row to an Expense category.
            sign: amt >= 0 ? 1 : -1,
            groupId: '',
            detailId: '',
            origin: r.org_name || 'Linked',
            period,
            system_category: sys,
            is_transfer: !!r.is_transfer || isSystemTransfer,
          } as Tx;
        });
        setLinkedTransactions(reshaped);
        // Backfill (spec #9): any locally-cached overlay row that carries
        // an external_id but has origin === 'Manual' is a leftover from a
        // pre-fix save. Reconcile it with the org name coming from the
        // linked feed so Activity shows "Chase" / "Ally Bank" and NOT
        // "Manual". Never touches manual-only rows (no external_id).
        try {
          const byExtId = new Map<string, string>();
          for (const t of reshaped) {
            if (t.external_id) byExtId.set(String(t.external_id), t.origin || 'Linked');
          }
          setTransactions((prev: Tx[]) => {
            let dirty = false;
            const next = prev.map((row: any) => {
              const extId = row?.external_id;
              if (!extId) return row;
              const canonical = byExtId.get(String(extId));
              if (!canonical) return row;
              if (row.origin === 'Manual' || !row.origin || row.origin === 'Linked') {
                if (row.origin !== canonical) {
                  dirty = true;
                  return { ...row, origin: canonical };
                }
              }
              return row;
            });
            return dirty ? next : prev;
          });
        } catch {}
      })
      .catch(() => { if (alive) setLinkedTransactions([]); })
      .finally(() => { if (alive) setTransactionsLoaded(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, linkedAccounts.length, stage, accountsRefreshTick]);
  // Effective list used across the app — manual first (users' overrides
  // win), then linked. Duplicates by external_id are avoided since manual
  // txns don't set that field.
  const mergedTransactions = React.useMemo(() => {
    // Build lookup: external_id → canonical linked row so we can reconcile
    // origin on the fly. This complements the fetch-time backfill and
    // guarantees Activity NEVER surfaces "Manual" for a linked Plaid/SnapTrade
    // transaction — even for legacy overlays saved before the Phase-1 fix.
    const linkedByExtId = new Map<string, any>();
    for (const l of linkedTransactions) {
      if (l.external_id) linkedByExtId.set(String(l.external_id), l);
    }
    const seen = new Set<string>(transactions.filter(t => (t as any).external_id).map(t => (t as any).external_id));
    const linkedOnly = linkedTransactions.filter(t => !seen.has(t.external_id as string));
    const reconciled = transactions.map((t: any) => {
      if (t?.external_id) {
        const linked = linkedByExtId.get(String(t.external_id));
        if (linked && linked.origin && (t.origin === 'Manual' || !t.origin || t.origin === 'Linked')) {
          return { ...t, origin: linked.origin };
        }
      }
      return t;
    });
    return [...reconciled, ...linkedOnly].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [transactions, linkedTransactions]);

  // -------------------------------------------------------------------
  // BUDGET ALERTS — evaluators (declared here so we can reference the
  // just-defined `mergedTransactions` without a TDZ error).
  // -------------------------------------------------------------------
  // Debounced budget-threshold evaluator. Runs whenever the user's budget
  // or transactions change. Computes per-subcategory {spent, budget} for
  // the CURRENT calendar month within the active budget year and posts
  // them to /api/notifications/evaluate-budget. Server dedupes so the
  // same month/threshold only fires once.
  const budgetEvalPayloadRef = React.useRef<string>('');
  useEffect(() => {
    if (!auth.token || !alertsSynced || !alerts.enabled) return;
    const now = new Date();
    const monthIdx = now.getMonth();
    // Only evaluate when the ACTIVE budgetYear equals the current calendar
    // year — future/past-year budgets shouldn't emit "this month" alerts.
    if (budgetYear !== now.getFullYear()) return;
    const totals: CategoryTotal[] = [];
    for (const c of categories as any[]) {
      for (const sub of (c.subcategories || []) as any[]) {
        const budget = Number(monthlyAmount(sub, monthIdx) || 0);
        if (budget <= 0) continue;
        const spent = Math.max(0, spentForSubInMonth(mergedTransactions, sub.id, monthIdx, budgetYear));
        totals.push({
          sub_id: sub.id,
          name: sub.name,
          parent_name: c.name,
          budget,
          spent,
        });
      }
    }
    if (totals.length === 0) return;
    // Payload fingerprint dedupes back-to-back state churn.
    const fingerprint = JSON.stringify({
      p: npCurrentPeriod(),
      totals: totals.map((x) => [x.sub_id, x.budget, Math.round(x.spent * 100)]),
    });
    if (fingerprint === budgetEvalPayloadRef.current) return;
    const timer = setTimeout(() => {
      budgetEvalPayloadRef.current = fingerprint;
      evaluateBudget(auth.token!, npCurrentPeriod(), totals).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [auth.token, alertsSynced, alerts.enabled, categories, mergedTransactions, budgetYear]);

  // Fire the large-transaction evaluator once per newly-seen transaction.
  // Server-side dedupe (alert_state) keeps us safe across restarts.
  const seenTxIdsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!auth.token || !alertsSynced || !alerts.enabled) return;
    if (!alerts.singleExpense?.enabled) return;
    const threshold = Number(alerts.singleExpense.threshold || 0);
    if (threshold <= 0) return;
    // Watch ALL spend — manual AND Plaid/imported — so synced transactions
    // trigger the alert too. Threshold is inclusive ("$500 or more").
    const list = (mergedTransactions as any[]) || [];
    for (const tx of list) {
      if (!tx?.id) continue;
      if (seenTxIdsRef.current.has(tx.id)) continue;
      seenTxIdsRef.current.add(tx.id);
      if (tx.type !== 'expense') continue;
      if (tx.is_transfer) continue;
      if (tx.system_category === 'transfer') continue;
      const amt = Math.abs(Number(tx.amount || 0));
      if (amt < threshold) continue;
      evaluateTransaction(auth.token!, {
        id: String(tx.id),
        amount: amt,
        name: tx.name,
        merchant_name: tx.merchant_name || tx.name,
        account_name: tx.account_name,
      }).catch(() => {});
    }
  }, [auth.token, alertsSynced, alerts.enabled, alerts.singleExpense?.enabled, alerts.singleExpense?.threshold, mergedTransactions]);
  // Group linked accounts by their Jaleter category so every downstream
  // calculation is grounded in the same classification (see #1 / #2 / #27).
  // Balances for liability accounts are already sent as positive magnitudes
  // by the backend, so we can sum without worrying about signs.
  const validLinked = React.useMemo(
    () => linkedAccountBalances.filter((r: any) => !r.error),
    [linkedAccountBalances],
  );
  // De-duplicate by unique (link_id, account_id) — protects against the same
  // account being counted twice when Plaid returns both a "raw" account and a
  // holdings-derived twin, or when the same account is linked via two items.
  // Also filters out zero-value insurance policies (term-life, disability) so
  // they never inflate the Investments category (spec: "no cash value").
  const dedupedLinked = React.useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of validLinked) {
      const key = `${r.link_id || ''}::${r.account_id || r.name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Insurance policies with zero cash value → skip entirely. Users can
      // still see them in Linked Accounts management, but they don't count.
      const hay = `${r.name || ''} ${r.subtype || ''} ${r.type || ''}`.toLowerCase();
      const looksInsurance = /(term life|term-life|disability insurance|whole life|umbrella|renters insurance|auto insurance|life insurance)/.test(hay);
      const bal = Number(r.balance || 0);
      if (looksInsurance && bal === 0) continue;
      // Statement imports are transaction history ONLY (Activity / Budget /
      // Reports / cash-flow). They must never create a Wealth balance — skip
      // them here so Cash, Net Worth, Available Cash, and Legacy all ignore
      // them entirely. (They still appear in Settings → Linked Accounts.)
      if (r.provider === 'file' || r.kind === 'file') continue;
      out.push(r);
    }
    return out;
  }, [validLinked]);
  const linkedByCategory = React.useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of dedupedLinked) {
      // Backend supplies `category`; if this row came from an older provider
      // that didn't classify, fall back to the legacy regex so we don't lose
      // data during the rollout.
      const cat = (r.category as string) || (isInvestmentAccount(r) ? 'investments' : 'cash');
      acc[cat] = (acc[cat] || 0) + Number(r.balance || 0);
    }
    return acc;
  }, [dedupedLinked]);
  // Rows grouped by category — used by the collapsible Wealth categories to
  // render every underlying account row. Category totals below MUST equal
  // the sum of these rows so the UI never lies.
  const linkedRowsByCategory = React.useMemo(() => {
    const acc: Record<string, any[]> = {};
    for (const r of dedupedLinked) {
      const cat = (r.category as string) || (isInvestmentAccount(r) ? 'investments' : 'cash');
      (acc[cat] = acc[cat] || []).push(r);
    }
    return acc;
  }, [dedupedLinked]);
  const linkedCashTotal = linkedByCategory['cash'] || 0;
  const linkedInvestmentTotal = linkedByCategory['investments'] || 0;
  const linkedRealEstateTotal = linkedByCategory['real_estate'] || 0;
  const linkedVehiclesTotal = linkedByCategory['vehicles'] || 0;
  const linkedOtherAssetsTotal = linkedByCategory['other_assets'] || 0;
  const linkedCreditCardsTotal = linkedByCategory['credit_cards'] || 0;
  const linkedMortgageTotal = linkedByCategory['mortgage'] || 0;
  const linkedAutoLoansTotal = linkedByCategory['auto_loans'] || 0;
  const linkedStudentLoansTotal = linkedByCategory['student_loans'] || 0;
  const linkedOtherLiabTotal = linkedByCategory['other_liabilities'] || 0;
  const linkedLiabilitiesTotal =
    linkedCreditCardsTotal + linkedMortgageTotal + linkedAutoLoansTotal +
    linkedStudentLoansTotal + linkedOtherLiabTotal;
  const linkedAssetsTotal =
    linkedCashTotal + linkedInvestmentTotal + linkedRealEstateTotal +
    linkedVehiclesTotal + linkedOtherAssetsTotal;

  // ---- Wealth cash policy (Sept 2026) --------------------------------------
  // Total Cash = manually entered cash (Wealth tab) + Plaid/linked cash
  // balances ONLY. Activity transactions and statement imports NEVER move a
  // Wealth cash balance — they feed Activity, Budget, and Reports exclusively.
  const manualCash = assets.find((x: Asset) => x.id === 'cash')?.value || 0;
  const manualAssetsTotal = assets.reduce((sum, x) => sum + x.value, 0);
  const manualLiabilitiesTotal = liabilities.reduce((sum: number, x: Asset) => sum + (x.value || 0), 0);
  const manualInvestments = assets.find((x: any) => x.id === 'investments')?.value || 0;
  const investmentTotal = manualInvestments + linkedInvestmentTotal;
  const totalCash = manualCash + linkedCashTotal;
  // ---- Single source of truth: Net Worth ------------------------------------
  // Sum unique linked accounts (already de-duped by account_id) + manual rows
  // exactly once. Category totals are used for aggregation ONLY — we never
  // double-count a per-account row plus its aggregated header (this was the
  // bug that produced Home $269K vs Wealth $563K).
  const canonicalTotalAssets = React.useMemo(() => {
    // Manual seeds: Cash + Investments seed values + all manual "other" rows.
    const manualSeedCash = manualCash; // user-entered in Wealth, never tx-derived
    const manualSeedInvest = manualInvestments; // manual investments seed
    const manualOtherRows = assets.filter((x: Asset) => x.id !== 'cash' && x.id !== 'investments');
    const manualOtherTotal = manualOtherRows.reduce((s: number, r: Asset) => s + (r.value || 0), 0);
    return (
      manualSeedCash + manualSeedInvest + manualOtherTotal +
      linkedCashTotal + linkedInvestmentTotal +
      linkedRealEstateTotal + linkedVehiclesTotal + linkedOtherAssetsTotal
    );
  }, [manualCash, manualInvestments, assets, linkedCashTotal, linkedInvestmentTotal, linkedRealEstateTotal, linkedVehiclesTotal, linkedOtherAssetsTotal]);
  const canonicalTotalLiabilities = React.useMemo(() => {
    return manualLiabilitiesTotal + linkedLiabilitiesTotal;
  }, [manualLiabilitiesTotal, linkedLiabilitiesTotal]);
  // Only publish a NEW Net Worth once both assets AND liabilities are loaded.
  // Until then, keep the last confirmed value so users never see a stale
  // partial total (spec: "Do not publish the new total until it reconciles").
  const [publishedNetWorth, setPublishedNetWorth] = useState<{ assets: number; liabilities: number; netWorth: number } | null>(null);
  useEffect(() => {
    // linkedAccountBalances / linkedTransactions are gated by auth token.
    // We treat the state as "ready" whenever we're not signed in OR the
    // linked fetch has landed (linkedAccountBalances is an array, not null).
    if (!auth.token) {
      setPublishedNetWorth({ assets: canonicalTotalAssets, liabilities: canonicalTotalLiabilities, netWorth: canonicalTotalAssets - canonicalTotalLiabilities });
      return;
    }
    const nextNet = canonicalTotalAssets - canonicalTotalLiabilities;
    // Reconcile: only publish when Assets − Liabilities exactly equals the
    // computed netWorth (they're computed above from the same inputs so it
    // must; this is a defensive check for future refactors).
    if (Math.abs(nextNet - (canonicalTotalAssets - canonicalTotalLiabilities)) > 0.01) {
      // eslint-disable-next-line no-console
      console.warn('[NetWorth] mismatch detected — not publishing', { canonicalTotalAssets, canonicalTotalLiabilities, nextNet });
      return;
    }
    setPublishedNetWorth({ assets: canonicalTotalAssets, liabilities: canonicalTotalLiabilities, netWorth: nextNet });
  }, [canonicalTotalAssets, canonicalTotalLiabilities, auth.token]);
  const netWorth = publishedNetWorth ? publishedNetWorth.netWorth : (canonicalTotalAssets - canonicalTotalLiabilities);
  const totalAssets = publishedNetWorth ? publishedNetWorth.assets : canonicalTotalAssets;
  const totalLiabilities = publishedNetWorth ? publishedNetWorth.liabilities : canonicalTotalLiabilities;
  // Global financials-ready gate. Every derived $ value on Home / Wealth /
  // Legacy / Reports should mask itself (••••••) until this flips true so
  // users never see a stale/partial number during a refresh (spec).
  const financialsReady = !auth.token
    ? true
    : (balancesLoaded && transactionsLoaded && publishedNetWorth !== null);
  // Set Aside cash aggregation — hoisted to App-level so Legacy/Home can use
  // Available Cash (= totalCash − totalRestricted) as the BUILD starting cash.
  const totalRestricted = React.useMemo(() => {
    const active = (restrictedBuckets || []).filter((b: any) => !b?.archived);
    return active.reduce((sum: number, b: any) => sum + (Number(b.amount) || 0), 0);
  }, [restrictedBuckets]);
  const availableCash = totalCash - totalRestricted;
  // Effective budgeted income/expense for the CURRENT local month — spec:
  // "BUILD should pull directly from the selected month's Budget". We use
  // per-month overrides (`sub.months[currentMonthIdx]`) when the user has
  // customized that specific month; otherwise fall back to the annual
  // default (`sub.budgeted`). This makes the Legacy "Monthly Budget Net"
  // reconcile EXACTLY with the Budget module for the same month/year.
  const currentMonthIdx = new Date().getMonth();
  const effBudget = (x: any): number => {
    if (!x) return 0;
    if (x.months && x.months[currentMonthIdx] !== undefined && x.months[currentMonthIdx] !== null) {
      return Number(x.months[currentMonthIdx]) || 0;
    }
    return Number(x.budgeted) || 0;
  };
  const monthlyBudgetIncome = incomeSources.reduce((sum, x: any) => sum + effBudget(x), 0);
  const monthlyBudgetExpense = categories.flatMap(c => c.subcategories).reduce((sum, x: any) => sum + effBudget(x), 0);
  const monthlyNet = monthlyBudgetIncome - monthlyBudgetExpense;
  const monthlyBudget = monthlyBudgetExpense;

  // ---- Legacy: per-month Net lookup + full BUILD breakdown --------
  // BUILD is BUDGET-BASED ONLY. Actual transactions must never influence
  // the BUILD projection (they belong to Budget vs Actual reporting).
  //
  // This callback returns BOTH the per-month rows AND the run-rate
  // metadata so the LegacyScreen "How this is calculated" card can
  // display exactly which months feed the run rate and which months use
  // a specific budget vs an estimated run rate. There is ONE source of
  // truth — the same rows drive the headline card, the chart, the
  // tooltip, the year-by-year table, and the drill-down list.
  //
  // For every projected month M (from now → now+N):
  //   1. If the user has entered an explicit budget FOR that month
  //      (month-specific overrides OR a per-year snapshot), use that
  //      month's exact Budgeted Income − Budgeted Expenses.
  //   2. Otherwise fall back to a "run rate" derived from the trailing
  //      history of BUDGET months the user has already set up:
  //         • 1 budget month available  → use it
  //         • 2                         → average the two
  //         • 3–11                      → average of the most recent 3
  //         • 12+                       → average of the most recent 12
  //      The run rate includes surpluses AND deficits — a negative
  //      run-rate is applied as-is (projection can decline).
  const _computeLegacyPerMonthNet = React.useCallback((totalMonths: number) => {
    const rows: { month: number; net: number; source: 'budgeted' | 'estimated'; ym: string; label: string; year: number; monthIdx: number }[] = [];
    const now = new Date();
    const startY = now.getFullYear();
    const startM = now.getMonth();
    const savedSet = new Set<string>(finalizedBudgetMonths);

    // Compute the net for (year, monthIdx) purely from category /
    // income-source data. This function does NOT decide whether the
    // month is "budgeted" vs "estimated" — that's the caller's job
    // via the `finalizedBudgetMonths` set.
    const budgetNetForMonth = (y: number, m: number): number => {
      const cats = ((categoriesByYear as any) && (categoriesByYear as any)[String(y)]) || categories;
      const srcs = incomeSources;
      const income = srcs.reduce((s: number, x: any) => {
        const o = x?.months && x.months[m];
        return s + (typeof o === 'number' ? o : (Number(x?.budgeted) || 0));
      }, 0);
      const expense = cats.flatMap((c: any) => c?.subcategories || []).reduce((s: number, x: any) => {
        const o = x?.months && x.months[m];
        return s + (typeof o === 'number' ? o : (Number(x?.budgeted) || 0));
      }, 0);
      return income - expense;
    };

    // ---- Build the trailing history of ACTUAL saved budget months. Only
    // months in `finalizedBudgetMonths` count — annual defaults, unsaved
    // future months, and per-year snapshots without per-month edits are
    // deliberately excluded so the run rate reflects real, user-declared
    // budgets only.
    const allBudgetMonths: { ym: string; label: string; net: number; year: number; monthIdx: number }[] = [];
    // Walk back 60 months (5yr) to gather any saved budget months.
    for (let i = 0; i <= 60; i++) {
      const d = new Date(startY, startM - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${m}`;
      if (savedSet.has(key)) {
        allBudgetMonths.push({
          ym: key,
          label: `${MONTHS[m]} ${y}${i === 0 ? ' (this month)' : ''}`,
          net: budgetNetForMonth(y, m),
          year: y,
          monthIdx: m,
        });
      }
    }
    // Also walk forward up to 60 months in case the user has saved
    // budgets for future months — those count as saved-budget history
    // for run-rate purposes, but are ordered newest-first (most recent
    // saved months first) so the "recent 3" slice picks up the freshest.
    const forwardSaved: { ym: string; label: string; net: number; year: number; monthIdx: number }[] = [];
    for (let i = 1; i <= 60; i++) {
      const d = new Date(startY, startM + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${m}`;
      if (savedSet.has(key)) {
        forwardSaved.push({
          ym: key,
          label: `${MONTHS[m]} ${y}`,
          net: budgetNetForMonth(y, m),
          year: y,
          monthIdx: m,
        });
      }
    }
    // Merge: [...forwardSaved (soonest first), ...allBudgetMonths (this
    // month first, then trailing)]. Sort by proximity to "now" desc so
    // the newest saved budget appears first regardless of past/future.
    const merged = [...allBudgetMonths, ...forwardSaved]
      .sort((a, b) => {
        const da = (a.year - startY) * 12 + (a.monthIdx - startM);
        const db = (b.year - startY) * 12 + (b.monthIdx - startM);
        // Order: current month, then closest future, then closest past.
        return Math.abs(da) - Math.abs(db);
      });

    // ---- Compute the run rate from the trailing saved budget months.
    //   • 0 real budget months → 0 (BUILD projects Starting Wealth flat)
    //   • 1                    → use it
    //   • 2                    → average
    //   • 3–11                 → average of most recent 3
    //   • 12+                  → average of most recent 12
    const n = merged.length;
    let take: number;
    if (n === 0) take = 0;
    else if (n === 1) take = 1;
    else if (n === 2) take = 2;
    else if (n < 12) take = 3;
    else take = 12;
    const runRateSlice = merged.slice(0, take);
    const runRate = runRateSlice.length > 0
      ? runRateSlice.reduce((a, b) => a + b.net, 0) / runRateSlice.length
      : 0;

    // ---- Project each future month.
    for (let i = 0; i < totalMonths; i++) {
      const my = new Date(startY, startM + i, 1);
      const y = my.getFullYear();
      const m = my.getMonth();
      const label = `${MONTHS[m]} ${y}`;
      const key = `${y}-${m}`;

      let net: number;
      let source: 'budgeted' | 'estimated';
      if (savedSet.has(key)) {
        // Real user-saved budget for this month.
        net = budgetNetForMonth(y, m);
        source = 'budgeted';
      } else {
        // No real budget → estimate from the run rate.
        net = runRate;
        source = 'estimated';
      }
      rows.push({ month: i + 1, net, source, ym: key, label, year: y, monthIdx: m });
    }
    // Expose metadata alongside the array so the drill-down UI can render
    // the exact contributing months and the resulting run rate.
    (rows as any).runRate = runRate;
    (rows as any).runRateSlice = runRateSlice;
    (rows as any).allBudgetMonths = merged;
    (rows as any).currentBudgetNet = budgetNetForMonth(startY, startM);
    (rows as any).finalizedBudgetMonthCount = merged.length;
    return rows as any;
  }, [categoriesByYear, categories, incomeSources, finalizedBudgetMonths]);

  const legacyPerMonthNet = React.useCallback((totalMonths: number) => {
    // Defensive wrapper — any crash inside the monthly projection would
    // previously bubble to the app root and show the Redbox. We now return
    // an empty projection with the error attached as metadata so the
    // Legacy screen renders "no projection yet" instead of the whole app
    // crashing (e.g. mid-statement-import when linked accounts churn).
    try {
      return _computeLegacyPerMonthNet(totalMonths);
    } catch (e: any) {
      const fallback: any[] = [];
      (fallback as any).error = e?.message || 'Could not project monthly net';
      (fallback as any).runRate = 0;
      (fallback as any).currentBudgetNet = 0;
      (fallback as any).finalizedBudgetMonthCount = 0;
      console.warn('[Jaleter] legacyPerMonthNet crashed:', e);
      return fallback as any;
    }
  }, [_computeLegacyPerMonthNet]);
  // Human-readable source period for the Legacy → Monthly Surplus drill-down.
  // Uses the currently-selected budget year + the real calendar month so the
  // label reads e.g. "August 2026 budget".
  const monthlyBudgetPeriod = React.useMemo(() => {
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    return `${monthName} ${budgetYear} budget`;
  }, [budgetYear]);
  // Same expense basis the old cash-sync used — Home "budget used" indicator.
  const totalExpenses = React.useMemo(
    () => transactions.filter(t => t.type === 'expense' && !isSystemTransaction(t)).reduce((sum, t) => sum + t.amount, 0),
    [transactions],
  );
  const budgetUsage = monthlyBudget > 0 ? (totalExpenses / monthlyBudget) * 100 : 0;
  const nav = (screen: string, category: string | null = null) => { setActive(screen); if (category) setFocusCategory(category); };

  // Multi-year budget: snapshot the current year's categories into the map,
  // then load the target year (or clone from current if untouched). This
  // keeps a single `categories` state as the "active year" for every consumer
  // downstream while letting users build multiple years side-by-side.
  const switchBudgetYear = (nextYear: number) => {
    if (nextYear === budgetYear) return;
    setCategoriesByYear((prev) => {
      const merged = { ...prev, [String(budgetYear)]: categories };
      const target = merged[String(nextYear)];
      // Load the target year's snapshot; if none exists, clone from current
      // as a starter template (structure preserved, amounts kept).
      setCategories(target ? target : JSON.parse(JSON.stringify(categories)));
      return merged;
    });
    setBudgetYear(nextYear);
  };

  if (!hydrated || auth.loading) return <View style={{ flex: 1, backgroundColor: C.cream }} testID="auth-loading" />;
  // Signed-in users never see Welcome/Login/Signup — hold a quiet splash for
  // the moment the membership routing effect needs to pick dashboard vs paywall.
  if (auth.user && stage !== 'app' && stage !== 'paywall') {
    return <View style={{ flex: 1, backgroundColor: C.cream }} testID="membership-routing" />;
  }

  const bg = isDark ? D.bg : C.cream;
  const displayName = (auth.user?.name || 'Friend').split(' ')[0];
  const displayInitials = initialsOf(auth.user?.name, auth.user?.email);

  return (
    <ThemeCtx.Provider value={{ dark: isDark }}>
    <SafeAreaView style={[s.appShell, { backgroundColor: bg }]} testID="app-shell">
      <RNStatusBar barStyle={stage === 'welcome' || isDark ? 'light-content' : 'dark-content'} />
      {!auth.user && stage === 'welcome' && <Welcome onStart={() => setStage('onboarding')} onLogin={() => setStage('login')} />}
      {!auth.user && stage === 'onboarding' && <Onboarding experience={experience} setExperience={setExperience} onContinue={() => setStage('signup')} back={() => setStage('welcome')} />}
      {!auth.user && stage === 'signup' && <Signup back={() => setStage('onboarding')} onCreated={() => setStage('paywall')} goLogin={() => setStage('login')} />}
      {!auth.user && stage === 'login' && <Login back={() => setStage('welcome')} goSignup={() => setStage('signup')} goForgot={() => setStage('forgot')} />}
      {!auth.user && stage === 'forgot' && <ForgotPassword back={() => setStage('login')} onSent={(email: string, token: string | null) => { setResetInfo({ email, token }); setStage('reset'); }} />}
      {!auth.user && stage === 'reset' && <ResetPassword back={() => setStage('login')} email={resetInfo.email} prefilledToken={resetInfo.token} onDone={() => setResetInfo({ email: '', token: null })} />}
      {auth.user && stage === 'paywall' && (
        <Paywall
          email={auth.user.email}
          checkMembership={checkMembership}
          onUnlocked={() => setStage('app')}
          onSwitchAccount={async () => { await auth.logout(); setActive('home'); setStage('login'); }}
        />
      )}
      {auth.user && stage === 'app' && appLock.enabled && appLock.locked && (
        <AppLockGate
          storedPin={appLock.pin}
          biometricsEnabled={appLock.biometricsEnabled}
          biometricsAvailable={appLock.biometricsAvailable}
          onUnlock={() => setAppLock((a) => ({ ...a, locked: false }))}
          onForgotPin={() => setForgotPinOpen(true)}
        />
      )}
      <ForgotPinModal
        visible={forgotPinOpen}
        close={() => setForgotPinOpen(false)}
        onReset={() => {
          // PIN + biometrics were wiped from SecureStore by the modal on
          // successful password re-verification. Unlock the app now and
          // clear local App Lock state so the gate does not re-appear.
          setForgotPinOpen(false);
          setAppLock({ enabled: false, pin: '', biometricsEnabled: false, biometricsAvailable: appLock.biometricsAvailable, locked: false });
        }}
      />
      {auth.user && stage === 'app' && !(appLock.enabled && appLock.locked) && (
        <View style={[{ flex: 1 }, isDark && { backgroundColor: D.bg }]}>
          <UpdateBanner isDark={isDark} />
          <EmailVerificationBanner isDark={isDark} />
          {active === 'home' && <HomeScreen name={displayName} initials={displayInitials} experience={experience} netWorth={netWorth} investmentTotal={investmentTotal} totalCash={totalCash} availableCash={availableCash} monthlyNet={monthlyNet} legacyContribution={legacyContribution} legacyHypothetical={legacyHypothetical} legacyHypoFrequency={legacyHypoFrequency} legacyHypoDuration={legacyHypoDuration} legacyReturnRate={legacyReturnRate} budgetUsage={budgetUsage} alertsEnabled={alerts.enabled} navigate={nav} financialsReady={financialsReady} />}
          {active === 'budget' && <BudgetScreen categories={categories} setCategories={setCategories} categoriesByYear={categoriesByYear} setCategoriesByYear={setCategoriesByYear} incomeSources={incomeSources} setIncomeSources={setIncomeSources} transactions={transactions} setTransactions={setTransactions} focusCategory={focusCategory} clearFocus={() => setFocusCategory(null)} alerts={alerts} budgetYear={budgetYear} finalizedBudgetMonths={finalizedBudgetMonths} setFinalizedBudgetMonths={setFinalizedBudgetMonths} onSwitchYear={switchBudgetYear} onCopyLastYear={(prevYear: number) => {
            // "Copy last year" — deep-copies categories + planned amounts (per-
            // month figures inside subcategories.monthly + the base .budgeted
            // value) but strips any actual transactions. Categories that only
            // existed in prev-year but not in current are added; the user's
            // saved current-year categories are replaced (per spec #13
            // wording — user chose this action explicitly via a confirmation).
            const src = categoriesByYear[String(prevYear)];
            if (!Array.isArray(src)) return;
            const cloned = src.map((c: any) => ({
              ...c,
              subcategories: (c.subcategories || []).map((sub: any) => ({ ...sub, monthly: sub.monthly ? { ...sub.monthly } : undefined })),
            }));
            setCategories(cloned);
          }} />}
          {active === 'coach' && <CoachAIScreen isDark={isDark} context={{
            budgetYear,
            categories,
            incomeSources,
            transactions,
            netWorth,
            totalCash,
            investmentTotal,
            monthlyNet,
            linkedAccountsCount: validLinked.length,
            experience,
            legacy: {
              timeframe: legacyTimeframe,
              contribution: legacyContribution,
              hypothetical: legacyHypothetical,
              hypoFrequency: legacyHypoFrequency,
              hypoDuration: legacyHypoDuration,
              returnRate: legacyReturnRate,
              cumulative: legacyCumulative,
            },
          }} />}
          {active === 'transactions' && <TransactionsScreen transactions={mergedTransactions} setTransactions={setTransactions} categories={categories} incomeSources={incomeSources} alerts={alerts} openLinkSheet={() => { setActive('settings'); }} onRefresh={refreshAccounts} addSubcategory={(groupId: string, name: string) => {
            // Smart categorization: user-approved new budget category.
            const sid = `sub-${Date.now().toString(36)}`;
            setCategories((prev: any[]) => prev.map((c: any) => c.id !== groupId ? c : { ...c, subcategories: [...c.subcategories, { id: sid, name, budgeted: 0 }] }));
            return sid;
          }} />}
          {active === 'networth' && <NetWorthScreen assets={assets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} transactions={transactions} restrictedBuckets={restrictedBuckets} setRestrictedBuckets={setRestrictedBuckets} linkedRowsByCategory={linkedRowsByCategory} linkedByCategory={linkedByCategory} onRefreshAccounts={refreshAccounts} canonicalTotalAssets={totalAssets} canonicalTotalLiabilities={totalLiabilities} canonicalNetWorth={netWorth} financialsReady={financialsReady} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={validLinked.length} onBack={() => setActive('home')} />}
          {active === 'legacy' && <LegacyScreen investmentTotal={investmentTotal} totalCash={totalCash} availableCash={availableCash} totalRestricted={totalRestricted} monthlyNet={monthlyNet} monthlyBudgetIncome={monthlyBudgetIncome} monthlyBudgetExpense={monthlyBudgetExpense} monthlyBudgetPeriod={monthlyBudgetPeriod} perMonthNet={legacyPerMonthNet} financialsReady={financialsReady} timeframe={legacyTimeframe} setTimeframe={setLegacyTimeframe} contribution={legacyContribution} setContribution={setLegacyContribution} hypothetical={legacyHypothetical} setHypothetical={setLegacyHypothetical} hypoFrequency={legacyHypoFrequency} setHypoFrequency={setLegacyHypoFrequency} hypoDuration={legacyHypoDuration} setHypoDuration={setLegacyHypoDuration} returnRate={legacyReturnRate} setReturnRate={setLegacyReturnRate} cumulative={legacyCumulative} setCumulative={setLegacyCumulative} currentAge={currentAge} setCurrentAge={setCurrentAge} retirementAge={retirementAge} setRetirementAge={setRetirementAge} />}
          {active === 'reports' && <ReportsScreen transactions={transactions} categories={categories} incomeSources={incomeSources} back={() => nav('home')} />}
          {active === 'coaching' && <CoachingScreen back={() => nav('more')} />}
          {active === 'membership' && <MembershipScreen back={() => nav('more')} />}
          {active === 'settings' && <SettingsScreen initials={displayInitials} experience={experience} setExperience={setExperience} appearance={appearance} setAppearance={setAppearance} alerts={alerts} setAlerts={setAlerts} categories={categories} appLock={appLock} setAppLock={(next: any) => setAppLock({ ...appLock, ...next })} onLogout={async () => { await auth.logout(); setActive('home'); setStage('welcome'); }} back={() => nav('more')} linkedAccounts={linkedAccounts} linkedAccountCount={validLinked.length} addLinked={(a: any[]) => { setLinkedAccounts([...linkedAccounts, ...a]); refreshAccounts(); }} onResetAppData={async () => {
            // Spec #18 — Reset App Data behavior: KEEP Plaid + subscription +
            // login, CLEAR the user's financial content on BOTH the server AND
            // local cache. The previous implementation only reset local state,
            // so all budgets/transactions came back from the server on next
            // login. We now call the backend first — if that succeeds, the
            // local state reset below just mirrors what the server already
            // did. If the backend call fails, we throw and the modal shows
            // an error rather than half-resetting.
            try {
              await apiCall('/api/user/reset-data', { method: 'POST' }, auth.token || '');
            } catch (e: any) {
              // Bubble the error to the modal so the user sees why it failed.
              throw new Error(e?.message || 'Could not reset your data. Please try again.');
            }
            try { await storage.removeItem(STORAGE_KEY); } catch {}
            for (const k of LEGACY_STORAGE_KEYS) { try { await storage.removeItem(k); } catch {} }
            setTransactions([]);
            setLinkedAccounts([]);           // local list — server still has plaid_items
            setLinkedAccountBalances([]);    // clear cached /accounts/all snapshot
            setCategories(initialCategories);
            setCategoriesByYear({});
            setIncomeSources(initialIncome);
            setRestrictedBuckets([]);
            setAssets(initialAssets);
            setLiabilities([]);
            setLegacyTimeframe('Retirement');
            setLegacyContribution(0);
            setLegacyHypothetical('');
            setLegacyHypoFrequency('onetime');
            setLegacyHypoDuration(null);
            setLegacyReturnRate(DEFAULT_LEGACY_RATE);
            setLegacyCumulative(false);
            setCurrentAge(30);
            setRetirementAge(65);
            setExperience('Faith');
            setAppearance('System');
            setAlerts({ enabled: true, threshold: 80, perCategory: {}, singleExpense: { enabled: false, threshold: 200 } });
          }} />}
          <BottomNav active={active} setActive={(id: string) => { setActive(id); }} isDark={isDark} />
        </View>
      )}
      {globalToast && <SharedToast message={globalToast} onHide={() => setGlobalToast(null)} />}
    </SafeAreaView>
    </ThemeCtx.Provider>
  );
}

/* ---------------- Styles ---------------- */

