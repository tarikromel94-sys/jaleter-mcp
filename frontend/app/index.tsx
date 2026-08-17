import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Modal, StatusBar as RNStatusBar, Platform, Linking, Dimensions, Alert, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as AppleAuthentication from 'expo-apple-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';
import { storage } from '@/src/utils/storage';
import { AuthProvider, useAuth, apiCall } from '@/src/AuthContext';
import { usePushRegistration } from '@/src/hooks/usePushRegistration';
import { getPrefs, putPrefs, evaluateBudget, evaluateTransaction, currentPeriod as npCurrentPeriod, type CategoryTotal } from '@/src/utils/notifications';
import { C, D, F } from '@/src/jaleterTheme';
import { dailyQuote, MONEY, EXACT, QuoteType } from '@/src/quoteLibrary';
import { WELCOME_HTML } from '@/src/welcomeHtml';
import { ConnectPlaidButton } from '@/src/PlaidLink';
import { SupportSheet } from '@/src/SupportSheet';
import { ReportsScreen } from '@/src/ReportsScreen';
import { BANK_IMPORT_GUIDES } from '@/src/bankGuides';
import { openJaleter } from '@/src/jaleterLinks';
import { PoweredByJaleter } from '@/src/PoweredByJaleter';
import { EmailVerificationBanner } from '@/src/components/EmailVerificationBanner';
// ReclassifySheet is now used exclusively inside NetWorthScreen.
import ProjectionLineChart from '@/src/components/ProjectionLineChart';
import { CoachAIScreen } from '@/src/screens/CoachAIScreen';
import {
  s,
  ThemeCtx,
  useThemed,
  CircleBtn,
  PeriodPills,
  PageHeader,
  Sheet,
  Toast as SharedToast,
  GoldButton,
  type Asset,
} from '@/src/utils/appShared';
import { NetWorthScreen } from '@/src/screens/NetWorthScreen';

const STORAGE_KEY = 'jaleter-state-v2';
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

/* ---------------- App Lock (PIN + Biometrics) ---------------- */
const APP_LOCK_KEY = 'jaleter_app_lock_pin';
const APP_LOCK_BIO_KEY = 'jaleter_app_lock_bio';
async function loadAppLock() {
  const pin = await storage.secureGet<string>(APP_LOCK_KEY, '' as string);
  const bio = await storage.secureGet<string>(APP_LOCK_BIO_KEY, '' as string);
  let biometricsAvailable = false;
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    biometricsAvailable = hw && enrolled;
  } catch { /* web */ }
  return { pin: pin || '', biometricsEnabled: bio === '1', biometricsAvailable };
}
async function saveAppLockPin(pin: string) { await storage.secureSet(APP_LOCK_KEY, pin); }
async function saveAppLockBio(enabled: boolean) { await storage.secureSet(APP_LOCK_BIO_KEY, enabled ? '1' : '0'); }
async function clearAppLock() { await storage.secureRemove(APP_LOCK_KEY); await storage.secureRemove(APP_LOCK_BIO_KEY); }

const AppLockGate = ({ storedPin, biometricsEnabled, biometricsAvailable, onUnlock }: any) => {
  const [entered, setEntered] = useState('');
  const [error, setError] = useState('');
  const [tryingBio, setTryingBio] = useState(false);
  useEffect(() => {
    if (!biometricsEnabled || !biometricsAvailable) return;
    (async () => {
      setTryingBio(true);
      try {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Jaleter', disableDeviceFallback: false, cancelLabel: 'Use PIN' });
        if (r.success) onUnlock();
      } catch { /* ignore */ } finally { setTryingBio(false); }
    })();
  }, [biometricsEnabled, biometricsAvailable]);
  const push = (d: string) => setEntered((e: string) => (e + d).slice(0, 6));
  const back = () => setEntered((e: string) => e.slice(0, -1));
  useEffect(() => {
    if (entered.length < 4) return;
    if (entered === storedPin) { onUnlock(); return; }
    if (entered.length >= storedPin.length) { setError('Incorrect PIN'); setTimeout(() => { setEntered(''); setError(''); }, 900); }
  }, [entered, storedPin]);
  const dots = Array.from({ length: 6 }, (_, i) => i < entered.length);
  return (
    <View style={s.gate}>
      <Sparkle size={30} color="#e2b96f" />
      <Text style={s.gateTitle}>Jaleter</Text>
      <Text style={s.gateSub}>Enter your PIN to unlock</Text>
      <View style={s.pinDots}>
        {dots.map((filled, i) => <View key={i} style={[s.pinDot, filled && s.pinDotFilled]} />)}
      </View>
      {error ? <Text style={s.pinErr}>{error}</Text> : <View style={{ height: 14 }} />}
      <View style={s.pinPad}>
        {[1,2,3,4,5,6,7,8,9].map(n => (
          <Pressable key={n} onPress={() => push(String(n))} style={s.pinBtn} testID={`pin-${n}`}><Text style={s.pinBtnText}>{n}</Text></Pressable>
        ))}
        <View style={s.pinBtn} />
        <Pressable onPress={() => push('0')} style={s.pinBtn} testID="pin-0"><Text style={s.pinBtnText}>0</Text></Pressable>
        <Pressable onPress={back} style={s.pinBtn} testID="pin-back"><Ionicons name="backspace-outline" size={20} color="#eee" /></Pressable>
      </View>
      {biometricsEnabled && biometricsAvailable && (
        <Pressable onPress={async () => {
          setTryingBio(true);
          try {
            const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Jaleter' });
            if (r.success) onUnlock();
          } catch {} finally { setTryingBio(false); }
        }} style={s.bioBtn} testID="pin-bio">
          <Ionicons name="scan-outline" size={20} color="#e2b96f" />
          <Text style={{ color: '#e2b96f', fontSize: 12, fontWeight: '700', marginLeft: 8 }}>{tryingBio ? 'Waiting for biometrics…' : 'Use Face ID / Touch ID'}</Text>
        </Pressable>
      )}
    </View>
  );
};

const AppLockConfigure = ({ close, currentPin, biometricsAvailable, biometricsEnabled, onSaved }: any) => {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [err, setErr] = useState('');
  const [useBio, setUseBio] = useState(biometricsEnabled);
  const draft = step === 'enter' ? first : second;
  const setDraft = step === 'enter' ? setFirst : setSecond;
  useEffect(() => {
    if (step === 'enter' && first.length >= 4 && first.length <= 6) {
      // wait for user to tap confirm
    }
  }, [first, step]);
  const push = (d: string) => setDraft((v: string) => (v + d).slice(0, 6));
  const back = () => setDraft((v: string) => v.slice(0, -1));
  const advance = async () => {
    if (step === 'enter') {
      if (first.length < 4) { setErr('PIN must be at least 4 digits'); return; }
      setErr(''); setStep('confirm');
      return;
    }
    if (second !== first) { setErr('PINs did not match. Try again.'); setSecond(''); setStep('enter'); setFirst(''); return; }
    await saveAppLockPin(first);
    await saveAppLockBio(!!useBio && biometricsAvailable);
    onSaved({ enabled: true, biometricsEnabled: !!useBio && biometricsAvailable, biometricsAvailable });
    close();
  };
  const disable = async () => { await clearAppLock(); onSaved({ enabled: false, biometricsEnabled: false, biometricsAvailable }); close(); };
  const dots = Array.from({ length: 6 }, (_, i) => i < draft.length);
  return (
    <View>
      <Text style={{ color: '#a97c39', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 }}>{currentPin ? 'CHANGE PIN' : 'SET A PIN'}</Text>
      <Text style={{ color: '#615b52', fontSize: 11, marginBottom: 12 }}>{step === 'enter' ? 'Enter a 4–6 digit PIN.' : 'Enter your PIN again to confirm.'}</Text>
      <View style={[s.pinDots, { alignSelf: 'center' }]}>{dots.map((filled, i) => <View key={i} style={[s.pinDot, filled && s.pinDotFilled, { borderColor: '#c8b494', backgroundColor: filled ? '#8a6d3a' : 'transparent' }]} />)}</View>
      {err ? <Text style={[s.pinErr, { color: C.danger, alignSelf: 'center' }]}>{err}</Text> : <View style={{ height: 14 }} />}
      <View style={[s.pinPad, { paddingHorizontal: 0 }]}>
        {[1,2,3,4,5,6,7,8,9].map(n => (
          <Pressable key={n} onPress={() => push(String(n))} style={[s.pinBtn, { backgroundColor: '#f5efdf' }]} testID={`cfg-pin-${n}`}><Text style={[s.pinBtnText, { color: '#3a3428' }]}>{n}</Text></Pressable>
        ))}
        <View style={s.pinBtn} />
        <Pressable onPress={() => push('0')} style={[s.pinBtn, { backgroundColor: '#f5efdf' }]} testID="cfg-pin-0"><Text style={[s.pinBtnText, { color: '#3a3428' }]}>0</Text></Pressable>
        <Pressable onPress={back} style={[s.pinBtn, { backgroundColor: '#f5efdf' }]} testID="cfg-pin-back"><Ionicons name="backspace-outline" size={20} color="#3a3428" /></Pressable>
      </View>
      {biometricsAvailable && (
        <Pressable onPress={() => setUseBio((v: boolean) => !v)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }} testID="cfg-bio-toggle">
          <View style={[s.toggle, useBio && s.toggleOn]}><View style={[s.toggleKnob, useBio && { transform: [{ translateX: 14 }] }]} /></View>
          <Text style={{ marginLeft: 10, fontSize: 11, fontWeight: '700', color: '#3a3428' }}>Also allow Face ID / Touch ID</Text>
        </Pressable>
      )}
      <GoldButton label={step === 'enter' ? 'Continue' : 'Save PIN'} onPress={advance} testID="cfg-pin-continue" />
      {currentPin ? (
        <Pressable onPress={disable} style={{ marginTop: 10, alignItems: 'center' }} testID="cfg-pin-disable">
          <Text style={{ color: C.danger, fontSize: 11, fontWeight: '700' }}>Turn off App Lock</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthIndex = (name: string) => MONTHS.indexOf(name);
const currentMonth = () => MONTHS[new Date().getMonth()];

/* ---------------- Payments & Scheduling ---------------- */
// Generates upcoming coaching slots: next N business days at 10am, 2pm, 4pm (local time).
function upcomingCoachingSlots(days: number = 10): { label: string; iso: string }[] {
  const slots: { label: string; iso: string }[] = [];
  const hours = [10, 14, 16];
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // start tomorrow
  let added = 0;
  while (added < days) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // skip weekends
      for (const h of hours) {
        const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0);
        if (slot.getTime() > now.getTime() + 30 * 60 * 1000) {
          const dateLabel = slot.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          const timeLabel = slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          slots.push({ label: `${dateLabel} · ${timeLabel}`, iso: slot.toISOString() });
        }
      }
      added += 1;
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return slots;
}

function formatBookingDate(iso: string): string {
  try {
    const d = new Date(iso);
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${dateLabel} at ${timeLabel}`;
  } catch { return iso; }
}

type CheckoutResult = { ok: boolean; paid?: boolean; canceled?: boolean; error?: string; sessionId?: string };

// Reusable Stripe Checkout runner. Opens hosted Checkout, waits for redirect,
// then polls /api/payments/status until payment_status becomes 'paid'.
function usePayment() {
  const { token } = useAuth();
  const start = useCallback(async (product: 'coaching_session' | 'jaleter_premium', extras?: { scheduled_at?: string }): Promise<CheckoutResult> => {
    if (!token) return { ok: false, error: 'You must be signed in to purchase.' };
    const platform = Platform.OS === 'web' ? 'web' : 'mobile';
    let body: any = { product, platform };
    if (extras?.scheduled_at) body.scheduled_at = extras.scheduled_at;
    let created: any;
    try {
      created = await apiCall('/api/payments/checkout', { method: 'POST', body: JSON.stringify(body) }, token);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not start checkout.' };
    }
    const { url, session_id } = created;
    if (!url) return { ok: false, error: 'Payment provider did not return a URL.' };

    if (Platform.OS === 'web') {
      // On web, browser will navigate away; we return here — the app will poll on return via the
      // web-return handler (checkout=success in URL) which lives in MainApp.
      if (typeof window !== 'undefined') window.location.href = url;
      return { ok: true, sessionId: session_id };
    }

    // Native: open Stripe Checkout in an auth session; wait for the jaleter://checkout redirect.
    const redirectScheme = ExpoLinking.createURL('checkout');
    let redirectResult: any;
    try {
      redirectResult = await WebBrowser.openAuthSessionAsync(url, redirectScheme);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not open Stripe Checkout.' };
    }
    if (redirectResult?.type !== 'success') {
      // Poll once anyway in case user completed but browser was dismissed
      try {
        const status = await apiCall(`/api/payments/status/${session_id}`, { method: 'GET' }, token);
        if (status?.payment_status === 'paid') return { ok: true, paid: true, sessionId: session_id };
      } catch {}
      return { ok: true, canceled: true, sessionId: session_id };
    }

    // Poll status (Stripe may lag a moment)
    for (let i = 0; i < 8; i += 1) {
      try {
        const status = await apiCall(`/api/payments/status/${session_id}`, { method: 'GET' }, token);
        if (status?.payment_status === 'paid') return { ok: true, paid: true, sessionId: session_id };
        if (status?.status === 'expired') return { ok: true, canceled: true, sessionId: session_id };
      } catch {}
      await new Promise((r) => setTimeout(r, 1200));
    }
    return { ok: true, sessionId: session_id, error: 'Payment is still processing.' };
  }, [token]);
  return { start };
}

/* ---------------- DATA ---------------- */
const initialCategories = [
  { id: 'give', name: 'Give', tagline: 'Lead with generosity', subcategories: [
    { id: 'tithe', name: 'Tithe', budgeted: 0 }, { id: 'missions', name: 'Missions', budgeted: 0 }, { id: 'extra-giving', name: 'Extra Giving', budgeted: 0 }] },
  { id: 'steward', name: 'Steward', tagline: 'Protect what you have', subcategories: [
    { id: 'housing', name: 'Housing', budgeted: 0 }, { id: 'food', name: 'Food & Dining', budgeted: 0 }, { id: 'transport', name: 'Transportation', budgeted: 0 }, { id: 'utilities', name: 'Utilities', budgeted: 0 }] },
  { id: 'grow', name: 'Grow', tagline: 'Build future wealth', subcategories: [
    { id: 'investments', name: 'Investments', budgeted: 0 }, { id: 'education', name: 'Education', budgeted: 0 }] },
  { id: 'enjoy', name: 'Enjoy', tagline: 'Enjoy life responsibly', subcategories: [
    { id: 'travel', name: 'Travel', budgeted: 0 }, { id: 'shopping', name: 'Shopping', budgeted: 0 }, { id: 'entertainment', name: 'Entertainment', budgeted: 0 }] },
];
const initialIncome = [{ id: 'w2', name: 'W-2 Income', budgeted: 0 }, { id: 'contract', name: 'Contract Income', budgeted: 0 }, { id: 'business', name: 'Business Income', budgeted: 0 }];
type Split = { groupId: string; detailId?: string; amount: number; type?: 'income' | 'expense' };
type Tx = {
  id: string;
  date: string;
  name: string;
  amount: number;
  // Type of transaction. `transfer` is a first-class type: an internal
  // Every transaction is either income (positive-money-in for user) or
  // expense (positive-money-out). "Transfer" is no longer a third type
  // (spec #10); a movement between the user's own accounts still uses
  // income/expense by sign, but `system_category='transfer'` (or the
  // legacy `is_transfer` flag) keeps it excluded from Budget actuals,
  // Reports, and Net Income cash-flow.
  type: 'income' | 'expense';
  groupId: string;
  detailId?: string;
  origin: string;
  period: string;
  // System classification set by the backend Plaid classifier — retained so
  // reclassify sheets can surface the auto-detected value.
  system_category?: string | null;
  is_transfer?: boolean;
  external_id?: string;
  // Signed direction of the ORIGINAL underlying money flow: +1 for money
  // into the user's account (positive Plaid amount, refunds), -1 for money
  // out (negative Plaid amount, spends). Enables spec #16 netting so a
  // +$48.80 Walmart refund manually assigned to Food & Dining REDUCES that
  // subcategory's actual instead of inflating it.
  sign?: 1 | -1;
  // Merchant name — canonical retailer name (e.g. "Costco Wholesale") used
  // for grouping in Reports. Distinct from `name` which is the description.
  merchant?: string;
  // Split allocation — when populated, this transaction contributes to
  // MULTIPLE budget categories. Sum of splits.amount should equal `amount`.
  // If splits is empty/absent, the transaction uses top-level groupId/detailId.
  splits?: Split[];
  // Optional counterparty account references — kept for transfer-category
  // transactions so the reconciliation sheet can match both sides.
  transfer_from_account_id?: string;
  transfer_to_account_id?: string;
};

// A transaction is treated as a "system transfer" (excluded from Budget
// actuals, Reports totals, and Net Income cash-flow) when either:
//   • the backend Plaid classifier tagged it (`system_category` ∈ transfer /
//     credit_card_payment / loan_payment), or
//   • the user manually assigned it to the Transfer category (`is_transfer`
//     flag / `system_category='transfer'`).
// Note: as of spec #10, `type: 'transfer'` is NO LONGER a valid value on
// the frontend — transfers still use income/expense by sign and the
// exclusion flag is what drives filtering.
const isSystemTransaction = (t: any): boolean => {
  if (t?.is_transfer) return true;
  const sc = (t?.system_category || '').toString().toLowerCase();
  return sc === 'transfer' || sc === 'credit_card_payment' || sc === 'loan_payment';
};
const initialTx: Tx[] = [];

// ---- Splits-aware budget accounting -----------------------------------------
// A single transaction can be split across multiple budget categories. When
// splits exist, we ignore the top-level groupId/detailId and iterate splits
// instead. When splits are absent, the transaction contributes its full
// amount to the top-level assignment.
type Alloc = { groupId: string; detailId?: string; amount: number; parentType: Tx['type']; allocType: Tx['type']; parentPeriod: string; parentYear: number; parentTx: Tx };
const txAllocations = (tx: Tx): Alloc[] => {
  const isoMatch = typeof tx.date === 'string' ? tx.date.match(/^(\d{4})-(\d{2})/) : null;
  const parentYear = isoMatch ? Number(isoMatch[1]) : (tx.date ? new Date(tx.date).getFullYear() : new Date().getFullYear());
  const parentPeriod = tx.period || 'Jan';
  if (Array.isArray(tx.splits) && tx.splits.length > 0) {
    return tx.splits.map((sp) => ({
      groupId: sp.groupId,
      detailId: sp.detailId,
      amount: Number(sp.amount) || 0,
      parentType: tx.type,
      // Per-split type (spec #17). Defaults to the parent tx type.
      allocType: (sp.type as Tx['type']) || tx.type,
      parentPeriod,
      parentYear,
      parentTx: tx,
    }));
  }
  return [{
    groupId: tx.groupId,
    detailId: tx.detailId,
    amount: tx.amount,
    parentType: tx.type,
    allocType: tx.type,
    parentPeriod,
    parentYear,
    parentTx: tx,
  }];
};
// Sum splits-aware actual for a subcategory in a given month (of a specific year).
// Spec #16: a refund/positive txn assigned to Expense OFFSETS spend
// (reduces the actual) rather than adding to it. We use `tx.sign` (+1 for
// money-in, -1 for money-out) to detect refunds: a positive-signed txn
// assigned to Expense contributes NEGATIVELY. Same idea for chargebacks
// against Income.
const spentForSubInMonth = (transactions: Tx[], subId: string, monthIndex: number, year?: number): number => {
  let sum = 0;
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    const allocs = txAllocations(tx);
    for (const a of allocs) {
      if (a.allocType !== 'expense') continue;
      if (a.detailId !== subId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      // Refund detection: +1-signed txn attributed to Expense reduces spend.
      const sign = (a.parentTx as any).sign;
      const netMultiplier = sign === 1 ? -1 : 1;
      sum += a.amount * netMultiplier;
    }
  }
  return sum;
};
// Same for income (uses groupId — no subcategory).
const receivedForIncomeInMonth = (transactions: Tx[], srcId: string, monthIndex: number, year?: number): number => {
  let sum = 0;
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    const allocs = txAllocations(tx);
    for (const a of allocs) {
      if (a.allocType !== 'income') continue;
      if (a.groupId !== srcId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      // Chargeback detection: -1-signed txn attributed to Income reduces the source.
      const sign = (a.parentTx as any).sign;
      const netMultiplier = sign === -1 ? -1 : 1;
      sum += a.amount * netMultiplier;
    }
  }
  return sum;
};
// Find every transaction that contributes to a subcategory in a given month.
// Used by the "tap the Actual number" drill-down.
const transactionsForSubInMonth = (transactions: Tx[], subId: string, monthIndex: number, year?: number): { tx: Tx; contribution: number }[] => {
  const out: { tx: Tx; contribution: number }[] = [];
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    if (tx.type !== 'expense') continue;
    const allocs = txAllocations(tx);
    let contribution = 0;
    for (const a of allocs) {
      if (a.detailId !== subId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      contribution += a.amount;
    }
    if (contribution > 0) out.push({ tx, contribution });
  }
  return out;
};
const transactionsForIncomeInMonth = (transactions: Tx[], srcId: string, monthIndex: number, year?: number): { tx: Tx; contribution: number }[] => {
  const out: { tx: Tx; contribution: number }[] = [];
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    if (tx.type !== 'income') continue;
    const allocs = txAllocations(tx);
    let contribution = 0;
    for (const a of allocs) {
      if (a.groupId !== srcId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      contribution += a.amount;
    }
    if (contribution > 0) out.push({ tx, contribution });
  }
  return out;
};

// Asset type is imported from `@/src/utils/appShared`.
const initialAssets: Asset[] = [
  { id: 'cash', name: 'Cash', value: 0, source: 'Manual', icon: 'wallet-outline' },
  { id: 'investments', name: 'Investments', value: 0, source: 'Manual', icon: 'trending-up' },
  { id: 'real-estate', name: 'Real Estate', value: 0, source: 'Manual', icon: 'business-outline' },
  { id: 'vehicles', name: 'Vehicles', value: 0, source: 'Manual', icon: 'car-outline' },
];
const initialLiabilities: Asset[] = [
  { id: 'mortgage', name: 'Mortgage', value: 0, source: 'Manual', icon: 'home-outline' },
  { id: 'auto-loan', name: 'Auto Loan', value: 0, source: 'Manual', icon: 'car-outline' },
  { id: 'credit-cards', name: 'Credit Cards', value: 0, source: 'Manual', icon: 'card-outline' },
  { id: 'student-loans', name: 'Student Loans', value: 0, source: 'Manual', icon: 'cash-outline' },
];

/* ---------------- Shared UI ---------------- */
// GoldButton is imported from `@/src/utils/appShared` above.
// CircleBtn / PeriodPills / PageHeader / Sheet are imported from
// `@/src/utils/appShared` at the top of this file.
// `Toast` is imported from `@/src/utils/appShared` (as `SharedToast`).
const Sparkle = ({ size = 20, color = C.goldGlow, style }: any) => (
  <Text style={[{ color, fontSize: size, fontWeight: '700' }, style]}>✦</Text>
);

/* ---------------- Billing Website Notice (external web billing) ---------------- */
// All Stripe checkout has moved to jaleter.com to bypass App Store fees.
// Tapping opens jaleter.com/billing in the platform's best browser.
const BillingWebsiteNotice = ({ compact = false, target = 'billing' as 'billing' | 'coaching' | 'membership' }: { compact?: boolean; target?: 'billing' | 'coaching' | 'membership' }) => {
  const t = useThemed();
  const label = target === 'coaching' ? 'Book & pay at jaleter.com' : target === 'membership' ? 'Manage membership at jaleter.com' : 'Billing lives at jaleter.com';
  return (
    <Pressable
      testID={`billing-notice-${target}`}
      onPress={() => openJaleter(target)}
      style={[billingNoticeStyles.card, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}
    >
      <View style={billingNoticeStyles.iconWrap}>
        <Ionicons name="globe-outline" size={16} color={C.goldEyebrow} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[billingNoticeStyles.title, t.textInk]}>{label}</Text>
        <Text style={[billingNoticeStyles.body, t.textMuted]}>
          {compact
            ? 'Tap to open on our website.'
            : 'To keep prices honest and avoid App Store fees, all payments and subscription management happen on our secure website. Tap here to open jaleter.com in your browser.'}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={C.goldEyebrow} />
    </Pressable>
  );
};
const billingNoticeStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8dcc4',
    backgroundColor: '#fbf6ec',
    marginTop: 10,
  },
  iconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#f4e6c9',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 12, fontWeight: '800', color: '#615b52', letterSpacing: 0.2 },
  body: { fontSize: 10, color: '#8a8378', marginTop: 3, lineHeight: 14 },
});

/* ---------------- Welcome (Get Started) ---------------- */
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const serifFont = Platform.select({ ios: 'PlayfairDisplay', android: 'PlayfairDisplay', default: 'PlayfairDisplay' });

/**
 * Gold silk-ribbon: a bundle of hairline strands living in the lower-middle band
 * of the screen only. Each strand shares the same silhouette but is offset
 * vertically by a small amount so the group reads as one flowing ribbon.
 * The path starts off-screen left at ~45% height, dips through the lower-middle,
 * and lifts toward the right edge.
 */
function GoldRibbon() {
  const H = SCREEN_HEIGHT;
  const W = SCREEN_WIDTH;
  const baseY = H * 0.60;                      // ribbon centerline
  const bandTop = H * 0.53;                    // top of allowed band
  // Vertical offsets for each strand relative to baseY (in px). Positive = below.
  const strands = [
    { dy: -30, w: 0.5, o: 0.10, color: '#8a6a34' },
    { dy: -22, w: 0.5, o: 0.14, color: '#a17a3e' },
    { dy: -14, w: 0.6, o: 0.18, color: '#b58547' },
    { dy: -6,  w: 0.7, o: 0.28, color: '#c99553' },
    { dy:  0,  w: 0.9, o: 0.55, color: '#e6c07b' }, // central brighter
    { dy:  6,  w: 0.9, o: 0.48, color: '#dcb26a' }, // central brighter
    { dy: 14,  w: 0.7, o: 0.30, color: '#c99553' },
    { dy: 22,  w: 0.6, o: 0.20, color: '#b58547' },
    { dy: 30,  w: 0.5, o: 0.14, color: '#96723c' },
    { dy: 38,  w: 0.5, o: 0.09, color: '#7a5e2f' },
  ];
  const makePath = (dy: number) => {
    // Start off-screen left at 45% height (slightly above baseY), curve down through
    // the lower-middle, then rise toward the right edge. Keeps the whole silhouette
    // inside the 22-25% band around baseY.
    const startY = H * 0.45 + dy;
    const dipY = baseY + 40 + dy;
    const endY = H * 0.50 + dy;
    return `M -60 ${startY} C ${W * 0.22} ${startY + 60}, ${W * 0.48} ${dipY}, ${W * 0.70} ${dipY - 25} C ${W * 0.88} ${dipY - 55}, ${W * 1.02} ${endY - 20}, ${W + 80} ${endY - 40}`;
  };
  return (
    <>
      {strands.map((strand, i) => (
        <Path
          key={`ribbon-${i}`}
          d={makePath(strand.dy)}
          fill="none"
          stroke={strand.color}
          strokeWidth={strand.w}
          strokeOpacity={strand.o}
          strokeLinecap="round"
        />
      ))}
      {/* Reference clamp — invisible, just documents the 22-25% band constraint. */}
      <Rect x={0} y={bandTop} width={W} height={H * 0.24} fill="transparent" />
    </>
  );
}

/**
 * Background: pure #090908 field + a single, extremely faint warm glow
 * biased to the bottom-right. Never resembles a visible circle/panel;
 * gradient stops fade to full opacity by ~45% radius so >75% of the
 * background stays truly black.
 */
function BackgroundArtwork() {
  return (
    <Svg
      width={SCREEN_WIDTH}
      height={SCREEN_HEIGHT}
      viewBox={`0 0 ${SCREEN_WIDTH} ${SCREEN_HEIGHT}`}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="ambient" cx="86%" cy="88%" rx="55%" ry="42%">
          <Stop offset="0%" stopColor="#7a5a2b" stopOpacity="0.14" />
          <Stop offset="35%" stopColor="#5a4322" stopOpacity="0.06" />
          <Stop offset="70%" stopColor="#090908" stopOpacity="0" />
          <Stop offset="100%" stopColor="#090908" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="#090908" />
      <Rect x="0" y="0" width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fill="url(#ambient)" />
      <GoldRibbon />
    </Svg>
  );
}

const Welcome = ({ onStart, onLogin }: any) => {
  const handleMessage = useCallback((event: any) => {
    const msg = event?.nativeEvent?.data;
    if (msg === 'navigate:onboarding') onStart?.();
    else if (msg === 'navigate:login') onLogin?.();
  }, [onStart, onLogin]);

  // On web, react-native-webview is unsupported — render the HTML in an <iframe>
  // and listen for postMessage events for navigation bridging.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener = (evt: any) => {
      const data = evt?.data;
      if (data === 'navigate:onboarding') onStart?.();
      else if (data === 'navigate:login') onLogin?.();
    };
    // @ts-ignore
    window.addEventListener('message', listener);
    // @ts-ignore
    return () => window.removeEventListener('message', listener);
  }, [onStart, onLogin]);

  if (Platform.OS === 'web') {
    // On web, embed via iframe using srcdoc; patch the postMessage bridge to use window.parent.postMessage.
    const webHtml = WELCOME_HTML.replace(
      "window.ReactNativeWebView && window.ReactNativeWebView.postMessage",
      "window.parent && window.parent.postMessage"
    ).replace(
      "window.ReactNativeWebView.postMessage(msg);",
      "window.parent.postMessage(msg, '*');"
    );
    return (
      <View style={welcomeStyles.screen}>
        <RNStatusBar barStyle="light-content" backgroundColor="#090908" translucent />
        {React.createElement('iframe' as any, {
          srcDoc: webHtml,
          style: {
            flex: 1,
            width: '100%',
            height: '100%',
            border: 0,
            backgroundColor: '#090908',
          },
          sandbox: 'allow-scripts allow-same-origin',
        })}
      </View>
    );
  }

  return (
    <View style={welcomeStyles.screen}>
      <RNStatusBar barStyle="light-content" backgroundColor="#090908" translucent />
      <WebView
        originWhitelist={['*']}
        source={{ html: WELCOME_HTML }}
        onMessage={handleMessage}
        style={welcomeStyles.webview}
        containerStyle={welcomeStyles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      />
    </View>
  );
};

const welcomeStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090908' },
  webview: { flex: 1, backgroundColor: '#090908' },
  safeArea: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },
  brandSection: { alignItems: 'center', paddingTop: SCREEN_HEIGHT * 0.30 },
  sparkles: { position: 'relative', width: 44, height: 30, marginBottom: 6 },
  largeSparkle: { position: 'absolute', left: 6, top: 8, color: '#E3BD79', fontSize: 18, lineHeight: 20 },
  smallSparkle: { position: 'absolute', right: 4, top: 0, color: '#F6DCA8', fontSize: 10, lineHeight: 12 },
  logo: {
    width: '100%',
    color: '#EED7AB',
    fontFamily: serifFont,
    fontSize: 60,
    fontWeight: '400',
    lineHeight: 72,
    letterSpacing: -0.5,
    textAlign: 'center',
    includeFontPadding: false,
  } as any,
  tagline: {
    color: 'rgba(245, 237, 224, 0.65)',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 2.8,
    textAlign: 'center',
    marginTop: 4,
  },
  actions: { paddingBottom: Math.max(28, SCREEN_HEIGHT * 0.05), alignItems: 'center' },
  buttonWrap: {
    width: '76%',
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  primaryButton: {
    width: '100%',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
  },
  primaryButtonText: {
    color: '#1a1305',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  loginButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 18,
  },
  loginText: {
    color: 'rgba(210, 202, 190, 0.55)',
    fontSize: 12,
    textAlign: 'center',
  },
  loginLink: { color: '#C69E5F', fontWeight: '600' },
});

/* ---------------- Onboarding ---------------- */
const Onboarding = ({ experience, setExperience, onContinue, back }: any) => {
  const options: [string, string, string][] = [
    ['Faith','✦','Scripture-centered financial encouragement.'],
    ['Both','◈','Faith and motivation, thoughtfully balanced.'],
    ['Motivation','↗','Universal encouragement for your journey.']];
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 54, paddingBottom: 28 }}>
      <CircleBtn testID="onboarding-back" onPress={back}><Ionicons name="arrow-back" size={20} color={C.ink3} /></CircleBtn>
      <View style={s.onboardHeading}>
        <View style={s.miniLogo}><Text style={s.miniLogoText}>J</Text></View>
        <Text style={s.eyebrow}>MAKE JALETER YOURS</Text>
        <Text style={s.onboardH1}>What keeps you{'\n'}moving forward?</Text>
        <Text style={s.onboardHint}>Choose your daily experience. You can change this anytime.</Text>
      </View>
      <View style={{ gap: 11 }}>
        {options.map(([name, icon, text]) => {
          const selected = experience === name;
          return (
            <Pressable key={name} testID={`experience-${name}`} onPress={() => setExperience(name)} style={[s.expCard, selected && s.expCardSelected]}>
              <View style={s.expIcon}><Text style={{ color: C.goldText, fontSize: 18, fontWeight: '600' }}>{icon}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.expName}>{name}</Text>
                <Text style={s.expText}>{text}</Text>
              </View>
              {name === 'Both' && <Text style={s.expRecommended}>RECOMMENDED</Text>}
              <View style={[s.selDot, selected && s.selDotOn]}>{selected && <Ionicons name="checkmark" size={13} color="#fff" />}</View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: 22 }}><GoldButton label="Continue" onPress={onContinue} testID="onboarding-continue" /></View>
    </ScrollView>
  );
};

/* ---------------- Apple Sign-In button (iOS native) ---------------- */
const AppleSignInButton = ({ onError, onBusy }: { onError: (m: string) => void; onBusy: (v: boolean) => void }) => {
  const { loginWithApple } = useAuth();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        if (alive) setAvailable(!!ok);
      } catch { if (alive) setAvailable(false); }
    })();
    return () => { alive = false; };
  }, []);
  // Apple only supports native iOS. Hide the button everywhere else.
  if (Platform.OS !== 'ios' || !available) return null;
  const onPress = async () => {
    onBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('Apple did not return an identity token.');
      const name = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ').trim() || null
        : null;
      await loginWithApple({
        identity_token: credential.identityToken,
        name,
        email: credential.email || null,
      });
    } catch (e: any) {
      if (e?.code === 'ERR_REQUEST_CANCELED') { /* user tapped Cancel — ignore */ }
      else onError(e?.message || 'Apple sign-in failed.');
    } finally {
      onBusy(false);
    }
  };
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={12}
      style={{ height: 46, marginTop: 10 }}
      onPress={onPress}
    />
  );
};

/* ---------------- Signup (real register) ---------------- */
const Signup = ({ back, onCreated, goLogin }: any) => {
  const { register, loginWithGoogle } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', terms: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = !!form.name && /\S+@\S+/.test(form.email) && form.password.length >= 8 && form.terms;
  const onSubmit = async () => {
    setError(''); setBusy(true);
    try {
      await register(form.name.trim(), form.email.trim().toLowerCase(), form.password);
      onCreated({ name: form.name.trim() });
    } catch (e: any) {
      setError(e?.message || 'Could not create account.');
    } finally { setBusy(false); }
  };
  const onGoogle = async () => {
    setError(''); setBusy(true);
    try { await loginWithGoogle(); } catch (e: any) { setError(e?.message || 'Google sign-in failed.'); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 54, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <CircleBtn testID="signup-back" onPress={back}><Ionicons name="arrow-back" size={20} color={C.ink3} /></CircleBtn>
      <View style={s.onboardHeading}>
        <View style={s.miniLogo}><Text style={s.miniLogoText}>J</Text></View>
        <Text style={s.eyebrow}>CREATE YOUR ACCOUNT</Text>
        <Text style={s.onboardH1}>Start building{'\n'}with intention.</Text>
        <Text style={s.onboardHint}>Your plan, transactions, and legacy stay in one private place.</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.label}>Name</Text>
        <TextInput testID="signup-name" style={s.input} value={form.name} onChangeText={t => setForm({ ...form, name: t })} placeholder="Your name" />
        <Text style={s.label}>Email</Text>
        <TextInput testID="signup-email" style={s.input} value={form.email} onChangeText={t => setForm({ ...form, email: t })} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
        <Text style={s.label}>Password</Text>
        <TextInput testID="signup-password" style={s.input} value={form.password} onChangeText={t => setForm({ ...form, password: t })} placeholder="At least 8 characters" secureTextEntry />
        <Pressable testID="signup-terms" onPress={() => setForm({ ...form, terms: !form.terms })} style={s.checkRow}>
          <View style={[s.checkbox, form.terms && s.checkboxOn]}>{form.terms && <Ionicons name="checkmark" size={11} color="#fff" />}</View>
          <Text style={{ fontSize: 12, color: C.ink, flex: 1 }}>
            I agree to Jaleter&apos;s{' '}
            <Text testID="signup-terms-link" style={{ color: C.goldEyebrow, fontWeight: '700' }} onPress={() => openJaleter('terms')}>Terms</Text>
            {' '}and{' '}
            <Text testID="signup-privacy-link" style={{ color: C.goldEyebrow, fontWeight: '700' }} onPress={() => openJaleter('privacy')}>Privacy Policy</Text>
            .
          </Text>
        </Pressable>
        {error ? <Text testID="signup-error" style={s.formError}>{error}</Text> : null}
        <View style={{ marginTop: 14 }}><GoldButton label={busy ? 'Creating...' : 'Create account'} onPress={onSubmit} disabled={!valid || busy} testID="signup-create" /></View>
        <View style={s.orDivider}><View style={s.orLine} /><Text style={s.orText}>or</Text><View style={s.orLine} /></View>
        <Pressable testID="signup-google" onPress={onGoogle} disabled={busy} style={s.googleBtn}>
          <Ionicons name="logo-google" size={16} color="#4285F4" />
          <Text style={s.googleBtnText}>Continue with Google</Text>
        </Pressable>
        <AppleSignInButton onError={setError} onBusy={setBusy} />
        <Pressable testID="signup-to-login" onPress={goLogin} style={{ alignItems: 'center', marginTop: 12 }}>
          <Text style={s.loginLink}>Already have an account? <Text style={{ color: C.goldEyebrow }}>Log in</Text></Text>
        </Pressable>
      </View>
      <PoweredByJaleter />
    </ScrollView>
  );
};

/* ---------------- Login screen ---------------- */
const Login = ({ back, goSignup, goForgot }: any) => {
  const { login, loginWithGoogle } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /\S+@\S+/.test(form.email) && form.password.length >= 8;
  const onSubmit = async () => {
    setError(''); setBusy(true);
    try { await login(form.email.trim().toLowerCase(), form.password); }
    catch (e: any) { setError(e?.message || 'Login failed.'); }
    finally { setBusy(false); }
  };
  const onGoogle = async () => {
    setError(''); setBusy(true);
    try { await loginWithGoogle(); } catch (e: any) { setError(e?.message || 'Google sign-in failed.'); } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 54, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <CircleBtn testID="login-back" onPress={back}><Ionicons name="arrow-back" size={20} color={C.ink3} /></CircleBtn>
      <View style={s.onboardHeading}>
        <View style={s.miniLogo}><Text style={s.miniLogoText}>J</Text></View>
        <Text style={s.eyebrow}>WELCOME BACK</Text>
        <Text style={s.onboardH1}>Log in to{'\n'}continue.</Text>
        <Text style={s.onboardHint}>Sign in with your Jaleter email{Platform.OS === 'ios' ? ', Google, or Apple' : ' or Google'} account.</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.label}>Email</Text>
        <TextInput testID="login-email" style={s.input} value={form.email} onChangeText={t => setForm({ ...form, email: t })} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
        <Text style={s.label}>Password</Text>
        <TextInput testID="login-password" style={s.input} value={form.password} onChangeText={t => setForm({ ...form, password: t })} placeholder="Your password" secureTextEntry />
        <Pressable testID="login-forgot" onPress={goForgot} style={{ alignSelf: 'flex-end', marginTop: 8 }}>
          <Text style={{ fontSize: 11, color: C.goldEyebrow, fontWeight: '600' }}>Forgot password?</Text>
        </Pressable>
        {error ? <Text testID="login-error" style={s.formError}>{error}</Text> : null}
        <View style={{ marginTop: 14 }}><GoldButton label={busy ? 'Signing in...' : 'Log in'} onPress={onSubmit} disabled={!valid || busy} testID="login-submit" /></View>
        <View style={s.orDivider}><View style={s.orLine} /><Text style={s.orText}>or</Text><View style={s.orLine} /></View>
        <Pressable testID="login-google" onPress={onGoogle} disabled={busy} style={s.googleBtn}>
          <Ionicons name="logo-google" size={16} color="#4285F4" />
          <Text style={s.googleBtnText}>Continue with Google</Text>
        </Pressable>
        <AppleSignInButton onError={setError} onBusy={setBusy} />
        <Pressable testID="login-to-signup" onPress={goSignup} style={{ alignItems: 'center', marginTop: 12 }}>
          <Text style={s.loginLink}>No account yet? <Text style={{ color: C.goldEyebrow }}>Sign up</Text></Text>
        </Pressable>
      </View>
      <PoweredByJaleter />
    </ScrollView>
  );
};

/* ---------------- Forgot password ---------------- */
const ForgotPassword = ({ back, onSent }: any) => {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /\S+@\S+/.test(email);
  const onSubmit = async () => {
    setError(''); setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim().toLowerCase());
      // Dev mode: backend returns reset_token in response. Hand it to the next screen.
      onSent(email.trim().toLowerCase(), res.reset_token || null);
    } catch (e: any) { setError(e?.message || 'Could not send reset link.'); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 54, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <CircleBtn testID="forgot-back" onPress={back}><Ionicons name="arrow-back" size={20} color={C.ink3} /></CircleBtn>
      <View style={s.onboardHeading}>
        <View style={s.miniLogo}><Ionicons name="lock-open-outline" size={22} color={C.goldText} /></View>
        <Text style={s.eyebrow}>PASSWORD RESET</Text>
        <Text style={s.onboardH1}>Forgot your{'\n'}password?</Text>
        <Text style={s.onboardHint}>Enter your Jaleter email and we&apos;ll send you a reset link.</Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.label}>Email</Text>
        <TextInput testID="forgot-email" style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
        {error ? <Text testID="forgot-error" style={s.formError}>{error}</Text> : null}
        <View style={{ marginTop: 14 }}><GoldButton label={busy ? 'Sending...' : 'Send reset link'} onPress={onSubmit} disabled={!valid || busy} testID="forgot-submit" /></View>
      </View>
    </ScrollView>
  );
};

/* ---------------- Reset password ---------------- */
const ResetPassword = ({ back, email, prefilledToken, onDone }: any) => {
  const { resetPassword } = useAuth();
  const [form, setForm] = useState({ token: prefilledToken || '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = form.token.length > 0 && form.password.length >= 8 && form.password === form.confirm;
  const onSubmit = async () => {
    setError(''); setBusy(true);
    try {
      await resetPassword(form.token.trim(), form.password);
      onDone();
    } catch (e: any) { setError(e?.message || 'Reset failed.'); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 54, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <CircleBtn testID="reset-back" onPress={back}><Ionicons name="arrow-back" size={20} color={C.ink3} /></CircleBtn>
      <View style={s.onboardHeading}>
        <View style={s.miniLogo}><Ionicons name="key-outline" size={22} color={C.goldText} /></View>
        <Text style={s.eyebrow}>SET A NEW PASSWORD</Text>
        <Text style={s.onboardH1}>Almost there.</Text>
        <Text style={s.onboardHint}>
          {prefilledToken
            ? (email ? `Reset the password for ${email}.` : 'Paste your reset token and choose a new password.')
            : (email ? `We emailed a reset token to ${email}. Paste it below along with your new password.` : 'Paste the token from your email and choose a new password.')}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.label}>Reset token</Text>
        <TextInput testID="reset-token" style={s.input} value={form.token} onChangeText={t => setForm({ ...form, token: t })} autoCapitalize="none" placeholder="Paste the reset token from the email" />
        <Text style={s.label}>New password</Text>
        <TextInput testID="reset-password" style={s.input} value={form.password} onChangeText={t => setForm({ ...form, password: t })} placeholder="At least 8 characters" secureTextEntry />
        <Text style={s.label}>Confirm new password</Text>
        <TextInput testID="reset-confirm" style={s.input} value={form.confirm} onChangeText={t => setForm({ ...form, confirm: t })} placeholder="Type it again" secureTextEntry />
        {error ? <Text testID="reset-error" style={s.formError}>{error}</Text> : null}
        {form.password.length > 0 && form.confirm.length > 0 && form.password !== form.confirm ? (
          <Text style={s.formError}>Passwords don&apos;t match.</Text>
        ) : null}
        <View style={{ marginTop: 14 }}><GoldButton label={busy ? 'Resetting...' : 'Reset password'} onPress={onSubmit} disabled={!valid || busy} testID="reset-submit" /></View>
      </View>
    </ScrollView>
  );
};

/* ---------------- Connect ---------------- */
const FirstConnect = ({ onConnect, onSkip }: any) => {
  const { token } = useAuth();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const runImport = async () => {
    await pickAndImport(
      token,
      (msg) => { setToast(msg); setTimeout(() => onSkip?.(), 900); onConnect?.({}); },
      (err) => setError(err),
      setImporting
    );
  };

  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 60, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <View style={{ marginTop: 45, alignItems: 'center' }}>
        <View style={s.connectLock}><Ionicons name="shield-checkmark-outline" size={29} color={C.goldText} /></View>
        <Text style={[s.eyebrow, { marginTop: 17 }]}>YOUR MONEY, YOUR CONTROL</Text>
        <Text style={[s.onboardH1, { textAlign: 'center' }]}>Import your first{'\n'}statement.</Text>
        <Text style={[s.onboardHint, { textAlign: 'center' }]}>
          Jaleter never touches your bank credentials. Download a statement from your bank and upload it here — private, secure, on your terms.
        </Text>
      </View>

      <View style={s.connectBenefits}>
        {[
          ['Bank-independent', 'Works with any bank that offers statement downloads.'],
          ['Zero credential storage', 'Your bank password never leaves your bank.'],
          ['No extra fees', 'No third-party sync bill added to your membership.'],
        ].map(([b, sm]) => (
          <View key={b} style={{ flexDirection: 'row', gap: 11, alignItems: 'center', marginVertical: 10 }}>
            <Ionicons name="checkmark" size={16} color="#a57537" />
            <View style={{ flex: 1 }}><Text style={{ fontSize: 12, fontWeight: '700', color: C.ink }}>{b}</Text><Text style={{ fontSize: 10, color: C.muted2 }}>{sm}</Text></View>
          </View>
        ))}
      </View>

      <GoldButton
        label={importing ? 'Importing…' : 'Import Statement (CSV / OFX / QFX / QBO)'}
        onPress={runImport}
        disabled={importing}
        testID="connect-import-file"
      />

      {error ? <Text testID="connect-error" style={[s.formError, { marginTop: 10 }]}>{error}</Text> : null}

      <Pressable onPress={onSkip} testID="connect-skip" hitSlop={8}>
        <Text style={[s.loginLink, { marginTop: 20, textAlign: 'center' }]}>Skip and enter manually</Text>
      </Pressable>

      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Paywall ---------------- */
const Paywall = ({ onContinue }: any) => {
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 60, paddingBottom: 28 }}>
      <View style={s.paywallMark}><Text style={{ color: '#e2b96f', fontSize: 24 }}>✦</Text></View>
      <View style={s.onboardHeading}>
        <Text style={s.eyebrow}>JALETER PREMIUM</Text>
        <Text style={s.onboardH1}>Steward today.{'\n'}Build tomorrow.</Text>
        <Text style={s.onboardHint}>Everything you need to turn daily decisions into a lasting legacy.</Text>
      </View>
      <View style={s.priceCard}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>ANNUAL MEMBERSHIP</Text>
        <Text style={s.priceStrong}>$90<Text style={{ fontSize: 13, color: '#8d867d', fontWeight: '500' }}>/year</Text></Text>
        {['Private statement import (any bank)', 'Budgets, Net Worth, and Legacy', '100 curated Faith + Focus messages'].map(t => (
          <View key={t} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: '#615b52', fontSize: 11 }}>{t}</Text>
          </View>
        ))}
      </View>
      <BillingWebsiteNotice />
      <Pressable onPress={onContinue} testID="paywall-preview"><Text style={[s.loginLink, { marginTop: 20, textAlign: 'center' }]}>Continue to the app</Text></Pressable>
    </ScrollView>
  );
};

/* ---------------- Home ---------------- */
// Shared legacy math — kept next to Home so both Home and Legacy show the
// exact same numbers for the checkpoint cards. The rate is user-editable on
// the Legacy screen and hoisted into App state so Home + Legacy always agree.
const DEFAULT_LEGACY_RATE = 7; // % annual (used until user edits it)
// Applies a hypothetical (one-time / monthly / annual, optional duration) to
// a projection horizon and returns amounts that should be added to cash and
// to the invested principal at year `n`. Kept here so Home and Legacy compute
// hypotheticals identically.
function hypoContributions(hypoAmount: number, freq: 'onetime' | 'monthly' | 'annual', duration: number | null, n: number) {
  if (!hypoAmount || hypoAmount <= 0) return { addToPrincipal: 0, addToCash: 0, addToMonthlyContrib: 0 };
  const active = duration && duration > 0 ? Math.min(duration, n) : n; // years the hypo is active
  if (freq === 'onetime') return { addToPrincipal: hypoAmount, addToCash: 0, addToMonthlyContrib: 0 };
  if (freq === 'monthly') return { addToPrincipal: 0, addToCash: hypoAmount * 12 * active, addToMonthlyContrib: hypoAmount };
  return { addToPrincipal: 0, addToCash: hypoAmount * active, addToMonthlyContrib: hypoAmount / 12 };
}
// Cash-only growth. Investments are NOT included here — they compound
// separately at the return rate. This fixes the confusing Y1/Y5/Y10 mix.
function shortTermCash(totalCash: number, monthlyNet: number, year: number, hypoCashAdd: number = 0): number {
  return Math.round(totalCash + monthlyNet * 12 * year + hypoCashAdd);
}
function longTermInvestment(investmentTotal: number, hypoPrincipal: number, monthlyContribution: number, year: number, ratePct: number = DEFAULT_LEGACY_RATE): number {
  const totalInvested = investmentTotal + hypoPrincipal;
  const r = ratePct / 100;
  if (r === 0) return Math.round(totalInvested + monthlyContribution * 12 * year);
  return Math.round(totalInvested * Math.pow(1 + r, year) + monthlyContribution * 12 * ((Math.pow(1 + r, year) - 1) / r));
}

const HomeScreen = ({ name, initials, experience, netWorth, investmentTotal, totalCash, availableCash, monthlyNet, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyReturnRate, budgetUsage, alertsEnabled, navigate, financialsReady }: any) => {
  const t = useThemed();
  const q = dailyQuote(experience as QuoteType, new Date());
  const hypoValue = Math.max(0, Number((legacyHypothetical || '').replace(/[^0-9.]/g, '')) || 0);
  const hypoFreq: 'onetime' | 'monthly' | 'annual' = legacyHypoFrequency || 'onetime';
  const hypoDur: number | null = typeof legacyHypoDuration === 'number' ? legacyHypoDuration : null;
  const rate = Number(legacyReturnRate) || DEFAULT_LEGACY_RATE;
  const hypoAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n);
  // Home teaser projection — 33yr compound of current investments at the user's chosen rate.
  const h33 = hypoAt(33);
  const projected = investmentTotal > 0 ? longTermInvestment(investmentTotal, h33.addToPrincipal, (legacyContribution || 0) + h33.addToMonthlyContrib, 33, rate) : 0;
  const hasProjection = projected > 0;
  // BUILD (Jun 2026 spec): starts with Total Cash + Investments per Wealth.
  // Investments held FLAT — no compounding assumption. Cash accumulates by
  // the current monthly budget net (positive or negative).
  const buildStartingCash = (typeof totalCash === 'number' ? totalCash : 0) || 0;
  const signedMonthlyNet = Number(monthlyNet || 0);
  const buildAt = (n: number) => {
    // Home BUILD teaser math: investments held flat, cash accumulates by
    // monthly budget net over `n` years. Mirror of LegacyScreen's BUILD.
    const h = hypoAt(n);
    const months = Math.max(0, Math.round(n * 12));
    const heldInvestments = (investmentTotal || 0) + h.addToPrincipal;
    const cashPortion = buildStartingCash + signedMonthlyNet * months + h.addToCash;
    return Math.round(heldInvestments + cashPortion);
  };
  const build1 = buildAt(1);
  const build2 = buildAt(2);
  const build3 = buildAt(3);
  const build5 = buildAt(5);
  // GROW checkpoint — 10yr labelled clearly as "10YR GROW" so users
  // understand it is investment-compound math (never cash-linear).
  const grow10 = longTermInvestment(investmentTotal || 0, hypoAt(10).addToPrincipal, (legacyContribution || 0) + hypoAt(10).addToMonthlyContrib, 10, rate);
  const grow20 = longTermInvestment(investmentTotal || 0, hypoAt(20).addToPrincipal, (legacyContribution || 0) + hypoAt(20).addToMonthlyContrib, 20, rate);
  const grow30 = longTermInvestment(investmentTotal || 0, hypoAt(30).addToPrincipal, (legacyContribution || 0) + hypoAt(30).addToMonthlyContrib, 30, rate);
  const showSnapshot = (totalCash || 0) > 0 || (investmentTotal || 0) > 0 || (monthlyNet || 0) > 0;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <View style={s.homeGreeting}>
        <View style={{ flex: 1 }}>
          <Text style={s.homeDate}>{today}</Text>
          <Text style={[s.homeName, t.textInk]}>Good evening, {name}.</Text>
        </View>
        <CircleBtn onPress={() => navigate('settings')} testID="home-bell"><Ionicons name="notifications-outline" size={18} color={t.dark ? D.text : C.ink3} /></CircleBtn>
        <Pressable onPress={() => navigate('more')} testID="home-profile" style={[s.avatar, { marginLeft: 8 }]}>
          <Text style={{ color: C.goldText, fontSize: 11, fontWeight: '700' }}>{initials}</Text>
        </Pressable>
      </View>
      <Pressable testID="home-inspiration" onPress={() => navigate('settings')} style={s.inspirationCard}>
        <Sparkle size={21} style={{ position: 'absolute', right: 20, top: 18, color: '#f0c77f' }} />
        <Sparkle size={9} style={{ position: 'absolute', right: 45, top: 42, color: '#f0c77f' }} />
        <Text style={{ color: '#d9af6d', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 }}>{q.type.toUpperCase()}</Text>
        <Text style={s.inspirationQuote}>{q.quote}</Text>
        <Text style={{ color: '#aaa297', fontSize: 9 }}>{q.source}</Text>
      </Pressable>
      {/* Prominent Coach AI entry point — replaces the bottom-nav slot.
          Kept visible on the Home screen so users can always reach the coach
          in one tap from the primary landing surface. */}
      <Pressable testID="home-coach-card" onPress={() => navigate('coach')} style={s.coachCard}>
        <LinearGradient
          colors={['#f5d698', '#c49450', '#8a6428']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.coachCardIcon}
        >
          <Ionicons name="sparkles" size={22} color="#fffdf9" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#d9af6d', fontSize: 9, fontWeight: '700', letterSpacing: 1.4 }}>JALETER COACH · AI</Text>
          <Text style={s.coachCardTitle}>Ask about your money</Text>
          <Text style={s.coachCardSub}>Personalized insights grounded in your real budget & spending.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#e5c38b" />
      </Pressable>
      <View style={s.sectionTitle}><Text style={[s.sectionH3, t.textInk]}>Right Now</Text><Text style={[s.sectionCap, t.textMuted]}>Your financial pulse</Text></View>
      <View style={{ flexDirection: 'row', gap: 11 }}>
        <Pressable style={[s.snapshotCard, t.cardBg]} onPress={() => navigate('budget')} testID="home-budget-card">
          <Text style={[s.snapshotLabel, t.textMuted]}>Budget</Text>
          <Text style={[s.snapshotValue, t.textInk]}>{financialsReady ? `${Math.round(budgetUsage)}%` : '••••'}</Text>
          <View style={s.miniProgress}><View style={[s.miniProgressBar, { width: `${financialsReady ? Math.min(budgetUsage, 100) : 0}%` }]} /></View>
          <Text style={[s.snapshotMeta, t.textMuted]}>{financialsReady ? 'used this month' : 'Updating…'}</Text>
        </Pressable>
        <Pressable style={[s.snapshotCard, s.snapshotDark]} onPress={() => navigate('networth')} testID="home-networth-card">
          <Text style={[s.snapshotLabel, { color: '#c4bdb2' }]}>Net Worth</Text>
          <Text style={[s.snapshotValue, { color: '#fff' }]}>{financialsReady ? MONEY(netWorth) : '••••••'}</Text>
          <View style={{ flexDirection: 'row', gap: 3, marginTop: 8, alignItems: 'center' }}>
            <Ionicons name="wallet-outline" size={12} color={C.greenSoft} />
            <Text style={{ color: C.greenSoft, fontSize: 9 }}>{financialsReady ? 'Assets − Liabilities' : 'Updating…'}</Text>
          </View>
        </Pressable>
      </View>
      {alertsEnabled && budgetUsage >= 80 && (
        <Pressable style={s.alertBanner} onPress={() => navigate('budget')} testID="home-alert">
          <View style={s.alertIcon}><Ionicons name="notifications" size={18} color={C.alertIconText} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 11, color: C.alertText }}>You're approaching your budget limit</Text>
            <Text style={{ color: '#8d806e', fontSize: 9 }}>{Math.round(budgetUsage)}% of this month's budget used.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={C.alertText} />
        </Pressable>
      )}
      <View style={s.sectionTitle}>
        <Text style={[s.sectionH3, t.textInk]}>Your Legacy</Text>
        <Pressable onPress={() => navigate('legacy')} testID="home-legacy-link" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#857b6d', fontSize: 11 }}>Explore </Text>
          <Ionicons name="chevron-forward" size={13} color="#857b6d" />
        </Pressable>
      </View>
      <Pressable style={s.legacyTeaser} onPress={() => navigate('legacy')} testID="home-legacy">
        <Text style={{ color: '#c9a56c', fontSize: 8, letterSpacing: 1.3 }}>RETIREMENT PROJECTION</Text>
        {!financialsReady ? (
          <>
            <Text style={s.legacyStrong}>••••••</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 14 }}>Updating your projections…</Text>
          </>
        ) : hasProjection ? (
          <>
            <Text style={s.legacyStrong}>{MONEY(projected)}</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 14 }}>
              33-year compounding of your current investments at {rate}%.
            </Text>
            <View style={{ marginTop: 8 }}>
              <ProjectionLineChart
                ready={true}
                height={80}
                showLabels={false}
                strokeColor="#e5c38b"
                gradientTop="rgba(229,195,139,0.35)"
                gradientBottom="rgba(229,195,139,0)"
                points={(() => {
                  // Real 33-year compounding curve of current investments at
                  // the user's rate. Same math as the headline number.
                  const pts: any[] = [];
                  for (let y = 0; y <= 33; y += 3) {
                    const h33 = hypoAt(y);
                    pts.push({ label: `${y}YR`, value: (investmentTotal || 0) > 0 ? longTermInvestment(investmentTotal, h33.addToPrincipal, (legacyContribution || 0) + h33.addToMonthlyContrib, y, rate) : 0 });
                  }
                  return pts;
                })()}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={s.legacyStrong}>{MONEY(0)}</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 12 }}>
              Link an account or add assets, then open the Legacy page to model your future.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#e5c38b', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>Start your legacy</Text>
              <Ionicons name="chevron-forward" size={13} color="#e5c38b" />
            </View>
          </>
        )}
      </Pressable>

      {/* Legacy Snapshot — mirrors the Legacy tab exactly. BUILD row = 1/2/3/5
          year, GROW row = 10/20/30 year. Labels match so Home ↔ Legacy stay
          in sync and users never see conflicting "Y10 Cash" numbers. All
          numbers are masked while the financials-ready gate is still false
          so users never see a stale/partial projection. */}
      {showSnapshot && (
        <Pressable style={[s.assumptionsCard, t.cardBg, { marginTop: 12 }]} onPress={() => navigate('legacy')} testID="home-legacy-snapshot">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, t.textInk]}>LEGACY SNAPSHOT</Text>
            <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#aaa39a'} />
          </View>
          <Text style={[{ fontSize: 9, marginBottom: 6 }, t.textMuted]}>
            {financialsReady
              ? `BUILD projects your wealth from your budget cash flow (investments held flat). GROW compounds investments at ${rate}%.`
              : 'Updating projections — numbers will appear once your accounts finish loading.'}
          </Text>
          {/* BUILD row — near-term (1/2/3/5 yr). Same math as Legacy BUILD. */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 4 }}>BUILD · CURRENT WEALTH + BUDGET CASH FLOW</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: '1YR', v: build1 },
              { label: '2YR', v: build2 },
              { label: '3YR', v: build3 },
              { label: '5YR', v: build5 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 11, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{financialsReady ? MONEY(row.v) : '••••'}</Text>
              </View>
            ))}
          </View>
          {/* GROW row — long-term investment compounding. 10YR labeled clearly. */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 10 }}>GROW · INVESTMENTS COMPOUND @ {rate}%</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: '10YR GROW', v: grow10 },
              { label: '20YR GROW', v: grow20 },
              { label: '30YR GROW', v: grow30 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{financialsReady ? MONEY(row.v) : '••••'}</Text>
              </View>
            ))}
          </View>
        </Pressable>
      )}
    </ScrollView>
  );
};

/* ---------------- Budget ---------------- */
/* ---------------- Budget helpers ---------------- */
type Subcategory = { id: string; name: string; budgeted: number; months?: Record<number, number> };
type Category = { id: string; name: string; tagline: string; subcategories: Subcategory[] };
const monthlyAmount = (sub: Subcategory, mIdx: number) => sub.months?.[mIdx] ?? sub.budgeted;
const annualAmount = (sub: Subcategory) => { let sum = 0; for (let i = 0; i < 12; i++) sum += monthlyAmount(sub, i); return sum; };
function toCsv(rows: (string | number)[][]): string {
  const esc = (v: any) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\n');
}
async function exportBudgetXlsx(categories: Category[], incomeSources: any[], transactions: any[], onToast: (m: string) => void) {
  const XLSX = await import('xlsx');
  const yearLabel = new Date().getFullYear();
  const dollarFmt = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';

  // Helpers to compute the same totals used across the app
  const incomeActualForMonth = (srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0);
  const expenseActualForMonth = (subId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === subId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0);
  const incomeAnnualActual = (srcId: string) => MONTHS.reduce((sum: number, _: string, i: number) => sum + incomeActualForMonth(srcId, i), 0);
  const expenseAnnualActual = (subId: string) => MONTHS.reduce((sum: number, _: string, i: number) => sum + expenseActualForMonth(subId, i), 0);
  const incomePlannedAnnual = (src: any) => (src.budgeted || 0) * 12;

  const wb = XLSX.utils.book_new();

  // ---------- Sheet 1: Budget Summary ----------
  const summaryRows: any[][] = [];
  summaryRows.push(['Jaleter — Budget Summary'], [`Year ${yearLabel}`], []);
  summaryRows.push(['Section', 'Category', 'Planned', 'Actual', 'Remaining']);

  let grandPlannedIncome = 0, grandActualIncome = 0;
  let grandPlannedExpense = 0, grandActualExpense = 0;

  // Earn section
  summaryRows.push(['EARN']);
  incomeSources.forEach((src: any) => {
    const p = incomePlannedAnnual(src);
    const a = incomeAnnualActual(src.id);
    grandPlannedIncome += p; grandActualIncome += a;
    summaryRows.push(['Earn', src.name, p, a, a - p]);
  });
  summaryRows.push(['', 'Earn Total', grandPlannedIncome, grandActualIncome, grandActualIncome - grandPlannedIncome]);
  summaryRows.push([]);

  // Expense sections (Give / Steward / Grow / Enjoy — plus any custom)
  categories.forEach((c: Category) => {
    summaryRows.push([c.name.toUpperCase()]);
    let secPlanned = 0, secActual = 0;
    c.subcategories.forEach((sub: Subcategory) => {
      const p = annualAmount(sub);
      const a = expenseAnnualActual(sub.id);
      secPlanned += p; secActual += a;
      grandPlannedExpense += p; grandActualExpense += a;
      summaryRows.push([c.name, sub.name, p, a, p - a]);
    });
    summaryRows.push(['', `${c.name} Total`, secPlanned, secActual, secPlanned - secActual]);
    summaryRows.push([]);
  });

  summaryRows.push(['OVERALL']);
  summaryRows.push(['', 'Total Income', grandPlannedIncome, grandActualIncome, grandActualIncome - grandPlannedIncome]);
  summaryRows.push(['', 'Total Planned Expenses', grandPlannedExpense, '', '']);
  summaryRows.push(['', 'Total Actual Expenses', '', grandActualExpense, '']);
  summaryRows.push(['', 'Planned Net (Income − Planned Exp)', grandPlannedIncome, grandPlannedExpense, grandPlannedIncome - grandPlannedExpense]);
  summaryRows.push(['', 'Actual Net (Income − Actual Exp)', '', '', grandActualIncome - grandActualExpense]);

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  // Apply $ format to numeric columns C-E (0-indexed 2, 3, 4)
  const rangeS = XLSX.utils.decode_range(ws1['!ref'] || 'A1');
  for (let R = 4; R <= rangeS.e.r; ++R) {
    for (const col of [2, 3, 4]) {
      const cell = ws1[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, 'Budget Summary');

  // ---------- Sheet 2: Monthly Budget (one sheet, all 12 months stacked) ----------
  const monthlyRows: any[][] = [];
  monthlyRows.push(['Jaleter — Monthly Budget'], [`Year ${yearLabel}`], []);
  MONTHS.forEach((m: string, mi: number) => {
    monthlyRows.push([m.toUpperCase()]);
    monthlyRows.push(['Section', 'Category', 'Planned', 'Actual', 'Remaining']);
    let monthPlannedIncome = 0, monthActualIncome = 0;
    let monthPlannedExpense = 0, monthActualExpense = 0;
    // Earn
    incomeSources.forEach((src: any) => {
      const p = src.budgeted || 0;
      const a = incomeActualForMonth(src.id, mi);
      monthPlannedIncome += p; monthActualIncome += a;
      monthlyRows.push(['Earn', src.name, p, a, a - p]);
    });
    // Expense categories
    categories.forEach((c: Category) => {
      c.subcategories.forEach((sub: Subcategory) => {
        const p = monthlyAmount(sub, mi);
        const a = expenseActualForMonth(sub.id, mi);
        monthPlannedExpense += p; monthActualExpense += a;
        monthlyRows.push([c.name, sub.name, p, a, p - a]);
      });
    });
    monthlyRows.push(['', 'Income Total', monthPlannedIncome, monthActualIncome, monthActualIncome - monthPlannedIncome]);
    monthlyRows.push(['', 'Expense Total', monthPlannedExpense, monthActualExpense, monthPlannedExpense - monthActualExpense]);
    monthlyRows.push(['', 'Net (Actual)', '', '', monthActualIncome - monthActualExpense]);
    monthlyRows.push([]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(monthlyRows);
  ws2['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const rangeM = XLSX.utils.decode_range(ws2['!ref'] || 'A1');
  for (let R = 3; R <= rangeM.e.r; ++R) {
    for (const col of [2, 3, 4]) {
      const cell = ws2[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Budget');

  // ---------- Sheet 3: Annual Grid ----------
  const gridRows: any[][] = [];
  gridRows.push(['Jaleter — Annual Grid'], [`Year ${yearLabel}`], []);
  gridRows.push(['Category', ...MONTHS, 'Annual Total']);
  // Earn
  gridRows.push(['EARN']);
  incomeSources.forEach((src: any) => {
    const monthly = src.budgeted || 0;
    const months = MONTHS.map(() => monthly);
    gridRows.push([`Earn · ${src.name}`, ...months, monthly * 12]);
  });
  // Expenses grouped by category
  categories.forEach((c: Category) => {
    gridRows.push([c.name.toUpperCase()]);
    c.subcategories.forEach((sub: Subcategory) => {
      const monthsArr = MONTHS.map((_: string, i: number) => monthlyAmount(sub, i));
      const total = monthsArr.reduce((s: number, x: number) => s + x, 0);
      gridRows.push([`${c.name} · ${sub.name}`, ...monthsArr, total]);
    });
  });
  const ws3 = XLSX.utils.aoa_to_sheet(gridRows);
  ws3['!cols'] = [{ wch: 28 }, ...MONTHS.map(() => ({ wch: 11 })), { wch: 14 }];
  const rangeG = XLSX.utils.decode_range(ws3['!ref'] || 'A1');
  for (let R = 4; R <= rangeG.e.r; ++R) {
    for (let col = 1; col <= 13; col++) {
      const cell = ws3[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws3, 'Annual Grid');

  // ---------- Sheet 4: Transactions ----------
  const catNameById: Record<string, string> = {};
  const sectionByDetail: Record<string, string> = {};
  categories.forEach((c: Category) => {
    c.subcategories.forEach((sub: Subcategory) => {
      catNameById[sub.id] = sub.name;
      sectionByDetail[sub.id] = c.name;
    });
  });
  const incNameById: Record<string, string> = {};
  incomeSources.forEach((src: any) => { incNameById[src.id] = src.name; });
  const txRows: any[][] = [['Date', 'Merchant / Description', 'Category', 'Jaleter Section', 'Amount', 'Account']];
  const sorted = [...transactions].sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  sorted.forEach((tx: any) => {
    let categoryName = ''; let sectionName = '';
    if (tx.type === 'income') { categoryName = incNameById[tx.groupId] || 'Income'; sectionName = 'Earn'; }
    else { categoryName = catNameById[tx.detailId] || (tx.detailId || ''); sectionName = sectionByDetail[tx.detailId] || ''; }
    const dateStr = tx.date ? (typeof tx.date === 'string' ? tx.date.slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10)) : '';
    txRows.push([dateStr, tx.name || '', categoryName, sectionName, tx.amount || 0, tx.origin || 'Manual']);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(txRows);
  ws4['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }];
  const rangeT = XLSX.utils.decode_range(ws4['!ref'] || 'A1');
  for (let R = 1; R <= rangeT.e.r; ++R) {
    const cell = ws4[XLSX.utils.encode_cell({ r: R, c: 4 })];
    if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
  }
  XLSX.utils.book_append_sheet(wb, ws4, 'Transactions');

  // Emit and share/download
  const filename = `Jaleter_Budget_${yearLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (Platform.OS === 'web') {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      onToast('Downloaded Excel workbook.');
    } else {
      const FileSystem = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) { await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Export Budget Workbook' }); onToast('Ready to share.'); }
      else { onToast('Saved to app cache.'); }
    }
  } catch (e: any) { onToast(e?.message || 'Export failed.'); }
}

async function exportTransactionsCsv(categories: Category[], incomeSources: any[], transactions: any[], onToast: (m: string) => void) {
  const catNameById: Record<string, string> = {};
  const sectionByDetail: Record<string, string> = {};
  categories.forEach((c: Category) => {
    c.subcategories.forEach((sub: Subcategory) => { catNameById[sub.id] = sub.name; sectionByDetail[sub.id] = c.name; });
  });
  const incNameById: Record<string, string> = {};
  incomeSources.forEach((src: any) => { incNameById[src.id] = src.name; });
  const rows: (string | number)[][] = [['Date', 'Merchant', 'Category', 'Jaleter Section', 'Type', 'Amount', 'Account', 'Month']];
  const sorted = [...transactions].sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  sorted.forEach((tx: any) => {
    let categoryName = ''; let sectionName = '';
    if (tx.type === 'income') { categoryName = incNameById[tx.groupId] || 'Income'; sectionName = 'Earn'; }
    else { categoryName = catNameById[tx.detailId] || (tx.detailId || ''); sectionName = sectionByDetail[tx.detailId] || ''; }
    const dateStr = tx.date ? (typeof tx.date === 'string' ? tx.date.slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10)) : '';
    rows.push([dateStr, tx.name || '', categoryName, sectionName, tx.type || '', tx.amount || 0, tx.origin || 'Manual', tx.period || '']);
  });
  const csv = toCsv(rows);
  const filename = `Jaleter_Transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      onToast('Downloaded transactions CSV.');
    } else {
      const FileSystem = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) { await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export Transactions' }); onToast('Ready to share.'); }
      else { onToast('Saved to app cache.'); }
    }
  } catch (e: any) { onToast(e?.message || 'Export failed.'); }
}

/* ---------------- Budget Screen ---------------- */
// Small picker row used inside the Reset-Budget confirmation sheet. Lets
// the user switch between months (0–11) or years (currentYear-2 .. +5)
// without leaving the sheet. Purely presentational — parent owns state.
function YearMonthPickerRow({ kind, target, onChange, currentYear }: {
  kind: 'month' | 'year';
  target: { kind: 'month' | 'year'; year: number; monthIdx?: number };
  onChange: (t: { kind: 'month' | 'year'; year: number; monthIdx?: number }) => void;
  currentYear: number;
}) {
  const t = useThemed();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4, currentYear + 5];
  return (
    <View style={{ marginTop: 4 }}>
      {kind === 'month' && (
        <View style={{ marginBottom: 10 }}>
          <Text style={[{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: '#a97c39', marginBottom: 6 }]}>MONTH</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {MONTHS.map((m, idx) => {
              const selected = target.monthIdx === idx;
              return (
                <Pressable
                  key={m}
                  onPress={() => onChange({ ...target, monthIdx: idx })}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
                    borderWidth: 1, borderColor: selected ? '#b28a4c' : '#e6dcc5',
                    backgroundColor: selected ? '#fbf6ec' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: selected ? '800' : '600', color: selected ? '#8b6437' : '#7a6a4d' }}>{m}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <Text style={[{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: '#a97c39', marginBottom: 6 }]}>YEAR</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {years.map((y) => {
          const selected = target.year === y;
          return (
            <Pressable
              key={y}
              onPress={() => onChange({ ...target, year: y })}
              style={{
                paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
                borderWidth: 1, borderColor: selected ? '#b28a4c' : '#e6dcc5',
                backgroundColor: selected ? '#fbf6ec' : 'transparent',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: selected ? '800' : '600', color: selected ? '#8b6437' : t.dark ? '#d9cfb6' : '#7a6a4d' }}>{y}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const BudgetScreen = ({ categories, setCategories, categoriesByYear, setCategoriesByYear, incomeSources, setIncomeSources, transactions, setTransactions, focusCategory, clearFocus, alerts, budgetYear, finalizedBudgetMonths, setFinalizedBudgetMonths, onSwitchYear, onCopyLastYear }: any) => {
  const t = useThemed();
  const [period, setPeriod] = useState<string>(currentMonth());
  const [view, setView] = useState<'cards' | 'grid'>('cards');
  const [expanded, setExpanded] = useState<string[]>(['give']);
  const [earnExpanded, setEarnExpanded] = useState(true);
  const [editing, setEditing] = useState<{ groupId: string; sub: Subcategory } | null>(null);
  const [editingEarn, setEditingEarn] = useState<any>(null);
  const [addingEarn, setAddingEarn] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Budget-options menu + reset-confirmation state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ kind: 'month' | 'year'; year: number; monthIdx?: number } | null>(null);
  const [newEarnName, setNewEarnName] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatTagline, setNewCatTagline] = useState('');
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');
  // Reassign-before-delete state (spec #1). When a user tries to delete a
  // subcategory that has transactions, we open this sheet to require them to
  // move the affected transactions to another subcategory. Financial history
  // is never lost — only the label changes.
  const [reassignFrom, setReassignFrom] = useState<{ groupId: string; sub: Subcategory; affected: Tx[] } | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>(''); // sub id OR '__new__'
  const [reassignNewName, setReassignNewName] = useState<string>('');
  const annual = period === 'Year';
  const mIdx = annual ? -1 : monthIndex(period);
  useEffect(() => { if (focusCategory) { setExpanded(x => x.includes(focusCategory) ? x : [...x, focusCategory]); clearFocus(); } }, [focusCategory]);

  // Splits-aware, year-aware budget accounting. For a given month, we count
  // each transaction's contribution to a subcategory/income source — split
  // transactions are attributed to each of their splits proportionally.
  const yr = Number(budgetYear) || new Date().getFullYear();
  const spentInSub = React.useCallback((subId: string) => {
    if (annual) return MONTHS.reduce((s, _m, i) => s + spentForSubInMonth(transactions, subId, i, yr), 0);
    return spentForSubInMonth(transactions, subId, mIdx, yr);
  }, [transactions, annual, mIdx, yr]);
  const receivedInIncome = React.useCallback((srcId: string) => {
    if (annual) return MONTHS.reduce((s, _m, i) => s + receivedForIncomeInMonth(transactions, srcId, i, yr), 0);
    return receivedForIncomeInMonth(transactions, srcId, mIdx, yr);
  }, [transactions, annual, mIdx, yr]);
  const actualIncome = incomeSources.reduce((sum: number, x: any) => sum + receivedInIncome(x.id), 0);
  const actualExpenses = categories.reduce((sum: number, c: Category) => sum + c.subcategories.reduce((cs: number, sub: Subcategory) => cs + spentInSub(sub.id), 0), 0);
  const spentInGroup = (gId: string) => {
    const c = categories.find((cc: Category) => cc.id === gId);
    if (!c) return 0;
    return c.subcategories.reduce((s: number, sc: Subcategory) => s + spentInSub(sc.id), 0);
  };
  // (`relevant` was removed — all callers now use the splits-aware helpers.)
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
  // Total planned expenses across every category / subcategory for the
  // currently-selected month (or the whole year when in Year view). This is
  // the "Budgeted Expenses" number surfaced on the summary card (spec #14).
  const plannedExpenses = categories.reduce((sum: number, c: Category) => {
    return sum + c.subcategories.reduce((cs: number, sub: Subcategory) => cs + (annual ? annualAmount(sub) : monthlyAmount(sub, mIdx)), 0);
  }, 0);
  const budgetedRemaining = plannedIncome - plannedExpenses;
  const actualRemaining = actualIncome - actualExpenses;
  const budgetFor = (sub: Subcategory) => annual ? annualAmount(sub) : monthlyAmount(sub, mIdx);
  const groupTotal = (c: Category) => c.subcategories.reduce((s: number, x: Subcategory) => s + budgetFor(x), 0);

  // Drill-down: tapping any Actual number opens a sheet listing the
  // transactions that make up that total, so users can edit / reclassify /
  // delete them (spec: "Make each Actual amount clickable").
  const [drillDown, setDrillDown] = useState<{ kind: 'expense'; subId: string; subName: string; groupName: string } | { kind: 'income'; srcId: string; srcName: string } | null>(null);
  const drillTransactions = React.useMemo(() => {
    if (!drillDown) return [];
    if (drillDown.kind === 'expense') {
      if (annual) {
        const acc: { tx: Tx; contribution: number }[] = [];
        for (let i = 0; i < MONTHS.length; i++) acc.push(...transactionsForSubInMonth(transactions, drillDown.subId, i, yr));
        return acc;
      }
      return transactionsForSubInMonth(transactions, drillDown.subId, mIdx, yr);
    }
    if (annual) {
      const acc: { tx: Tx; contribution: number }[] = [];
      for (let i = 0; i < MONTHS.length; i++) acc.push(...transactionsForIncomeInMonth(transactions, drillDown.srcId, i, yr));
      return acc;
    }
    return transactionsForIncomeInMonth(transactions, drillDown.srcId, mIdx, yr);
  }, [drillDown, transactions, annual, mIdx, yr]);
  const [drillEditTx, setDrillEditTx] = useState<Tx | null>(null);

  const startEdit = (groupId: string, sub: Subcategory) => { setEditing({ groupId, sub }); setDraft(String(budgetFor(sub) || '')); };
  const commitEdit = () => {
    if (!editing) return;
    const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
    setCategories((prev: Category[]) => prev.map((c) => c.id !== editing.groupId ? c : {
      ...c,
      subcategories: c.subcategories.map((sc: Subcategory) => {
        if (sc.id !== editing.sub.id) return sc;
        if (annual) {
          // Annual set: divide evenly and ONLY apply to months that don't already have a manual override.
          // Existing month overrides are preserved so users don't lose their custom edits.
          const perMonth = Math.round(clean / 12);
          const existing = sc.months || {};
          const nextMonths: Record<number, number> = { ...existing };
          for (let i = 0; i < 12; i++) {
            if (nextMonths[i] === undefined) nextMonths[i] = perMonth;
          }
          return { ...sc, budgeted: perMonth, months: nextMonths };
        }
        // Setting for a specific month → override that month only. The
        // month becomes editable in the monthly view, but stays a DRAFT
        // until the user explicitly taps "Finalize" — only finalized
        // months feed BUILD.
        const months = { ...(sc.months || {}), [mIdx]: clean };
        return { ...sc, months };
      }),
    }));
    setEditing(null);
    setDraft('');
  };
  const resetOverride = () => {
    if (!editing || annual) return;
    setCategories((prev: Category[]) => prev.map((c) => c.id !== editing.groupId ? c : {
      ...c,
      subcategories: c.subcategories.map((sc: Subcategory) => {
        if (sc.id !== editing.sub.id) return sc;
        const nextMonths = { ...(sc.months || {}) };
        delete nextMonths[mIdx];
        return { ...sc, months: Object.keys(nextMonths).length ? nextMonths : undefined };
      }),
    }));
    setEditing(null); setDraft('');
  };

  const addCategory = () => {
    const name = (newCatName || '').trim();
    if (!name) return;
    const id = `cat-${Date.now().toString(36)}`;
    setCategories((prev: Category[]) => [...prev, { id, name, tagline: (newCatTagline || '').trim(), subcategories: [] }]);
    setExpanded((xs: string[]) => xs.includes(id) ? xs : [...xs, id]);
    setAddingCategory(false); setNewCatName(''); setNewCatTagline('');
    setToast(`Added "${name}".`);
  };
  const addSubcategory = (groupId: string) => {
    const name = (newSubName || '').trim();
    if (!name) return;
    const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
    const sid = `sub-${Date.now().toString(36)}`;
    setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: [...c.subcategories, { id: sid, name, budgeted: clean }] }));
    setAddingSubTo(null); setNewSubName(''); setDraft('');
    setToast(`Added "${name}".`);
  };
  const removeCategory = (id: string) => {
    const cat = categories.find((c: Category) => c.id === id);
    const name = cat?.name || 'this category';
    const doIt = () => {
      setCategories((prev: Category[]) => prev.filter((c) => c.id !== id));
      setToast('Category removed.');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}" and all its subcategories?\n\nThis cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'This removes the category and all its subcategories. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const removeSubcategory = (groupId: string, subId: string) => {
    const cat = categories.find((c: Category) => c.id === groupId);
    const sub = cat?.subcategories.find((x: Subcategory) => x.id === subId);
    const name = sub?.name || 'this subcategory';
    // Count affected transactions across ALL time (not just current period),
    // because deleting the subcategory affects historical rows too.
    const affected = (transactions || []).filter((tx: Tx) => tx.detailId === subId);
    if (affected.length > 0 && sub) {
      // Open the reassign sheet — user must pick a destination before we
      // delete the subcategory. This keeps every dollar & transaction intact.
      setReassignFrom({ groupId, sub, affected });
      // Default target: the first other sub in the same category, else the
      // first sub anywhere. If there is truly no other sub the user can
      // create a new one via '__new__'.
      const otherInSame = cat?.subcategories.filter((x: Subcategory) => x.id !== subId) || [];
      const anyOther: Subcategory[] = otherInSame.length
        ? otherInSame
        : categories.flatMap((c: Category) => c.subcategories).filter((x: Subcategory) => x.id !== subId);
      setReassignTargetId(anyOther[0]?.id || '__new__');
      setReassignNewName(`${sub.name} (moved)`);
      return;
    }
    // No affected transactions → simple confirm+delete.
    const doIt = () => {
      setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: c.subcategories.filter((x) => x.id !== subId) }));
      setToast('Subcategory removed.');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const commitReassign = () => {
    if (!reassignFrom) return;
    const { groupId, sub, affected } = reassignFrom;
    let destGroupId = groupId;
    let destSubId = reassignTargetId;
    // Create-new branch: append a new subcategory to the same group and
    // move all affected transactions to it.
    if (destSubId === '__new__') {
      const name = (reassignNewName || `${sub.name} (moved)`).trim();
      if (!name) return;
      const newId = `sub-${Date.now().toString(36)}`;
      setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : {
        ...c,
        subcategories: [...c.subcategories, { id: newId, name, budgeted: 0 }],
      }));
      destSubId = newId;
    } else {
      // Find which group the target sub belongs to so we can update
      // transactions' groupId too when moving cross-group.
      for (const c of categories as Category[]) {
        if (c.subcategories.some((x: Subcategory) => x.id === destSubId)) { destGroupId = c.id; break; }
      }
    }
    // Reassign every affected transaction, preserving all financial data.
    const affectedIds = new Set(affected.map((tx) => tx.id));
    setTransactions((prev: Tx[]) => prev.map((tx: Tx) => affectedIds.has(tx.id) ? { ...tx, detailId: destSubId, groupId: destGroupId } : tx));
    // Finally delete the source subcategory.
    setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: c.subcategories.filter((x) => x.id !== sub.id) }));
    setToast(`Moved ${affected.length} transaction${affected.length === 1 ? '' : 's'} · deleted "${sub.name}".`);
    setReassignFrom(null); setReassignTargetId(''); setReassignNewName('');
  };

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Budget" subtitle="Give first. Steward wisely. Grow intentionally." action={
        <View style={s.viewToggle}>
          <Pressable onPress={() => setView('cards')} style={[s.viewTogglePill, view === 'cards' && s.viewTogglePillActive]} testID="budget-view-cards"><Ionicons name="albums-outline" size={13} color={view === 'cards' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
          <Pressable onPress={() => setView('grid')} style={[s.viewTogglePill, view === 'grid' && s.viewTogglePillActive]} testID="budget-view-grid"><Ionicons name="grid-outline" size={13} color={view === 'grid' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
        </View>
      } />
      {/* Year selector — dynamic. Includes: (a) current year, (b) every year
          that already has stored data, (c) three near-future years, and
          (d) any prior years with saved data. New calendar years appear
          automatically without needing a code change (spec #13). */}
      {onSwitchYear && (
        <View style={s.yearSelectorRow}>
          <Text style={s.yearSelectorLabel}>YEAR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(() => {
              const nowY = new Date().getFullYear();
              const dataYears: number[] = Object.keys(categoriesByYear || {})
                .map((y) => Number(y))
                .filter((y) => Number.isFinite(y));
              const set = new Set<number>();
              // Always show the current year + 3 future years + years with data.
              set.add(nowY);
              for (let i = 1; i <= 3; i += 1) set.add(nowY + i);
              dataYears.forEach((y) => set.add(y));
              if (budgetYear) set.add(budgetYear); // always visible even if outside range
              const sorted = Array.from(set).sort((a, b) => a - b);
              return sorted.map((y) => (
                <Pressable
                  key={y}
                  onPress={() => onSwitchYear(y)}
                  style={[s.yearPill, budgetYear === y && s.yearPillActive]}
                  testID={`budget-year-${y}`}
                >
                  <Text style={[s.yearPillText, budgetYear === y && s.yearPillTextActive]}>{y}</Text>
                </Pressable>
              ));
            })()}
          </ScrollView>
          {onCopyLastYear && (() => {
            // Show "Copy last year" only when the previous year has stored
            // categories AND the current year is still at the seeded default
            // (i.e. hasn't been customized yet). This prevents accidental
            // overwrites — user must intentionally opt in each January.
            const prevYear = budgetYear - 1;
            const hasPrev = Boolean(categoriesByYear && categoriesByYear[String(prevYear)]);
            if (!hasPrev) return null;
            return (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    `Copy ${prevYear} budget?`,
                    `We'll copy your ${prevYear} categories and planned amounts into ${budgetYear}. Actual transactions are never copied. This replaces the current ${budgetYear} categories — you can undo by switching back.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: `Copy from ${prevYear}`, onPress: () => onCopyLastYear(prevYear) },
                    ],
                  );
                }}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 10, borderWidth: 1, borderColor: '#c49450',
                  marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
                }}
                testID="budget-copy-last-year"
              >
                <Ionicons name="copy-outline" size={12} color="#9a6d32" />
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#9a6d32' }}>Copy {prevYear}</Text>
              </Pressable>
            );
          })()}
        </View>
      )}
      <PeriodPills values={[...MONTHS, 'Year']} value={period} onChange={setPeriod} testID="budget-period" />
      {annual && (
        <View style={s.yearTotalTop}>
          <Text style={s.yearTotalEyebrow}>TOTAL INCOME · {budgetYear || new Date().getFullYear()}</Text>
          <Text style={s.yearTotalStrong}>{MONEY(actualIncome)}</Text>
          <Text style={s.yearTotalSub}>Expected {MONEY(plannedIncome)} · {plannedIncome > 0 ? Math.round((actualIncome / plannedIncome) * 100) : 0}% received</Text>
        </View>
      )}
      {!annual && (
        <View style={s.budgetSummary}>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Income</Text>
            <Text style={s.bsStrong}>{MONEY(actualIncome)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(plannedIncome)}</Text>
          </View>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Expenses</Text>
            <Text style={s.bsStrong}>{MONEY(actualExpenses)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(plannedExpenses)}</Text>
          </View>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Remaining</Text>
            <Text style={[s.bsStrong, actualRemaining < 0 && { color: '#b0453d' }]}>{MONEY(actualRemaining)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(budgetedRemaining)}</Text>
          </View>
        </View>
      )}
      <View style={s.budgetActions}>
        <Pressable style={s.budgetActionBtn} onPress={() => { setNewCatName(''); setNewCatTagline(''); setAddingCategory(true); }} testID="budget-add-category">
          <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Add Category</Text>
        </Pressable>
        <Pressable style={s.budgetActionBtn} onPress={() => setExportMenuOpen(true)} testID="budget-export">
          <Ionicons name="download-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Export</Text>
        </Pressable>
        <Pressable style={s.budgetActionBtn} onPress={() => setSettingsOpen(true)} testID="budget-settings">
          <Ionicons name="settings-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Options</Text>
        </Pressable>
      </View>

      {/* Draft / Finalized banner — monthly view only. Only Finalized months
          feed BUILD's projection. Users toggle explicitly so nothing
          slips into BUILD before they're ready. */}
      {!annual && (() => {
        const key = `${yr}-${mIdx}`;
        const isFinalized = Array.isArray(finalizedBudgetMonths) && finalizedBudgetMonths.includes(key);
        return (
          <View style={{
            marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1,
            borderColor: isFinalized ? '#c9d9c1' : '#e6dcc5',
            backgroundColor: isFinalized ? (t.dark ? '#1f2620' : '#f4f9ee') : (t.dark ? '#26221c' : '#fbf6ec'),
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                  backgroundColor: isFinalized ? '#4c8b56' : '#8b6437',
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.6 }}>
                    {isFinalized ? 'FINALIZED' : 'DRAFT'}
                  </Text>
                </View>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{period} {yr}</Text>
              </View>
              <Text style={[{ fontSize: 10, marginTop: 4, lineHeight: 14 }, t.textMuted]}>
                {isFinalized
                  ? 'Feeding BUILD projections. Edits keep this month finalized until you switch back to Draft.'
                  : 'Draft budgets do not feed BUILD. Finalize when you\u2019re done to include this month in the BUILD run rate.'}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (!setFinalizedBudgetMonths) return;
                if (isFinalized) {
                  setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => k !== key));
                  setToast(`${period} ${yr} moved to Draft. BUILD updated.`);
                } else {
                  setFinalizedBudgetMonths((prev: string[]) => ((prev || []).includes(key) ? prev : [...(prev || []), key]));
                  setToast(`${period} ${yr} finalized. BUILD updated.`);
                }
              }}
              style={{
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
                backgroundColor: isFinalized ? 'transparent' : '#9a6d32',
                borderWidth: isFinalized ? 1 : 0,
                borderColor: '#c9b98f',
              }}
              testID={isFinalized ? 'budget-set-draft' : 'budget-finalize'}
            >
              <Text style={{
                fontSize: 11, fontWeight: '800',
                color: isFinalized ? '#7a6a4d' : '#fff',
              }}>
                {isFinalized ? 'Return to Draft' : 'Finalize Budget'}
              </Text>
            </Pressable>
          </View>
        );
      })()}
      {/* Budget settings / options menu — houses destructive actions like
          Reset Budget behind a menu (per user spec: keep it out of the
          primary Budget screen surface). */}
      <Sheet visible={settingsOpen} close={() => setSettingsOpen(false)} title="Budget Options" subtitle="Manage your budget data. Destructive actions require a second confirm.">
        <View>
          <Pressable
            style={s.moreGridBtn}
            onPress={() => {
              setSettingsOpen(false);
              setResetTarget({ kind: 'month', year: yr, monthIdx: annual ? new Date().getMonth() : mIdx });
            }}
            testID="budget-reset-month"
          >
            <View style={s.moreGridIcon}><Ionicons name="refresh-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Reset a Month</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Clears budgeted income, expenses, and category amounts for one month. Transactions are preserved.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
          <Pressable
            style={s.moreGridBtn}
            onPress={() => {
              setSettingsOpen(false);
              setResetTarget({ kind: 'year', year: yr });
            }}
            testID="budget-reset-year"
          >
            <View style={s.moreGridIcon}><Ionicons name="calendar-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Reset a Full Year</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Clears all budget data for a full calendar year. Transactions, accounts, and other years are preserved.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
        </View>
      </Sheet>

      {/* Reset confirmation sheet — one sheet handles both month and year
          resets with slightly different copy. */}
      <Sheet visible={!!resetTarget} close={() => setResetTarget(null)} title={
        resetTarget?.kind === 'year'
          ? 'Reset Year Budget?'
          : (resetTarget ? `Reset ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year} Budget?` : '')
      } subtitle={undefined}>
        {resetTarget && (
          <View>
            <YearMonthPickerRow
              kind={resetTarget.kind}
              target={resetTarget}
              onChange={setResetTarget}
              currentYear={yr}
            />
            <Text style={[{ fontSize: 12, marginTop: 10, lineHeight: 17 }, t.textInk]}>
              {resetTarget.kind === 'year'
                ? `This will remove all budget data for January–December ${resetTarget.year}.`
                : `This will remove the budgeted income, expenses, categories/amounts, and other budget entries for ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year}.`}
            </Text>
            <Text style={[{ fontSize: 10, marginTop: 8, lineHeight: 14 }, t.textMuted]}>
              Preserved: transactions, accounts, wealth balances{resetTarget.kind === 'year' ? ', other years' : ", other months' budgets"}, and BUILD projections (which will automatically recompute from your remaining budget months).
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                style={{ flex: 1, borderWidth: 1, borderColor: '#d9cfb6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => setResetTarget(null)}
                testID="budget-reset-cancel"
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#7a6a4d' }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={{ flex: 1, backgroundColor: '#b0453d', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => {
                  if (!resetTarget) return;
                  if (resetTarget.kind === 'month') {
                    const targetY = resetTarget.year;
                    const targetM = resetTarget.monthIdx ?? 0;
                    // Clear per-month overrides on expenses for the CURRENT
                    // budget year (this is what the user sees in `categories`).
                    if (targetY === yr) {
                      setCategories((prev: Category[]) => prev.map((c) => ({
                        ...c,
                        subcategories: c.subcategories.map((sub: any) => {
                          if (!sub?.months || sub.months[targetM] === undefined) return sub;
                          const next = { ...sub.months };
                          delete next[targetM];
                          return { ...sub, months: Object.keys(next).length ? next : undefined };
                        }),
                      })));
                    }
                    // Also clear any snapshot for that year (if the year
                    // isn't the current budget year, e.g., 2027 while
                    // budgeting 2026).
                    if (setCategoriesByYear) {
                      setCategoriesByYear((prev: any) => {
                        const key = String(targetY);
                        if (!prev || !prev[key]) return prev;
                        return {
                          ...prev,
                          [key]: prev[key].map((c: any) => ({
                            ...c,
                            subcategories: (c.subcategories || []).map((sub: any) => {
                              if (!sub?.months || sub.months[targetM] === undefined) return sub;
                              const next = { ...sub.months };
                              delete next[targetM];
                              return { ...sub, months: Object.keys(next).length ? next : undefined };
                            }),
                          })),
                        };
                      });
                    }
                    // Clear income sources' per-month override for that month.
                    setIncomeSources((prev: any[]) => prev.map((x: any) => {
                      if (!x?.months || x.months[targetM] === undefined) return x;
                      const next = { ...x.months };
                      delete next[targetM];
                      return { ...x, months: Object.keys(next).length ? next : undefined };
                    }));
                    // Drop the month from finalizedBudgetMonths.
                    if (setFinalizedBudgetMonths) {
                      const dropKey = `${targetY}-${targetM}`;
                      setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => k !== dropKey));
                    }
                    setToast(`${MONTHS[targetM]} ${targetY} budget reset.`);
                  } else {
                    // Reset a full year.
                    const targetY = resetTarget.year;
                    if (targetY === yr) {
                      // Clear amounts on the current-year categories in place
                      // (keeps user-defined structure intact).
                      setCategories((prev: Category[]) => prev.map((c) => ({
                        ...c,
                        subcategories: c.subcategories.map((sub: any) => ({ ...sub, budgeted: 0, months: undefined })),
                      })));
                      // Clear income-source month overrides (base `budgeted`
                      // is left alone because income sources are shared
                      // across years today — clearing base would affect
                      // other years too).
                      setIncomeSources((prev: any[]) => prev.map((x: any) => ({ ...x, months: undefined })));
                    }
                    // Delete any per-year snapshot for that year.
                    if (setCategoriesByYear) {
                      setCategoriesByYear((prev: any) => {
                        if (!prev || !prev[String(targetY)]) return prev;
                        const next = { ...prev };
                        delete next[String(targetY)];
                        return next;
                      });
                    }
                    // Drop every "targetY-*" from finalizedBudgetMonths.
                    if (setFinalizedBudgetMonths) {
                      setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => {
                        const [ky] = String(k).split('-');
                        return Number(ky) !== targetY;
                      }));
                    }
                    setToast(`${targetY} budget reset.`);
                  }
                  setResetTarget(null);
                }}
                testID="budget-reset-confirm"
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>
                  {resetTarget.kind === 'year' ? `Reset ${resetTarget.year}` : `Reset ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year}`}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </Sheet>
      <Sheet visible={exportMenuOpen} close={() => setExportMenuOpen(false)} title="Export" subtitle="Choose a format. All numbers come from your current Budget + Transactions.">
        <View>
          <Pressable style={s.moreGridBtn} onPress={async () => { setExportMenuOpen(false); await exportBudgetXlsx(categories, incomeSources, transactions, setToast); }} testID="export-workbook">
            <View style={s.moreGridIcon}><Ionicons name="grid-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Export Budget Workbook (.xlsx)</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Formatted workbook · Budget Summary, Monthly Budget, Annual Grid, Transactions.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
          <Pressable style={s.moreGridBtn} onPress={async () => { setExportMenuOpen(false); await exportTransactionsCsv(categories, incomeSources, transactions, setToast); }} testID="export-transactions-csv">
            <View style={s.moreGridIcon}><Ionicons name="document-text-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Export Transactions (.csv)</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Raw transaction rows only — for spreadsheets or accounting software.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
        </View>
      </Sheet>

      {view === 'cards' ? (
        <>
          <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Earn</Text><Text style={[s.sectionCap, t.textMuted]}>All the ways you make money</Text></View>
          <View style={[s.budgetCategory, t.cardBg]}>
            <Pressable style={s.categorySummary} onPress={() => setEarnExpanded((x: boolean) => !x)} testID="budget-earn">
              <View style={[s.purposeIcon, { backgroundColor: '#dfead0' }]}><Text style={[s.purposeIconText, { color: '#4e765c' }]}>E</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Earn</Text>
                <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>What comes in each month</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{MONEY(actualIncome)}</Text>
                <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>of {MONEY(plannedIncome)}</Text>
              </View>
              <Ionicons name={earnExpanded ? 'chevron-down' : 'chevron-forward'} size={17} color={t.dark ? D.textMuted : C.muted} />
            </Pressable>
            {earnExpanded && (
              <View style={s.subcategoryList}>
                {/* Column headers — matching expense subcategory rows */}
                <View style={s.subHeaderRow}>
                  <Text style={s.subHeaderName}>Earn source</Text>
                  <Text style={s.subHeaderCol}>Actual</Text>
                  <Text style={s.subHeaderCol}>Budget</Text>
                  <Text style={s.subHeaderCol}>Left</Text>
                  <View style={{ width: 24 }} />
                </View>
                {incomeSources.map((src: any) => {
                  const rec = receivedInIncome(src.id);
                  const target = src.budgeted * (annual ? 12 : 1);
                  const left = target - rec;
                  const leftColor = target > 0 ? (left < 0 ? '#5a7f60' : left > 0 ? C.amber : '#5a7f60') : '#c1b9ac';
                  const clickable = rec > 0;
                  return (
                    <View key={src.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable
                        onPress={() => { setEditingEarn(src); setDraft(src.budgeted ? String(src.budgeted) : ''); }}
                        style={[s.subcategoryRow, { flex: 1 }]}
                        testID={`budget-earn-${src.id}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{src.name}</Text>
                          {src.budgeted <= 0 && <Text style={{ fontSize: 8, color: '#c9a56c' }}>tap to set</Text>}
                        </View>
                        <Pressable
                          onPress={clickable ? () => setDrillDown({ kind: 'income', srcId: src.id, srcName: src.name }) : undefined}
                          style={[s.subCol, clickable && { backgroundColor: '#c4945010', borderRadius: 4 }]}
                          hitSlop={4}
                          testID={`budget-earn-actual-${src.id}`}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: clickable ? '#9a6d32' : (t.dark ? D.text : C.ink) }} numberOfLines={1}>{MONEY(rec)}</Text>
                          {clickable && <Text style={{ fontSize: 7, color: '#c1a06a', letterSpacing: 0.4 }}>view</Text>}
                        </Pressable>
                        <View style={s.subCol}>
                          <Text style={{ fontSize: 11, color: t.dark ? D.text : C.ink }} numberOfLines={1}>{MONEY(target)}</Text>
                        </View>
                        <View style={s.subCol}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: leftColor }} numberOfLines={1}>
                            {target > 0 ? (left >= 0 ? MONEY(left) : `+${MONEY(-left)}`) : '—'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#c1b9ac'} />
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable onPress={() => { setNewEarnName(''); setDraft(''); setAddingEarn(true); }} style={[s.subcategoryRow, { justifyContent: 'center' }]} testID="budget-earn-add">
                  <Ionicons name="add-circle-outline" size={16} color="#9a6d32" />
                  <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>Add Earn source</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Plan by Purpose</Text><Text style={[s.sectionCap, t.textMuted]}>{annual ? 'Year total per category — tap to set' : `${period} · tap to set an amount`}</Text></View>
          <View style={{ gap: 11 }}>
            {categories.map((c: Category) => {
              const total = groupTotal(c);
              const actual = spentInGroup(c.id);
              const pct = total ? actual / total * 100 : 0;
              const open = expanded.includes(c.id);
              const barColor = pct >= 100 ? C.red : pct >= 80 ? C.amber : C.green;
              return (
                <View key={c.id} style={[s.budgetCategory, t.cardBg, open && { borderColor: '#ddc7a6' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable style={[s.categorySummary, { flex: 1 }]} onPress={() => setExpanded(xs => xs.includes(c.id) ? xs.filter(x => x !== c.id) : [...xs, c.id])} onLongPress={() => removeCategory(c.id)} testID={`budget-cat-${c.id}`}>
                      <View style={s.purposeIcon}><Text style={s.purposeIconText}>{c.name[0]}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: C.ink }, t.textInk]}>{c.name}</Text>
                        <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]} numberOfLines={1}>{c.tagline}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]}>{MONEY(actual)} <Text style={{ color: '#c1b9ac', fontWeight: '400' }}>/ {MONEY(total)}</Text></Text>
                        <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>{Math.round(pct)}% used</Text>
                      </View>
                      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={17} color={t.dark ? D.textMuted : C.muted} />
                    </Pressable>
                    <Pressable onPress={() => removeCategory(c.id)} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 6 }} testID={`budget-cat-del-${c.id}`}>
                      <Ionicons name="trash-outline" size={15} color="#b06a5b" />
                    </Pressable>
                  </View>
                  <View style={s.categoryProgress}><View style={[s.categoryProgressBar, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]} /></View>
                  {open && (
                    <View style={s.subcategoryList}>
                      {/* Column headers */}
                      <View style={s.subHeaderRow}>
                        <Text style={s.subHeaderName}>Subcategory</Text>
                        <Text style={s.subHeaderCol}>Actual</Text>
                        <Text style={s.subHeaderCol}>Budget</Text>
                        <Text style={s.subHeaderCol}>Left</Text>
                        <View style={{ width: 24 }} />
                      </View>
                      {c.subcategories.map((sub: Subcategory) => {
                        const b = budgetFor(sub);
                        const a = spentInSub(sub.id);
                        const remaining = b - a;
                        const spct = b > 0 ? a / b * 100 : 0;
                        const conf = (alerts?.perCategory && alerts.perCategory[sub.id]) || { p50: false, p80: true, exceeded: true };
                        let alertLevel: 'p50' | 'p80' | 'exceeded' | null = null;
                        if (alerts?.enabled) {
                          if (conf.exceeded && spct >= 100) alertLevel = 'exceeded';
                          else if (conf.p80 && spct >= 80) alertLevel = 'p80';
                          else if (conf.p50 && spct >= 50) alertLevel = 'p50';
                        }
                        const alertColor = alertLevel === 'exceeded' ? C.red : alertLevel === 'p80' ? C.amber : alertLevel === 'p50' ? '#c9a56c' : null;
                        const leftColor = b > 0 ? (remaining < 0 ? C.red : remaining < b * 0.2 ? C.amber : '#5a7f60') : '#c1b9ac';
                        return (
                          <View key={sub.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Pressable
                              onPress={() => startEdit(c.id, sub)}
                              onLongPress={() => removeSubcategory(c.id, sub.id)}
                              style={[s.subcategoryRow, { flex: 1 }]}
                              testID={`budget-sub-${sub.id}`}
                            >
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{sub.name}</Text>
                                </View>
                                {alertColor && (
                                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, backgroundColor: alertColor + '22', borderWidth: 1, borderColor: alertColor }}>
                                    <Text style={{ color: alertColor, fontSize: 8, fontWeight: '800' }}>{alertLevel === 'exceeded' ? 'OVER' : alertLevel === 'p80' ? '80%' : '50%'}</Text>
                                  </View>
                                )}
                              </View>
                              <Pressable
                                onPress={a > 0 ? () => setDrillDown({ kind: 'expense', subId: sub.id, subName: sub.name, groupName: c.name }) : () => startEdit(c.id, sub)}
                                hitSlop={4}
                                style={[s.subCol, a > 0 && { backgroundColor: '#c4945010', borderRadius: 4 }]}
                                testID={`budget-actual-${sub.id}`}
                              >
                                <Text style={{ fontSize: 11, color: a > 0 ? '#9a6d32' : (t.dark ? D.text : C.ink), fontWeight: a > 0 ? '700' : '400' }} numberOfLines={1}>{MONEY(a)}</Text>
                                {a > 0 && <Text style={{ fontSize: 7, color: '#c1a06a', letterSpacing: 0.4 }}>view</Text>}
                              </Pressable>
                              <Text style={[s.subCol, { color: b > 0 ? (t.dark ? D.textInk : C.ink) : '#c9a56c' }]}>{b > 0 ? MONEY(b) : '—'}</Text>
                              <Text style={[s.subCol, { color: leftColor, fontWeight: '800' }]}>{b > 0 ? MONEY(remaining) : '—'}</Text>
                            </Pressable>
                            <Pressable onPress={() => removeSubcategory(c.id, sub.id)} hitSlop={6} style={{ paddingHorizontal: 6, paddingVertical: 8 }} testID={`budget-sub-del-${sub.id}`}>
                              <Ionicons name="close-circle-outline" size={14} color="#b06a5b" />
                            </Pressable>
                          </View>
                        );
                      })}
                      <Pressable onPress={() => { setAddingSubTo(c.id); setNewSubName(''); setDraft(''); }} style={[s.subcategoryRow, { justifyContent: 'center' }]} testID={`budget-sub-add-${c.id}`}>
                        <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
                        <Text style={{ color: '#9a6d32', fontSize: 10, fontWeight: '700', marginLeft: 6 }}>Add subcategory</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          {annual && (
            <View style={s.yearTotalBottom}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                <Text style={s.yearTotalEyebrow}>TOTAL EXPENSES · {new Date().getFullYear()}</Text>
                <Text style={{ fontSize: 9, color: C.muted2 }}>{plannedIncome > 0 ? `${Math.round((actualExpenses / plannedIncome) * 100)}% of income` : ''}</Text>
              </View>
              <Text style={[s.yearTotalStrong, { color: C.ink }]}>{MONEY(actualExpenses)}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e8dcc4' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted2, letterSpacing: 0.6 }}>NET REMAINING</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: actualIncome - actualExpenses >= 0 ? '#5a7f60' : C.red }}>{MONEY(actualIncome - actualExpenses)}</Text>
              </View>
            </View>
          )}
        </>
      ) : (
        <BudgetGrid
          categories={categories}
          incomeSources={incomeSources}
          incomeReceivedForMonth={(srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0)}
          spentInSub={(id: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === id && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0)}
          onEdit={startEdit}
          onEditIncome={(src: any) => { setEditingEarn(src); setDraft(src.budgeted ? String(src.budgeted) : ''); }}
          tDark={t.dark}
        />
      )}

      <Sheet visible={!!editing} close={() => { setEditing(null); setDraft(''); }} title={editing ? `${annual ? 'Set annual' : `Set ${period}`} · ${editing.sub.name}` : ''} subtitle={annual ? 'Annual amount auto-splits evenly across 12 months — but any months you\'ve already customized will stay unchanged.' : `Amount is for ${period} only. Other months are not affected.`}>
        {editing && (
          <View>
            <Text style={s.label}>{annual ? 'Annual amount' : 'Monthly amount'}</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" autoFocus testID="budget-edit-amount" />
            </View>
            <View style={{ marginTop: 14 }}>
              <GoldButton label="Save amount" onPress={commitEdit} testID="budget-edit-save" />
            </View>
            {!annual && editing.sub.months && editing.sub.months[mIdx] !== undefined && (
              <Pressable onPress={resetOverride} style={{ marginTop: 12, alignItems: 'center' }} testID="budget-edit-reset">
                <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700' }}>Reset {period} to auto-split</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>

      <Sheet visible={!!editingEarn} close={() => { setEditingEarn(null); setDraft(''); }} title={editingEarn ? `Set expected · ${editingEarn.name}` : ''} subtitle="Amount is what you expect to earn per month.">
        {editingEarn && (
          <View>
            <Text style={s.label}>Monthly amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" autoFocus testID="earn-edit-amount" />
            </View>
            <View style={{ marginTop: 14 }}>
              <GoldButton label="Save amount" onPress={() => {
                const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
                setIncomeSources((prev: any[]) => prev.map((x) => x.id === editingEarn.id ? { ...x, budgeted: clean } : x));
                setEditingEarn(null); setDraft('');
              }} testID="earn-edit-save" />
            </View>
            <Pressable onPress={() => {
              setIncomeSources((prev: any[]) => prev.filter((x) => x.id !== editingEarn.id));
              setEditingEarn(null); setDraft('');
            }} style={{ marginTop: 12, alignItems: 'center' }} testID="earn-edit-delete">
              <Text style={{ color: C.danger, fontSize: 11, fontWeight: '700' }}>Delete this source</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      <Sheet visible={addingEarn} close={() => { setAddingEarn(false); setNewEarnName(''); setDraft(''); }} title="Add Earn source" subtitle="Name it and set the monthly amount you expect.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newEarnName} onChangeText={setNewEarnName} placeholder="e.g., Freelance" testID="earn-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Monthly amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" testID="earn-add-amount" />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Add source" onPress={() => {
              const name = (newEarnName || '').trim();
              if (!name) return;
              const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
              const id = `earn-${Date.now().toString(36)}`;
              setIncomeSources((prev: any[]) => [...prev, { id, name, budgeted: clean }]);
              setAddingEarn(false); setNewEarnName(''); setDraft('');
            }} testID="earn-add-save" />
          </View>
        </View>
      </Sheet>

      <Sheet visible={addingCategory} close={() => { setAddingCategory(false); setNewCatName(''); setNewCatTagline(''); }} title="Add Category" subtitle="Create a new spending purpose. You can add subcategories after.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newCatName} onChangeText={setNewCatName} placeholder="e.g., Health" testID="cat-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Short tagline (optional)</Text>
          <TextInput style={s.input} value={newCatTagline} onChangeText={setNewCatTagline} placeholder="e.g., Care for the body you're given" testID="cat-add-tagline" />
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Create Category" onPress={addCategory} testID="cat-add-save" />
          </View>
        </View>
      </Sheet>

      <Sheet visible={!!addingSubTo} close={() => { setAddingSubTo(null); setNewSubName(''); setDraft(''); }} title="Add Subcategory" subtitle="Name it and (optionally) set the monthly amount.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newSubName} onChangeText={setNewSubName} placeholder="e.g., Gym" testID="sub-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Monthly amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" testID="sub-add-amount" />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Add" onPress={() => addingSubTo && addSubcategory(addingSubTo)} testID="sub-add-save" />
          </View>
        </View>
      </Sheet>

      {/* Drill-down: transactions that make up an Actual number. Tap any
          row to open the standard TxForm sheet — edit / reclassify / delete
          all works from here. Budget totals refresh instantly on save. */}
      <Sheet
        visible={!!drillDown}
        close={() => { setDrillDown(null); setDrillEditTx(null); }}
        title={drillDown ? (drillDown.kind === 'expense' ? drillDown.subName : drillDown.srcName) : ''}
        subtitle={drillDown ? `${drillTransactions.length} transaction${drillTransactions.length === 1 ? '' : 's'} · ${period === 'Year' ? String(budgetYear) : `${period} ${budgetYear}`}` : ''}
      >
        {drillDown && (
          <View>
            {drillTransactions.length === 0 ? (
              <Text style={{ fontSize: 11, color: C.muted2 }}>No transactions yet for this period.</Text>
            ) : drillTransactions.map(({ tx, contribution }) => (
              <Pressable
                key={tx.id}
                onPress={() => setDrillEditTx(tx)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}
                testID={`budget-drill-${tx.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{tx.name}</Text>
                  <Text style={[{ fontSize: 9 }, t.textMuted]} numberOfLines={1}>
                    {(tx.date || '').slice(0, 10)} · {tx.origin}{tx.merchant && tx.merchant !== tx.name ? ` · ${tx.merchant}` : ''}{tx.splits && tx.splits.length > 0 ? ` · Split contribution` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[{ fontSize: 12, fontWeight: '800' }, t.textInk]}>{MONEY(contribution)}</Text>
                  {tx.splits && tx.splits.length > 0 && Math.abs(tx.amount - contribution) > 0.01 && (
                    <Text style={[{ fontSize: 8 }, t.textMuted]}>of {MONEY(tx.amount)}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={13} color={t.dark ? D.textMuted : '#c1b9ac'} style={{ marginLeft: 4 }} />
              </Pressable>
            ))}
          </View>
        )}
      </Sheet>
      <Sheet visible={!!drillEditTx} close={() => setDrillEditTx(null)} title={drillEditTx?.id ? 'Edit Transaction' : 'Add Transaction'} subtitle="Update the amount, category, or delete the transaction. Budget totals refresh instantly.">
        {drillEditTx && (
          <TxForm
            item={drillEditTx}
            categories={categories}
            incomeSources={incomeSources}
            save={(next: any) => {
              // Preserve the tx id from the original — TxForm may include a
              // spread that could omit it. Then update transactions state.
              const merged = { ...drillEditTx, ...next };
              setTransactions((prev: Tx[]) => prev.map((x: Tx) => x.id === merged.id ? merged : x));
              setDrillEditTx(null);
            }}
            remove={(id: string) => {
              setTransactions((prev: Tx[]) => prev.filter((x: Tx) => x.id !== id));
              setDrillEditTx(null);
            }}
          />
        )}
      </Sheet>

      {/* Reassign-before-delete sheet — required whenever the target
          subcategory has transactions attached to it. Financial history is
          preserved by moving each transaction's `detailId` (and groupId if
          the destination lives under a different category). */}
      <Sheet
        visible={!!reassignFrom}
        close={() => { setReassignFrom(null); setReassignTargetId(''); setReassignNewName(''); }}
        title={reassignFrom ? `Reassign "${reassignFrom.sub.name}"` : ''}
        subtitle="This subcategory has transactions. Choose where to move them before deleting. Your transaction totals stay unchanged — only the label moves."
      >
        {reassignFrom && (
          <View>
            <View style={{ padding: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: '#c49450', marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#9a6d32' }}>
                {reassignFrom.affected.length} transaction{reassignFrom.affected.length === 1 ? '' : 's'} affected
              </Text>
              <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 2 }}>
                All existing spend & history moves with them. Nothing is deleted.
              </Text>
            </View>

            <Text style={[s.label, { marginBottom: 6 }]}>Move to</Text>
            <View style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10 }}>
              {/* List of other subcategories, grouped by category */}
              {categories.map((c: Category) => {
                const eligible = c.subcategories.filter((x: Subcategory) => x.id !== reassignFrom.sub.id);
                if (eligible.length === 0) return null;
                return (
                  <View key={c.id}>
                    <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', paddingHorizontal: 10, paddingTop: 8 }}>
                      {c.name.toUpperCase()}
                    </Text>
                    {eligible.map((sc: Subcategory) => (
                      <Pressable
                        key={sc.id}
                        onPress={() => setReassignTargetId(sc.id)}
                        style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}
                        testID={`reassign-target-${sc.id}`}
                      >
                        <Ionicons
                          name={reassignTargetId === sc.id ? 'radio-button-on' : 'radio-button-off'}
                          size={16}
                          color={reassignTargetId === sc.id ? '#9a6d32' : (t.dark ? D.textMuted : C.muted)}
                        />
                        <Text style={[{ fontSize: 12, marginLeft: 10, flex: 1 }, t.textInk]}>{sc.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
              {/* Create-new option */}
              <View>
                <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', paddingHorizontal: 10, paddingTop: 8 }}>OR CREATE NEW</Text>
                <Pressable
                  onPress={() => setReassignTargetId('__new__')}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}
                  testID="reassign-target-new"
                >
                  <Ionicons
                    name={reassignTargetId === '__new__' ? 'radio-button-on' : 'radio-button-off'}
                    size={16}
                    color={reassignTargetId === '__new__' ? '#9a6d32' : (t.dark ? D.textMuted : C.muted)}
                  />
                  <Text style={[{ fontSize: 12, marginLeft: 10 }, t.textInk]}>
                    Create a new subcategory in {reassignFrom ? (categories.find((c: Category) => c.id === reassignFrom.groupId)?.name || 'this category') : 'this category'}
                  </Text>
                </Pressable>
                {reassignTargetId === '__new__' && (
                  <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
                    <TextInput
                      style={s.input}
                      value={reassignNewName}
                      onChangeText={setReassignNewName}
                      placeholder="Name for the new subcategory"
                      testID="reassign-new-name"
                    />
                  </View>
                )}
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              <GoldButton
                label={`Move & delete "${reassignFrom.sub.name}"`}
                onPress={commitReassign}
                disabled={!reassignTargetId || (reassignTargetId === '__new__' && !reassignNewName.trim())}
                testID="reassign-confirm"
              />
            </View>
            <Pressable onPress={() => { setReassignFrom(null); setReassignTargetId(''); setReassignNewName(''); }} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: C.muted2, fontSize: 11 }}>Cancel — keep subcategory</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Budget Grid (annual spreadsheet view) ---------------- */
const BudgetGrid = ({ categories, incomeSources, incomeReceivedForMonth, spentInSub, onEdit, onEditIncome, tDark }: any) => {
  const cellW = 60;
  const nameW = 130;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={[s.gridHeader, tDark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <View style={{ width: nameW }}><Text style={[s.gridHeaderText, tDark && { color: D.text }]}>Category</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MONTHS.map((m: string) => (
            <View key={m} style={{ width: cellW, alignItems: 'center' }}>
              <Text style={[s.gridHeaderText, tDark && { color: D.text }]}>{m}</Text>
            </View>
          ))}
          <View style={{ width: cellW + 10, alignItems: 'center' }}><Text style={[s.gridHeaderText, tDark && { color: D.text }]}>Year</Text></View>
        </ScrollView>
      </View>
      {/* Income section — matches monthly breakdown for Earn sources */}
      {Array.isArray(incomeSources) && incomeSources.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <View style={[s.gridGroupRow, tDark && { backgroundColor: D.surfaceAlt }, { backgroundColor: '#eef4e6' }]}>
            <Text style={[s.gridGroupText, tDark && { color: D.text }, { color: '#4e765c' }]}>Income · Earn</Text>
          </View>
          {incomeSources.map((src: any) => {
            const annualPlanned = (src.budgeted || 0) * 12;
            return (
              <View key={src.id} style={[s.gridRow, tDark && { borderColor: D.border }]}>
                <View style={{ width: nameW, paddingRight: 6 }}><Text style={[s.gridSubText, tDark && { color: D.text }]} numberOfLines={1}>{src.name}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {MONTHS.map((_: string, i: number) => {
                    const planned = src.budgeted || 0;
                    const received = incomeReceivedForMonth ? incomeReceivedForMonth(src.id, i) : 0;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onEditIncome?.(src)}
                        style={{ width: cellW, alignItems: 'center', paddingVertical: 6 }}
                        testID={`grid-inc-${src.id}-${i}`}
                      >
                        <Text style={[{ fontSize: 10, fontWeight: '700', color: '#4e765c' }, tDark && { color: '#a4c9a5' }]}>{planned > 0 ? `$${Math.round(planned)}` : '—'}</Text>
                        {received > 0 && <Text style={{ fontSize: 8, color: '#7a9b7a' }}>${Math.round(received)}</Text>}
                      </Pressable>
                    );
                  })}
                  <View style={{ width: cellW + 10, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#4e765c' }}>${Math.round(annualPlanned)}</Text>
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      )}
      {categories.map((c: Category) => (
        <View key={c.id} style={{ marginBottom: 6 }}>
          <View style={[s.gridGroupRow, tDark && { backgroundColor: D.surfaceAlt }]}><Text style={[s.gridGroupText, tDark && { color: D.text }]}>{c.name}</Text></View>
          {c.subcategories.map((sub: Subcategory) => {
            const annualTotal = annualAmount(sub);
            return (
              <View key={sub.id} style={[s.gridRow, tDark && { borderColor: D.border }]}>
                <View style={{ width: nameW, paddingRight: 6 }}><Text style={[s.gridSubText, tDark && { color: D.text }]} numberOfLines={1}>{sub.name}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {MONTHS.map((_: string, i: number) => {
                    const b = monthlyAmount(sub, i);
                    const a = spentInSub(sub.id, i);
                    const over = a > b && b > 0;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onEdit(c.id, sub)}
                        style={{ width: cellW, alignItems: 'center', paddingVertical: 6, backgroundColor: over ? '#fbecd8' : 'transparent' }}
                        testID={`grid-cell-${sub.id}-${i}`}
                      >
                        <Text style={[{ fontSize: 10, fontWeight: '700' }, tDark && { color: D.text }]}>{b > 0 ? `$${Math.round(b)}` : '—'}</Text>
                        {a > 0 && <Text style={{ fontSize: 8, color: over ? '#b46b41' : '#8b9a80' }}>${Math.round(a)}</Text>}
                      </Pressable>
                    );
                  })}
                  <View style={{ width: cellW + 10, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={[{ fontSize: 10, fontWeight: '800', color: '#9a6d32' }]}>${Math.round(annualTotal)}</Text>
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};

/* ---------------- File import helper (shared) ---------------- */
async function pickAndImport(token: string | null, onDone: (msg: string) => void, onError: (err: string) => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  try {
    const DocumentPicker = await import('expo-document-picker');
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/x-ofx', 'application/vnd.intu.qbo', 'application/x-qfx', 'application/octet-stream', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) { setBusy(false); return; }
    const asset = res.assets[0];
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(asset.uri)).blob();
      form.append('file', new File([blob], asset.name, { type: asset.mimeType || 'text/csv' }));
    } else {
      // @ts-ignore RN FormData
      form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
    }
    const headers: any = { 'Authorization': `Bearer ${token}` };
    const url = `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/accounts/import`;
    const httpRes = await fetch(url, { method: 'POST', headers, body: form as any });
    const body = await httpRes.json();
    if (!httpRes.ok) throw new Error(body?.detail || 'Import failed');
    onDone(`Imported ${body.inserted} tx (${body.duplicates} duplicates skipped).`);
  } catch (e: any) { onError(e?.message || 'Import failed.'); }
  finally { setBusy(false); }
}

/* ---------------- Transactions ---------------- */
const TransactionsScreen = ({ transactions, setTransactions, categories, incomeSources, openLinkSheet, alerts, onRefresh }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [filter, setFilter] = useState('All');
  const [accountFilter, setAccountFilter] = useState<string>('All');
  const [dateRange, setDateRange] = useState<string>('All');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  const [linkedLoaded, setLinkedLoaded] = useState(false);
  const refreshLinkedRows = React.useCallback(() => {
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => { setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []); setLinkedLoaded(true); })
      .catch(() => { setLinkedRows([]); setLinkedLoaded(true); });
  }, [token]);
  useEffect(() => {
    let alive = true;
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => { if (alive) { setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []); setLinkedLoaded(true); } })
      .catch(() => { if (alive) { setLinkedRows([]); setLinkedLoaded(true); } });
    return () => { alive = false; };
  }, [token, transactions.length]);
  // Tap the sync banner to force a Plaid + SimpleFIN resync followed by a
  // full refetch of accounts and transactions. Users kept asking "why aren't
  // my new transactions showing?" — this makes the answer a single tap.
  const runManualSync = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    try {
      // Fire both provider syncs in parallel — silent on individual failures.
      await Promise.allSettled([
        apiCall('/api/plaid/sync', { method: 'POST' }, token),
        apiCall('/api/accounts/sync', { method: 'POST' }, token),
      ]);
      refreshLinkedRows();
      // Force the App-level useEffect that fetches /accounts/transactions to re-run.
      onRefresh && onRefresh();
      setToast('Refreshed. New transactions will appear momentarily.');
    } catch { setToast('Refresh failed. Please try again.'); }
    finally { setSyncing(false); }
  };
  const shown = transactions.filter((tx: Tx) => {
    // Type filter — Activity is now only All / Income / Expenses (spec #10).
    // Transfer-flagged rows still surface here so users can see them; they
    // just don't count in Budget/Reports.
    const isTransfer = isSystemTransaction(tx);
    if (filter === 'Income' && (tx.type !== 'income' || isTransfer)) return false;
    if (filter === 'Expenses' && (tx.type !== 'expense' || isTransfer)) return false;
    // Account/bank filter — matches `origin` (e.g. "Chase", "Bank of America", "Manual")
    if (accountFilter !== 'All' && tx.origin !== accountFilter) return false;
    // Date-range filter
    if (dateRange !== 'All') {
      const isoMatch = typeof tx.date === 'string' ? tx.date.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
      if (!isoMatch) return false;
      const txDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      const now = new Date();
      if (dateRange === '30d') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (txDate < cutoff) return false;
      } else if (dateRange === 'This Month') {
        if (txDate.getFullYear() !== now.getFullYear() || txDate.getMonth() !== now.getMonth()) return false;
      } else if (dateRange === 'Last Month') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        if (txDate.getFullYear() !== lm.getFullYear() || txDate.getMonth() !== lm.getMonth()) return false;
      } else if (dateRange === 'YTD') {
        if (txDate.getFullYear() !== now.getFullYear()) return false;
      } else if (dateRange === 'Custom') {
        if (customFrom) {
          const [y, m, d] = customFrom.split('-').map(Number);
          if (txDate < new Date(y, (m || 1) - 1, d || 1)) return false;
        }
        if (customTo) {
          const [y, m, d] = customTo.split('-').map(Number);
          if (txDate > new Date(y, (m || 1) - 1, d || 1)) return false;
        }
      }
    }
    return true;
  });
  // Unique origins (banks) for the account filter — computed once per render.
  const originOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) if (tx.origin) set.add(tx.origin);
    return ['All', ...Array.from(set).sort()];
  }, [transactions]);
  const save = (t: any) => {
    // Overlay vs manual: when editing a linked (Plaid) transaction we MUST
    // preserve the original `origin` (e.g. "Chase", "Ally Bank") instead of
    // stamping "Manual" — that was the root cause of #9 (Chase txns showing
    // as Manual). Real Manual entries — no external_id — still default to
    // "Manual" as before.
    setTransactions((xs: Tx[]) => {
      if (xs.some(x => x.id === t.id)) {
        return xs.map(x => x.id === t.id ? t : x);
      }
      const isOverlay = !!(t as any).external_id;
      const newEntry: any = {
        ...t,
        id: isOverlay ? t.id : `manual-${Date.now()}`,
        origin: isOverlay ? (t.origin || 'Linked') : (t.origin || 'Manual'),
        period: t.period || currentMonth(),
      };
      return [newEntry, ...xs];
    });
    setEditing(null); setToast('Transaction saved and totals refreshed.');
    // Single-expense alert (spec #16) — fires only for eligible expense
    // transactions. Transfers, refunds, credit-card payments and income
    // deposits are ignored per the exclusion list.
    const isEligibleExpense =
      t.type === 'expense'
      && !isSystemTransaction(t)
      && Number(t.amount) > 0;
    const threshold = alerts?.singleExpense?.threshold ?? 0;
    if (isEligibleExpense && alerts?.enabled && alerts?.singleExpense?.enabled && threshold > 0 && Math.abs(Number(t.amount)) > threshold) {
      try {
        Alert.alert(
          'Large expense alert',
          `"${t.name}" was ${MONEY(Math.abs(Number(t.amount)))} — over your $${threshold} alert threshold. Review it in the Budget or Activity screens if it wasn't expected.`,
          [{ text: 'OK' }],
        );
      } catch { /* Alert.alert isn't available on web preview — silent */ }
    }
  };
  const remove = (id: string) => { setTransactions((xs: Tx[]) => xs.filter(x => x.id !== id)); setEditing(null); setToast('Transaction deleted.'); };
  const importFile = () => pickAndImport(token, (msg) => setToast(msg), (err) => setToast(err), setImporting);

  // Sync banner state — reflects the ACTUAL backend state, never fakes
  const okLinks = linkedRows.filter((r: any) => !r.error);
  const errLinks = linkedRows.filter((r: any) => r.error);
  const totalLinks = linkedRows.length;
  const timestamps = okLinks.map((r: any) => r.last_sync_at).filter(Boolean).map((v: string) => new Date(v).getTime()).filter((n: number) => !Number.isNaN(n));
  const lastSyncMs = timestamps.length ? Math.max(...timestamps) : 0;
  const formatAgo = (ms: number) => {
    if (!ms) return 'just now';
    const diff = Math.max(0, Date.now() - ms);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };
  let banner: { icon: any; iconColor: string; title: string; sub: string; kind: 'empty' | 'ok' | 'warn' };
  if (!linkedLoaded) {
    banner = { icon: 'sync-outline', iconColor: '#7d8f92', title: 'Checking sync status…', sub: 'Refreshing linked accounts.', kind: 'empty' };
  } else if (totalLinks === 0) {
    banner = { icon: 'alert-circle-outline', iconColor: '#b28a4c', title: 'No accounts linked yet', sub: 'Link a bank via Settings → Linked Accounts, or import a CSV.', kind: 'empty' };
  } else if (errLinks.length > 0) {
    banner = { icon: 'warning-outline', iconColor: '#b46b41', title: `${errLinks.length} account${errLinks.length > 1 ? 's need' : ' needs'} attention`, sub: 'Re-link or refresh from Settings → Linked Accounts.', kind: 'warn' };
  } else {
    banner = { icon: 'link', iconColor: '#50715b', title: `${okLinks.length} account${okLinks.length > 1 ? 's' : ''} synced`, sub: `Last sync ${formatAgo(lastSyncMs)}.`, kind: 'ok' };
  }
  const bannerBg = banner.kind === 'empty' ? { backgroundColor: t.dark ? '#28241d' : '#f6efe1', borderColor: '#e5d5b3' }
                 : banner.kind === 'warn' ? { backgroundColor: t.dark ? '#2d2118' : '#fbebe0', borderColor: '#e6b593' }
                 : { backgroundColor: t.dark ? '#1e2d22' : '#eaf3ec', borderColor: '#c6dcc8' };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Transactions" subtitle="Synced automatically. Editable anytime." action={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <CircleBtn testID="tx-import" onPress={importFile}><Ionicons name={importing ? 'hourglass-outline' : 'cloud-upload-outline'} size={18} color={t.dark ? D.text : C.ink3} /></CircleBtn>
          <CircleBtn testID="tx-add" onPress={() => {
            const now = new Date();
            const firstCat = categories?.[0];
            setEditing({ type: 'expense', name: '', amount: '', date: now.toISOString(), groupId: firstCat?.id || 'steward', detailId: firstCat?.subcategories?.[0]?.id, period: currentMonth() });
          }}>
            <Ionicons name="add" size={19} color={t.dark ? D.text : C.ink3} />
          </CircleBtn>
        </View>
      } />
      <Pressable onPress={banner.kind === 'empty' ? openLinkSheet : runManualSync} disabled={syncing} style={[s.syncBanner, bannerBg, syncing && { opacity: 0.7 }]} testID="tx-sync-banner">
        <View style={[s.syncIcon, { backgroundColor: t.dark ? '#00000033' : '#ffffffbb' }]}><Ionicons name={syncing ? 'sync-outline' : banner.icon} size={18} color={banner.iconColor} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.text : '#3a3428' }}>{syncing ? 'Refreshing…' : banner.title}</Text>
          <Text style={{ fontSize: 8, color: t.dark ? D.textMuted : '#7a6f5c' }}>{syncing ? 'Pulling the latest transactions from your linked banks.' : (banner.kind === 'empty' ? banner.sub : `${banner.sub} · Tap to refresh`)}</Text>
        </View>
        <Ionicons name={banner.kind === 'empty' ? 'chevron-forward' : (syncing ? 'sync-outline' : 'refresh-outline')} size={16} color={banner.iconColor} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PeriodPills values={['All','Income','Expenses']} value={filter} onChange={setFilter} testID="tx-filter" />
        </View>
        {/* Filter button — opens a bottom sheet with Date range + Account
            source pills. Consolidated so the Activity header stays clean. */}
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: (dateRange !== 'All' || accountFilter !== 'All') ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: (dateRange !== 'All' || accountFilter !== 'All') ? '#c4945018' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 4 }}
          testID="tx-open-filters"
        >
          <Ionicons name="options-outline" size={13} color="#9a6d32" />
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#9a6d32' }}>Filter</Text>
          {(dateRange !== 'All' || accountFilter !== 'All') && (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#c49450' }} />
          )}
        </Pressable>
      </View>
      <Sheet
        visible={filterSheetOpen}
        close={() => setFilterSheetOpen(false)}
        title="Filter transactions"
        subtitle="Narrow by date range and account/bank source."
      >
        <View>
          <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }]}>DATE RANGE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {(['All', '30d', 'This Month', 'Last Month', 'YTD', 'Custom'] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => setDateRange(r)}
                style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: dateRange === r ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: dateRange === r ? '#c4945018' : 'transparent' }}
                testID={`tx-range-${r.replace(/\W/g, '')}`}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: dateRange === r ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>{r === '30d' ? 'Last 30d' : r}</Text>
              </Pressable>
            ))}
          </View>
          {dateRange === 'Custom' && (
            <View style={{ marginTop: 10 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>From (YYYY-MM-DD)</Text>
              {Platform.OS === 'web'
                ? React.createElement('input' as any, {
                    type: 'date', value: customFrom,
                    onChange: (e: any) => setCustomFrom(e.target.value),
                    style: { padding: '8px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #d9cfbf', background: '#fbf6ec', color: '#2d2820', outline: 'none', width: '100%' },
                    'data-testid': 'tx-custom-from',
                  })
                : (
                  <TextInput style={s.input} value={customFrom} onChangeText={setCustomFrom} placeholder="2026-07-01" testID="tx-custom-from" />
                )
              }
              <Text style={[{ fontSize: 9, marginTop: 8, marginBottom: 4 }, t.textMuted]}>To (YYYY-MM-DD)</Text>
              {Platform.OS === 'web'
                ? React.createElement('input' as any, {
                    type: 'date', value: customTo,
                    onChange: (e: any) => setCustomTo(e.target.value),
                    style: { padding: '8px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #d9cfbf', background: '#fbf6ec', color: '#2d2820', outline: 'none', width: '100%' },
                    'data-testid': 'tx-custom-to',
                  })
                : (
                  <TextInput style={s.input} value={customTo} onChangeText={setCustomTo} placeholder="2026-07-31" testID="tx-custom-to" />
                )
              }
            </View>
          )}
          {originOptions.length > 2 && (
            <>
              <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39', marginTop: 16 }]}>ACCOUNT / BANK</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {originOptions.map((o) => (
                  <Pressable
                    key={o}
                    onPress={() => setAccountFilter(o)}
                    style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: accountFilter === o ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: accountFilter === o ? '#c4945018' : 'transparent' }}
                    testID={`tx-account-${o.replace(/\W/g, '')}`}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: accountFilter === o ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
            <Pressable
              onPress={() => { setDateRange('All'); setAccountFilter('All'); setCustomFrom(''); setCustomTo(''); }}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', alignItems: 'center' }}
              testID="tx-filters-reset"
            >
              <Text style={{ fontSize: 12, color: t.dark ? D.textMuted : C.muted2, fontWeight: '700' }}>Reset</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <GoldButton label="Done" onPress={() => setFilterSheetOpen(false)} testID="tx-filters-done" />
            </View>
          </View>
        </View>
      </Sheet>
      <View style={[s.transactionList, t.cardBg]}>
        {shown.length === 0 && (
          <View style={{ padding: 30, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={28} color={t.dark ? D.textMuted : '#c1b9ac'} />
            <Text style={[{ fontSize: 12, marginTop: 8, fontWeight: '700' }, t.textInk]}>No transactions yet</Text>
            <Text style={[{ fontSize: 10, marginTop: 4, textAlign: 'center', maxWidth: 260, lineHeight: 14 }, t.textMuted]}>
              Connect a bank, import transactions, or add a transaction manually.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable
                onPress={() => openLinkSheet && openLinkSheet()}
                testID="tx-empty-connect"
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: '#c49450' }}
              >
                <Text style={{ color: '#fffdf9', fontSize: 11, fontWeight: '700' }}>Connect account</Text>
              </Pressable>
              <Pressable
                onPress={() => setEditing({ id: '', name: '', amount: 0, date: new Date().toISOString().slice(0, 10), category: '', type: 'expense', origin: 'Manual' } as any)}
                testID="tx-empty-add"
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#c49450' }}
              >
                <Text style={{ color: '#c49450', fontSize: 11, fontWeight: '700' }}>Add transaction</Text>
              </Pressable>
            </View>
          </View>
        )}
        {shown.map((tx: Tx) => {
          const isTransferRow = isSystemTransaction(tx);
          const isIncomeRow = tx.type === 'income' && !isTransferRow;
          const iconBg = isIncomeRow ? '#e7f0e8' : isTransferRow ? (t.dark ? '#2e2b3a' : '#e9e6f2') : undefined;
          const iconName = isIncomeRow ? 'trending-up' : isTransferRow ? 'swap-horizontal-outline' : 'receipt-outline';
          const iconColor = isIncomeRow ? '#4e765c' : isTransferRow ? '#6f5e9a' : '#886f4b';
          const amountColor = isIncomeRow ? '#568066' : isTransferRow ? '#6f5e9a' : (t.dark ? D.text : C.ink);
          const prefix = isIncomeRow ? '+' : isTransferRow ? '↔ ' : '−';
          return (
            <Pressable key={tx.id} style={[s.transactionRow, t.dividerBorder]} onPress={() => setEditing(tx)} testID={`tx-${tx.id}`}>
              <View style={[s.txIcon, iconBg ? { backgroundColor: iconBg } : null]}>
                <Ionicons name={iconName as any} size={16} color={iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]} numberOfLines={1}>
                  {tx.name}{tx.merchant && tx.merchant !== tx.name ? <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}> · {tx.merchant}</Text> : null}
                </Text>
                <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>
                  {tx.date?.slice(0, 10)} · {tx.origin}{isTransferRow ? ' · Transfer' : ''}{tx.splits && tx.splits.length > 0 ? ` · Split (${tx.splits.length})` : ''}
                </Text>
              </View>
              <Text style={[{ fontSize: 11, fontWeight: '700', color: amountColor }]}>{prefix}{EXACT(tx.amount)}</Text>
              <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#b1aaa0'} />
            </Pressable>
          );
        })}
      </View>
      <Sheet visible={!!editing} close={() => setEditing(null)} title={editing?.id ? 'Edit transaction' : 'Add transaction'} subtitle="Manual changes immediately update Budget and cash.">
        {editing && <TxForm item={editing} categories={categories} incomeSources={incomeSources} save={save} remove={editing.id ? remove : null} />}
      </Sheet>
      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};
const TxForm = ({ item, categories, incomeSources, save, remove }: any) => {
  const t = useThemed();
  const [tx, setT] = useState<any>({
    ...item,
    amount: String(item.amount || ''),
    merchant: item.merchant || '',
    splits: Array.isArray(item.splits) ? item.splits.map((sp: any) => ({ ...sp, amount: String(sp.amount || '') })) : [],
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSplits, setShowSplits] = useState(Array.isArray(item.splits) && item.splits.length > 0);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  // Split-line category picker (latest spec). Tracks which split row is
  // currently choosing its category. null = closed. Uses the same
  // searchable Sheet UX as the regular Activity picker so users only
  // learn one pattern.
  const [splitPickerIdx, setSplitPickerIdx] = useState<number | null>(null);
  const [splitPickerQuery, setSplitPickerQuery] = useState('');
  const isIncome = tx.type === 'income';
  const isTransfer = isSystemTransaction(tx);
  const currentGroup = isIncome ? incomeSources.find((s: any) => s.id === tx.groupId) : categories.find((c: any) => c.id === tx.groupId);
  const currentSubs = !isIncome && currentGroup ? currentGroup.subcategories : [];
  const parsedAmount = Math.abs(Number((tx.amount || '').toString().replace(/[^0-9.]/g, '')) || 0);
  // Splits accounting in INTEGER CENTS (spec #14) — floating-point dollars
  // lose precision at 2 decimals (48.80 + 3.70 becomes 52.500000000000004).
  // Round each side to cents, then compare/validate/sum on cents so users
  // can enter values like $20.25 / $28.55 / $48.80 without the app quietly
  // rounding them into whole dollars.
  const dollarsToCents = (v: string | number): number => {
    const s = String(v ?? '').replace(/[^0-9.\-]/g, '');
    if (!s) return 0;
    // Parse then round to nearest cent to eliminate FP drift.
    return Math.round(Number(s) * 100);
  };
  const parsedAmountCents = dollarsToCents(tx.amount);
  const splitsTotalCents = (tx.splits || []).reduce((sum: number, sp: any) => sum + dollarsToCents(sp.amount), 0);
  const splitsRemainingCents = parsedAmountCents > 0 ? parsedAmountCents - splitsTotalCents : 0;
  const splitsTotal = splitsTotalCents / 100;
  const splitsRemaining = splitsRemainingCents / 100;
  // Save enables when allocated cents EXACTLY equals the transaction cents.
  const splitsValid = !showSplits || (
    tx.splits &&
    tx.splits.length >= 2 &&
    splitsRemainingCents === 0 &&
    tx.splits.every((sp: any) => dollarsToCents(sp.amount) > 0)
  );

  // Parse the current date string. Fallback to today.
  const parsedDate = (() => {
    if (!tx.date) return new Date();
    const d = new Date(tx.date);
    return isNaN(d.getTime()) ? new Date() : d;
  })();
  const displayDate = parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const isoDateForInput = parsedDate.toISOString().slice(0, 10);

  const setDateFromValue = (d: Date) => {
    if (!isNaN(d.getTime())) {
      setT({ ...tx, date: d.toISOString() });
    }
  };

  const addSplit = () => {
    const firstCat = categories[0];
    const firstSub = firstCat?.subcategories?.[0];
    // Toggle behavior: first invocation opens the splits UI with EXACTLY
    // one empty row so users can build up the allocation deliberately.
    // Subsequent invocations append one row (spec test copy: "Add split").
    if (!tx.splits || tx.splits.length === 0) {
      setT({
        ...tx,
        splits: [{ groupId: tx.groupId || firstCat?.id, detailId: tx.detailId || firstSub?.id, amount: '' }],
      });
    } else {
      setT({
        ...tx,
        splits: [...tx.splits, { groupId: firstCat?.id, detailId: firstSub?.id, amount: '' }],
      });
    }
    setShowSplits(true);
  };
  const updateSplit = (idx: number, patch: any) => {
    const next = [...(tx.splits || [])];
    next[idx] = { ...next[idx], ...patch };
    setT({ ...tx, splits: next });
  };
  const removeSplit = (idx: number) => {
    const next = (tx.splits || []).filter((_: any, i: number) => i !== idx);
    setT({ ...tx, splits: next });
    if (next.length === 0) setShowSplits(false);
  };

  return (
    <View>
      {/* Type selector — Income / Expense only (spec #10). Transfer is a
          CATEGORY option that lives under the group picker below, not a
          third type. Assigning Transfer preserves the transaction's sign
          but excludes it from Budget / Reports / Net Income totals. */}
      <PeriodPills
        values={['Income', 'Expense']}
        value={tx.type === 'income' ? 'Income' : 'Expense'}
        onChange={(label: string) => {
          const v = label.toLowerCase() as 'income' | 'expense';
          setT({
            ...tx,
            type: v,
            // Clear the previous transfer flag when the user switches types
            // — reclassification is a full reset (spec #13).
            is_transfer: false,
            system_category: null,
            groupId: v === 'income' ? (incomeSources[0]?.id || 'w2') : (categories[0]?.id || 'steward'),
            detailId: v === 'income' ? undefined : (categories[0]?.subcategories?.[0]?.id),
            splits: tx.splits,
          });
        }}
        testID="tx-type"
      />
      <Text style={s.label}>Description</Text>
      <TextInput style={s.input} value={tx.name} onChangeText={x => setT({ ...tx, name: x })} testID="tx-name" />
      <Text style={s.label}>Merchant <Text style={{ color: t.dark ? D.textMuted : C.muted, fontWeight: '400' }}>(optional)</Text></Text>
      <TextInput
        style={s.input}
        value={tx.merchant}
        onChangeText={(x) => setT({ ...tx, merchant: x })}
        placeholder="e.g., Costco, Chevron, Whole Foods"
        placeholderTextColor={t.dark ? D.textMuted : C.muted}
        testID="tx-merchant"
      />
      <Text style={[{ fontSize: 9, marginTop: 3 }, t.textMuted]}>
        Merchant is used in Reports to group your spending by retailer.
      </Text>
      <Text style={s.label}>Amount</Text>
      <View style={s.amountInput}>
        <Text style={s.amountPrefix}>$</Text>
        <TextInput style={[s.input, { paddingLeft: 26 }]} value={tx.amount} onChangeText={x => setT({ ...tx, amount: x.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1') })} keyboardType="decimal-pad" testID="tx-amount" />
      </View>

      <Text style={s.label}>Date</Text>
      {Platform.OS === 'web' ? (
        React.createElement('input' as any, {
          type: 'date',
          value: isoDateForInput,
          onChange: (e: any) => {
            const iso = e.target.value;
            if (iso) {
              const [y, m, d] = iso.split('-').map(Number);
              setDateFromValue(new Date(y, m - 1, d));
            }
          },
          style: {
            width: '100%',
            padding: '10px 12px',
            fontSize: 13,
            borderRadius: 10,
            border: '1px solid #d9cfbf',
            background: '#fbf6ec',
            fontFamily: 'inherit',
            color: '#2d2820',
            outline: 'none',
          },
          'data-testid': 'tx-date-web',
        })
      ) : (
        <>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
            testID="tx-date-open"
          >
            <Text style={{ fontSize: 13, color: C.ink }}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={16} color={C.goldEyebrow} />
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={parsedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(event: any, selected?: Date) => {
                if (Platform.OS === 'android') setShowDatePicker(false);
                if (event?.type === 'dismissed') { setShowDatePicker(false); return; }
                if (selected) setDateFromValue(selected);
              }}
            />
          )}
          {Platform.OS === 'ios' && showDatePicker && (
            <Pressable onPress={() => setShowDatePicker(false)} style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 }}>
              <Text style={{ color: C.goldEyebrow, fontSize: 12, fontWeight: '700' }}>Done</Text>
            </Pressable>
          )}
        </>
      )}

      <Text style={s.label}>Month</Text>
      <PeriodPills values={[...MONTHS]} value={tx.period || currentMonth()} onChange={(v: string) => setT({ ...tx, period: v })} testID="tx-month" />

      {/* Transfer callout — shown when the transaction is currently flagged
          as a Transfer (either auto-detected by the Plaid classifier or
          manually assigned via the Transfer chip). Purely informational —
          the actual assignment happens via the "Transfer" chip below. */}
      {isTransfer && (
        <View style={{ padding: 10, marginTop: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#c49450' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
          <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 3, lineHeight: 14 }}>
            This transaction is an internal movement between your own accounts (or a credit-card payment).
            It won&apos;t affect Budget, Reports, Net Income, or Net Worth totals.
          </Text>
        </View>
      )}

      {/* Category / subcategory picker (spec #15). A single tappable row
          opens a searchable bottom sheet with every group + subcategory
          plus Transfer. This replaces the previous 2-3 walls of chips
          and keeps the modal clean on small screens. */}
      {!showSplits && (
        <>
          <Text style={s.label}>{isIncome ? 'Earn source' : 'Category'}</Text>
          <Pressable
            onPress={() => setCategoryPickerOpen(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 12, paddingHorizontal: 14,
              borderWidth: 1, borderColor: t.dark ? D.border : '#e2dcd2',
              borderRadius: 13, backgroundColor: t.dark ? D.surfaceAlt : '#fff',
            }}
            testID="tx-category-open"
          >
            <Text style={[{ fontSize: 13 }, t.textInk]}>
              {(() => {
                if (isTransfer) return 'Transfer';
                if (isIncome) {
                  const g = incomeSources.find((s: any) => s.id === tx.groupId);
                  return g ? g.name : 'Tap to select';
                }
                const g = categories.find((c: any) => c.id === tx.groupId);
                const sub = g?.subcategories?.find((sb: any) => sb.id === tx.detailId);
                if (!g) return 'Tap to select';
                return sub ? `${g.name} · ${sub.name}` : g.name;
              })()}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.dark ? D.textMuted : C.goldEyebrow} />
          </Pressable>
        </>
      )}

      {/* Split allocations — only for expense (and income) transactions.
          Each split assigns part of the amount to a different category. */}
      {!isTransfer && (
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Split across categories</Text>
            <Pressable onPress={() => {
              if (!showSplits) {
                addSplit();
              } else {
                setShowSplits(false);
                setT({ ...tx, splits: [] });
              }
            }} testID="tx-split-toggle">
              <Text style={{ color: '#9a6d32', fontWeight: '700', fontSize: 11 }}>{showSplits ? 'Remove split' : '+ Split this'}</Text>
            </Pressable>
          </View>
          {showSplits && (
            <View style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5' }}>
              {(tx.splits || []).map((sp: any, idx: number) => {
                // Simplified split row (latest spec): only "Category" +
                // "Amount". No Income/Expense toggle, no chip wall. Any
                // category (Earn / Give / Steward / Grow / Enjoy / Transfer)
                // is available regardless of sign so refunds, credits, and
                // reimbursements can offset any category cleanly.
                const isSplitTransfer = !!sp.is_transfer;
                const spIncomeGroup = incomeSources.find((c: any) => c.id === sp.groupId);
                const spExpenseGroup = categories.find((c: any) => c.id === sp.groupId);
                const spSub = spExpenseGroup?.subcategories?.find((sb: any) => sb.id === sp.detailId);
                const splitLabel = isSplitTransfer
                  ? 'Transfer'
                  : spIncomeGroup
                    ? spIncomeGroup.name
                    : spExpenseGroup
                      ? (spSub ? `${spExpenseGroup.name} › ${spSub.name}` : spExpenseGroup.name)
                      : 'Select category';
                return (
                  <View key={idx} style={{ paddingVertical: 10, borderBottomWidth: idx < (tx.splits.length - 1) ? 1 : 0, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Pressable
                        onPress={() => setSplitPickerIdx(idx)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#e2dcd2', backgroundColor: t.dark ? D.surfaceAlt : '#fff' }}
                        testID={`tx-split-${idx}-category-open`}
                      >
                        <Text style={[{ fontSize: 12, flex: 1 }, t.textInk]} numberOfLines={1}>{splitLabel}</Text>
                        <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : C.goldEyebrow} />
                      </Pressable>
                      <View style={{ width: 90 }}>
                        <View style={s.amountInput}>
                          <Text style={s.amountPrefix}>$</Text>
                          <TextInput
                            style={[s.input, { paddingLeft: 22, paddingRight: 6, fontSize: 12 }]}
                            value={String(sp.amount || '')}
                            onChangeText={(x) => updateSplit(idx, { amount: x.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1') })}
                            keyboardType="decimal-pad"
                            placeholder="0.00"
                            testID={`tx-split-${idx}-amount`}
                          />
                        </View>
                      </View>
                      <Pressable onPress={() => removeSplit(idx)} hitSlop={6} testID={`tx-split-${idx}-remove`}>
                        <Ionicons name="close-circle-outline" size={16} color="#b06a5b" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <Pressable onPress={addSplit} style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }} testID="tx-split-add">
                <Ionicons name="add-circle-outline" size={14} color="#9a6d32" />
                <Text style={{ color: '#9a6d32', fontWeight: '700', fontSize: 11 }}>Add split</Text>
              </Pressable>
              <View style={{ marginTop: 10, gap: 4 }}>
                {(() => {
                  const MONEY_C = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
                  return (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>
                          Allocated: {MONEY_C(splitsTotal)} of {MONEY_C(parsedAmountCents / 100)}
                          {splitsValid ? ' ✓' : ''}
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: splitsValid ? '#4c8b56' : '#b06a5b' }}>
                          Remaining: {MONEY_C(Math.max(0, splitsRemaining))}
                          {splitsRemaining < 0 ? ` (over by ${MONEY_C(-splitsRemaining)})` : ''}
                        </Text>
                      </View>
                      {!splitsValid && (tx.splits && tx.splits.length < 2) && (
                        <Text style={{ fontSize: 10, color: '#b06a5b' }}>Add at least 2 rows.</Text>
                      )}
                    </>
                  );
                })()}
              </View>
            </View>
          )}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <GoldButton
          label="Save transaction"
          onPress={() => {
            const merchantClean = (tx.merchant || '').toString().trim();
            // Emit splits with integer-cent precision (spec #14): parse
            // each user-entered string, round to cents, then divide back.
            const splitsClean = showSplits && Array.isArray(tx.splits)
              ? tx.splits.map((sp: any) => ({
                  groupId: sp.groupId,
                  detailId: sp.detailId,
                  amount: dollarsToCents(sp.amount) / 100,
                  type: (sp.type as 'income' | 'expense') || tx.type,
                }))
              : undefined;
            // Preserve or infer the signed direction. For new manual rows
            // (no external_id, no prior sign), infer from the current type
            // toggle: expense → -1 (money out), income → +1. Users can then
            // reassign side without losing their original intent.
            const preservedSign = tx.sign != null
              ? tx.sign
              : (tx.type === 'income' ? 1 : -1);
            save({
              ...tx,
              amount: parsedAmountCents / 100,
              merchant: merchantClean || undefined,
              splits: splitsClean,
              sign: preservedSign,
              // Preserve the true origin: a linked transaction (has external_id)
              // should NEVER be stamped "Manual" on edit — that was the root
              // cause of spec #9 (Chase/Ally showing as Manual). Fall back to
              // "Linked" only if the row is a Plaid overlay whose org name
              // isn't yet known, and to "Manual" only for genuinely new rows.
              origin: tx.origin || (tx.external_id ? 'Linked' : 'Manual'),
              period: tx.period || currentMonth(),
            });
          }}
          disabled={!tx.name || !parsedAmount || !splitsValid}
          testID="tx-save"
        />
        {showSplits && !splitsValid && (
          <Text style={{ fontSize: 10, color: '#b06a5b', marginTop: 6, textAlign: 'center' }}>
            Splits must total exactly ${(parsedAmountCents / 100).toFixed(2)} and have at least 2 rows.
          </Text>
        )}
      </View>
      {remove && <Pressable onPress={() => remove(item.id)} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="tx-delete">
        <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Delete transaction</Text>
      </Pressable>}

      {/* Category picker Sheet (spec #15) — searchable, groups + leaves,
          Transfer at bottom. Rendered inline so it inherits the same state
          scope as the transaction editor. */}
      <Sheet
        visible={categoryPickerOpen}
        close={() => { setCategoryPickerOpen(false); setCategoryQuery(''); }}
        title={isIncome ? 'Select Earn source' : 'Select Category'}
        subtitle="Tap a category to assign this transaction."
      >
        <View>
          <TextInput
            value={categoryQuery}
            onChangeText={setCategoryQuery}
            placeholder="Search..."
            style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 10, fontSize: 13, backgroundColor: '#fff', marginBottom: 10 }, t.inputBg]}
            placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
            testID="tx-category-search"
            autoFocus
          />
          {(() => {
            const q = categoryQuery.trim().toLowerCase();
            const matches = (name: string) => !q || name.toLowerCase().includes(q);
            const opts = isIncome ? incomeSources : categories;
            return (
              <View>
                {opts.map((g: any) => {
                  const groupHit = matches(g.name);
                  const subHits = isIncome
                    ? []
                    : (g.subcategories || []).filter((sub: any) => matches(sub.name) || groupHit);
                  if (!groupHit && subHits.length === 0) return null;
                  return (
                    <View key={g.id} style={{ marginBottom: 12 }}>
                      <Pressable
                        onPress={() => {
                          setT({
                            ...tx,
                            groupId: g.id,
                            detailId: isIncome ? undefined : g.subcategories?.[0]?.id,
                            is_transfer: false,
                            system_category: null,
                          });
                          setCategoryPickerOpen(false);
                          setCategoryQuery('');
                        }}
                        style={{ padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#2a251f' : '#fbf5e9', borderWidth: 1, borderColor: t.dark ? D.border : '#e5decf' }}
                        testID={`tx-category-group-${g.id}`}
                      >
                        <Text style={[{ fontSize: 13, fontWeight: '800', color: '#9a6d32' }]}>{g.name}</Text>
                      </Pressable>
                      {!isIncome && subHits.map((sub: any) => (
                        <Pressable
                          key={sub.id}
                          onPress={() => {
                            setT({
                              ...tx,
                              groupId: g.id,
                              detailId: sub.id,
                              is_transfer: false,
                              system_category: null,
                            });
                            setCategoryPickerOpen(false);
                            setCategoryQuery('');
                          }}
                          style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f0ebe4' }}
                          testID={`tx-category-sub-${sub.id}`}
                        >
                          <Text style={[{ fontSize: 12 }, t.textInk]}>{sub.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
                {/* Transfer — always at the bottom, single-tap */}
                <Pressable
                  onPress={() => {
                    setT({
                      ...tx,
                      is_transfer: true,
                      system_category: 'transfer',
                      groupId: '',
                      detailId: undefined,
                      splits: undefined,
                    });
                    setCategoryPickerOpen(false);
                    setCategoryQuery('');
                  }}
                  style={{ marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderWidth: 1, borderColor: '#c49450', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  testID="tx-category-transfer"
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#9a6d32" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
                    <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 2 }}>Excluded from Budget, Reports & Net Income</Text>
                  </View>
                </Pressable>
              </View>
            );
          })()}
        </View>
      </Sheet>

      {/* Split-line category picker — same searchable Sheet UX as the main
          picker so users learn one pattern. Full hierarchy (Earn, Give,
          Steward, Grow, Enjoy, Transfer) available for every split line
          regardless of sign. */}
      <Sheet
        visible={splitPickerIdx !== null}
        close={() => { setSplitPickerIdx(null); setSplitPickerQuery(''); }}
        title="Select Category"
        subtitle="Choose any category — refunds and credits can offset any type."
      >
        <View>
          <TextInput
            value={splitPickerQuery}
            onChangeText={setSplitPickerQuery}
            placeholder="Search..."
            style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 10, fontSize: 13, backgroundColor: '#fff', marginBottom: 10 }, t.inputBg]}
            placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
            testID="tx-split-category-search"
            autoFocus
          />
          {(() => {
            const q = splitPickerQuery.trim().toLowerCase();
            const matches = (name: string) => !q || name.toLowerCase().includes(q);
            const applyToSplit = (fields: any) => {
              if (splitPickerIdx == null) return;
              updateSplit(splitPickerIdx, fields);
              setSplitPickerIdx(null);
              setSplitPickerQuery('');
            };
            return (
              <View>
                {/* Earn (income) sources */}
                {incomeSources.map((src: any) => (
                  matches(src.name) && (
                    <Pressable
                      key={`earn-${src.id}`}
                      onPress={() => applyToSplit({ type: 'income', groupId: src.id, detailId: undefined, is_transfer: false })}
                      style={{ padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#2a251f' : '#fbf5e9', borderWidth: 1, borderColor: t.dark ? D.border : '#e5decf', marginBottom: 8 }}
                      testID={`tx-split-earn-${src.id}`}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6 }}>EARN</Text>
                      <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2, color: '#9a6d32' }]}>{src.name}</Text>
                    </Pressable>
                  )
                ))}
                {/* Give / Steward / Grow / Enjoy — expense groups */}
                {categories.map((g: any) => {
                  const groupHit = matches(g.name);
                  const subHits = (g.subcategories || []).filter((sub: any) => matches(sub.name) || groupHit);
                  if (!groupHit && subHits.length === 0) return null;
                  return (
                    <View key={`exp-${g.id}`} style={{ marginBottom: 12 }}>
                      <Text style={[{ fontSize: 10, fontWeight: '800', color: '#9a6d32', letterSpacing: 0.6, marginBottom: 4 }]}>{g.name.toUpperCase()}</Text>
                      {subHits.map((sub: any) => (
                        <Pressable
                          key={sub.id}
                          onPress={() => applyToSplit({ type: 'expense', groupId: g.id, detailId: sub.id, is_transfer: false })}
                          style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f0ebe4' }}
                          testID={`tx-split-sub-${sub.id}`}
                        >
                          <Text style={[{ fontSize: 12 }, t.textInk]}>{g.name} › {sub.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
                {/* Transfer */}
                <Pressable
                  onPress={() => applyToSplit({ is_transfer: true, groupId: '', detailId: undefined, type: 'expense' })}
                  style={{ marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderWidth: 1, borderColor: '#c49450', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  testID="tx-split-transfer"
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#9a6d32" />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
                </Pressable>
              </View>
            );
          })()}
        </View>
      </Sheet>
    </View>
  );
};

/* ---------------- Net Worth ---------------- */
// Wealth-classification helpers (isInvestmentAccount, CATEGORY_LABELS,
// CATEGORY_ICONS, LIABILITY_CATEGORIES, timeAgo) are imported from
// `@/src/utils/appShared`.


/* ---------------- Legacy / Coaching / Membership / Settings / More ---------------- */
const LegacyScreen = ({ investmentTotal, totalCash, availableCash, totalRestricted, monthlyNet, monthlyBudgetIncome, monthlyBudgetExpense, monthlyBudgetPeriod, perMonthNet, financialsReady, timeframe, setTimeframe, contribution, setContribution, hypothetical, setHypothetical, hypoFrequency, setHypoFrequency, hypoDuration, setHypoDuration, returnRate, setReturnRate, cumulative, setCumulative, currentAge, setCurrentAge, retirementAge, setRetirementAge }: any) => {
  const t = useThemed();
  const [editingHypo, setEditingHypo] = useState(false);
  const [hypoDraft, setHypoDraft] = useState('');
  // Direct-typed Monthly Contribution editor (spec #3). Users tap the
  // contribution chip → sheet opens with a TextInput pre-filled with the
  // current value. Save applies immediately and closes the sheet.
  const [editingContrib, setEditingContrib] = useState(false);
  const [contribDraft, setContribDraft] = useState('');
  const commitContribution = () => {
    const clean = Math.max(0, Math.round(Number((contribDraft || '').replace(/[^0-9.]/g, '')) || 0));
    setContribution(clean);
    setEditingContrib(false);
    setContribDraft('');
  };
  const [hypoFreqDraft, setHypoFreqDraft] = useState<'onetime' | 'monthly' | 'annual'>('onetime');
  const [hypoDurDraft, setHypoDurDraft] = useState<string>('');
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState<string>(String(returnRate ?? DEFAULT_LEGACY_RATE));
  const [showMath, setShowMath] = useState(false);
  const [showSurplusBreakdown, setShowSurplusBreakdown] = useState(false);
  const [ageDraft, setAgeDraft] = useState<string>(String(currentAge ?? ''));
  const [retDraft, setRetDraft] = useState<string>(String(retirementAge ?? ''));
  // Whenever the persisted ages change (e.g. loaded from storage), sync the
  // drafts so users always see the current value in the inputs.
  React.useEffect(() => { setAgeDraft(String(currentAge ?? '')); }, [currentAge]);
  React.useEffect(() => { setRetDraft(String(retirementAge ?? '')); }, [retirementAge]);
  React.useEffect(() => { setRateDraft(String(returnRate ?? DEFAULT_LEGACY_RATE)); }, [returnRate]);
  const [ageError, setAgeError] = useState('');

  // Rate assumption used across every Legacy projection + mirrored on Home.
  // Now user-editable — defaults to DEFAULT_LEGACY_RATE (7%) but can be
  // adjusted via the assumption chip beside the projection card.
  const RATE = (Number(returnRate) || DEFAULT_LEGACY_RATE) / 100;   // e.g. 0.07
  const MONTHLY_RATE = RATE / 12;       // monthly compounding

  // ---- BUILD vs GROW split (spec #21) --------------------------------------
  const BUILD: Record<string, number> = { '1yr': 1, '2yr': 2, '3yr': 3, '5yr': 5 };
  const GROW: Record<string, { years: number | null; isRetirement?: boolean }> = {
    '10yr': { years: 10 }, '20yr': { years: 20 }, '30yr': { years: 30 },
    'Retirement': { years: null, isRetirement: true },
  };
  const isBuild = timeframe in BUILD;
  const isRetirement = timeframe === 'Retirement';

  // Compute effective years (Retirement uses ages; everything else is fixed).
  const yearsUntilRetirement = Math.max(0, (Number(retirementAge) || 0) - (Number(currentAge) || 0));
  const years = isBuild
    ? BUILD[timeframe]
    : (isRetirement ? yearsUntilRetirement : (GROW[timeframe]?.years || 0));

  const hypoValue = Math.max(0, Number((hypothetical || '').replace(/[^0-9.]/g, '')) || 0);
  const hypoFreq: 'onetime' | 'monthly' | 'annual' = hypoFrequency || 'onetime';
  const hypoDur: number | null = typeof hypoDuration === 'number' ? hypoDuration : null;

  // Raw monthly net (Budgeted Income − Budgeted Expenses) — used for the
  // headline "Monthly Budget Net" card and the fallback for months without
  // explicit per-month budget overrides. Kept SIGNED (spec #4: "Do not
  // change negative months to $0"). BUILD math preserves the sign as well
  // so a real deficit reduces the projection.
  const rawMonthlyNet = Number(monthlyNet) || 0;

  // Per-month Net for BUILD projections (spec #4). Comes from App-level
  // `legacyPerMonthNet` which classifies each month as ACTUAL / BUDGETED /
  // ESTIMATED. Falls back to a signed carry of the current budget net when
  // the App didn't pass the callback (older callers, tests).
  const perMonthNetFn = React.useCallback((totalMonths: number): { month: number; net: number; source: 'actual' | 'budgeted' | 'estimated'; label?: string }[] => {
    if (typeof perMonthNet === 'function') return perMonthNet(totalMonths);
    const carry = rawMonthlyNet;
    const rows: { month: number; net: number; source: 'actual' | 'budgeted' | 'estimated'; label?: string }[] = [];
    for (let i = 0; i < totalMonths; i++) {
      rows.push({ month: i + 1, net: carry, source: i === 0 ? 'budgeted' : 'estimated' });
    }
    return rows;
  }, [perMonthNet, rawMonthlyNet]);

  // BUILD spec (Jun 2026): Current Wealth = Total Cash + Total Investments,
  // pulled directly from the Wealth tab. Investments are held flat — no 7%
  // return applied. The 7% assumption is a GROW/Retirement concept only.
  const buildStartingCash = (typeof totalCash === 'number' ? totalCash : 0) || 0;

  // ---- ONE calculation engine for BUILD ------------------------------
  // Everything BUILD-related — the projected wealth headline, the chart
  // points, the tooltip deltas, the year-by-year table, and the "How
  // this is calculated" drill-down — derives from this single memo. If
  // you find yourself computing BUILD math anywhere else, wire it here.
  const buildBreakdown = React.useMemo(() => {
    const months = Math.max(0, Math.round(years * 12));
    const rows = perMonthNetFn(months) as any;
    const runRate = typeof rows.runRate === 'number' ? rows.runRate : 0;
    const runRateSlice = Array.isArray(rows.runRateSlice) ? rows.runRateSlice : [];
    const allBudgetMonths = Array.isArray(rows.allBudgetMonths) ? rows.allBudgetMonths : [];
    // Hypothetical contribution — surfaced separately so it can never
    // become an invisible adjustment.
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, years);
    const hypoCashAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n).addToCash;
    const hypoPrincipalAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n).addToPrincipal;
    // Yearly snapshots — startWealth, sumOfMonths, hypo add-on, endWealth.
    const yearSnaps: { year: number; startWealth: number; monthsSum: number; hypoAdd: number; endWealth: number; startIdx: number; endIdx: number }[] = [];
    const startingWealth = buildStartingCash + investmentTotal;
    let prevEnd = startingWealth;
    let cumNet = 0;
    for (let y = 1; y <= years; y++) {
      const startIdx = (y - 1) * 12;
      const endIdx = y * 12 - 1;
      const yearMonths = rows.slice(startIdx, endIdx + 1);
      const monthsSum = yearMonths.reduce((s: number, r: any) => s + (r?.net || 0), 0);
      cumNet += monthsSum;
      const hypoAdd = hypoCashAt(y) + hypoPrincipalAt(y);
      const endWealth = Math.round(startingWealth + cumNet + hypoAdd);
      yearSnaps.push({
        year: y,
        startWealth: Math.round(prevEnd),
        monthsSum: Math.round(monthsSum),
        hypoAdd: Math.round(hypoAdd - (y > 1 ? (hypoCashAt(y - 1) + hypoPrincipalAt(y - 1)) : 0)),
        endWealth,
        startIdx,
        endIdx,
      });
      prevEnd = endWealth;
    }
    // The "projected monthly cash flow" figure shown on the assumptions
    // card must equal the run rate that the projection actually uses for
    // unbudgeted months — this is the number the user can multiply by 12
    // to reproduce Y1 (approximately, when the current month is +
    // rest-of-year budgeted separately).
    const projectedMonthlyCashFlow = runRate;
    return {
      months: rows as any[],
      runRate,
      runRateSlice,
      allBudgetMonths,
      startingCash: buildStartingCash,
      startingInvestments: investmentTotal,
      startingWealth,
      hypo: h,
      hypoCashAt,
      hypoPrincipalAt,
      yearSnaps,
      projectedMonthlyCashFlow,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, buildStartingCash, investmentTotal, perMonthNetFn, hypoValue, hypoFreq, hypoDur]);

  const buildProjectionAt = (n: number): number => {
    // BUILD: budget-based only. investments held FLAT — no return
    // assumption applied. Cash portion accumulates the per-month
    // Budgeted / Estimated net (both surpluses AND deficits included).
    // Reads from `buildBreakdown` when n === years to guarantee an
    // exact match with the drill-down; falls back to a direct
    // computation for arbitrary n (used by the chart's yearly points).
    const months = Math.max(0, Math.round(n * 12));
    const netRows = perMonthNetFn(months);
    const cashFromNet = netRows.reduce((sum: number, r: any) => sum + (r?.net || 0), 0);
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, n);
    const heldInvestments = investmentTotal + h.addToPrincipal;
    const cashAtN = buildStartingCash + cashFromNet + h.addToCash;
    return Math.round(heldInvestments + cashAtN);
  };
  const growProjectionAt = (n: number): number => {
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, n);
    // Monthly compounding: FV = P * (1+r/12)^(n*12) + C * [((1+r/12)^(n*12) - 1) / (r/12)]
    const months = Math.max(0, Math.round(n * 12));
    const growthFactor = Math.pow(1 + MONTHLY_RATE, months);
    const startingPrincipal = investmentTotal + h.addToPrincipal;
    const effectiveContribution = contribution + h.addToMonthlyContrib;
    const fvPrincipal = startingPrincipal * growthFactor;
    const fvContrib = MONTHLY_RATE > 0
      ? effectiveContribution * ((growthFactor - 1) / MONTHLY_RATE)
      : effectiveContribution * months;
    return Math.round(fvPrincipal + fvContrib);
  };
  const projectionAtYear = (n: number): number => (isBuild ? buildProjectionAt(n) : growProjectionAt(n));
  const projection = projectionAtYear(years);

  // Cumulative year-by-year table — only rendered when the toggle is on.
  const cumulativeRows = useMemo(() => {
    const rows: { year: number; value: number; delta: number }[] = [];
    let prev = isBuild
      ? totalCash + investmentTotal + hypoValue
      : investmentTotal + hypoValue;
    for (let y = 1; y <= years; y++) {
      const v = projectionAtYear(y);
      rows.push({ year: y, value: v, delta: v - prev });
      prev = v;
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, isBuild, totalCash, investmentTotal, hypoValue, hypoFreq, hypoDur, rawMonthlyNet, perMonthNetFn, contribution, currentAge, retirementAge, RATE, MONTHLY_RATE]);

  const commitHypo = () => {
    const clean = Math.max(0, Math.round(Number(hypoDraft.replace(/[^0-9.]/g, '')) || 0));
    const durClean = (hypoDurDraft || '').replace(/[^0-9]/g, '');
    const durNum = durClean ? Math.max(1, Math.min(50, Number(durClean))) : null;
    setHypothetical(clean > 0 ? String(clean) : '');
    setHypoFrequency(clean > 0 ? hypoFreqDraft : 'onetime');
    setHypoDuration(clean > 0 && hypoFreqDraft !== 'onetime' ? durNum : null);
    setEditingHypo(false);
    setHypoDraft('');
    setHypoDurDraft('');
  };

  const commitRate = () => {
    const cleanNum = Number((rateDraft || '').replace(/[^0-9.]/g, ''));
    const clamped = !isFinite(cleanNum) || cleanNum <= 0 ? DEFAULT_LEGACY_RATE : Math.min(30, Math.max(0.1, cleanNum));
    setReturnRate(clamped);
    setEditingRate(false);
  };

  const commitAges = () => {
    // Each field falls back to its persisted value when the draft is blank,
    // so users can update one age without needing to retype the other. This
    // was the bug where entering only a new "Current age" would fail with
    // "Please enter a retirement age" because retDraft was empty.
    const parsed = (draft: string, fallback: number) => {
      const clean = (draft || '').replace(/[^0-9]/g, '');
      if (!clean) return fallback;
      return Math.max(0, Math.round(Number(clean) || 0));
    };
    const a = parsed(ageDraft, currentAge || 0);
    const r = parsed(retDraft, retirementAge || 0);
    if (!a) { setAgeError('Please enter your current age.'); return; }
    if (!r) { setAgeError('Please enter a retirement age.'); return; }
    if (r <= a) { setAgeError(`Retirement age must be greater than ${a}.`); return; }
    setCurrentAge(a); setRetirementAge(r); setAgeError('');
    setAgeDraft(String(a));
    setRetDraft(String(r));
  };

  const projectionTitle = isBuild ? 'PROJECTED WEALTH' : 'PROJECTED INVESTMENTS';
  const projectionSubtitle = isBuild
    ? `Based on your current wealth and projected monthly cash flow.`
    : `Assumes a ${Math.round(RATE * 100)}% annual return and your selected monthly contribution.`;

  const hypoDesc = hypoValue > 0
    ? (hypoFreq === 'onetime'
        ? `${MONEY(hypoValue)} one-time`
        : hypoFreq === 'monthly'
          ? `${MONEY(hypoValue)}/mo${hypoDur ? ` for ${hypoDur}yr${hypoDur === 1 ? '' : 's'}` : ''}`
          : `${MONEY(hypoValue)}/yr${hypoDur ? ` for ${hypoDur}yr${hypoDur === 1 ? '' : 's'}` : ''}`)
    : '+ Add';

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Your Legacy" subtitle="See what consistent stewardship can become." />
      {/* Spec #21 — BUILD vs GROW top organisation. Only one row is
          "active" at a time; the other is grayed out so users can see the
          full menu but understand what they're switching between. */}
      <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
        <Text style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: '800', color: '#c49450' }}>BUILD</Text>
        <Text style={[{ fontSize: 9, marginTop: 2, marginBottom: 6 }, t.textMuted]}>What your money + budget habits could build.</Text>
        <PeriodPills values={Object.keys(BUILD)} value={isBuild ? timeframe : ''} onChange={setTimeframe} testID="legacy-build-period" />
        <Text style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: '800', color: '#c49450', marginTop: 14 }}>GROW</Text>
        <Text style={[{ fontSize: 9, marginTop: 2, marginBottom: 6 }, t.textMuted]}>What your investments could grow into.</Text>
        <PeriodPills values={Object.keys(GROW)} value={!isBuild ? timeframe : ''} onChange={setTimeframe} testID="legacy-grow-period" />
      </View>

      {/* Retirement-age card — only visible when the user selects Retirement (spec #24). */}
      {isRetirement && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Retirement age</Text>
          <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>
            {yearsUntilRetirement > 0
              ? `Projecting for ${yearsUntilRetirement} year${yearsUntilRetirement === 1 ? '' : 's'} (age ${currentAge} → ${retirementAge}).`
              : 'Enter your current age and desired retirement age to see the projection.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>Current age</Text>
              <TextInput
                keyboardType="numeric"
                value={ageDraft}
                onChangeText={(v) => { setAgeDraft(v.replace(/[^0-9]/g, '')); setAgeError(''); }}
                onBlur={commitAges}
                selectTextOnFocus
                placeholder="30"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: t.dark ? D.text : C.ink }}
                testID="legacy-current-age"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>Retirement age</Text>
              <TextInput
                keyboardType="numeric"
                value={retDraft}
                onChangeText={(v) => { setRetDraft(v.replace(/[^0-9]/g, '')); setAgeError(''); }}
                onBlur={commitAges}
                selectTextOnFocus
                placeholder="65"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: t.dark ? D.text : C.ink }}
                testID="legacy-retirement-age"
              />
            </View>
          </View>
          {ageError ? <Text style={{ fontSize: 10, color: '#b0453d', marginTop: 8 }}>{ageError}</Text> : null}
        </View>
      )}

      {/* Projection card — labeled per selected mode. */}
      <View style={s.projectionCard}>
        <Text style={{ color: '#caa465', fontSize: 9, letterSpacing: 1.3, textAlign: 'center' }}>
          {projectionTitle} ({isRetirement && yearsUntilRetirement > 0 ? `${yearsUntilRetirement}yr` : timeframe})
        </Text>
        <Text style={s.projectionStrong}>{!financialsReady ? '••••••' : years > 0 ? MONEY(projection) : '—'}</Text>
        <Text style={{ color: '#b4ada3', fontSize: 12, textAlign: 'center', maxWidth: 300, alignSelf: 'center' }}>
          {projectionSubtitle}
        </Text>
        {/* Real-data line chart — every point is a computed projection value
            from the SAME math as the headline number. The final plotted point
            must exactly equal MONEY(projection) (spec reconciliation). */}
        <ProjectionLineChart
          ready={!!financialsReady && years > 0}
          height={110}
          strokeColor="#8b6437"
          gradientTop="rgba(232,201,143,0.35)"
          gradientBottom="rgba(232,201,143,0)"
          emptyLabel={years > 0 ? 'Updating…' : 'Select a timeframe to see the projection.'}
          deltaMode={isBuild ? 'from-today' : 'previous'}
          points={(() => {
            // Real-data chart points — every value comes from the SAME
            // projection math as the headline number.
            //
            // BUILD (spec #22): 1-5yr — plot yearly checkpoints. Each
            // point equals `buildProjectionAt(y)` which sums the actual
            // per-month Net (Actual/Budgeted/Estimated) with investments
            // held flat.
            //
            // GROW / Retirement (spec #21, #23): use meaningful long-term
            // checkpoints — Now, 5yr, 10yr, 15yr, 20yr, 25yr, 30yr and
            // (if applicable) Retirement — so the compounding curve is
            // visible. `growProjectionAt(y)` applies the compound formula
            // with the currently-selected return rate + contribution.
            if (years <= 0) return [];
            if (isBuild) {
              const pts: any[] = [];
              for (let y = 0; y <= Math.min(years, 5); y++) {
                pts.push({
                  label: y === 0 ? 'Now' : `${y}YR`,
                  value: buildProjectionAt(y),
                  meta: {
                    source: y === 0 ? 'actual' : 'projected',
                    fullLabel: y === 0 ? 'Today' : `${y} year${y === 1 ? '' : 's'} from now`,
                    subtitle: 'BUILD · investments held flat',
                  },
                });
              }
              return pts;
            }
            // Long-horizon (GROW / Retirement) — meaningful checkpoints.
            const checkpoints: number[] = [];
            if (isRetirement) {
              // Every 5 yrs up to Retirement, then the exact retirement year.
              for (let y = 0; y <= years; y += 5) checkpoints.push(y);
              if (checkpoints[checkpoints.length - 1] !== years) checkpoints.push(years);
            } else {
              // GROW modes (10/20/30yr): every 5 yrs.
              for (let y = 0; y <= years; y += 5) checkpoints.push(y);
              if (checkpoints[checkpoints.length - 1] !== years) checkpoints.push(years);
            }
            return checkpoints.map((y, i) => ({
              label: y === 0 ? 'Now' : (isRetirement && i === checkpoints.length - 1 ? 'RETIRE' : `${y}YR`),
              value: growProjectionAt(y),
              meta: {
                source: y === 0 ? 'actual' : 'projected',
                fullLabel: y === 0
                  ? 'Today'
                  : (isRetirement && i === checkpoints.length - 1
                      ? 'Retire'
                      : `Year ${y}`),
                subtitle: `${isRetirement ? 'Retirement' : 'GROW'} · ${Math.round(RATE * 100)}% compound`,
              },
            }));
          })()}
        />
      </View>

      {/* Assumption chips — tap any to edit. These are the exact inputs used
          in the projection above so users can see and adjust them inline. */}
      <View style={[s.assumptionsCard, t.cardBg]} testID="legacy-assumptions">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>YOUR ASSUMPTIONS</Text>
          <Text style={[{ fontSize: 8 }, t.textMuted]}>Tap to edit</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {/* Return rate chip — only shown on GROW/Retirement modes, where
              the assumption actually applies. BUILD holds investments flat,
              so surfacing "7% Return" there is confusing. */}
          {!isBuild && (
            <Pressable onPress={() => { setRateDraft(String(returnRate ?? DEFAULT_LEGACY_RATE)); setEditingRate(true); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID="legacy-chip-rate">
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>RETURN</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{Math.round(RATE * 100)}%</Text>
          </Pressable>
          )}
          {/* Monthly contribution — GROW modes only. Spec #3: tap to type
              the exact dollar amount instead of using +/- buttons. */}
          {!isBuild && (
            <Pressable
              onPress={() => { setContribDraft(String(contribution || '')); setEditingContrib(true); }}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}
              testID="legacy-chip-contrib"
            >
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>CONTRIB / MO</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(contribution)}</Text>
            </Pressable>
          )}
          {/* Cash chip — BUILD modes only (uses Total Cash per Wealth tab). */}
          {isBuild && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>CASH</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(buildStartingCash)}</Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>INVESTMENTS</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(investmentTotal)}</Text>
          </View>
          <Pressable onPress={() => { setHypoDraft(hypothetical || ''); setHypoFreqDraft(hypoFreq); setHypoDurDraft(hypoDur ? String(hypoDur) : ''); setEditingHypo(true); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID="legacy-chip-hypo">
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>HYPOTHETICAL</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{hypoDesc}</Text>
          </Pressable>
          {isRetirement && (
            <>
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>YEARS</Text>
                <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{yearsUntilRetirement}</Text>
              </View>
            </>
          )}
        </View>
        <Text style={[{ fontSize: 8, marginTop: 8, fontStyle: 'italic' }, t.textMuted]}>
          Actual data · assumptions in gold borders are user-editable.
        </Text>
      </View>

      {/* How the math works — collapsible explanation directly wired to the
          numbers above. Answers "why is my Y1 not just 1.07x my money?". */}
      <Pressable onPress={() => setShowMath(!showMath)} style={[s.assumptionsCard, t.cardBg, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} testID="legacy-math-toggle">
        <View style={{ flex: 1 }}>
          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>How this is calculated</Text>
          <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>Step-by-step math for the number above.</Text>
        </View>
        <Ionicons name={showMath ? 'chevron-down' : 'chevron-forward'} size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
      </Pressable>
      {showMath && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          {isBuild ? (
            (() => {
              // Fully transparent breakdown so every displayed number
              // reconciles: starting wealth → each month with source →
              // yearly rollups → projection. All values come from ONE
              // memo (`buildBreakdown`) so the card, chart, tooltip and
              // year-by-year table can never disagree.
              const bd = buildBreakdown;
              const hypoActive = hypoValue > 0;
              return (
                <>
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1 }]}>PROJECTED WEALTH</Text>
                  <Text style={[{ fontSize: 32, fontWeight: '800', marginTop: 4 }, t.textInk]}>{MONEY(projection)}</Text>
                  <Text style={[{ fontSize: 10, marginTop: 2 }, t.textMuted]}>in {years} year{years === 1 ? '' : 's'}</Text>

                  {/* --- Starting Wealth --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>STARTING WEALTH</Text>
                  <View style={{ marginTop: 6, gap: 4 }}>
                    <Row label="Cash" value={MONEY(bd.startingCash)} muted={t.textMuted} ink={t.textInk} />
                    <Row label="Investments" value={MONEY(bd.startingInvestments)} muted={t.textMuted} ink={t.textInk} />
                    <View style={{ height: 1, backgroundColor: t.dark ? '#332e26' : '#efe6d0', marginVertical: 4 }} />
                    <Row label="Starting Wealth" value={MONEY(bd.startingWealth)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
                  </View>

                  {/* --- Projected monthly cash flow (aka run rate) --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>PROJECTED MONTHLY BUDGET CASH FLOW</Text>
                  {bd.allBudgetMonths.length === 0 ? (
                    <View style={{ marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#26221c' : '#fbf6ec' }}>
                      <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>No finalized budgets yet</Text>
                      <Text style={[{ fontSize: 10, marginTop: 4, lineHeight: 14 }, t.textMuted]}>
                        BUILD needs at least one finalized monthly budget to project forward. Head to Budget → pick a month → tap <Text style={{ fontWeight: '800' }}>Finalize Budget</Text>. Draft budgets are ignored.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ marginTop: 6, gap: 4 }}>
                      <Row
                        label={bd.allBudgetMonths.length === 0 ? 'No finalized budget yet' : bd.allBudgetMonths.length === 1 ? `From ${bd.allBudgetMonths[0].label}` : `Average of ${bd.runRateSlice.length} finalized budget month${bd.runRateSlice.length === 1 ? '' : 's'}`}
                        value={`${bd.projectedMonthlyCashFlow >= 0 ? '+' : '−'}${MONEY(Math.abs(Math.round(bd.projectedMonthlyCashFlow)))}`}
                        muted={t.textMuted} ink={t.textInk}
                        valueColor={bd.projectedMonthlyCashFlow >= 0 ? '#4c8b56' : '#b0453d'}
                      />
                      {bd.runRateSlice.length > 0 && (
                        <View style={{ marginTop: 4, gap: 3, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#e6dcc5' }}>
                          {bd.runRateSlice.map((rs: any, idx: number) => (
                            <View key={`rr-${idx}-${rs.ym}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={[{ fontSize: 9 }, t.textMuted]}>{rs.label}</Text>
                              <Text style={[{ fontSize: 9, fontWeight: '600' }, t.textInk]}>{rs.net >= 0 ? '+' : '−'}{MONEY(Math.abs(rs.net))}</Text>
                            </View>
                          ))}
                          {bd.runRateSlice.length >= 2 && (
                            <Text style={[{ fontSize: 9, marginTop: 2, fontStyle: 'italic' }, t.textMuted]}>
                              (sum ÷ {bd.runRateSlice.length}) = {bd.projectedMonthlyCashFlow >= 0 ? '+' : '−'}{MONEY(Math.abs(Math.round(bd.projectedMonthlyCashFlow)))} / mo
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  )}

                  {/* --- Month by month projection --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>MONTH-BY-MONTH</Text>
                  <View style={{ marginTop: 6, gap: 2 }}>
                    <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderColor: t.dark ? '#332e26' : '#efe6d0' }}>
                      <Text style={[{ flex: 2, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39' }]}>MONTH</Text>
                      <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39', textAlign: 'right' }]}>AMOUNT</Text>
                      <Text style={[{ flex: 2, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39', textAlign: 'right' }]}>SOURCE</Text>
                    </View>
                    {bd.months.map((r: any, idx: number) => (
                      <View key={`mo-${idx}-${r.ym}`} style={{ flexDirection: 'row', paddingVertical: 2 }}>
                        <Text style={[{ flex: 2, fontSize: 10 }, t.textInk]}>{r.label}</Text>
                        <Text style={[{ flex: 1, fontSize: 10, fontWeight: '600', textAlign: 'right', color: (r.net || 0) >= 0 ? '#4c8b56' : '#b0453d' }]}>
                          {(r.net || 0) >= 0 ? '+' : '−'}{MONEY(Math.abs(r.net || 0))}
                        </Text>
                        <Text style={[{ flex: 2, fontSize: 9, textAlign: 'right' }, t.textMuted]}>
                          {r.source === 'budgeted' ? 'Finalized budget' : 'Estimated from budget average'}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* --- Hypothetical contribution (only if user opted in) --- */}
                  {hypoActive && (
                    <>
                      <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>HYPOTHETICAL CONTRIBUTION</Text>
                      <View style={{ marginTop: 6, gap: 4 }}>
                        <Row
                          label={`${MONEY(hypoValue)} ${hypoFreq}${hypoDur ? ` × ${hypoDur}yr` : ''}`}
                          value={`+${MONEY(Math.round(bd.hypo.addToCash + bd.hypo.addToPrincipal))}`}
                          muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56"
                        />
                        <Text style={[{ fontSize: 9, fontStyle: 'italic' }, t.textMuted]}>
                          Extra cash you&apos;re modeling on top of your budget projection. Set to $0 to remove.
                        </Text>
                      </View>
                    </>
                  )}

                  {/* --- Year-by-year rollup --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>YEAR-BY-YEAR</Text>
                  <View style={{ marginTop: 6, gap: 8 }}>
                    {bd.yearSnaps.map((y: any) => (
                      <View key={`ys-${y.year}`} style={{ backgroundColor: t.dark ? '#242019' : '#fbf6ec', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: t.dark ? '#332e26' : '#efe6d0' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '800' }, t.textInk]}>Year {y.year} projected wealth</Text>
                        <View style={{ marginTop: 4, gap: 2 }}>
                          <Row label={y.year === 1 ? 'Starting Wealth' : `Year ${y.year - 1} Ending Wealth`} value={MONEY(y.startWealth)} muted={t.textMuted} ink={t.textInk} />
                          <Row label={`+ Budget cash flow (months ${y.startIdx + 1}–${y.endIdx + 1})`} value={`${y.monthsSum >= 0 ? '+' : '−'}${MONEY(Math.abs(y.monthsSum))}`} muted={t.textMuted} ink={t.textInk} valueColor={y.monthsSum >= 0 ? '#4c8b56' : '#b0453d'} />
                          {hypoActive && y.hypoAdd !== 0 && (
                            <Row label="+ Hypothetical contribution" value={`${y.hypoAdd >= 0 ? '+' : '−'}${MONEY(Math.abs(y.hypoAdd))}`} muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56" />
                          )}
                          <View style={{ height: 1, backgroundColor: t.dark ? '#332e26' : '#efe6d0', marginVertical: 2 }} />
                          <Row label={`= Year ${y.year} Ending Wealth`} value={MONEY(y.endWealth)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
                        </View>
                      </View>
                    ))}
                  </View>

                  <Text style={[{ fontSize: 10, marginTop: 14, lineHeight: 14, fontStyle: 'italic' }, t.textMuted]}>
                    Based on your current wealth and projected budget cash flow. Investments are held flat in BUILD — 7% growth belongs to GROW/Retirement.
                  </Text>
                </>
              );
            })()
          ) : (
            <>
              <Text style={[{ fontSize: 10, lineHeight: 15 }, t.textInk]}>
                <Text style={{ fontWeight: '800' }}>GROW mode ({isRetirement ? `${years}yr Retirement` : timeframe})</Text> — investments only.{'\n'}
              </Text>
              <View style={{ marginTop: 6, gap: 4 }}>
                <Row label="Starting principal" value={MONEY(investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal)} muted={t.textMuted} ink={t.textInk} />
                <Row label={`× (1 + ${Math.round(RATE * 100)}%/12)^(${years} × 12)`} value={MONEY(Math.round((investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal) * Math.pow(1 + MONTHLY_RATE, years * 12)))} muted={t.textMuted} ink={t.textInk} />
                <View style={{ height: 4 }} />
                <Row label={`Monthly contributions (${MONEY(contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib)}/mo × ${years * 12})`} value={MONEY(Math.round(MONTHLY_RATE > 0 ? (contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib) * ((Math.pow(1 + MONTHLY_RATE, years * 12) - 1) / MONTHLY_RATE) : (contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib) * years * 12))} muted={t.textMuted} ink={t.textInk} />
                <View style={{ height: 6 }} />
                <Row label="TOTAL PROJECTION" value={MONEY(projection)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
              </View>
              <Text style={[{ fontSize: 9, marginTop: 8, lineHeight: 13 }, t.textMuted]}>
                Cash is intentionally excluded from GROW projections — retirement wealth compounds from your invested portion + ongoing contributions.
              </Text>
            </>
          )}
        </View>
      )}

      {/* Cumulative-year toggle. */}
      {years > 0 && (
        <Pressable onPress={() => setCumulative(!cumulative)} style={[s.assumptionsCard, t.cardBg, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} testID="legacy-cumulative-toggle">
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Cumulative year-by-year</Text>
            <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>Show growth for every year up to {isRetirement ? `year ${years}` : timeframe}.</Text>
          </View>
          <View style={[{ width: 34, height: 20, borderRadius: 10, backgroundColor: cumulative ? '#b28a4c' : '#e5decf', padding: 2 }]}>
            <View style={[{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', transform: [{ translateX: cumulative ? 14 : 0 }] }]} />
          </View>
        </Pressable>
      )}

      {cumulative && years > 0 && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderColor: t.dark ? '#333' : '#f0e7d1' }}>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6 }]}>YEAR</Text>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6, textAlign: 'right' }]}>TOTAL</Text>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6, textAlign: 'right' }]}>Δ</Text>
          </View>
          {cumulativeRows.map((r) => (
            <View key={r.year} style={{ flexDirection: 'row', paddingVertical: 4 }}>
              <Text style={[{ flex: 1, fontSize: 10 }, t.textInk]}>Year {r.year}</Text>
              <Text style={[{ flex: 1, fontSize: 10, fontWeight: '700', textAlign: 'right' }, t.textInk]}>{financialsReady ? MONEY(r.value) : '••••••'}</Text>
              <Text style={[{ flex: 1, fontSize: 10, textAlign: 'right' }, { color: r.delta >= 0 ? '#4c8b56' : '#b0453d' }]}>
                {financialsReady ? `${r.delta >= 0 ? '+' : ''}${MONEY(r.delta)}` : '••••'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* WHAT WE'RE PROJECTING FROM — content differs by mode per spec #22 / #23. */}
      <View style={[s.assumptionsCard, t.cardBg]}>
        <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>WHAT WE&apos;RE PROJECTING FROM</Text>
        <View style={{ marginTop: 8, gap: 6 }}>
          {isBuild ? (
            <>
              <Row label="Cash (from Wealth)" value={MONEY(buildStartingCash)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Current Investments (held flat)" value={MONEY(investmentTotal)} muted={t.textMuted} ink={t.textInk} />
              {/* This month's budget net — the same figure as the Budget
                  module for the current month. Kept as-is so users can
                  reconcile it 1:1 with the Budget page. */}
              <Pressable onPress={() => setShowSurplusBreakdown(true)} hitSlop={4} testID="legacy-surplus-drill">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[{ fontSize: 11, fontWeight: '600', color: '#9a6d32' }, t.textInk]}>This Month&apos;s Budget Cash Flow</Text>
                    <Ionicons name="information-circle-outline" size={12} color="#9a6d32" />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: rawMonthlyNet < 0 ? '#b0453d' : '#9a6d32' }}>
                    {MONEY(rawMonthlyNet)}
                  </Text>
                </View>
                <Text style={[{ fontSize: 8, marginTop: 2 }, t.textMuted]}>Same as the Budget page for {monthlyBudgetPeriod || 'this month'} — tap for breakdown</Text>
              </Pressable>
              {/* Run rate — the projected monthly cash flow BUILD uses for
                  unbudgeted future months. Differs from "this month" when
                  the user has entered per-month overrides for multiple
                  months. This is the number the user can multiply by 12
                  to reconcile Y1 against the chart. */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTopWidth: 1, borderTopColor: t.dark ? '#332e26' : '#efe6d0' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>Projected Monthly Budget Cash Flow</Text>
                  <Text style={[{ fontSize: 8, marginTop: 2 }, t.textMuted]}>
                    {buildBreakdown.allBudgetMonths.length === 0
                      ? 'Finalize a monthly budget to start projecting BUILD.'
                      : buildBreakdown.allBudgetMonths.length === 1
                        ? `From ${buildBreakdown.allBudgetMonths[0].label}`
                        : `Average of ${buildBreakdown.runRateSlice.length} finalized budget month${buildBreakdown.runRateSlice.length === 1 ? '' : 's'} — see math below`}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: buildBreakdown.runRate < 0 ? '#b0453d' : '#9a6d32' }}>
                  {buildBreakdown.runRate >= 0 ? '+' : '−'}{MONEY(Math.abs(Math.round(buildBreakdown.runRate)))}
                </Text>
              </View>
              {rawMonthlyNet < 0 && (
                <Text style={{ fontSize: 9, color: '#b0453d', marginTop: 2 }}>
                  Your Budget is currently net-negative — BUILD reflects this.
                </Text>
              )}
            </>
          ) : (
            <>
              <Row label="Current Investments" value={MONEY(investmentTotal)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Monthly Contribution" value={MONEY(contribution)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Assumed Return" value={`${Math.round(RATE * 100)}%`} muted={t.textMuted} ink={t.textInk} />
            </>
          )}
          {hypoValue > 0 && (
            <Row label={`+ Hypothetical (${hypoFreq === 'onetime' ? 'one-time' : hypoFreq === 'monthly' ? 'monthly' : 'annual'}${hypoDur ? ` × ${hypoDur}yr` : ''})`} value={MONEY(hypoValue)} muted={t.textMuted} ink={t.textInk} valueColor="#c9a56c" labelColor="#c9a56c" />
          )}
        </View>
      </View>

      {/* Monthly contribution — only GROW modes (spec #23 / #26). */}
      {!isBuild && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Monthly Contribution</Text><Text style={[{ fontSize: 8, color: '#999289' }, t.textMuted]}>Extra amount you plan to invest each month</Text></View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32' }}>{MONEY(contribution)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable onPress={() => setContribution(Math.max(0, contribution - 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-minus"><Text style={t.textInk}>−</Text></Pressable>
            <Pressable onPress={() => setContribution(Math.min(10000, contribution + 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-plus"><Text style={t.textInk}>+</Text></Pressable>
          </View>
        </View>
      )}

      {/* Hypothetical amount — clearly labeled as modeling only (spec #25). */}
      <Pressable onPress={() => { setHypoDraft(hypothetical || ''); setHypoFreqDraft(hypoFreq); setHypoDurDraft(hypoDur ? String(hypoDur) : ''); setEditingHypo(true); }} style={[s.assumptionsCard, t.cardBg]} testID="legacy-hypo-open">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Hypothetical Amount</Text>
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: '#c4945020' }}>
                <Text style={{ fontSize: 7, fontWeight: '800', letterSpacing: 0.6, color: '#c49450' }}>MODELED</Text>
              </View>
            </View>
            <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>
              For what-if modeling only. Never changes your actual Wealth, Budget, or account balances.
            </Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32', marginLeft: 12 }}>{hypoDesc}</Text>
        </View>
      </Pressable>

      <Sheet visible={editingHypo} close={() => { setEditingHypo(false); setHypoDraft(''); setHypoDurDraft(''); }} title="Add hypothetical amount" subtitle="Model a what-if. Choose one-time, monthly, or annual — with an optional duration.">
        <View>
          <Text style={s.label}>Frequency</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
            {(['onetime', 'monthly', 'annual'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setHypoFreqDraft(f)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  alignItems: 'center',
                  borderColor: hypoFreqDraft === f ? '#c49450' : (t.dark ? D.border : '#ece5d5'),
                  backgroundColor: hypoFreqDraft === f ? '#c4945018' : 'transparent',
                }}
                testID={`legacy-hypo-freq-${f}`}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: hypoFreqDraft === f ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>
                  {f === 'onetime' ? 'One-time' : f === 'monthly' ? 'Monthly' : 'Annual'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>{hypoFreqDraft === 'onetime' ? 'One-time amount' : hypoFreqDraft === 'monthly' ? 'Amount per month' : 'Amount per year'}</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={hypoDraft} onChangeText={setHypoDraft} keyboardType="numeric" placeholder="0" autoFocus testID="legacy-hypo-amount" />
          </View>
          {hypoFreqDraft !== 'onetime' && (
            <>
              <Text style={[s.label, { marginTop: 12 }]}>Duration in years (optional)</Text>
              <TextInput
                style={s.input}
                value={hypoDurDraft}
                onChangeText={(v) => setHypoDurDraft(v.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="Leave blank to apply for the full projection horizon"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                testID="legacy-hypo-duration"
              />
              <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
                Blank = ongoing (applies for the entire 1/5/10/20/30yr horizon). Set a number to model a bounded item like a car loan or bonus period.
              </Text>
            </>
          )}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={hypoValue > 0 && Number(hypoDraft.replace(/[^0-9.]/g, '') || 0) === 0 ? 'Remove hypothetical' : 'Save'} onPress={commitHypo} testID="legacy-hypo-save" />
          </View>
        </View>
      </Sheet>

      {/* Return rate sheet — tap the RETURN chip to edit. Clamped 0.1-30%. */}
      <Sheet visible={editingRate} close={() => setEditingRate(false)} title="Expected annual return" subtitle="This is the compounding rate applied to your invested portion. 7% is a common long-term U.S. stock market assumption.">
        <View>
          <Text style={s.label}>Return %</Text>
          <TextInput
            style={s.input}
            value={rateDraft}
            onChangeText={(v) => setRateDraft(v.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
            placeholder="7"
            autoFocus
            testID="legacy-rate-input"
          />
          <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
            Reasonable values: 3-4% conservative (bonds/CDs), 6-8% balanced, 9-10% aggressive equities. Past performance is not a guarantee.
          </Text>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Save" onPress={commitRate} testID="legacy-rate-save" />
          </View>
          <Pressable onPress={() => { setRateDraft(String(DEFAULT_LEGACY_RATE)); }} style={{ marginTop: 10, alignItems: 'center' }}>
            <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700' }}>Reset to {DEFAULT_LEGACY_RATE}%</Text>
          </Pressable>
        </View>
      </Sheet>
      {/* Monthly Contribution editor (spec #3) — direct-typed dollar entry. */}
      <Sheet
        visible={editingContrib}
        close={() => { setEditingContrib(false); setContribDraft(''); }}
        title="Monthly Contribution"
        subtitle="Type the exact dollar amount you plan to contribute each month."
      >
        <View>
          <Text style={s.label}>Amount / month</Text>
          <View style={s.amountInput}>
            <Text style={[s.amountPrefix, t.textInk]}>$</Text>
            <TextInput
              style={[s.input, { paddingLeft: 26 }]}
              value={contribDraft}
              onChangeText={(v) => setContribDraft(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1'))}
              keyboardType="decimal-pad"
              placeholder="0"
              autoFocus
              testID="legacy-contrib-input"
            />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Save" onPress={commitContribution} testID="legacy-contrib-save" />
          </View>
        </View>
      </Sheet>

      {/* Monthly Budget Net drill-down — read-only breakdown so users can
          verify the projection input. Shows Budgeted Income − Budgeted Expenses
          = Monthly Budget Net (signed). Renamed from "Surplus" per spec #5
          since negative values are valid and BUILD reflects them. */}
      <Sheet
        visible={showSurplusBreakdown}
        close={() => setShowSurplusBreakdown(false)}
        title="Monthly Budget Net"
        subtitle={`Based on ${monthlyBudgetPeriod || 'your current Budget'}`}
      >
        <View>
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={[{ fontSize: 12 }, t.textInk]}>Budgeted Monthly Income</Text>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{MONEY(monthlyBudgetIncome || 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.dark ? '#3a342b' : '#efe6d0' }}>
              <Text style={[{ fontSize: 12 }, t.textInk]}>− Budgeted Monthly Expenses</Text>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{MONEY(monthlyBudgetExpense || 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.dark ? '#3a342b' : '#efe6d0' }}>
              <Text style={[{ fontSize: 12, fontWeight: '800' }, t.textInk]}>= Monthly Budget Net</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: rawMonthlyNet < 0 ? '#b0453d' : '#9a6d32' }}>
                {MONEY(rawMonthlyNet)}
              </Text>
            </View>
          </View>
          {rawMonthlyNet < 0 && (
            <View style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#b0453d' }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#b0453d' }}>Net-negative Budget</Text>
              <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d806e', marginTop: 4, lineHeight: 14 }}>
                Your Budget currently plans to spend more than it earns. BUILD projections reflect this — Available Cash decreases each month by the net deficit. Increase Earn or trim category budgets to turn this positive.
              </Text>
            </View>
          )}
          <Text style={[{ fontSize: 9, marginTop: 12, textAlign: 'center' }, t.textMuted]}>
            This is view-only. Edit your budget in the Budget tab to change these numbers.
          </Text>
        </View>
      </Sheet>

      {/* Legal / financial disclaimer required at the bottom of Legacy so
          users understand these numbers are educational estimates, not a
          guarantee. Kept concise + subtle to match the luxury feel. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={12} color={t.dark ? D.textMuted : '#8b8478'} style={{ marginTop: 1 }} />
          <Text style={[{ fontSize: 9, lineHeight: 14, flex: 1 }, t.textMuted]}>
            Projections are estimates for planning only. Actual returns will vary and are not guaranteed. Jaleter does not provide investment, tax, or legal advice — consult a licensed professional for personalized guidance.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

// Small reusable row for the "WHAT WE'RE PROJECTING FROM" card.
const Row = ({ label, value, ink, muted, valueColor, labelColor }: any) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    <Text style={[{ fontSize: 10 }, muted, labelColor && { color: labelColor }]}>{label}</Text>
    <Text style={[{ fontSize: 10, fontWeight: '700' }, ink, valueColor && { color: valueColor }]}>{value}</Text>
  </View>
);

const CALENDLY_URL = 'https://calendly.com/danyelldaugherty-v6lh/30min';

const CoachingScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);

  const refreshBookings = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/coaching/bookings', { method: 'GET' }, token);
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { refreshBookings(); }, [refreshBookings]);

  const upcoming = bookings
    .filter((b) => b.status === 'confirmed')
    .sort((a, b) => (new Date(b.created_at).getTime()) - (new Date(a.created_at).getTime()))
    .slice(0, 5);

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Coaching" subtitle="Personal financial clarity, one hour at a time." back={back} />
      <View style={s.coachingCard}>
        <View style={s.coachingIcon}><Ionicons name="chatbubble-outline" size={24} color={C.goldText} /></View>
        <Text style={{ color: '#cda86d', fontSize: 9, letterSpacing: 1.2 }}>COACHING · 1 HOUR</Text>
        <Text style={[{ fontSize: 22, fontWeight: '700', color: '#f2e5c8', marginVertical: 4, textAlign: 'center' }]}>Private Financial Clarity Session</Text>
        <Text style={s.coachingPrice}>$75<Text style={{ fontSize: 13, color: '#aaa298', fontWeight: '500' }}> / session</Text></Text>
        <Text style={{ color: '#aaa298', fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 15 }}>
          One focused session to get clear on a financial question, budget concern, or next step.
        </Text>
        <View style={{ marginTop: 12, alignSelf: 'stretch', gap: 6 }}>
          {[
            'Review one primary financial concern',
            'Budget, cash-flow, or goal review',
            'Identify priorities and opportunities',
            'Questions answered during the session',
            'Clear next steps',
          ].map((line) => (
            <View key={line} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ color: '#e8c98f', fontSize: 12, fontWeight: '800' }}>✓</Text>
              <Text style={{ color: '#e6ddca', fontSize: 11, flex: 1, lineHeight: 15 }}>{line}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Single CTA — Stripe on jaleter.com handles the checkout and then
          redirects the user directly into Calendly to pick their slot. */}
      <View style={{ marginTop: 18 }}>
        <Pressable
          onPress={() => openJaleter('coaching')}
          style={s.coachingCta}
          testID="coaching-book-pay"
        >
          <Ionicons name="lock-closed-outline" size={16} color="#fff" />
          <Text style={s.coachingCtaText}>Book & Pay — $75</Text>
          <Ionicons name="open-outline" size={14} color="#fff" />
        </Pressable>
        <Text style={[{ fontSize: 10, textAlign: 'center', marginTop: 10 }, t.textMuted]}>
          You&apos;ll choose your session time right after payment.
        </Text>
      </View>

      {upcoming.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }, t.textInk]}>PAID SESSIONS</Text>
          {upcoming.map((b) => (
            <View key={b.booking_id} style={[s.slotRow, { borderColor: '#c9a56c33', backgroundColor: t.dark ? D.surface : '#faf4e9' }]}>
              <Ionicons name="checkmark-circle" size={17} color="#8fa88f" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '600' }, t.textInk]}>{b.scheduled_at ? formatBookingDate(b.scheduled_at) : 'Scheduled via Calendly'}</Text>
              <Text style={{ color: '#8fa88f', fontSize: 9, fontWeight: '700' }}>CONFIRMED</Text>
            </View>
          ))}
        </View>
      )}

      {toast && <SharedToast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};
const MembershipScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const pay = usePayment();
  const [membership, setMembership] = useState<{
    active: boolean;
    status: string | null;
    plan: string | null;
    price: number | null;
    currency: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    premium_since: string | null;
  } | null>(null);
  // "Confirming…" state — set true after a subscribe attempt returns, cleared
  // once the backend reports `active: true` (or after we give up polling).
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'subscribe' | 'portal' | 'cancel' | 'resume' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await apiCall('/api/user/membership', { method: 'GET' }, token);
      setMembership(data);
      return data;
    } catch { setMembership(null); return null; }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  // Polls /api/user/membership for up to ~60 seconds after Stripe redirect
  // until the webhook flips the user to active. Never activates locally;
  // this is a READ loop.
  const waitForActivation = useCallback(async () => {
    setConfirming(true);
    setConfirmMsg('Payment received. Confirming membership…');
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      const m = await refresh();
      if (m?.active) {
        setConfirming(false);
        setConfirmMsg(null);
        setNotice('Membership activated. Thanks for supporting Jaleter!');
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    setConfirming(false);
    setConfirmMsg(null);
    setNotice("We haven't heard back from Stripe yet. Pull to refresh in a moment — your access will unlock as soon as we receive Stripe's confirmation.");
  }, [refresh]);

  const startSubscribe = async () => {
    if (!token) return;
    setBusy('subscribe');
    setNotice(null);
    try {
      const res = await pay.start('jaleter_premium');
      // Regardless of the outcome (success, canceled, dismissed) we ask the
      // backend for the authoritative status. The webhook — not the redirect
      // — decides entitlement.
      if (res.ok && res.sessionId) {
        await waitForActivation();
      } else if (res.error) {
        setNotice(res.error);
      }
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    if (!token) return;
    setBusy('portal');
    try {
      const res = await apiCall('/api/payments/billing-portal', { method: 'POST', body: JSON.stringify({}) }, token);
      if (res?.url) {
        if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.location.href = res.url; }
        else { await WebBrowser.openBrowserAsync(res.url); }
      }
    } catch (e: any) {
      setNotice(e?.message || 'Could not open the billing portal.');
    } finally { setBusy(null); refresh(); }
  };

  const cancelAtPeriodEnd = async () => {
    if (!token) return;
    setBusy('cancel');
    try {
      await apiCall('/api/payments/cancel-at-period-end', { method: 'POST', body: JSON.stringify({}) }, token);
      setNotice("Cancellation scheduled. You'll keep access until the end of the current billing period.");
    } catch (e: any) { setNotice(e?.message || 'Could not schedule cancellation.'); }
    finally { setBusy(null); refresh(); }
  };

  const resume = async () => {
    if (!token) return;
    setBusy('resume');
    try {
      await apiCall('/api/payments/resume', { method: 'POST', body: JSON.stringify({}) }, token);
      setNotice('Your subscription will renew as normal.');
    } catch (e: any) { setNotice(e?.message || 'Could not resume subscription.'); }
    finally { setBusy(null); refresh(); }
  };

  const renewsOn = membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Membership" subtitle="One simple annual plan." back={back} />

      {/* Confirming banner — visible while polling the backend after Stripe redirect. */}
      {confirming && (
        <View style={{
          padding: 12, borderRadius: 12, marginBottom: 10,
          backgroundColor: t.dark ? '#26221c' : '#fbf6ec',
          borderWidth: 1, borderColor: '#e6dcc5',
          flexDirection: 'row', gap: 10, alignItems: 'center',
        }}>
          <ActivityIndicator color="#9a6d32" />
          <Text style={[{ flex: 1, fontSize: 12 }, t.textInk]}>{confirmMsg}</Text>
        </View>
      )}
      {notice && !confirming && (
        <View style={{
          padding: 12, borderRadius: 12, marginBottom: 10,
          backgroundColor: t.dark ? '#1f2620' : '#f4f9ee',
          borderWidth: 1, borderColor: '#c9d9c1',
        }}>
          <Text style={[{ fontSize: 12 }, t.textInk]}>{notice}</Text>
        </View>
      )}

      <View style={[s.priceCard, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>JALETER PREMIUM</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: t.dark ? D.text : C.ink, marginTop: 4 }}>Annual Membership</Text>
        <Text style={[{ color: t.dark ? D.textMuted : '#8d867d', fontSize: 11, marginTop: 2 }]}>Everything you need to plan, track, and grow your money.</Text>
        <Text style={[s.priceStrong, t.textInk, { marginTop: 6 }]}>$90<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}> / year</Text></Text>
        <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', marginTop: 2 }}>$7.50 / month equivalent · auto-renews annually</Text>

        {/* Membership state pill: ACTIVE / PAST DUE / CANCELING / INACTIVE. */}
        {membership && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {membership.active ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#4c8b5622' }}>
                <Text style={{ color: '#4c8b56', fontSize: 10, fontWeight: '800' }}>
                  {membership.cancel_at_period_end ? `ACTIVE · ends ${renewsOn || ''}` : `ACTIVE · renews ${renewsOn || ''}`}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#8b643722' }}>
                <Text style={{ color: '#8b6437', fontSize: 10, fontWeight: '800' }}>
                  {membership.status === 'past_due' ? 'PAYMENT ISSUE' : (membership.status || 'INACTIVE').toUpperCase()}
                </Text>
              </View>
            )}
            {membership.status === 'past_due' && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#b0453d22' }}>
                <Text style={{ color: '#b0453d', fontSize: 10, fontWeight: '800' }}>UPDATE PAYMENT METHOD</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ marginTop: 12, gap: 6 }}>
          {[
            'Secure bank & account syncing',
            'Budgeting + transaction tracking',
            'Reports & spending insights',
            'Net Worth + Set Aside goals',
            'Build, Grow & retirement projections',
            'Jaleter Coach AI',
            'Faith + Focus library',
            'Statement import from supported bank files',
          ].map(item => (
            <View key={item} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text style={{ color: '#a57537', fontSize: 12, fontWeight: '800' }}>✓</Text>
              <Text style={{ color: t.dark ? D.textSubtle : '#615b52', fontSize: 11, flex: 1, lineHeight: 15 }}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Action buttons — different set depending on membership state. */}
      <View style={{ marginTop: 14, gap: 10 }}>
        {!membership?.active && (
          <Pressable
            onPress={startSubscribe}
            disabled={busy === 'subscribe' || confirming}
            style={{
              backgroundColor: '#9a6d32', paddingVertical: 14, borderRadius: 12, alignItems: 'center',
              opacity: (busy === 'subscribe' || confirming) ? 0.6 : 1,
            }}
            testID="membership-subscribe"
          >
            {busy === 'subscribe'
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Start membership — $90 / year</Text>}
          </Pressable>
        )}
        {membership?.active && !membership.cancel_at_period_end && (
          <>
            <Pressable
              onPress={openPortal}
              disabled={busy === 'portal'}
              style={{ borderWidth: 1, borderColor: '#c9b98f', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
              testID="membership-manage"
            >
              {busy === 'portal' ? <ActivityIndicator color="#8b6437" /> : <Text style={{ color: '#8b6437', fontWeight: '800', fontSize: 13 }}>Manage subscription</Text>}
            </Pressable>
            <Pressable
              onPress={cancelAtPeriodEnd}
              disabled={busy === 'cancel'}
              style={{ paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
              testID="membership-cancel"
            >
              {busy === 'cancel'
                ? <ActivityIndicator color="#b0453d" />
                : <Text style={{ color: '#b0453d', fontWeight: '600', fontSize: 12 }}>Cancel at period end</Text>}
            </Pressable>
          </>
        )}
        {membership?.active && membership.cancel_at_period_end && (
          <Pressable
            onPress={resume}
            disabled={busy === 'resume'}
            style={{ backgroundColor: '#4c8b56', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
            testID="membership-resume"
          >
            {busy === 'resume'
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Resume subscription</Text>}
          </Pressable>
        )}
      </View>
      <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', textAlign: 'center', marginTop: 12, lineHeight: 14 }}>
        Membership is billed by Stripe. You can cancel, update your card, or download invoices any time from Manage subscription.
      </Text>
    </ScrollView>
  );
};
const MoreScreen = ({ navigate, linkedCount, onBack }: any) => {
  const t = useThemed();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="More" subtitle="Your legacy, membership, and preferences." back={onBack} />
      <View style={s.moreHero}>
        <Sparkle size={22} color="#d7ad6b" />
        <Text style={s.moreHeroH2}>Build with purpose.</Text>
        <Text style={{ color: '#aaa298', fontSize: 10 }}>Every feature is designed to connect today's stewardship with tomorrow's freedom.</Text>
      </View>
      <View style={{ gap: 10 }}>
        {[
          ['coach','Jaleter Coach','AI insights on your money','sparkles-outline'],
          ['coaching','Book Coaching','Schedule + pay at jaleter.com','chatbubble-outline'],
          ['membership','Membership','Manage at jaleter.com','sparkles-outline'],
          ['settings','Settings','Profile, alerts, appearance','settings-outline'],
        ].map(([id, name, sub, icon]) => (
          <Pressable key={id} style={[s.moreGridBtn, t.cardBg]} onPress={() => navigate(id)} testID={`more-${id}`}>
            <View style={[s.moreGridIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={icon as any} size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{name}</Text>
              <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
          </Pressable>
        ))}

        {/* External-website quick links — open jaleter.com in the browser. */}
        <Pressable style={[s.moreGridBtn, t.cardBg]} onPress={() => openJaleter('home')} testID="more-visit-jaleter">
          <View style={[s.moreGridIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name="globe-outline" size={20} color={C.goldEyebrow} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Visit jaleter.com</Text>
            <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>Blog, pricing, resources</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
        </Pressable>
      </View>
      <PoweredByJaleter />
    </ScrollView>
  );
};
/**
 * ResetAppDataModal — strong two-step confirmation for the destructive reset.
 *
 * Spec #18 requirements addressed:
 *  - Clearly explains what is REMOVED (imported transactions, manual entries,
 *    budgets, income plans, manual assets/liabilities, custom reclassifications,
 *    alerts, cached reports) vs what STAYS (login, profile, subscription,
 *    Plaid connections — synced data resyncs on next refresh).
 *  - Requires the user to type "RESET" verbatim before the final button
 *    activates. No one-tap deletion.
 *  - Final button is labeled "Permanently Reset App Data" so intent is
 *    unambiguous.
 */
function ResetAppDataModal({ visible, isDark, onCancel, onConfirm }: { visible: boolean; isDark: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const needed = 'RESET';
  const canProceed = confirmText.trim() === needed && !busy;

  React.useEffect(() => { if (!visible) { setConfirmText(''); setBusy(false); } }, [visible]);

  const cardBg = isDark ? D.surface : '#fff';
  const border = isDark ? D.border : '#e5decf';
  const ink = isDark ? D.text : C.ink;
  const muted = isDark ? D.textMuted : C.muted;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 }}>
        <View style={[{ borderRadius: 22, padding: 22, backgroundColor: cardBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="warning-outline" size={20} color="#b0453d" />
            <Text style={[{ fontSize: 18, fontFamily: F.serif, fontWeight: '600', color: ink, flex: 1 }]}>Reset app data?</Text>
          </View>
          <Text style={[{ fontSize: 11, marginTop: 12, lineHeight: 16, color: muted }]}>
            <Text style={{ fontWeight: '800', color: ink }}>What gets removed:</Text>{'\n'}
            • Every imported and manually entered transaction{'\n'}
            • Your budget categories, planned amounts, and income sources{'\n'}
            • Manual assets, liabilities, Set Aside Cash buckets{'\n'}
            • Custom account renames + reclassifications{'\n'}
            • Legacy assumptions (hypotheticals, retirement age){'\n'}
            • Budget alerts + notification preferences{'\n'}
            • Cached reports and category-mapping overrides
          </Text>
          <Text style={[{ fontSize: 11, marginTop: 12, lineHeight: 16, color: muted }]}>
            <Text style={{ fontWeight: '800', color: ink }}>What stays:</Text>{'\n'}
            • Your login and profile{'\n'}
            • Membership + coaching bookings{'\n'}
            • Your Plaid bank connections{'\n'}
            <Text style={{ fontStyle: 'italic' }}>Plaid accounts remain connected. Their live balances and transactions will resync automatically on your next open.</Text>
          </Text>
          <Text style={[{ fontSize: 11, marginTop: 14, color: ink, fontWeight: '600' }]}>
            Type <Text style={{ fontWeight: '900', color: '#b0453d' }}>{needed}</Text> to confirm:
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={needed}
            placeholderTextColor={muted}
            style={{
              marginTop: 6, borderWidth: 1, borderColor: border, borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: ink,
              backgroundColor: isDark ? '#20180c' : '#fbf6ec',
            }}
            testID="reset-confirm-input"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable onPress={onCancel} disabled={busy} style={{ flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, alignItems: 'center' }} testID="reset-cancel">
              <Text style={[{ fontWeight: '700', fontSize: 12, color: ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={async () => { if (!canProceed) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
              disabled={!canProceed}
              style={{ flex: 1.4, padding: 14, borderRadius: 14, backgroundColor: canProceed ? '#b0453d' : (isDark ? '#3a2a26' : '#eecfcb'), alignItems: 'center' }}
              testID="reset-confirm"
            >
              <Text style={{ color: canProceed ? '#fff' : (isDark ? '#8f6862' : '#b0453d'), fontWeight: '800', fontSize: 12 }}>
                {busy ? 'Resetting…' : 'Permanently Reset App Data'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const SettingsScreen = ({ experience, setExperience, appearance, setAppearance, alerts, setAlerts, onLogout, back, linkedAccounts, linkedAccountCount, addLinked, onResetAppData, initials, categories, appLock, setAppLock }: any) => {
  const t = useThemed();
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  // UI-only expanded state per category for the collapsible Budget Alerts list.
  const [settingsAlertExpanded, setSettingsAlertExpanded] = useState<Record<string, boolean>>({});
  // Prefer the derived-from-live-API count when provided; fall back to the
  // Plaid-items length (# of institutions) so we degrade gracefully during
  // the first render pass before /accounts/all returns.
  const effectiveCount = typeof linkedAccountCount === 'number' ? linkedAccountCount : linkedAccounts.length;
  const rows: [string, string, string, any][] = [
    ['accounts', 'Linked Accounts', `${effectiveCount} connected`, 'link-outline'],
    ['support', 'Help & Support', 'Contact us, FAQs, ticket history', 'help-buoy-outline'],
    ['notifications', 'Notification Details', 'Manage every reminder', 'notifications-outline'],
    ['terms', 'Terms of Use', 'Opens jaleter.com/terms', 'document-text-outline'],
    ['privacy', 'Privacy Policy', 'Opens jaleter.com/privacy', 'lock-closed-outline'],
  ];
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Settings" subtitle="Make Jaleter work your way." back={back} action={<View style={s.avatar}><Text style={{ color: C.goldText, fontSize: 11, fontWeight: '700' }}>{initials || '—'}</Text></View>} />
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Your Experience</Text>
        <Text style={[s.settingsSub, t.textMuted]}>100 approved messages. No generated scripture.</Text>
        <PeriodPills values={['Faith','Both','Motivation']} value={experience} onChange={setExperience} testID="settings-exp" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Appearance</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Choose a look or follow your device.</Text>
        <PeriodPills values={['Light','System','Dark']} value={appearance} onChange={setAppearance} testID="settings-appear" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Budget Alerts</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Choose which thresholds trigger a warning per category.</Text>
        <Pressable onPress={() => setAlerts({ ...alerts, enabled: !alerts.enabled })} style={s.settingToggleRow} testID="settings-alerts">
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Enable alerts</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>Master switch</Text></View>
          <View style={[s.toggle, alerts.enabled && s.toggleOn]}><View style={[s.toggleKnob, alerts.enabled && { transform: [{ translateX: 14 }] }]} /></View>
        </Pressable>
        {alerts.enabled && (categories || []).map((c: any) => {
          // Category-level alert section — collapsible per spec #15 to keep
          // the interface clean. Expanded state is UI-only (not persisted).
          const expanded = (settingsAlertExpanded || {})[c.id];
          return (
            <View key={c.id} style={{ marginTop: 10 }}>
              <Pressable
                onPress={() => setSettingsAlertExpanded({ ...(settingsAlertExpanded || {}), [c.id]: !expanded })}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                testID={`alert-cat-toggle-${c.id}`}
              >
                <Text style={[{ flex: 1, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }]}>{c.name.toUpperCase()}</Text>
                <Text style={[{ fontSize: 9, color: C.muted3, marginRight: 6 }, t.textMuted]}>
                  {c.subcategories.length} item{c.subcategories.length === 1 ? '' : 's'}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.dark ? D.textMuted : '#9a938a'} />
              </Pressable>
              {expanded && c.subcategories.map((sub: any) => {
                // New-user defaults per spec #15: 50% OFF, 80% ON, 100%+ ON.
                // Existing per-sub prefs are preserved because the presence of
                // a record in `alerts.perCategory[sub.id]` short-circuits the
                // defaults.
                const conf = (alerts.perCategory && alerts.perCategory[sub.id]) || { p50: false, p80: true, exceeded: true };
                const toggle = (key: 'p50' | 'p80' | 'exceeded') => {
                  const next = { ...conf, [key]: !conf[key] };
                  setAlerts({ ...alerts, perCategory: { ...(alerts.perCategory || {}), [sub.id]: next } });
                };
                return (
                  <View key={sub.id} style={s.alertRow}>
                    <Text style={[{ flex: 1, fontSize: 10, fontWeight: '600' }, t.textInk]}>{sub.name}</Text>
                    {(['p50','p80','exceeded'] as const).map((k) => {
                      const label = k === 'p50' ? '50%' : k === 'p80' ? '80%' : '100%+';
                      return (
                        <Pressable key={k} onPress={() => toggle(k)} style={[s.alertPill, conf[k] && s.alertPillOn]} testID={`alert-${sub.id}-${k}`}>
                          <Text style={[s.alertPillText, conf[k] && { color: '#fff' }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          );
        })}
        {/* Single-expense alert (spec #16) — triggers when one transaction
            exceeds the configured amount. Refunds, transfers, credit-card
            payments, income deposits and matched moves are all excluded
            server-side before this compares against the threshold. */}
        {alerts.enabled && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.dark ? D.border : '#ece5d5' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="alert-circle-outline" size={14} color="#c49450" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '700' }, t.textInk]}>Alert on large single expense</Text>
              <Pressable
                onPress={() => setAlerts({ ...alerts, singleExpense: { ...(alerts.singleExpense || { threshold: 200 }), enabled: !(alerts.singleExpense?.enabled) } })}
                style={[s.toggle, alerts.singleExpense?.enabled && s.toggleOn]}
                testID="alert-single-toggle"
              >
                <View style={[s.toggleKnob, alerts.singleExpense?.enabled && { transform: [{ translateX: 14 }] }]} />
              </Pressable>
            </View>
            {alerts.singleExpense?.enabled && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <Text style={[{ fontSize: 10, fontWeight: '600' }, t.textMuted]}>Notify me when one expense exceeds</Text>
                <TextInput
                  keyboardType="numeric"
                  value={String(alerts.singleExpense?.threshold ?? 200)}
                  onChangeText={(v) => {
                    const cleaned = Math.max(0, Math.round(Number((v || '').replace(/[^0-9.]/g, '')) || 0));
                    setAlerts({ ...alerts, singleExpense: { ...(alerts.singleExpense || {}), enabled: true, threshold: cleaned } });
                  }}
                  style={{
                    borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5',
                    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
                    fontSize: 12, minWidth: 70, textAlign: 'right',
                    color: t.dark ? D.text : C.ink,
                  }}
                  placeholder="200"
                  placeholderTextColor={t.dark ? D.textMuted : C.muted}
                  testID="alert-single-threshold"
                />
                <Text style={[{ fontSize: 10 }, t.textMuted]}>USD</Text>
              </View>
            )}
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Transfers, refunds, credit-card payments, and income deposits never trigger this alert.
            </Text>
          </View>
        )}
        {/* Weekly Summary (Premium) — Sunday 6PM local. On-by-default; toggle
            hides only the Sunday recap push. Individual budget & large-txn
            alerts continue firing regardless. */}
        {alerts.enabled && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.dark ? D.border : '#ece5d5' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="calendar-outline" size={14} color="#c49450" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '700' }, t.textInk]}>Weekly summary (Sun 6PM)</Text>
              <Pressable
                onPress={() => setAlerts({ ...(alerts as any), weeklyDigest: !((alerts as any).weeklyDigest !== false) })}
                style={[s.toggle, (alerts as any).weeklyDigest !== false && s.toggleOn]}
                testID="alert-weekly-digest-toggle"
              >
                <View style={[s.toggleKnob, (alerts as any).weeklyDigest !== false && { transform: [{ translateX: 14 }] }]} />
              </Pressable>
            </View>
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Premium subscribers get a Sunday 6PM local recap: total spent this week vs last, top merchant, budget hits, and large-transaction count.
            </Text>
          </View>
        )}
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>App Lock</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Require a PIN{appLock?.biometricsAvailable ? ' or Face ID' : ''} on app launch.</Text>
        <Pressable onPress={() => setAppLock?.({ ...(appLock || {}), openConfigure: true })} style={s.settingToggleRow} testID="settings-applock">
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{appLock?.enabled ? 'Enabled' : 'Not set'}</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>{appLock?.enabled ? (appLock?.biometricsEnabled ? 'Face ID + PIN' : 'PIN only') : 'Tap to set a PIN'}</Text></View>
          <Ionicons name={appLock?.enabled ? 'lock-closed' : 'lock-open-outline'} size={18} color={appLock?.enabled ? '#8fa88f' : (t.dark ? D.textMuted : '#9a938a')} />
        </Pressable>
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Billing</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Payments and subscriptions are managed on our website.</Text>
        <BillingWebsiteNotice compact />
      </View>
      <View style={[s.settingsMenu, t.cardBg]}>
        {rows.map(([id, label, detail, icon]) => (
          <Pressable
            key={id}
            onPress={() => {
              // Terms and Privacy live on jaleter.com — open directly.
              if (id === 'terms') { openJaleter('terms'); return; }
              if (id === 'privacy') { openJaleter('privacy'); return; }
              setSheet(id);
            }}
            style={[s.settingsMenuBtn, t.dividerBorder]}
            testID={`settings-${id}`}
          >
            <View style={[s.settingsRowIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={icon} size={17} color={t.dark ? D.textMuted : '#8a7b65'} /></View>
            <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{label}</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>{detail}</Text></View>
            <Ionicons name={id === 'terms' || id === 'privacy' ? 'open-outline' : 'chevron-forward'} size={16} color={t.dark ? D.textMuted : '#b0aaa0'} />
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setConfirmReset(true)} style={[s.logoutBtn, { marginTop: 10, borderColor: '#b28a4c' }]} testID="settings-reset">
        <Ionicons name="refresh-outline" size={17} color="#b28a4c" />
        <Text style={{ color: '#b28a4c', fontSize: 12, fontWeight: '700' }}>Reset App Data</Text>
      </Pressable>
      <Pressable onPress={onLogout} style={s.logoutBtn} testID="settings-logout">
        <Ionicons name="log-out-outline" size={17} color={C.danger} />
        <Text style={{ color: C.danger, fontSize: 12, fontWeight: '700' }}>Log Out</Text>
      </Pressable>
      <Sheet visible={!!appLock?.openConfigure} close={() => setAppLock?.({ openConfigure: false })} title={appLock?.enabled ? 'Change App Lock' : 'Set up App Lock'} subtitle="Your PIN is stored securely on this device only.">
        <AppLockConfigure
          currentPin={appLock?.pin || ''}
          biometricsAvailable={!!appLock?.biometricsAvailable}
          biometricsEnabled={!!appLock?.biometricsEnabled}
          onSaved={async (next: any) => {
            const fresh = await loadAppLock();
            setAppLock?.({
              enabled: !!fresh.pin,
              pin: fresh.pin,
              biometricsEnabled: fresh.biometricsEnabled,
              biometricsAvailable: next.biometricsAvailable,
              openConfigure: false,
              locked: false,
            });
          }}
          close={() => setAppLock?.({ openConfigure: false })}
        />
      </Sheet>
      <ResetAppDataModal
        visible={confirmReset}
        isDark={t.dark}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => { setConfirmReset(false); await onResetAppData?.(); setToast('App data reset. Fresh start.'); }}
      />
      <LegalSheet visible={sheet === 'terms'} close={() => setSheet(null)} type="Terms of Use" />
      <LegalSheet visible={sheet === 'privacy'} close={() => setSheet(null)} type="Privacy Policy" />
      <NotificationsSheet visible={sheet === 'notifications'} close={() => setSheet(null)} onSave={(m: string) => { setSheet(null); setToast(m); }} />
      <AccountLinkSheet visible={sheet === 'accounts'} close={() => setSheet(null)} onConfirm={(accs: any[]) => { addLinked(accs); setSheet(null); setToast('Accounts connected and syncing.'); }} />
      <SupportSheet visible={sheet === 'support'} close={() => setSheet(null)} />
      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Bottom Nav ---------------- */
const navItems = [
  { id: 'home', label: 'Home', icon: 'home-outline' as const },
  { id: 'budget', label: 'Budget', icon: 'menu-outline' as const },
  { id: 'reports', label: 'Reports', icon: 'stats-chart-outline' as const },
  { id: 'transactions', label: 'Activity', icon: 'receipt-outline' as const },
  { id: 'networth', label: 'Wealth', icon: 'wallet-outline' as const },
  { id: 'legacy', label: 'Legacy', icon: 'trophy-outline' as const },
];
const BottomNav = ({ active, setActive, isDark }: any) => (
  <View style={[s.bottomNav, isDark && { backgroundColor: '#151411ed', borderTopColor: '#2c2924' }]}>
    {navItems.map(({ id, label, icon }) => {
      const isActive = active === id;
      const activeColor = isDark ? '#e7c58e' : C.ink2;
      const inactiveColor = isDark ? '#827c74' : '#918b83';
      return (
        <Pressable key={id} onPress={() => setActive(id)} style={s.navBtn} testID={`nav-${id}`}>
          {isActive && <View style={[s.navIndicator, isDark && { backgroundColor: '#dfb46e' }]} />}
          <Ionicons name={icon} size={19} color={isActive ? activeColor : inactiveColor} />
          <Text style={[s.navLabel, { color: isActive ? activeColor : inactiveColor }]}>{label}</Text>
        </Pressable>
      );
    })}
  </View>
);

/* ---------------- Extra Sheets ---------------- */
const LegalSheet = ({ visible, close, type }: any) => (
  <Sheet visible={visible} close={close} title={type} subtitle="Last updated July 15, 2026">
    {type === 'Privacy Policy' ? (
      <View>
        <Text style={s.privacyPara}>Jaleter never touches your bank credentials. You download statements from your bank and upload them into Jaleter — your login stays only with your bank.</Text>
        <Text style={s.privacyPara}>We do not sell financial data. You control linked accounts and can disconnect them at any time.</Text>
        <Text style={s.privacyPara}>Manual entries and preferences are used only to provide requested features.</Text>
      </View>
    ) : (
      <View>
        <Text style={s.privacyPara}>Jaleter provides budgeting and planning tools for educational purposes. It does not provide investment, tax, or legal advice.</Text>
        <Text style={s.privacyPara}>Premium membership is $90 per year. Coaching is a separate $75 per session service. Renewal and cancellation details are shown before checkout.</Text>
        <Text style={s.privacyPara}>Projections are estimates and are not guarantees of future performance.</Text>
      </View>
    )}
    <View style={{ marginTop: 14 }}><GoldButton label="Close" onPress={close} testID="legal-close" /></View>
  </Sheet>
);
const NotificationsSheet = ({ visible, close, onSave }: any) => {
  // Coaching Alerts removed intentionally — the setting was surfaced in the
  // Notifications sheet but never wired to actual delivery, so it was confusing.
  const labels: Record<string, string> = { daily: 'Daily check-in', weekly: 'Weekly summary', streak: 'Streak reminders', transactions: 'Large transactions' };
  const [n, setN] = useState({ daily: true, weekly: true, streak: true, transactions: true });
  return (
    <Sheet visible={visible} close={close} title="Notification Details" subtitle="Choose exactly what reaches you.">
      {Object.entries(n).map(([id, v]) => (
        <Pressable key={id} testID={`notif-${id}`} onPress={() => setN(x => ({ ...x, [id]: !x[id as keyof typeof x] }))} style={s.settingToggleRow}>
          <Text style={{ fontSize: 12, fontWeight: '700', flex: 1 }}>{labels[id]}</Text>
          <View style={[s.toggle, v && s.toggleOn]}><View style={[s.toggleKnob, v && { transform: [{ translateX: 14 }] }]} /></View>
        </Pressable>
      ))}
      <View style={{ marginTop: 14 }}><GoldButton label="Save preferences" onPress={() => onSave('Notification preferences saved.')} testID="notif-save" /></View>
    </Sheet>
  );
};


const AccountLinkSheet = ({ visible, close, onConfirm }: any) => {
  const { token } = useAuth();
  const [mode, setMode] = useState<'menu' | 'file' | 'request' | 'guides'>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [institution, setInstitution] = useState('');
  const [notes, setNotes] = useState('');
  const [existing, setExisting] = useState<any[] | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const refresh = async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/accounts/all', { method: 'GET' }, token);
      setExisting(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch { setExisting([]); }
  };
  useEffect(() => { if (visible) { setMode('menu'); setError(''); setMessage(''); setInstitution(''); setNotes(''); setBusy(false); refresh(); } }, [visible]);
  const syncOne = async (link_id: string, provider?: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const path = provider === 'plaid'
        ? `/api/plaid/sync?item_id=${encodeURIComponent(link_id)}`
        : `/api/accounts/link/${link_id}/sync`;
      const data = await apiCall(path, { method: 'POST' }, token);
      setMessage(`Refreshed. ${data?.synced ?? 0} new transactions.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'Sync failed.'); }
    finally { setSyncingId(null); }
  };
  const unlink = async (link_id: string, provider: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const path = provider === 'plaid'
        ? `/api/plaid/item/${encodeURIComponent(link_id)}`
        : `/api/accounts/link/${link_id}`;
      await apiCall(path, { method: 'DELETE' }, token);
      setMessage('Account removed.');
      await refresh();
      onConfirm([]);
    } catch (e: any) { setError(e?.message || 'Unlink failed.'); }
    finally { setSyncingId(null); }
  };
  const submitFile = async () => pickAndImport(token, async (msg) => { setMessage(msg); await refresh(); onConfirm([]); setMode('menu'); }, (err) => setError(err), setBusy);
  const submitRequest = async () => {
    if (!institution.trim()) { setError('Enter an institution name.'); return; }
    setError(''); setBusy(true);
    try {
      await apiCall('/api/support/requests', { method: 'POST', body: JSON.stringify({ institution: institution.trim(), notes: notes.trim() }) }, token);
      setMessage(`Thanks — we've logged your request for ${institution.trim()}.`);
      setInstitution(''); setNotes('');
    } catch (e: any) { setError(e?.message || 'Could not send request.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} close={close} title={mode === 'menu' ? 'Linked accounts' : mode === 'file' ? 'Import statement' : mode === 'guides' ? 'How to download from your bank' : 'Request an institution'} subtitle={mode === 'menu' ? 'Refresh, remove, or add a new account.' : ''}>
      {mode === 'menu' && (
        <View style={{ gap: 10 }}>
          {existing && existing.length > 0 && (
            <View style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: C.muted, letterSpacing: 1.2, marginBottom: 6 }}>YOUR ACCOUNTS ({existing.length})</Text>
              {existing.map((row: any, i: number) => {
                const key = row.link_id || `${row.provider}-${i}`;
                const isSyncing = syncingId === row.link_id;
                const canSync = (row.provider === 'simplefin' || row.provider === 'plaid') && !!row.link_id;
                return (
                  <View key={key} style={s.linkedRow}>
                    <View style={s.linkedIcon}><Ionicons name={row.provider === 'file' ? 'document-attach-outline' : row.provider === 'snaptrade' ? 'trending-up' : row.provider === 'plaid' ? 'business-outline' : 'card-outline'} size={16} color={C.goldEyebrow} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: C.ink }}>{row.name || row.account_name || 'Account'}</Text>
                      <Text style={{ fontSize: 8, color: C.muted2 }}>{row.org_name || (row.provider === 'file' ? 'Imported' : row.provider === 'snaptrade' ? 'SnapTrade' : row.provider === 'plaid' ? 'Plaid' : 'Linked')}{row.balance !== undefined ? ` · ${MONEY(row.balance)}` : ''}</Text>
                      {row.error ? <Text style={{ fontSize: 8, color: C.danger }}>{row.error}</Text> : null}
                    </View>
                    {canSync && (
                      <Pressable testID={`link-sync-${row.link_id}`} onPress={() => syncOne(row.link_id, row.provider)} disabled={isSyncing} style={s.linkedBtn}>
                        <Ionicons name={isSyncing ? 'hourglass-outline' : 'refresh-outline'} size={16} color={C.ink3} />
                      </Pressable>
                    )}
                    {row.link_id && (
                      <Pressable testID={`link-remove-${row.link_id}`} onPress={() => unlink(row.link_id, row.provider)} disabled={isSyncing} style={s.linkedBtn}>
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {message ? <Text testID="link-message" style={{ color: C.green, fontSize: 11, marginTop: 6 }}>{message}</Text> : null}
              {error ? <Text testID="link-error" style={s.formError}>{error}</Text> : null}
            </View>
          )}
          <Text style={{ fontSize: 9, fontWeight: '700', color: C.muted, letterSpacing: 1.2, marginTop: 4 }}>ADD AN ACCOUNT</Text>
          <ConnectPlaidButton
            token={token}
            testID="plaid-connect"
            onLinked={async (name: string) => {
              setMessage(`Connected ${name}. Refreshing…`);
              // Kick off a sync so transactions land in bank_transactions immediately.
              try { await apiCall('/api/plaid/sync', { method: 'POST' }, token); } catch { /* silent */ }
              await refresh();
              onConfirm([]);
            }}
          />
          {[
            { id: 'file', icon: 'cloud-upload-outline' as const, label: 'Import statement (recommended)', sub: 'Upload CSV, OFX, QFX, or QBO from any bank.' },
            { id: 'guides', icon: 'library-outline' as const, label: 'How to download from your bank', sub: 'Step-by-step guides for 10+ major banks.' },
            { id: 'request', icon: 'help-circle-outline' as const, label: 'Request an unsupported institution', sub: 'Tell us who to add next.' },
          ].map((row) => (
            <Pressable key={row.id} testID={`link-mode-${row.id}`} onPress={() => setMode(row.id as any)} style={s.moreGridBtn}>
              <View style={s.moreGridIcon}><Ionicons name={row.icon} size={20} color={C.goldEyebrow} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700' }}>{row.label}</Text>
                <Text style={{ fontSize: 9, color: C.muted2 }}>{row.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
            </Pressable>
          ))}
        </View>
      )}
      {mode === 'file' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 12, lineHeight: 16 }}>
            Download a statement from your bank (CSV, OFX, QFX, or QBO), then upload it here. Jaleter detects columns, dedupes transactions, and updates your budget automatically. Need help? Tap {'"How to download from your bank"'} for step-by-step guides.
          </Text>
          {error ? <Text testID="import-error" style={s.formError}>{error}</Text> : null}
          {message ? <Text style={{ color: C.green, fontSize: 11 }}>{message}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Uploading…' : 'Choose file'} onPress={submitFile} disabled={busy} testID="import-choose" />
          </View>
        </View>
      )}
      {mode === 'guides' && (
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 14, lineHeight: 16 }}>
            Each bank offers a way to export transactions to CSV or OFX. Log in on any browser, follow the steps, then come back to Jaleter and tap {'"Import statement"'}.
          </Text>
          {BANK_IMPORT_GUIDES.map((g) => (
            <View key={g.name} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e8dcc4', marginBottom: 8, backgroundColor: '#fbf6ec' }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.ink, marginBottom: 6 }}>{g.name}</Text>
              {g.steps.map((step, i) => (
                <Text key={i} style={{ fontSize: 10, color: '#615b52', marginBottom: 3, lineHeight: 15 }}>
                  {i + 1}.  {step}
                </Text>
              ))}
              <Text style={{ fontSize: 9, color: C.muted3, marginTop: 6, fontStyle: 'italic' }}>Format: {g.format}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 10, color: C.muted3, marginTop: 6, lineHeight: 15 }}>
            Don&apos;t see your bank?  Almost every US bank offers a {'"Download / Export"'} option under Transactions or Statements. If you can&apos;t find it, use the {'"Request an institution"'} option and we&apos;ll help.
          </Text>
        </ScrollView>
      )}
      {mode === 'request' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 8 }}>Tell us which bank / credit union / brokerage you&apos;d like Jaleter to support.</Text>
          <TextInput testID="request-institution" style={s.input} value={institution} onChangeText={setInstitution} placeholder="e.g. Chime, PenFed, Robinhood" />
          <TextInput testID="request-notes" style={[s.input, { minHeight: 80, marginTop: 8 }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything else we should know? (optional)" />
          {error ? <Text testID="request-error" style={s.formError}>{error}</Text> : null}
          {message ? <Text style={{ color: C.green, fontSize: 11, marginTop: 8 }}>{message}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Sending…' : 'Send request'} onPress={submitRequest} disabled={busy || !institution.trim()} testID="request-submit" />
          </View>
        </View>
      )}
      {mode !== 'menu' && (
        <Pressable testID="link-back-to-menu" onPress={() => { setMode('menu'); setError(''); setMessage(''); }} style={{ alignItems: 'center', marginTop: 14 }}>
          <Text style={{ fontSize: 11, color: C.goldEyebrow, fontWeight: '600' }}>← Back to add-account menu</Text>
        </Pressable>
      )}
    </Sheet>
  );
};

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
  useEffect(() => {
    (async () => {
      const l = await loadAppLock();
      setAppLock({ enabled: !!l.pin, pin: l.pin, biometricsEnabled: l.biometricsEnabled, biometricsAvailable: l.biometricsAvailable, locked: !!l.pin });
    })();
  }, []);
  const [stage, setStage] = useState<'welcome'|'onboarding'|'signup'|'login'|'forgot'|'reset'|'connect'|'paywall'|'app'>('welcome');
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
  }>({ enabled: true, threshold: 80, perCategory: {}, singleExpense: { enabled: false, threshold: 200 }, weeklyDigest: true });
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

  // When Login/Google flow completes, jump straight to the app.
  // Signup flow stays on 'connect'/'paywall' cosmetic screens (handled by onCreated).
  useEffect(() => {
    if (auth.user && (stage === 'login' || stage === 'welcome')) setStage('app');
    if (!auth.user && stage === 'app') setStage('welcome');
  }, [auth.user]);

  // On web, when Stripe redirects back with ?checkout=success&session_id=..., poll and show toast.
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
            const label = status?.product === 'jaleter_premium' ? 'Membership activated.' : 'Session confirmed.';
            setGlobalToast(label);
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
    const list = (transactions as any[]) || [];
    for (const tx of list) {
      if (!tx?.id) continue;
      if (seenTxIdsRef.current.has(tx.id)) continue;
      seenTxIdsRef.current.add(tx.id);
      if (tx.type !== 'expense') continue;
      if (tx.is_transfer) continue;
      if (tx.system_category === 'transfer') continue;
      const amt = Math.abs(Number(tx.amount || 0));
      if (amt <= threshold) continue;
      evaluateTransaction(auth.token!, {
        id: String(tx.id),
        amount: amt,
        name: tx.name,
        merchant_name: tx.merchant_name || tx.name,
        account_name: tx.account_name,
      }).catch(() => {});
    }
  }, [auth.token, alertsSynced, alerts.enabled, alerts.singleExpense?.enabled, alerts.singleExpense?.threshold, transactions]);
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

  const income = transactions.filter(t => t.type === 'income' && !isSystemTransaction(t)).reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense' && !isSystemTransaction(t)).reduce((sum, t) => sum + t.amount, 0);
  const openingCash = 0;
  const syncedCash = openingCash + income - expense;
  const syncedAssets = assets.map(x => x.id === 'cash' ? { ...x, value: syncedCash } : x);
  const manualAssetsTotal = syncedAssets.reduce((sum, x) => sum + x.value, 0);
  const manualLiabilitiesTotal = liabilities.reduce((sum: number, x: Asset) => sum + (x.value || 0), 0);
  const manualInvestments = syncedAssets.find((x: any) => x.id === 'investments')?.value || 0;
  const investmentTotal = manualInvestments + linkedInvestmentTotal;
  const totalCash = syncedCash + linkedCashTotal; // Cash-only linked accounts, per spec #2
  // ---- Single source of truth: Net Worth ------------------------------------
  // Sum unique linked accounts (already de-duped by account_id) + manual rows
  // exactly once. Category totals are used for aggregation ONLY — we never
  // double-count a per-account row plus its aggregated header (this was the
  // bug that produced Home $269K vs Wealth $563K).
  const canonicalTotalAssets = React.useMemo(() => {
    // Manual seeds: Cash + Investments seed values + all manual "other" rows.
    const manualSeedCash = syncedCash; // synced from transactions + opening
    const manualSeedInvest = manualInvestments; // manual investments seed
    const manualOtherRows = syncedAssets.filter((x: Asset) => x.id !== 'cash' && x.id !== 'investments');
    const manualOtherTotal = manualOtherRows.reduce((s: number, r: Asset) => s + (r.value || 0), 0);
    return (
      manualSeedCash + manualSeedInvest + manualOtherTotal +
      linkedCashTotal + linkedInvestmentTotal +
      linkedRealEstateTotal + linkedVehiclesTotal + linkedOtherAssetsTotal
    );
  }, [syncedCash, manualInvestments, syncedAssets, linkedCashTotal, linkedInvestmentTotal, linkedRealEstateTotal, linkedVehiclesTotal, linkedOtherAssetsTotal]);
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
  const legacyPerMonthNet = React.useCallback((totalMonths: number) => {
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
  // Human-readable source period for the Legacy → Monthly Surplus drill-down.
  // Uses the currently-selected budget year + the real calendar month so the
  // label reads e.g. "August 2026 budget".
  const monthlyBudgetPeriod = React.useMemo(() => {
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    return `${monthName} ${budgetYear} budget`;
  }, [budgetYear]);
  const budgetUsage = monthlyBudget > 0 ? (expense / monthlyBudget) * 100 : 0;
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

  const bg = isDark ? D.bg : C.cream;
  const displayName = (auth.user?.name || 'Friend').split(' ')[0];
  const displayInitials = initialsOf(auth.user?.name, auth.user?.email);

  return (
    <ThemeCtx.Provider value={{ dark: isDark }}>
    <SafeAreaView style={[s.appShell, { backgroundColor: bg }]} testID="app-shell">
      <RNStatusBar barStyle={stage === 'welcome' || isDark ? 'light-content' : 'dark-content'} />
      {!auth.user && stage === 'welcome' && <Welcome onStart={() => setStage('onboarding')} onLogin={() => setStage('login')} />}
      {!auth.user && stage === 'onboarding' && <Onboarding experience={experience} setExperience={setExperience} onContinue={() => setStage('signup')} back={() => setStage('welcome')} />}
      {!auth.user && stage === 'signup' && <Signup back={() => setStage('onboarding')} onCreated={() => setStage('connect')} goLogin={() => setStage('login')} />}
      {!auth.user && stage === 'login' && <Login back={() => setStage('welcome')} goSignup={() => setStage('signup')} goForgot={() => setStage('forgot')} />}
      {!auth.user && stage === 'forgot' && <ForgotPassword back={() => setStage('login')} onSent={(email: string, token: string | null) => { setResetInfo({ email, token }); setStage('reset'); }} />}
      {!auth.user && stage === 'reset' && <ResetPassword back={() => setStage('login')} email={resetInfo.email} prefilledToken={resetInfo.token} onDone={() => { setResetInfo({ email: '', token: null }); setStage('app'); }} />}
      {auth.user && stage === 'connect' && <FirstConnect onConnect={(data: any) => { setLinkedAccounts(data?.accounts || []); setStage('paywall'); }} onSkip={() => setStage('paywall')} />}
      {auth.user && stage === 'paywall' && <Paywall onContinue={() => setStage('app')} />}
      {auth.user && stage === 'app' && appLock.enabled && appLock.locked && (
        <AppLockGate
          storedPin={appLock.pin}
          biometricsEnabled={appLock.biometricsEnabled}
          biometricsAvailable={appLock.biometricsAvailable}
          onUnlock={() => setAppLock((a) => ({ ...a, locked: false }))}
        />
      )}
      {auth.user && stage === 'app' && !(appLock.enabled && appLock.locked) && (
        <View style={[{ flex: 1 }, isDark && { backgroundColor: D.bg }]}>
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
          {active === 'transactions' && <TransactionsScreen transactions={mergedTransactions} setTransactions={setTransactions} categories={categories} incomeSources={incomeSources} alerts={alerts} openLinkSheet={() => { setActive('settings'); }} onRefresh={refreshAccounts} />}
          {active === 'networth' && <NetWorthScreen assets={syncedAssets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} transactions={transactions} restrictedBuckets={restrictedBuckets} setRestrictedBuckets={setRestrictedBuckets} linkedRowsByCategory={linkedRowsByCategory} linkedByCategory={linkedByCategory} onRefreshAccounts={refreshAccounts} canonicalTotalAssets={totalAssets} canonicalTotalLiabilities={totalLiabilities} canonicalNetWorth={netWorth} financialsReady={financialsReady} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={validLinked.length} onBack={() => setActive('home')} />}
          {active === 'legacy' && <LegacyScreen investmentTotal={investmentTotal} totalCash={totalCash} availableCash={availableCash} totalRestricted={totalRestricted} monthlyNet={monthlyNet} monthlyBudgetIncome={monthlyBudgetIncome} monthlyBudgetExpense={monthlyBudgetExpense} monthlyBudgetPeriod={monthlyBudgetPeriod} perMonthNet={legacyPerMonthNet} financialsReady={financialsReady} timeframe={legacyTimeframe} setTimeframe={setLegacyTimeframe} contribution={legacyContribution} setContribution={setLegacyContribution} hypothetical={legacyHypothetical} setHypothetical={setLegacyHypothetical} hypoFrequency={legacyHypoFrequency} setHypoFrequency={setLegacyHypoFrequency} hypoDuration={legacyHypoDuration} setHypoDuration={setLegacyHypoDuration} returnRate={legacyReturnRate} setReturnRate={setLegacyReturnRate} cumulative={legacyCumulative} setCumulative={setLegacyCumulative} currentAge={currentAge} setCurrentAge={setCurrentAge} retirementAge={retirementAge} setRetirementAge={setRetirementAge} />}
          {active === 'reports' && <ReportsScreen transactions={transactions} categories={categories} incomeSources={incomeSources} back={() => nav('home')} />}
          {active === 'coaching' && <CoachingScreen back={() => nav('more')} />}
          {active === 'membership' && <MembershipScreen back={() => nav('more')} />}
          {active === 'settings' && <SettingsScreen initials={displayInitials} experience={experience} setExperience={setExperience} appearance={appearance} setAppearance={setAppearance} alerts={alerts} setAlerts={setAlerts} categories={categories} appLock={appLock} setAppLock={(next: any) => setAppLock({ ...appLock, ...next })} onLogout={async () => { await auth.logout(); setActive('home'); setStage('welcome'); }} back={() => nav('more')} linkedAccounts={linkedAccounts} linkedAccountCount={validLinked.length} addLinked={(a: any[]) => { setLinkedAccounts([...linkedAccounts, ...a]); refreshAccounts(); }} onResetAppData={async () => {
            // Spec #18 — Reset App Data behavior confirmed by the user:
            // KEEP Plaid connections, CLEAR synced data. Every locally-cached
            // financial artefact goes; Plaid items in the backend stay so
            // balances + transactions resync on the next `/accounts/all` call.
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
