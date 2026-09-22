import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, AppState, Platform } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { openJaleter, JALETER_SUBSCRIPTION_URL } from '@/src/jaleterLinks';
import { s, GoldButton } from '@/src/utils/appShared';
import { usePayment } from '@/src/hooks/usePayment';
import { useAuth } from '@/src/AuthContext';
import { useSubscription, rcEnabled, rcUsingTestStore, syncIapToBackend, ensureRcReady, REVENUECAT_ENTITLEMENT_IDENTIFIER } from '@/src/lib/revenuecat';

/* ---------------- Connect ---------------- */
/* ---------------- Membership Required (hard paywall) ---------------- */
// Access model: Jaleter is free to download, but every financial feature
// requires an ACTIVE paid membership (Stripe, purchased on the web). This
// screen intentionally has NO bypass — the only exits are:
//   1. the backend confirming an active membership (webhook-driven), or
//   2. signing into a different account that already has one.
// Entitlement is never decided locally; `checkMembership` always asks the
// server (`GET /api/user/membership`) and premium APIs return 402 anyway.
const PAYWALL_BENEFITS = [
  'Grid-based budgeting across every month',
  'Connected financial accounts (Plaid + statement import)',
  'Spending insights & intelligent reports',
  'Financial goals & Legacy projections',
  'Net worth tracking — investments, liabilities, credit cards',
  'AI-powered financial insights (Jaleter Coach)',
];
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
  // Apple guideline 3.1.1: no external purchase links on iOS builds. Stripe
  // web checkout stays available on Android/web (and in the dev test store).
  const showStripeOption = Platform.OS !== 'ios' || rcUsingTestStore;

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

  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 60, paddingBottom: 40 }}>
      <View style={s.paywallMark}><Text style={{ color: '#e2b96f', fontSize: 24 }}>✦</Text></View>
      <View style={s.onboardHeading}>
        <Text style={s.eyebrow}>JALETER MEMBERSHIP</Text>
        <Text style={s.onboardH1}>Unlock Jaleter</Text>
        <Text style={s.onboardHint}>An active Jaleter membership is required to access Jaleter&apos;s financial tools and features.</Text>
      </View>
      <View style={s.priceCard}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>ANNUAL MEMBERSHIP</Text>
        <Text style={s.priceStrong}>$90<Text style={{ fontSize: 13, color: '#8d867d', fontWeight: '500' }}>/year</Text></Text>
        {PAYWALL_BENEFITS.map(b => (
          <View key={b} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: '#615b52', fontSize: 11, flex: 1 }}>{b}</Text>
          </View>
        ))}
      </View>
      {processing ? (
        <View testID="paywall-processing" style={{ marginTop: 18, borderWidth: 1, borderColor: '#e3cf9e', backgroundColor: '#fdf7e9', borderRadius: 14, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <Ionicons name="time-outline" size={18} color="#a5772e" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#8a6a2e', fontSize: 12, fontWeight: '800' }}>Payment Processing</Text>
            <Text style={{ color: '#8a6a2e', fontSize: 11, lineHeight: 16, marginTop: 3 }}>
              Your payment is on its way. Bank payments can take a few business days to clear — Jaleter will unlock automatically once Stripe confirms it. Please don&apos;t pay again.
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: 18 }}>
        {iapAvailable ? (
          <>
            {confirmTestBuy ? (
              <View testID="paywall-iap-confirm" style={{ borderWidth: 1, borderColor: '#e3cf9e', backgroundColor: '#fdf7e9', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                <Text style={{ color: '#8a6a2e', fontSize: 12, fontWeight: '800' }}>Confirm test purchase (simulated)</Text>
                <Text style={{ color: '#8a6a2e', fontSize: 11, marginTop: 3, lineHeight: 15 }}>
                  You&apos;re in the preview Test Store — no real money moves. Confirm to simulate the {iapPrice}/year subscription.
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <Pressable onPress={buyWithStore} style={{ flex: 1, backgroundColor: '#a57537', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }} testID="paywall-iap-confirm-yes">
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Confirm</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmTestBuy(false)} style={{ flex: 1, borderWidth: 1, borderColor: '#d9cdb6', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }} testID="paywall-iap-confirm-no">
                    <Text style={{ color: '#8a6a2e', fontSize: 12, fontWeight: '700' }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <GoldButton
              label={busy === 'iap' ? 'Completing your purchase…' : `Subscribe — ${iapPrice}/year`}
              onPress={buyWithStore}
              disabled={!!busy || processing}
              testID="paywall-iap-buy"
            />
            <Pressable
              onPress={restorePurchases}
              disabled={!!busy}
              style={{ marginTop: 12, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
              testID="paywall-iap-restore"
            >
              {busy === 'restore'
                ? <ActivityIndicator size="small" color="#a57537" />
                : <Text style={{ color: '#a57537', fontSize: 12, fontWeight: '700' }}>Restore Purchases</Text>}
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: '#e6ddcc' }} />
              <Text style={{ fontSize: 10, color: '#a29a8e' }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: '#e6ddcc' }} />
            </View>
            {showStripeOption ? (
              <Pressable
                onPress={startCheckout}
                disabled={!!busy || processing}
                style={{ borderWidth: 1, borderColor: '#d9cdb6', borderRadius: 14, paddingVertical: 13, alignItems: 'center', opacity: busy || processing ? 0.6 : 1 }}
                testID="paywall-checkout"
              >
                <Text style={{ color: '#a57537', fontSize: 12, fontWeight: '700' }}>
                  {processing ? 'Payment processing — no need to pay again' : busy === 'checkout' ? 'Opening secure checkout…' : 'Pay on Jaleter.com instead'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={refreshNow} disabled={!!busy} style={{ alignItems: 'center', paddingVertical: 4, opacity: busy ? 0.6 : 1 }} testID="paywall-refresh-membership">
                <Text style={{ color: '#a29a8e', fontSize: 11, fontWeight: '700' }}>
                  {busy === 'refresh' ? 'Checking…' : 'Already a member on Jaleter.com? Refresh membership'}
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          <GoldButton
            label={processing ? 'Payment processing — no need to pay again' : busy === 'checkout' ? 'Opening secure checkout…' : 'Continue to Jaleter.com'}
            onPress={startCheckout}
            disabled={!!busy || processing}
            testID="paywall-checkout"
          />
        )}
      </View>
      <Pressable
        onPress={refreshNow}
        disabled={!!busy}
        style={{ marginTop: 14, borderWidth: 1, borderColor: '#d9cdb6', borderRadius: 14, paddingVertical: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7, opacity: busy ? 0.6 : 1 }}
        testID="paywall-refresh"
      >
        {busy === 'refresh'
          ? <ActivityIndicator size="small" color="#a57537" />
          : <Ionicons name="refresh-outline" size={15} color="#a57537" />}
        <Text style={{ color: '#a57537', fontSize: 12, fontWeight: '700' }}>Refresh Membership</Text>
      </Pressable>
      {notice ? (
        <Text testID="paywall-notice" style={{ marginTop: 14, fontSize: 11, color: '#8a6a2e', textAlign: 'center', lineHeight: 16 }}>{notice}</Text>
      ) : null}
      {/* This screen only renders for AUTHENTICATED users, so never ask them
          to "sign in" again — show who they are and offer a way out. */}
      <View style={{ marginTop: 22, alignItems: 'center' }}>
        {email ? (
          <Text testID="paywall-signed-in-as" style={{ fontSize: 11, color: '#77726b', textAlign: 'center' }}>
            Signed in as <Text style={{ fontWeight: '700', color: '#615b52' }}>{email}</Text>
          </Text>
        ) : null}
        <Pressable onPress={onSwitchAccount} hitSlop={8} testID="paywall-signout">
          <Text style={[s.loginLink, { textAlign: 'center', marginTop: 6 }]}>Not you? Sign out</Text>
        </Pressable>
      </View>
      <Text style={{ marginTop: 16, fontSize: 9, color: '#a29a8e', textAlign: 'center', lineHeight: 13 }}>
        {iapAvailable
          ? `$90 USD billed annually via ${Platform.OS === 'ios' ? 'your Apple ID (App Store)' : Platform.OS === 'android' ? 'Google Play' : 'the store'}; renews automatically until canceled in your store subscription settings.${showStripeOption ? ' Web payments are handled securely by Stripe — either unlocks the same membership.' : ' Memberships purchased on the web are recognized automatically when you sign in.'}`
          : 'Payments are handled securely by Stripe on the web — Jaleter never sees your card. $90 USD billed annually; renews automatically until canceled. Cancel any time from Membership settings.'}
      </Text>
    </ScrollView>
  );
};
