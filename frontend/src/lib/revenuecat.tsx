/**
 * RevenueCat (Emergent-managed) — Apple/Google in-app subscriptions.
 *
 * - SDK init happens ONCE at module scope from app/_layout.tsx.
 * - `pro` entitlement (annual $90) mirrors the same premium Stripe grants.
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

function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error('RevenueCat public API keys not found in env');
  }
  if (Platform.OS === 'web' || __DEV__) return REVENUECAT_TEST_API_KEY;
  if (Platform.OS === 'ios') return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === 'android') return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

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
  if (rcUsingTestStore) {
    // purchases-js browser mode: reconfigure with the stable app user id.
    Purchases.configure({ apiKey: getRevenueCatApiKey(), appUserID: uid ? String(uid) : undefined });
  } else if (uid) {
    await Purchases.logIn(String(uid));
  } else {
    await Purchases.logOut();
  }
  identityListeners.forEach((fn) => { try { fn(); } catch {} });
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
      const id = (await Purchases.getCustomerInfo()).originalAppUserId;
      if (id.startsWith('$RCAnonymousID:')) throw new Error('identity_not_ready');
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER] !== undefined;

  const originalAppUserId = customerInfoQuery.data?.originalAppUserId;
  const identityReady = !!originalAppUserId && !originalAppUserId.startsWith('$RCAnonymousID:');

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    identityReady,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
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
