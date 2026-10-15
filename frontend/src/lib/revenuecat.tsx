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
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall } from '@/src/AuthContext';

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || 'appl_NWgjkOMfQcXaPDLJxjSNhmBaaDK';
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || 'goog_JJZijBzcPEDAuBIHieCbAnXwUez';
export const REVENUECAT_ENTITLEMENT_IDENTIFIER = 'pro';

export const rcEnabled = Platform.OS !== 'web' || __DEV__; // production web has no store

/** True when the SDK is running against the RevenueCat Test Store (simulated). */
export const rcUsingTestStore = Platform.OS === 'web' || __DEV__;

/** Key selection — RevenueCat project "Jaleter Budgeting App" ONLY.
 *  • Release / TestFlight / App Store / Play builds: iOS → `appl_…`,
 *    Android → `goog_…`. The Test Store key is NEVER allowed here.
 *  • Web preview + Expo Go (__DEV__): Test Store key (`test_…`). */
function getRevenueCatApiKey(): string {
  if (!REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error('RevenueCat public API keys not found in env');
  }
  if (Platform.OS === 'web' || __DEV__) {
    if (!REVENUECAT_TEST_API_KEY) throw new Error('RevenueCat Test Store key not found in env');
    return REVENUECAT_TEST_API_KEY;
  }
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

/** Launch-time setup: log level only. The SDK is configured LAZILY with the
 *  signed-in Jaleter user id (see bindRevenueCatIdentity) so an authenticated
 *  user is never represented by an anonymous RevenueCat customer. */
export function initializeRevenueCat() {
  if (!rcEnabled) return;
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
}

async function rcIsConfigured(): Promise<boolean> {
  try { return !!(await Promise.resolve((Purchases as any).isConfigured())); } catch { return false; }
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
// REQUIRED FLOW: authenticated Jaleter user (email / Apple / Google) →
// internal `user_id` → RevenueCat app user id === that `user_id` → StoreKit /
// Play purchase → entitlement attached to that Jaleter account.
//
// The SDK is configured WITH the Jaleter user id the first time an
// authenticated user is known (`configure({ appUserID })`), so no anonymous
// customer is ever created for a signed-in user. Account switches use
// `logIn(newId)`; sign-out uses `logOut()` (only when the current customer
// is identified — logOut on an anonymous customer throws).
// Every bind is VERIFIED by exact equality: `getAppUserID() === user_id`.
let identityListeners: (() => void)[] = [];
export function onRcIdentityChanged(fn: () => void): () => void {
  identityListeners.push(fn);
  return () => { identityListeners = identityListeners.filter((f) => f !== fn); };
}
function notifyIdentity() { identityListeners.forEach((fn) => { try { fn(); } catch {} }); }

/** Bound Jaleter user id (null = signed out / not yet bound). */
let boundUid: string | null = null;
export function getBoundUid(): string | null { return boundUid; }

export async function bindRevenueCatIdentity(uid: string | null): Promise<void> {
  if (!rcEnabled) return;
  const target = uid ? String(uid) : null;
  try {
    if (target) {
      const configured = await rcIsConfigured();
      if (rcUsingTestStore || !configured) {
        // First identified configure (native) / browser-mode reconfigure.
        Purchases.configure({ apiKey: getRevenueCatApiKey(), appUserID: target });
        lastBindResult = `configure(appUserID=${target}) ok`;
      } else {
        const current = String(await Purchases.getAppUserID());
        if (current !== target) {
          const res: any = await Purchases.logIn(target);
          lastBindResult = `logIn(${target}) ok · created=${String(res?.created)} · was=${current}`;
        } else {
          lastBindResult = `already bound (${target})`;
        }
      }
      // VERIFY — exact equality, never an "anonymous" heuristic.
      const now = String(await Purchases.getAppUserID());
      if (now !== target) {
        lastBindResult = `VERIFY FAILED · sdk=${now} · expected=${target}`;
        throw new Error(`RevenueCat identity mismatch: SDK user "${now}" ≠ Jaleter user "${target}"`);
      }
      boundUid = target;
    } else {
      boundUid = null;
      if (await rcIsConfigured()) {
        let anonymous = true;
        try { anonymous = !!(await Purchases.isAnonymous()); } catch {}
        if (!anonymous) {
          await Purchases.logOut();
          lastBindResult = 'logOut ok';
        } else {
          lastBindResult = 'logOut skipped (already anonymous)';
        }
      } else {
        lastBindResult = 'signed out · SDK not configured';
      }
    }
  } catch (e: any) {
    if (!lastBindResult.startsWith('VERIFY FAILED')) {
      lastBindResult = `${target ? 'bind' : 'logOut'} FAILED: ${String(e?.message || e)}`;
    }
    throw e;
  } finally {
    notifyIdentity();
  }
}

/** Current SDK identity vs. the expected Jaleter user id. */
export async function rcIdentity(expectedUid?: string | null): Promise<{ appUserId: string; anonymous: boolean; linked: boolean }> {
  let appUserId = '';
  let anonymous = true;
  if (await rcIsConfigured()) {
    try { appUserId = String(await Purchases.getAppUserID()); } catch {}
    try { anonymous = !!(await Purchases.isAnonymous()); } catch { anonymous = !appUserId || appUserId.startsWith('$RCAnonymousID:'); }
  }
  const linked = !!expectedUid && appUserId === String(expectedUid) && !anonymous;
  return { appUserId, anonymous, linked };
}

/** Pre-purchase guarantee: the SDK customer IS this Jaleter user. Re-binds on
 *  demand and returns the real underlying error (with both ids) on failure. */
export async function ensureRcReady(uid: string | null | undefined): Promise<{ ok: boolean; appUserId?: string; error?: string }> {
  if (!rcEnabled) return { ok: false, error: 'in-app purchases are not available on this platform' };
  if (!uid) return { ok: false, error: 'no signed-in account' };
  try {
    await bindRevenueCatIdentity(String(uid));
    const id = await rcIdentity(uid);
    if (!id.linked) {
      return { ok: false, appUserId: id.appUserId, error: `account link failed — RevenueCat user "${id.appUserId || 'none'}" ≠ Jaleter user "${uid}"` };
    }
    return { ok: true, appUserId: id.appUserId };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || 'unknown error') };
  }
}

function useSubscriptionContext() {
  const queryClient = useQueryClient();
  // Queries only run once the SDK is configured for a signed-in user.
  const [bound, setBound] = useState<string | null>(boundUid);

  const customerInfoQuery = useQuery({
    queryKey: ['revenuecat', 'customer-info', bound],
    queryFn: () => Purchases.getCustomerInfo(),
    enabled: rcEnabled && !!bound,
    staleTime: 60 * 1000,
  });

  const offeringsQuery = useQuery({
    queryKey: ['revenuecat', 'offerings', bound],
    queryFn: () => Purchases.getOfferings(),
    enabled: rcEnabled && !!bound,
    staleTime: 300 * 1000,
  });

  // Reactive entitlement updates — pushed by the SDK after purchases,
  // restores, renewals, and logIn/logOut. Never poll for this.
  useEffect(() => {
    if (!rcEnabled) return;
    const listener = (info: CustomerInfo) =>
      queryClient.setQueryData(['revenuecat', 'customer-info', boundUid], info);
    // Listener registration requires a configured SDK; (re)attach after binds.
    let attached = false;
    const attach = async () => {
      if (attached || !(await rcIsConfigured())) return;
      Purchases.addCustomerInfoUpdateListener(listener);
      attached = true;
    };
    attach();
    // Identity binds (configure / logIn / logOut) → reload everything under
    // the new app user id.
    const offIdentity = onRcIdentityChanged(() => {
      setBound(boundUid);
      attach();
      queryClient.invalidateQueries({ queryKey: ['revenuecat'] });
    });
    return () => {
      if (attached) Purchases.removeCustomerInfoUpdateListener(listener);
      offIdentity();
    };
  }, [queryClient]);

  const purchaseMutation = useMutation({
    mutationFn: async ({ pkg, uid }: { pkg: PurchasesPackage; uid: string }) => {
      // Choke point: the SDK customer MUST be this Jaleter user (exact match).
      const id = await rcIdentity(uid);
      if (!id.linked) throw new Error('identity_not_ready');
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return customerInfo;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  // Live SDK identity (current app user id) under the bound Jaleter user.
  const appUserIdQuery = useQuery({
    queryKey: ['revenuecat', 'identity', bound],
    queryFn: () => rcIdentity(bound),
    enabled: rcEnabled && !!bound,
    staleTime: 60 * 1000,
  });
  const identityReady = !!appUserIdQuery.data?.linked;

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    identityReady,
    appUserId: appUserIdQuery.data?.appUserId || '',
    boundUid: bound,
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
