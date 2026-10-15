import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, AppState, Platform, StyleSheet, Image } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { openJaleter } from '@/src/jaleterLinks';
import { openStoreListing, STORE_NAME } from '@/src/storeLinks';
import { useAuth } from '@/src/AuthContext';
import Purchases from 'react-native-purchases';
import { useSubscription, rcEnabled, rcUsingTestStore, syncIapToBackend, ensureRcReady, rcIdentity, rcActiveKeyMasked, getLastBindResult, REVENUECAT_ENTITLEMENT_IDENTIFIER } from '@/src/lib/revenuecat';
import { F } from '@/src/jaleterTheme';
import Constants from 'expo-constants';

// Bump whenever the paywall/purchase code changes so a tester can confirm the
// installed build actually contains the fix (shown in the footer).
const PAYWALL_CODE_STAMP = 'PW-2026.10.02-e';

/* ---------------- Membership Required (hard paywall) ---------------- */
// Access model: Jaleter is free to download, but every financial feature
// requires an ACTIVE Jaleter Premium subscription bought through Apple
// In-App Purchase (iPhone) or Google Play Billing (Android) — never Stripe.
// This screen intentionally has NO bypass — the only exits are:
//   1. the backend confirming an active entitlement (store-verified via
//      RevenueCat and synced to the account), or
//   2. signing into a different account that already has one.
// Entitlement is never decided locally; `checkMembership` always asks the
// server (`GET /api/user/membership`) and premium APIs return 402 anyway.
export const Paywall = ({ email, checkMembership, onUnlocked, onSwitchAccount }: any) => {
  const { token, user } = useAuth();
  const iap = useSubscription();
  const [busy, setBusy] = useState<null | 'refresh' | 'iap' | 'restore'>(null);
  const [notice, setNotice] = useState('');
  const [confirmTestBuy, setConfirmTestBuy] = useState(false);
  const [diag, setDiag] = useState<string>('');
  const diagTaps = useRef(0);
  const busyRef = useRef(false);

  // Hidden diagnostics: tap the price card 3× to print the live RevenueCat
  // state (app user id, identity, offering, package, store) — lets a tester
  // report exactly what the device sees without a debugger.
  const showDiagnostics = async () => {
    diagTaps.current += 1;
    if (diagTaps.current < 3) return;
    diagTaps.current = 0;
    if (diag) { setDiag(''); return; }
    const lines: string[] = [];
    try {
      const id = await rcIdentity(user?.user_id);
      lines.push(`RC user: ${id.appUserId || '(none)'} ${id.linked ? '(LINKED ✓ equals Jaleter id)' : id.anonymous ? '(ANONYMOUS ✗)' : '(MISMATCH ✗)'}`);
    } catch (e: any) { lines.push(`RC user: error ${String(e?.message || e)}`); }
    lines.push(`Jaleter user: ${user?.user_id || '(none)'} · provider: ${(user as any)?.provider || '?'}`);
    lines.push(`store: ${Platform.OS} ${rcUsingTestStore ? 'TEST STORE' : 'LIVE'} · identityReady=${String(iap.identityReady)}`);
    lines.push(`RC key: ${rcActiveKeyMasked()} (project: Jaleter Budgeting App)`);
    lines.push(`last bind: ${getLastBindResult()}`);
    try { lines.push(`canMakePayments: ${String(await Purchases.canMakePayments())}`); } catch (e: any) { lines.push(`canMakePayments: error ${String(e?.message || e)}`); }
    lines.push(`offering: ${iap.offerings?.current?.identifier || '(none)'} · packages: ${(iap.offerings?.current?.availablePackages || []).map((p: any) => p.identifier).join(',') || '(none)'}`);
    lines.push(`package: ${annualPkg?.identifier || '(none)'} · product: ${annualPkg?.product?.identifier || '(none)'} · ${annualPkg?.product?.priceString || '(no price)'}`);
    lines.push(`entitlement active: ${String(!!iap.customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER])}`);
    setDiag(lines.join('\n'));
  };
  useEffect(() => { busyRef.current = !!busy; }, [busy]);

  // Annual package from the current offering (never hardcode product ids or
  // prices — the store product is the source of truth).
  const pickAnnual = (offerings: any) =>
    offerings?.current?.annual
    || offerings?.current?.availablePackages?.find((p: any) => p.identifier === '$rc_annual')
    || offerings?.current?.availablePackages?.[0]
    || null;
  const annualPkg = pickAnnual(iap.offerings);
  // On native store builds the IAP button ALWAYS renders (Apple requires the
  // native StoreKit flow to be the purchase path). If the offering hasn't
  // loaded yet, tapping Subscribe refetches it and surfaces the real error.
  const isNativeStore = Platform.OS !== 'web';
  const iapAvailable = rcEnabled && (isNativeStore || !!annualPkg);
  const iapPrice = annualPkg?.product?.priceString || '$89.99';
  const priceNum = annualPkg?.product?.price;
  const monthlyEq = priceNum ? `$${(Math.ceil((priceNum / 12) * 100) / 100).toFixed(2)}` : '$7.50';

  const applyResult = (m: { active: boolean }): boolean => {
    if (m.active) { onUnlocked(); return true; }
    return false;
  };

  // On mount + whenever the app returns to the foreground: if RevenueCat
  // already holds an ACTIVE store entitlement for this account (renewal that
  // happened while the app was closed, purchase on another device with the
  // same Apple ID/Google account, …) mirror it to the backend, then re-ask
  // the server. Makes "Refresh membership" a backup, not a required step.
  useEffect(() => {
    let disposed = false;
    const reconcile = async () => {
      if (busyRef.current) return;
      try {
        const info = iap.customerInfo;
        if (token && info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER]) {
          await syncIapToBackend(token, info);
        }
        const m = await checkMembership(true);
        if (!disposed) applyResult(m);
      } catch {}
    };
    reconcile();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') reconcile(); });
    return () => { disposed = true; sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iap.customerInfo]);

  const refreshNow = async () => {
    setBusy('refresh'); setNotice('');
    try {
      if (token && iap.customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER]) {
        await syncIapToBackend(token, iap.customerInfo);
      }
      const m = await checkMembership(true);
      if (applyResult(m)) return;
      setNotice(`We couldn't find an active Premium subscription on this account yet. If you just subscribed, give it a few seconds and refresh again — or tap Restore Purchase to re-link your ${STORE_NAME} subscription.`);
    } catch {
      setNotice('Could not reach Jaleter. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  // ---- Apple / Google In-App Purchase (RevenueCat) ------------------------
  const finishIapUnlock = async (info: any): Promise<boolean> => {
    const active = !!info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER];
    if (!active) return false;
    // Sync the store-verified entitlement to the backend so server-gated
    // APIs (Plaid, syncs, Coach AI…) unlock, then confirm through the
    // normal membership check.
    await syncIapToBackend(token!, info);
    try {
      const m = await checkMembership(false);
      if (applyResult(m)) return true;
    } catch {}
    onUnlocked(); // entitlement verified by the store — never strand a buyer
    return true;
  };

  const buyWithStore = async () => {
    setBusy('iap'); setNotice('');
    // Identity: self-heal instead of stalling. The launch-time binding can
    // fail silently on device — re-run configure + logIn here and surface the
    // real error if it still can't link the customer to this account.
    // Always (re)assert identity right before the sale — cheap, and it is the
    // one guarantee that matters: SDK customer === this Jaleter user.
    const ready = await ensureRcReady(user?.user_id);
    if (!ready.ok) {
      setBusy(null);
      setNotice(`Purchases can't start yet: ${ready.error}. Check your internet connection and try again.`);
      return;
    }
    // Offering may not have loaded yet (or store product misconfigured) —
    // refetch on demand and surface the real error rather than hiding IAP.
    let pkg = annualPkg;
    if (!pkg) {
      try {
        const res = await iap.refetchOfferings();
        pkg = pickAnnual(res?.data);
        if (!pkg && res?.error) throw res.error;
      } catch (e: any) {
        setBusy(null);
        setNotice(`The ${STORE_NAME} subscription isn't available right now: ${String(e?.message || e || 'no products returned')}. If this persists, verify the subscription product in ${Platform.OS === 'android' ? 'Google Play Console' : 'App Store Connect'} matches the RevenueCat product ID.`);
        return;
      }
      if (!pkg) {
        setBusy(null);
        setNotice(`The ${STORE_NAME} subscription isn't available right now — the store returned no products. Verify the auto-renewable subscription exists in ${Platform.OS === 'android' ? 'Google Play Console' : 'App Store Connect'} with the exact RevenueCat product ID and that agreements/banking are complete.`);
        return;
      }
    }
    // Test Store (preview/dev): require a deliberate second tap.
    if (rcUsingTestStore && !confirmTestBuy) { setBusy(null); setConfirmTestBuy(true); return; }
    setConfirmTestBuy(false);
    // Device-level block (Screen Time / parental restrictions / MDM) — StoreKit
    // rejects instantly and silently otherwise.
    try {
      const allowed = await Purchases.canMakePayments();
      if (!allowed) {
        setBusy(null);
        setNotice(`This device isn't allowed to make in-app purchases. Check Settings → Screen Time → Content & Privacy Restrictions → iTunes & App Store Purchases → In-app Purchases, then try again.`);
        return;
      }
    } catch {}
    try {
      const info = await iap.purchase({ pkg, uid: String(user!.user_id) });
      const ok = await finishIapUnlock(info);
      if (!ok) setNotice("The purchase completed but the subscription isn't active yet. Tap Restore Purchase in a moment.");
    } catch (e: any) {
      // NEVER fail silently — every outcome gets a visible line, including a
      // cancel (so "nothing happened" can't be mistaken for a dead button).
      const msg = describeRcError(e);
      if (e?.userCancelled) {
        setNotice(`Purchase canceled — no charge was made. ${msg ? `(${msg})` : ''}`.trim());
      } else if (String(e?.message || e) === 'identity_not_ready') {
        setNotice('Preparing your account for purchase — try again in a moment.');
      } else {
        setNotice(`Purchase failed: ${msg || 'unknown error'}`);
      }
    } finally { setBusy(null); }
  };

  const restorePurchases = async () => {
    setBusy('restore'); setNotice('');
    const ready = await ensureRcReady(user?.user_id);
    if (!ready.ok) {
      setBusy(null);
      setNotice(`Restore can't start yet: ${ready.error}. Check your internet connection and try again.`);
      return;
    }
    try {
      const info = await iap.restore();
      const ok = await finishIapUnlock(info);
      if (!ok) setNotice(`No previous ${STORE_NAME} purchases were found for this account.`);
    } catch (e: any) {
      setNotice(`Restore failed: ${describeRcError(e) || 'unknown error'}`);
    } finally { setBusy(null); }
  };

  // Human-readable RevenueCat / StoreKit error (code + message + underlying).
  function describeRcError(e: any): string {
    if (!e) return '';
    const parts = [
      e?.userInfo?.readableErrorCode || (typeof e?.code !== 'undefined' ? `code ${e.code}` : ''),
      e?.message,
      e?.userInfo?.underlyingErrorMessage || e?.underlyingErrorMessage,
    ].filter(Boolean).map(String);
    return Array.from(new Set(parts)).join(' · ');
  }

  const FEATURES: [string, string, string][] = [
    ['analytics-outline', 'Advanced Insights', 'Smarter analytics and personalized recommendations'],
    ['flag-outline', 'Goal Tracking', 'Stay on track and reach your goals faster'],
    ['diamond-outline', 'Premium Tools', 'Access exclusive features and tools'],
    ['headset-outline', 'Priority Support', 'Get help when you need it'],
  ];

  const disclosure = iapAvailable
    ? `Annual auto-renewing subscription billed at ${iapPrice}/year through ${STORE_NAME}. Payment is charged to your ${Platform.OS === 'android' ? 'Google Play' : 'Apple ID'} account at confirmation. Renews automatically unless canceled at least 24 hours before the end of the period. Manage or cancel any time in your ${STORE_NAME} subscription settings. The same subscription unlocks Jaleter on every device you sign into.`
    : 'Jaleter Premium is an annual auto-renewing subscription purchased inside the Jaleter app through the App Store (iPhone) or Google Play (Android). Your subscription unlocks the same Premium account wherever you sign in.';

  return (
    <ScrollView style={d.screen} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 54, paddingBottom: 40 }}>
      {/* X — dismisses the paywall (back to welcome / account switch). Never
          forces a purchase to leave this screen. */}
      <Pressable onPress={onSwitchAccount} hitSlop={12} style={d.closeBtn} testID="paywall-close">
        <Ionicons name="close" size={20} color="#b9ae9a" />
      </Pressable>

      <View style={{ alignItems: 'center' }}>
        <Image source={require('../../assets/images/wordmark.png')} style={{ width: 190, height: 68 }} resizeMode="contain" accessibilityLabel="Jaleter" testID="paywall-wordmark" />
        <Text style={d.tagline}>SMART BUDGETING. WEALTHY LIVING.</Text>
      </View>

      <Text style={d.h1}>Unlock Your{'\n'}Full Potential</Text>
      <Text style={d.sub}>Get full access to premium features and take control of your financial future.</Text>

      <View style={{ marginTop: 26, gap: 16 }}>
        {FEATURES.map(([icon, title, desc]) => (
          <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={d.featIcon}><Ionicons name={icon as any} size={18} color="#d4af61" /></View>
            <View style={{ flex: 1 }}>
              <Text style={d.featTitle}>{title}</Text>
              <Text style={d.featDesc}>{desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Annual plan card — price always from the live store product */}
      <Pressable onPress={showDiagnostics} style={d.planCard} testID="paywall-plan-card">
        <View style={d.bestBadge}><Text style={d.bestBadgeText}>BEST VALUE</Text></View>
        <Text style={d.planEyebrow}>ANNUAL PLAN</Text>
        <Text style={d.planPrice}>{iapPrice}<Text style={d.planPer}>/year</Text></Text>
        <Text style={d.planEquiv}>Equivalent to less than {monthlyEq}/month</Text>
      </Pressable>

      {confirmTestBuy ? (
        <View testID="paywall-iap-confirm" style={d.noticeBox}>
          <View style={{ flex: 1 }}>
            <Text style={d.noticeTitle}>Confirm test purchase (simulated)</Text>
            <Text style={d.noticeBody}>You&apos;re in the preview Test Store — no real money moves. Confirm to simulate the {iapPrice}/year subscription.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pressable onPress={buyWithStore} style={[d.cta, { flex: 1, marginTop: 0, paddingVertical: 10 }]} testID="paywall-iap-confirm-yes">
                <Text style={d.ctaText}>Confirm</Text>
              </Pressable>
              <Pressable onPress={() => setConfirmTestBuy(false)} style={d.confirmCancel} testID="paywall-iap-confirm-no">
                <Text style={{ color: '#c9bfa9', fontSize: 12, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {iapAvailable ? (
        <>
          <Pressable onPress={buyWithStore} disabled={!!busy} style={[d.cta, busy && { opacity: 0.6 }]} testID="paywall-iap-buy">
            {busy === 'iap'
              ? <ActivityIndicator size="small" color="#171204" />
              : <Text style={d.ctaText}>Subscribe Now</Text>}
          </Pressable>
          <View style={d.linksRow}>
            <Pressable onPress={restorePurchases} disabled={!!busy} hitSlop={8} testID="paywall-iap-restore">
              {busy === 'restore'
                ? <ActivityIndicator size="small" color="#d4af61" />
                : <Text style={d.linkText}>Restore Purchase</Text>}
            </Pressable>
            <Text style={d.linkDivider}>|</Text>
            <Pressable onPress={() => openJaleter('terms')} hitSlop={8} testID="paywall-terms"><Text style={d.linkText}>Terms</Text></Pressable>
            <Text style={d.linkDivider}>|</Text>
            <Pressable onPress={() => openJaleter('privacy')} hitSlop={8} testID="paywall-privacy"><Text style={d.linkText}>Privacy</Text></Pressable>
          </View>
          <Pressable onPress={refreshNow} disabled={!!busy} style={{ alignItems: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }} testID="paywall-refresh">
            {busy === 'refresh'
              ? <ActivityIndicator size="small" color="#d4af61" />
              : <Text style={{ color: '#8f8672', fontSize: 11, fontWeight: '700' }}>Already subscribed? Refresh membership</Text>}
          </Pressable>
        </>
      ) : (
        <>
          {/* Production web: no store here — send visitors to the apps. */}
          <View style={d.noticeBox} testID="paywall-web-store-notice">
            <Ionicons name="phone-portrait-outline" size={17} color="#d4af61" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={d.noticeTitle}>Subscribe in the Jaleter app</Text>
              <Text style={d.noticeBody}>Jaleter Premium is purchased through the App Store on iPhone or Google Play on Android. Download the app, sign in with this same email, and tap Subscribe Now.</Text>
            </View>
          </View>
          <Pressable onPress={() => openStoreListing('ios')} style={d.cta} testID="paywall-store-ios">
            <Text style={d.ctaText}>Get Jaleter for iPhone</Text>
          </Pressable>
          <Pressable onPress={() => openStoreListing('android')} style={d.secondaryBtn} testID="paywall-store-android">
            <Text style={d.linkText}>Get Jaleter for Android</Text>
          </Pressable>
          <View style={d.linksRow}>
            <Pressable onPress={refreshNow} disabled={!!busy} hitSlop={8} testID="paywall-refresh">
              {busy === 'refresh' ? <ActivityIndicator size="small" color="#d4af61" /> : <Text style={d.linkText}>Refresh Membership</Text>}
            </Pressable>
            <Text style={d.linkDivider}>|</Text>
            <Pressable onPress={() => openJaleter('terms')} hitSlop={8} testID="paywall-terms"><Text style={d.linkText}>Terms</Text></Pressable>
            <Text style={d.linkDivider}>|</Text>
            <Pressable onPress={() => openJaleter('privacy')} hitSlop={8} testID="paywall-privacy"><Text style={d.linkText}>Privacy</Text></Pressable>
          </View>
        </>
      )}

      {diag ? (
        <Text testID="paywall-diagnostics" selectable style={{ marginTop: 12, fontSize: 10, color: '#8f8672', textAlign: 'left', lineHeight: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{diag}</Text>
      ) : null}

      {notice ? (
        <Text testID="paywall-notice" style={{ marginTop: 14, fontSize: 11, color: '#d4af61', textAlign: 'center', lineHeight: 16 }}>{notice}</Text>
      ) : null}

      <Text style={d.disclosure}>{disclosure}</Text>
      <Text testID="paywall-build-stamp" style={{ marginTop: 8, fontSize: 9, color: '#5c5548', textAlign: 'center' }}>
        v{Constants.expoConfig?.version || '?'} · build {String(Constants.nativeBuildVersion || (Constants.expoConfig?.ios as any)?.buildNumber || (Constants.expoConfig?.android as any)?.versionCode || '—')} · {PAYWALL_CODE_STAMP} · key {rcActiveKeyMasked()}
      </Text>

      {/* This screen only renders for AUTHENTICATED users, so never ask them
          to "sign in" again — show who they are and offer a way out. */}
      <View style={{ marginTop: 20, alignItems: 'center' }}>
        {email ? (
          <Text testID="paywall-signed-in-as" style={{ fontSize: 11, color: '#8f8672', textAlign: 'center' }}>
            Signed in as <Text style={{ fontWeight: '700', color: '#c9bfa9' }}>{email}</Text>
          </Text>
        ) : null}
        <Pressable onPress={onSwitchAccount} hitSlop={8} testID="paywall-signout">
          <Text style={{ color: '#d4af61', fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 6 }}>Not you? Sign out</Text>
        </Pressable>
      </View>

      {/* Bottom decorative gold treatment */}
      <View style={{ alignItems: 'center', marginTop: 26 }}>
        <View style={d.goldRule} />
        <Text style={{ color: '#d4af61', fontSize: 14, marginTop: 10 }}>✦</Text>
      </View>
    </ScrollView>
  );
};

/* Dark luxury paywall styles — this screen is intentionally dark in BOTH
   themes (brand design), so colors are local literals, not theme tokens. */
const d = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0906' },
  closeBtn: { position: 'absolute', top: 52, right: 20, zIndex: 5, width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a160e', alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: '#e5c37a', fontSize: 52, fontFamily: F.serifBold, letterSpacing: 0.5 },
  tagline: { color: '#8f8672', fontSize: 9, fontWeight: '700', letterSpacing: 2.4, marginTop: 6 },
  h1: { color: '#f4eee1', fontSize: 34, fontFamily: F.serifBold, textAlign: 'center', marginTop: 26, lineHeight: 42 },
  sub: { color: '#a79d88', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 19, paddingHorizontal: 10 },
  featIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1d1709', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#33270f' },
  featTitle: { color: '#f4eee1', fontSize: 14, fontWeight: '700' },
  featDesc: { color: '#8f8672', fontSize: 11, marginTop: 2, lineHeight: 15 },
  planCard: { marginTop: 26, borderRadius: 18, borderWidth: 1.5, borderColor: '#d4af61', backgroundColor: '#14100a', padding: 20, alignItems: 'center' },
  bestBadge: { position: 'absolute', top: -11, alignSelf: 'center', backgroundColor: '#d4af61', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 3 },
  bestBadgeText: { color: '#171204', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  planEyebrow: { color: '#8f8672', fontSize: 10, fontWeight: '800', letterSpacing: 1.6, marginTop: 4 },
  planPrice: { color: '#f4eee1', fontSize: 38, fontFamily: F.serifBold, marginTop: 6 },
  planPer: { color: '#a79d88', fontSize: 14, fontWeight: '500' },
  planEquiv: { color: '#a79d88', fontSize: 11, marginTop: 4 },
  cta: { marginTop: 18, backgroundColor: '#d4af61', borderRadius: 14, paddingVertical: 15, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  ctaText: { color: '#171204', fontSize: 15, fontWeight: '800' },
  linksRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  linkText: { color: '#d4af61', fontSize: 12, fontWeight: '700' },
  linkDivider: { color: '#4d4633', fontSize: 12 },
  secondaryBtn: { marginTop: 14, borderWidth: 1, borderColor: '#33270f', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  noticeBox: { marginTop: 16, borderWidth: 1, borderColor: '#33270f', backgroundColor: '#14100a', borderRadius: 14, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noticeTitle: { color: '#d4af61', fontSize: 12, fontWeight: '800' },
  noticeBody: { color: '#a79d88', fontSize: 11, lineHeight: 16, marginTop: 3 },
  confirmCancel: { flex: 1, borderWidth: 1, borderColor: '#33270f', borderRadius: 14, paddingVertical: 10, alignItems: 'center', marginTop: 0, justifyContent: 'center' },
  disclosure: { marginTop: 16, fontSize: 9, color: '#8f8672', textAlign: 'center', lineHeight: 14 },
  goldRule: { width: 120, height: 2, borderRadius: 1, backgroundColor: '#d4af61', opacity: 0.7 },
});
