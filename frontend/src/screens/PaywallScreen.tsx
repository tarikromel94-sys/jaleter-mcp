import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, AppState, Platform, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { openJaleter, JALETER_SUBSCRIPTION_URL } from '@/src/jaleterLinks';
import { usePayment } from '@/src/hooks/usePayment';
import { useAuth } from '@/src/AuthContext';
import { useSubscription, rcEnabled, rcUsingTestStore, syncIapToBackend, ensureRcReady, REVENUECAT_ENTITLEMENT_IDENTIFIER } from '@/src/lib/revenuecat';
import { F } from '@/src/jaleterTheme';

/* ---------------- Connect ---------------- */
/* ---------------- Membership Required (hard paywall) ---------------- */
// Access model: Jaleter is free to download, but every financial feature
// requires an ACTIVE paid membership (Stripe, purchased on the web). This
// screen intentionally has NO bypass — the only exits are:
//   1. the backend confirming an active membership (webhook-driven), or
//   2. signing into a different account that already has one.
// Entitlement is never decided locally; `checkMembership` always asks the
// server (`GET /api/user/membership`) and premium APIs return 402 anyway.
export const Paywall = ({ email, checkMembership, onUnlocked, onSwitchAccount }: any) => {
  const pay = usePayment();
  const { token, user } = useAuth();
  const iap = useSubscription();
  const [busy, setBusy] = useState<null | 'checkout' | 'refresh' | 'iap' | 'restore'>(null);
  const [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState(false);
  const [confirmTestBuy, setConfirmTestBuy] = useState(false);
  const busyRef = useRef(false);
  const processingRef = useRef(false);
  useEffect(() => { busyRef.current = !!busy; }, [busy]);
  useEffect(() => { processingRef.current = processing; }, [processing]);

  // Apple/Google in-app subscription — annual package from the current
  // offering (never hardcode product ids or prices).
  const pickAnnual = (offerings: any) =>
    offerings?.current?.annual
    || offerings?.current?.availablePackages?.find((p: any) => p.identifier === '$rc_annual')
    || offerings?.current?.availablePackages?.[0]
    || null;
  const annualPkg = pickAnnual(iap.offerings);
  // On native store builds the IAP button ALWAYS renders (Apple requires the
  // native StoreKit flow to be the purchase path). If the offering hasn't
  // loaded yet, tapping Subscribe refetches it and surfaces the real error
  // instead of silently falling back to Stripe.
  const isNativeStore = Platform.OS !== 'web';
  const iapAvailable = rcEnabled && (isNativeStore || !!annualPkg);
  const iapPrice = annualPkg?.product?.priceString || '$90.00';
  // Store digital subscriptions MUST use the native billing systems (Apple
  // guideline 3.1.1 / Google Play Billing policy) — the Stripe web option is
  // only shown on the web build, never inside iOS or Android store builds.
  const showStripeOption = Platform.OS === 'web';
  const priceNum = annualPkg?.product?.price;
  const monthlyEq = priceNum ? `$${(Math.ceil((priceNum / 12) * 100) / 100).toFixed(2)}` : '$7.50';

  const PROCESSING_MSG = 'No need to pay again — bank payments can take a few business days to clear. Jaleter unlocks automatically the moment Stripe confirms it.';

  const applyResult = (m: { active: boolean; processing: boolean }): boolean => {
    if (m.active) { onUnlocked(); return true; }
    setProcessing(!!m.processing);
    return false;
  };

  // On mount + whenever the app returns to the foreground (e.g. the user just
  // paid on jaleter.com/Stripe in the browser), reconcile with Stripe
  // server-side. This self-heals missed webhooks and makes "Refresh
  // Membership" a backup, not a required step.
  useEffect(() => {
    let disposed = false;
    const reconcile = async () => {
      if (busyRef.current) return;
      try {
        const m = await checkMembership(true);
        if (!disposed) applyResult(m);
      } catch {}
    };
    reconcile();
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') reconcile(); });
    return () => { disposed = true; sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After Checkout returns (or the user paid on another device / the web),
  // poll the backend for up to ~30s. The Stripe webhook — never this client —
  // grants entitlement; we are only waiting to observe it.
  const confirmActivation = async (): Promise<boolean> => {
    for (let i = 0; i < 12; i += 1) {
      try {
        const m = await checkMembership(i === 0 || i === 5 || i === 11);
        if (applyResult(m)) return true;
        if (m.processing) return false; // bank payment clearing — stop polling
      } catch {}
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  };

  const startCheckout = async () => {
    if (processing) { setNotice(PROCESSING_MSG); return; }
    setBusy('checkout'); setNotice('');
    try {
      // Preferred: backend creates a Stripe Checkout already linked to THIS
      // Jaleter user (user_id + customer_id — never email matching). The
      // backend refuses to open a second Checkout if a membership is already
      // active or a bank payment is still clearing.
      const res = await pay.start('jaleter_premium');
      if (res.alreadyActive) {
        setNotice('Your membership is already active — welcome back!');
        const m = await checkMembership(true);
        if (applyResult(m)) return;
      }
      if (res.processing) { setProcessing(true); setNotice(PROCESSING_MSG); return; }
      if (!res.ok) {
        // Fallback: send them to the membership page on jaleter.com.
        await openJaleter(JALETER_SUBSCRIPTION_URL);
        setNotice('Complete your membership on jaleter.com, then tap "Refresh Membership" below.');
        return;
      }
      if (res.canceled) { setNotice('Checkout canceled. You can restart any time.'); return; }
      setNotice('Confirming your membership with Stripe…');
      const active = await confirmActivation();
      if (!active) {
        setNotice(processingRef.current ? PROCESSING_MSG : "We haven't received Stripe's confirmation yet. If you completed payment, tap \"Refresh Membership\" in a moment.");
      }
    } finally { setBusy(null); }
  };

  const refreshNow = async () => {
    setBusy('refresh'); setNotice('');
    try {
      // refresh=1 → backend reconciles straight from Stripe's records.
      const m = await checkMembership(true);
      if (applyResult(m)) return;
      setNotice(m.processing
        ? PROCESSING_MSG
        : "We couldn't find an active membership on this account yet. If you just paid, give it a few seconds and refresh again.");
    } catch {
      setNotice('Could not reach Jaleter. Check your connection and try again.');
    } finally { setBusy(null); }
  };

  // ---- Apple / Google In-App Purchase ($90/yr via RevenueCat) ------------
  const finishIapUnlock = async (info: any): Promise<boolean> => {
    const active = !!info?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_IDENTIFIER];
    if (!active) return false;
    // Sync entitlement to the backend so server-gated APIs unlock, then
    // confirm through the normal membership check.
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
    if (!iap.identityReady) {
      const ready = await ensureRcReady(user?.user_id);
      if (!ready.ok) {
        setBusy(null);
        setNotice(`Purchases can't start yet: ${ready.error}. Check your internet connection and try again.`);
        return;
      }
    }
    // Offering may not have loaded yet (or ASC product misconfigured) —
    // refetch on demand and surface the real error rather than hiding IAP.
    let pkg = annualPkg;
    if (!pkg) {
      try {
        const res = await iap.refetchOfferings();
        pkg = pickAnnual(res?.data);
        if (!pkg && res?.error) throw res.error;
      } catch (e: any) {
        setBusy(null);
        setNotice(`The App Store subscription isn't available right now: ${String(e?.message || e || 'no products returned')}. If this persists, verify the subscription product in App Store Connect matches the RevenueCat product ID.`);
        return;
      }
      if (!pkg) {
        setBusy(null);
        setNotice("The App Store subscription isn't available right now — the store returned no products. Verify the auto-renewable subscription exists in App Store Connect with the exact RevenueCat product ID and that agreements/banking are complete.");
        return;
      }
    }
    // Test Store (preview/dev): require a deliberate second tap.
    if (rcUsingTestStore && !confirmTestBuy) { setBusy(null); setConfirmTestBuy(true); return; }
    setConfirmTestBuy(false);
    try {
      const info = await iap.purchase(pkg);
      const ok = await finishIapUnlock(info);
      if (!ok) setNotice("The purchase completed but the subscription isn't active yet. Tap Restore Purchases in a moment.");
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (!e?.userCancelled && !/cancel/i.test(msg)) {
        setNotice(msg === 'identity_not_ready'
          ? 'Preparing your account for purchase — try again in a moment.'
          : `Purchase failed: ${msg}`);
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
      if (!ok) setNotice('No previous App Store purchases were found for this account.');
    } catch (e: any) {
      setNotice(`Restore failed: ${String(e?.message || e || '')}`);
    } finally { setBusy(null); }
  };

  const FEATURES: [string, string, string][] = [
    ['analytics-outline', 'Advanced Insights', 'Smarter analytics and personalized recommendations'],
    ['flag-outline', 'Goal Tracking', 'Stay on track and reach your goals faster'],
    ['diamond-outline', 'Premium Tools', 'Access exclusive features and tools'],
    ['headset-outline', 'Priority Support', 'Get help when you need it'],
  ];

  const disclosure = iapAvailable
    ? `Annual auto-renewing subscription billed at ${iapPrice}/year through ${Platform.OS === 'android' ? 'Google Play' : 'the App Store'}. Renews automatically unless canceled at least 24 hours before the end of the period. Manage or cancel any time in your ${Platform.OS === 'android' ? 'Google Play' : 'App Store'} account settings.${showStripeOption ? ' Web payments are handled by Stripe — either unlocks the same membership.' : ' Memberships purchased on jaleter.com are recognized automatically when you sign in.'}`
    : 'Annual auto-renewing subscription billed at $89.99/year, handled securely by Stripe on the web — Jaleter never sees your card. Renews automatically unless canceled. Cancel any time from Membership settings.';

  return (
    <ScrollView style={d.screen} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 54, paddingBottom: 40 }}>
      {/* X — dismisses the paywall (back to welcome / account switch). Never
          forces a purchase to leave this screen. */}
      <Pressable onPress={onSwitchAccount} hitSlop={12} style={d.closeBtn} testID="paywall-close">
        <Ionicons name="close" size={20} color="#b9ae9a" />
      </Pressable>

      <View style={{ alignItems: 'center' }}>
        <Text style={d.wordmark}>Jaleter</Text>
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
      <View style={d.planCard} testID="paywall-plan-card">
        <View style={d.bestBadge}><Text style={d.bestBadgeText}>BEST VALUE</Text></View>
        <Text style={d.planEyebrow}>ANNUAL PLAN</Text>
        <Text style={d.planPrice}>{iapPrice}<Text style={d.planPer}>/year</Text></Text>
        <Text style={d.planEquiv}>Equivalent to less than {monthlyEq}/month</Text>
      </View>

      {processing ? (
        <View testID="paywall-processing" style={d.noticeBox}>
          <Ionicons name="time-outline" size={17} color="#d4af61" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={d.noticeTitle}>Payment Processing</Text>
            <Text style={d.noticeBody}>Your payment is on its way. Bank payments can take a few business days to clear — Jaleter will unlock automatically once confirmed. Please don&apos;t pay again.</Text>
          </View>
        </View>
      ) : null}

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
          <Pressable onPress={buyWithStore} disabled={!!busy || processing} style={[d.cta, (busy || processing) && { opacity: 0.6 }]} testID="paywall-iap-buy">
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
          {showStripeOption ? (
            <Pressable onPress={startCheckout} disabled={!!busy || processing} style={[d.secondaryBtn, (busy || processing) && { opacity: 0.6 }]} testID="paywall-checkout">
              <Text style={d.linkText}>
                {processing ? 'Payment processing — no need to pay again' : busy === 'checkout' ? 'Opening secure checkout…' : 'Pay on Jaleter.com instead'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={refreshNow} disabled={!!busy} style={{ alignItems: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }} testID="paywall-refresh">
            {busy === 'refresh'
              ? <ActivityIndicator size="small" color="#d4af61" />
              : <Text style={{ color: '#8f8672', fontSize: 11, fontWeight: '700' }}>Already a member on Jaleter.com? Refresh Membership</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Pressable onPress={startCheckout} disabled={!!busy || processing} style={[d.cta, (busy || processing) && { opacity: 0.6 }]} testID="paywall-checkout">
            <Text style={d.ctaText}>{processing ? 'Payment processing — no need to pay again' : busy === 'checkout' ? 'Opening secure checkout…' : 'Subscribe Now'}</Text>
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

      {notice ? (
        <Text testID="paywall-notice" style={{ marginTop: 14, fontSize: 11, color: '#d4af61', textAlign: 'center', lineHeight: 16 }}>{notice}</Text>
      ) : null}

      <Text style={d.disclosure}>{disclosure}</Text>

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
