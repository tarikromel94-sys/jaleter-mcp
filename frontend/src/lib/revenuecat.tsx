/**
 * RevenueCat (Emergent-managed) — Apple/Google in-app subscriptions.
 *
 * - SDK init happens ONCE at module scope from app/_layout.tsx.
 * - `pro` entitlement (annual $89.99) is THE Jaleter Premium entitlement.
 * - Web preview / Expo Go run against the RevenueCat Test Store (simulated
 *   but end-to-end); store builds use the native SDK with real billing.
 * - `syncIapToBackend` posts the verified entitlement snapshot to
 *   /api/iap/sync so the server-side paywall recognizes IAP buyers.
 */
import React, { createContext, useContext, useEffect } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall } from '@/src/AuthContext';

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_IDENTIFIER = 'pro';

export const rcEnabled = Platform.OS !== 'web' || __DEV__; // production web has no store

/** True when the SDK is running against the RevenueCat Test Store (simulated). */
export const rcUsingTestStore = Platform.OS === 'web' || __DEV__;

/** Key selection — RevenueCat project "Jaleter Budgeting App" ONLY.
 *  • Release / TestFlight / App Store / Play builds: iOS → `appl_…`,
 *    Android → `goog_…`. The Test Store key is NEVER allowed here.
 *  • Web preview + Expo Go (__DEV__): Test Store key (`test_…`). */
function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error('RevenueCat public API keys not found in env');
  }
  if (Platform.OS === 'web' || __DEV__) return REVENUECAT_TEST_API_KEY;
  const key = Platform.OS === 'ios' ? REVENUECAT_IOS_API_KEY : REVENUECAT_ANDROID_API_KEY;
  const expected = Platform.OS === 'ios' ? 'appl_' : 'goog_';
  if (!key.startsWith(expected)) {
    throw new Error(`RevenueCat key for ${Platform.OS} must start with "${expected}" in release builds (got "${key.slice(0, 5)}…")`);
  }
  return key;
}

/** Masked active key for diagnostics, e.g. "appl_NWgjk…" (prefix + 5 chars). */
export function rcActiveKeyMasked(): string {
  try {
    const k = getRevenueCatApiKey();
    const us = k.indexOf('_');
    return `${k.slice(0, us + 1)}${k.slice(us + 1, us + 6)}…`;
  } catch (e: any) {
    return `ERROR: ${String(e?.message || e)}`;
  }
}

/** Last identity-binding outcome, surfaced in paywall diagnostics. */
let lastBindResult = 'not attempted';
export function getLastBindResult(): string { return lastBindResult; }

export function initializeRevenueCat() {
  if (!rcEnabled) return;
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: getRevenueCatApiKey() });
}

/** Push an ACTIVE entitlement snapshot to the backend so the server-side
 *  paywall unlocks for Apple/Google subscribers. NEVER posts a revoke —
 *  browser/test SDKs can report empty entitlements for users who legitimately
 *  bought on iOS, so the client must never be able to take premium away.
 *  Expiry lapses naturally server-side (stored expirationDate). */
export async function syncIapToBackend(token: string, info: CustomerInfo | null | undefined): Promise<boolean> {
  const ent = info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER];
  if (!ent) return false; // no active entitlement → nothing to sync, never revoke
  try {
    const res = await apiCall('/api/iap/sync', {
      method: 'POST',
      body: JSON.stringify({
        active: true,
        expires_at: ent.expirationDate || null,
        product_id: ent.productIdentifier || null,
        platform: Platform.OS,
      }),
    }, token);
    return !!res?.active;
  } catch (e) {
    console.warn('[RevenueCat] backend sync failed:', e);
    return false;
  }
}

// ---- Identity binding ----------------------------------------------------
// Native store builds: Purchases.logIn/logOut. Browser mode (web preview and
// Expo Go run purchases-js) has a no-op logIn — identity must be set by
// re-configuring the SDK with appUserID. After a bind, registered listeners
// (SubscriptionProvider) invalidate the cached customer-info/offerings.
let identityListeners: (() => void)[] = [];
export function onRcIdentityChanged(fn: () => void): () => void {
  identityListeners.push(fn);
  return () => { identityListeners = identityListeners.filter((f) => f !== fn); };
}

export async function bindRevenueCatIdentity(uid: string | null): Promise<void> {
  if (!rcEnabled) return;
  try {
    if (rcUsingTestStore) {
      // purchases-js browser mode: reconfigure with the stable app user id.
      Purchases.configure({ apiKey: getRevenueCatApiKey(), appUserID: uid ? String(uid) : undefined });
      lastBindResult = `configure(appUserID=${uid || 'anonymous'}) ok`;
    } else if (uid) {
      const res: any = await Purchases.logIn(String(uid));
      const got = res?.customerInfo?.originalAppUserId || '';
      lastBindResult = `logIn(${uid}) ok · created=${String(res?.created)} · original=${got || '?'}`;
    } else {
      await Purchases.logOut();
      lastBindResult = 'logOut ok';
    }
  } catch (e: any) {
    lastBindResult = `${uid ? 'logIn' : 'logOut'} FAILED: ${String(e?.message || e)}`;
    throw e;
  }
  identityListeners.forEach((fn) => { try { fn(); } catch {} });
}

/** Is the SDK's CURRENT customer anonymous?
 *  IMPORTANT: never judge this from `customerInfo.originalAppUserId` — that
 *  field is the FIRST id the customer was created with and stays
 *  `$RCAnonymousID:…` forever after a native `logIn()` aliases the anonymous
 *  customer to the Jaleter user id. On real iPhones that false positive
 *  blocked every purchase with "account link failed (anonymous customer)". */
export async function rcIsAnonymous(): Promise<{ anonymous: boolean; appUserId: string }> {
  let appUserId = '';
  try { appUserId = String(await Purchases.getAppUserID()); } catch {}
  try {
    const anon = await Purchases.isAnonymous();
    return { anonymous: !!anon, appUserId };
  } catch {
    return { anonymous: !appUserId || appUserId.startsWith('$RCAnonymousID:'), appUserId };
  }
}

/** Self-healing pre-purchase check. Re-runs configure + identity binding on
 *  demand (the launch-time attempt can fail silently on device) and returns
 *  either a linked customer or the REAL underlying error so the paywall can
 *  show something actionable instead of stalling on "preparing". */
export async function ensureRcReady(uid: string | null | undefined): Promise<{ ok: boolean; appUserId?: string; error?: string }> {
  if (!rcEnabled) return { ok: false, error: 'in-app purchases are not available on this platform' };
  if (!uid) return { ok: false, error: 'no signed-in account' };
  try {
    let configured = true;
    try {
      configured = await Promise.resolve((Purchases as any).isConfigured());
    } catch {
      configured = false;
    }
    if (!configured) initializeRevenueCat();
    let bindError = '';
    try {
      await bindRevenueCatIdentity(String(uid));
    } catch (e: any) {
      bindError = String(e?.message || e || 'logIn failed');
    }
    let { anonymous, appUserId } = await rcIsAnonymous();
    if (anonymous) {
      // Last resort on native: re-configure the SDK with an explicit app user
      // id (RevenueCat allows re-configure; it logs a warning). This covers
      // devices where logIn() resolves but the identity never sticks.
      try {
        Purchases.configure({ apiKey: getRevenueCatApiKey(), appUserID: String(uid) });
        identityListeners.forEach((fn) => { try { fn(); } catch {} });
        ({ anonymous, appUserId } = await rcIsAnonymous());
      } catch (e: any) {
        bindError = bindError || String(e?.message || e || 'configure failed');
      }
    }
    if (anonymous) {
      return {
        ok: false,
        appUserId,
        error: `account link failed — RevenueCat user "${appUserId || 'none'}" is anonymous, expected "${uid}"${bindError ? ` · ${bindError}` : ''}`,
      };
    }
    return { ok: true, appUserId };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || 'unknown error') };
  }
}

function useSubscriptionContext() {
  const queryClient = useQueryClient();

  const customerInfoQuery = useQuery({
    queryKey: ['revenuecat', 'customer-info'],
    queryFn: () => Purchases.getCustomerInfo(),
    enabled: rcEnabled,
    staleTime: 60 * 1000,
  });

  const offeringsQuery = useQuery({
    queryKey: ['revenuecat', 'offerings'],
    queryFn: () => Purchases.getOfferings(),
    enabled: rcEnabled,
    staleTime: 300 * 1000,
  });

  // Reactive entitlement updates — pushed by the SDK after purchases,
  // restores, renewals, and logIn/logOut. Never poll for this.
  useEffect(() => {
    if (!rcEnabled) return;
    const listener = (info: CustomerInfo) =>
      queryClient.setQueryData(['revenuecat', 'customer-info'], info);
    Purchases.addCustomerInfoUpdateListener(listener);
    // Identity re-binds (incl. browser-mode reconfigure) invalidate the cache
    // so customer-info/offerings reload under the new app user id.
    const offIdentity = onRcIdentityChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['revenuecat'] });
    });
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
      offIdentity();
    };
  }, [queryClient]);

  const purchaseMutation = useMutation({
    mutationFn: async (packageToPurchase: PurchasesPackage) => {
      // Choke point: never let an anonymous purchase through.
      const { anonymous } = await rcIsAnonymous();
      if (anonymous) throw new Error('identity_not_ready');
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  // Current (not original) app user id — see rcIsAnonymous().
  const appUserIdQuery = useQuery({
    queryKey: ['revenuecat', 'app-user-id'],
    queryFn: async () => (await rcIsAnonymous()),
    enabled: rcEnabled,
    staleTime: 60 * 1000,
  });
  const identityReady = !!appUserIdQuery.data && !appUserIdQuery.data.anonymous;

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    identityReady,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    refetchOfferings: offeringsQuery.refetch,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useSubscription must be used within a SubscriptionProvider');
  return ctx;
}
