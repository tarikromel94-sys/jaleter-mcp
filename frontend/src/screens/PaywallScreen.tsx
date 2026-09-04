import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/src/jaleterTheme';
import { openJaleter, JALETER_SUBSCRIPTION_URL } from '@/src/jaleterLinks';
import { s, GoldButton } from '@/src/utils/appShared';
import { usePayment } from '@/src/hooks/usePayment';

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
  const [busy, setBusy] = useState<null | 'checkout' | 'refresh'>(null);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = !!busy; }, [busy]);

  // Auto-recheck whenever the app returns to the foreground (e.g. the user
  // just paid on jaleter.com/Stripe in the browser and switched back). This
  // makes "Refresh Membership" a backup, not a required step.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || busyRef.current) return;
      (async () => {
        try { if (await checkMembership()) onUnlocked(); } catch {}
      })();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After Checkout returns (or the user paid on another device / the web),
  // poll the backend for up to ~30s. The Stripe webhook — never this client —
  // grants entitlement; we are only waiting to observe it.
  const confirmActivation = async (): Promise<boolean> => {
    for (let i = 0; i < 12; i += 1) {
      try {
        if (await checkMembership()) { onUnlocked(); return true; }
      } catch {}
      await new Promise((r) => setTimeout(r, 2500));
    }
    return false;
  };

  const startCheckout = async () => {
    setBusy('checkout'); setNotice('');
    try {
      // Preferred: backend creates a Stripe Checkout already linked to THIS
      // Jaleter user (user_id + customer_id — never email matching).
      const res = await pay.start('jaleter_premium');
      if (!res.ok) {
        // Fallback: send them to the membership page on jaleter.com.
        await openJaleter(JALETER_SUBSCRIPTION_URL);
        setNotice('Complete your membership on jaleter.com, then tap "Refresh Membership" below.');
        return;
      }
      if (res.canceled) { setNotice('Checkout canceled. You can restart any time.'); return; }
      setNotice('Confirming your membership with Stripe…');
      const active = await confirmActivation();
      if (!active) setNotice("We haven't received Stripe's confirmation yet. If you completed payment, tap \"Refresh Membership\" in a moment.");
    } finally { setBusy(null); }
  };

  const refreshNow = async () => {
    setBusy('refresh'); setNotice('');
    try {
      if (await checkMembership()) { onUnlocked(); return; }
      setNotice("We couldn't find an active membership on this account yet. If you just paid, give it a few seconds and refresh again.");
    } catch {
      setNotice('Could not reach Jaleter. Check your connection and try again.');
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
      <View style={{ marginTop: 18 }}>
        <GoldButton
          label={busy === 'checkout' ? 'Opening secure checkout…' : 'Continue to Jaleter.com'}
          onPress={startCheckout}
          disabled={!!busy}
          testID="paywall-checkout"
        />
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
        Payments are handled securely by Stripe on the web — Jaleter never sees your card. $90 USD billed annually; renews automatically until canceled. Cancel any time from Membership settings.
      </Text>
    </ScrollView>
  );
};
