import React, { useState, useMemo, useEffect, useCallback, createContext, useContext } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Modal, StatusBar as RNStatusBar, Platform, Linking, Dimensions, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import * as LocalAuthentication from 'expo-local-authentication';
import * as AppleAuthentication from 'expo-apple-authentication';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';
import { storage } from '@/src/utils/storage';
import { AuthProvider, useAuth, apiCall } from '@/src/AuthContext';
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
import { ReclassifySheet } from '@/src/components/ReclassifySheet';
import { CoachAIScreen } from '@/src/screens/CoachAIScreen';

const STORAGE_KEY = 'jaleter-state-v2';
// One-time migration: any legacy v1 cache (which was seeded with mock $ figures) must be discarded.
const LEGACY_STORAGE_KEYS = ['jaleter-state-v1'];

// Dark theme context
const ThemeCtx = createContext<{ dark: boolean }>({ dark: false });
const useDark = () => useContext(ThemeCtx).dark;

// Themed style helper: overlays dark palette on light styles when in dark mode.
const useThemed = () => {
  const dark = useDark();
  return {
    dark,
    pageBg: dark ? { backgroundColor: D.bg } : null,
    cardBg: dark ? { backgroundColor: D.surface, borderColor: D.border } : null,
    darkCard: dark ? { backgroundColor: D.surfaceAlt, borderColor: D.border } : null,
    textInk: dark ? { color: D.text } : null,
    textMuted: dark ? { color: D.textMuted } : null,
    textSubtle: dark ? { color: D.textSubtle } : null,
    inputBg: dark ? { backgroundColor: D.surfaceAlt, borderColor: D.border, color: D.text } : null,
    circleBg: dark ? { backgroundColor: D.surface } : null,
    pillBg: dark ? { backgroundColor: '#242220', borderColor: D.border } : null,
    pillSelectedBg: dark ? { backgroundColor: D.surfaceAlt } : null,
    dividerBg: dark ? { backgroundColor: D.border } : null,
    dividerBorder: dark ? { borderColor: D.border } : null,
  };
};

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
type Split = { groupId: string; detailId?: string; amount: number };
type Tx = {
  id: string;
  date: string;
  name: string;
  amount: number;
  // Type of transaction. `transfer` is a first-class type: an internal
  // movement between the user's own accounts. Transfers never affect income
  // or expense totals or net worth. Credit-card payments are automatically
  // classified as transfers by the Plaid mapper.
  type: 'income' | 'expense' | 'transfer';
  groupId: string;
  detailId?: string;
  origin: string;
  period: string;
  // System classification set by the backend Plaid classifier — retained so
  // reclassify sheets can surface the auto-detected value.
  system_category?: string | null;
  is_transfer?: boolean;
  external_id?: string;
  // Merchant name — canonical retailer name (e.g. "Costco Wholesale") used
  // for grouping in Reports. Distinct from `name` which is the description.
  merchant?: string;
  // Split allocation — when populated, this transaction contributes to
  // MULTIPLE budget categories. Sum of splits.amount should equal `amount`.
  // If splits is empty/absent, the transaction uses top-level groupId/detailId.
  splits?: Split[];
  // Optional counterparty account references — only meaningful for `type: 'transfer'`.
  transfer_from_account_id?: string;
  transfer_to_account_id?: string;
};

// Phase-3 helper — a transaction that represents a self-move (transfer,
// credit-card payment, or loan-principal payment) should NEVER inflate
// Budget actuals or Income/Expense totals. `system_category` is set by
// the backend (Plaid PFC + description matching) and mirrored onto every
// row surfaced to the app.
const isSystemTransaction = (t: any): boolean => {
  // Also treat top-level `type: 'transfer'` as system-excluded so manual
  // transfers created by the user (no Plaid system_category) are still
  // excluded from Budget actuals, Reports totals, and AI cash-flow.
  if (t?.type === 'transfer') return true;
  const sc = (t?.system_category || '').toString().toLowerCase();
  return sc === 'transfer' || sc === 'credit_card_payment' || sc === 'loan_payment';
};
const initialTx: Tx[] = [];

type Asset = { id: string; name: string; value: number; source: string; icon: string; };
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
const GoldButton = ({ label, onPress, disabled, testID }: any) => (
  <Pressable testID={testID} disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.45 : 1 }}>
    <LinearGradient colors={['#f2c779', '#ffe3a8', '#d09a4d']} start={{x:0,y:0}} end={{x:1,y:0}} style={s.goldBtn}>
      <Text style={s.goldBtnText}>{label}</Text>
    </LinearGradient>
  </Pressable>
);
const CircleBtn = ({ children, onPress, testID, dark }: any) => {
  const t = useThemed();
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.circleBtn, dark && { backgroundColor: '#24221e' }, t.circleBg]}>{children}</Pressable>
  );
};
const PeriodPills = ({ values, value, onChange, testID }: any) => {
  const t = useThemed();
  // Short lists keep their original stretched (`flex:1`) layout so touch
  // targets stay large. Longer lists (Legacy's 8 timeframes, Budget's
  // Jan-Dec+Year) horizontally scroll with content-hugging widths so long
  // labels like "Retirement" and "September" aren't clipped.
  const scrollable = values.length > 5;
  if (!scrollable) {
    return (
      <View style={[s.segmented, t.pillBg]} testID={testID}>
        {values.map((v: string) => (
          <Pressable key={v} testID={`${testID}-${v}`} onPress={() => onChange(v)} style={[s.pill, value === v && s.pillSelected, value === v && t.pillSelectedBg]}>
            <Text style={[s.pillText, t.textMuted, value === v && s.pillTextSelected, value === v && t.textInk]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingRight: 4 }}
      style={{ marginTop: 12 }}
    >
      <View style={[s.segmented, t.pillBg, { marginTop: 0, alignSelf: 'flex-start' }]} testID={testID}>
        {values.map((v: string) => (
          <Pressable
            key={v}
            testID={`${testID}-${v}`}
            onPress={() => onChange(v)}
            style={[s.pill, { flex: 0, paddingHorizontal: 14, minWidth: 64 }, value === v && s.pillSelected, value === v && t.pillSelectedBg]}
          >
            <Text style={[s.pillText, t.textMuted, value === v && s.pillTextSelected, value === v && t.textInk]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
};
const PageHeader = ({ title, subtitle, back, action }: any) => {
  const t = useThemed();
  return (
    <View style={s.pageHeader}>
      <View style={s.headerActions}>
        {back ? <CircleBtn onPress={back} testID="header-back"><Ionicons name="arrow-back" size={20} color={t.dark ? D.text : C.ink3} /></CircleBtn> : <View style={{width:38}} />}
        {action || <View style={{width:38}} />}
      </View>
      <Text style={[s.pageTitle, t.textInk]}>{title}</Text>
      {subtitle ? <Text style={[s.pageSubtitle, t.textSubtle]}>{subtitle}</Text> : null}
    </View>
  );
};
const Sheet = ({ visible, close, title, subtitle, children }: any) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <View style={s.modalBackdrop}>
      <Pressable style={{flex:1}} onPress={close} />
      <View style={s.modalSheet}>
        <Pressable testID="modal-close" onPress={close} style={s.modalClose}><Ionicons name="close" size={20} color={C.ink} /></Pressable>
        <Text style={s.sheetTitle}>{title}</Text>
        {subtitle ? <Text style={s.sheetSubtitle}>{subtitle}</Text> : null}
        <ScrollView style={{maxHeight:520}}>{children}</ScrollView>
      </View>
    </View>
  </Modal>
);
const Toast = ({ message, onHide }: any) => {
  useEffect(() => { const t = setTimeout(onHide, 2800); return () => clearTimeout(t); }, [onHide]);
  return (
    <View style={s.toast}>
      <Ionicons name="checkmark" size={16} color={C.goldGlow} />
      <Text style={s.toastText}>{message}</Text>
      <Pressable onPress={onHide}><Ionicons name="close" size={14} color="#bdb6ac" /></Pressable>
    </View>
  );
};
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

      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
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

const HomeScreen = ({ name, initials, experience, netWorth, investmentTotal, totalCash, monthlyNet, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyReturnRate, budgetUsage, alertsEnabled, navigate }: any) => {
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
  // Cash checkpoints — cash only, no investment growth.
  const cashY1 = shortTermCash(totalCash || 0, monthlyNet || 0, 1, hypoAt(1).addToCash);
  const cashY5 = shortTermCash(totalCash || 0, monthlyNet || 0, 5, hypoAt(5).addToCash);
  const cashY10 = shortTermCash(totalCash || 0, monthlyNet || 0, 10, hypoAt(10).addToCash);
  // Investment checkpoints — compound at chosen rate, monthly contribution stream applied.
  const invest10 = longTermInvestment(investmentTotal || 0, hypoAt(10).addToPrincipal, (legacyContribution || 0) + hypoAt(10).addToMonthlyContrib, 10, rate);
  const invest20 = longTermInvestment(investmentTotal || 0, hypoAt(20).addToPrincipal, (legacyContribution || 0) + hypoAt(20).addToMonthlyContrib, 20, rate);
  const invest30 = longTermInvestment(investmentTotal || 0, hypoAt(30).addToPrincipal, (legacyContribution || 0) + hypoAt(30).addToMonthlyContrib, 30, rate);
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
          <Text style={[s.snapshotValue, t.textInk]}>{Math.round(budgetUsage)}%</Text>
          <View style={s.miniProgress}><View style={[s.miniProgressBar, { width: `${Math.min(budgetUsage, 100)}%` }]} /></View>
          <Text style={[s.snapshotMeta, t.textMuted]}>used this month</Text>
        </Pressable>
        <Pressable style={[s.snapshotCard, s.snapshotDark]} onPress={() => navigate('networth')} testID="home-networth-card">
          <Text style={[s.snapshotLabel, { color: '#c4bdb2' }]}>Net Worth</Text>
          <Text style={[s.snapshotValue, { color: '#fff' }]}>{MONEY(netWorth)}</Text>
          <View style={{ flexDirection: 'row', gap: 3, marginTop: 8, alignItems: 'center' }}>
            <Ionicons name="wallet-outline" size={12} color={C.greenSoft} />
            <Text style={{ color: C.greenSoft, fontSize: 9 }}>Assets − Liabilities</Text>
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
        {hasProjection ? (
          <>
            <Text style={s.legacyStrong}>{MONEY(projected)}</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 14 }}>
              33-year compounding of your current investments at {rate}%.
            </Text>
            <View style={s.teaserBarsFlow}>
              {[28, 36, 44, 57, 70, 88].map((h, i) => (
                <LinearGradient key={i} colors={['#e5c38b', '#7d5b31']} style={[s.teaserBarFlow, { height: h }]} />
              ))}
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

      {/* Legacy Snapshot — mirrors the exact same numbers as the Legacy tab so
          Home and Legacy never disagree. Cash and Investments are now shown
          on separate rows with clear labels so users understand that cash
          does not compound at 7% — only investments do. */}
      {showSnapshot && (
        <Pressable style={[s.assumptionsCard, t.cardBg, { marginTop: 12 }]} onPress={() => navigate('legacy')} testID="home-legacy-snapshot">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, t.textInk]}>LEGACY SNAPSHOT</Text>
            <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#aaa39a'} />
          </View>
          <Text style={[{ fontSize: 9, marginBottom: 6 }, t.textMuted]}>
            Cash grows from your monthly surplus only. Investments compound at {rate}%.
          </Text>
          {/* Cash row — no growth applied, just surplus × time */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 4 }}>CASH · GROWS FROM SURPLUS</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: 'Y1', v: cashY1 },
              { label: 'Y5', v: cashY5 },
              { label: 'Y10', v: cashY10 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 11, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{MONEY(row.v)}</Text>
              </View>
            ))}
          </View>
          {/* Investments row — compounds at chosen rate */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 10 }}>INVESTMENTS · COMPOUND @ {rate}%</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: 'Y10', v: invest10 },
              { label: 'Y20', v: invest20 },
              { label: 'Y30', v: invest30 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{MONEY(row.v)}</Text>
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
const BudgetScreen = ({ categories, setCategories, categoriesByYear, incomeSources, setIncomeSources, transactions, setTransactions, focusCategory, clearFocus, alerts, budgetYear, onSwitchYear, onCopyLastYear }: any) => {
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

  const relevant = transactions.filter((t: Tx) => (annual || t.period === period) && !isSystemTransaction(t));
  const actualIncome = relevant.filter((t: Tx) => t.type === 'income').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const actualExpenses = relevant.filter((t: Tx) => t.type === 'expense').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
  // Total planned expenses across every category / subcategory for the
  // currently-selected month (or the whole year when in Year view). This is
  // the "Budgeted Expenses" number surfaced on the summary card (spec #14).
  const plannedExpenses = categories.reduce((sum: number, c: Category) => {
    return sum + c.subcategories.reduce((cs: number, sub: Subcategory) => cs + (annual ? annualAmount(sub) : monthlyAmount(sub, mIdx)), 0);
  }, 0);
  const budgetedRemaining = plannedIncome - plannedExpenses;
  const actualRemaining = actualIncome - actualExpenses;
  const spentInSub = (subId: string) => relevant.filter((tx: Tx) => tx.type === 'expense' && tx.detailId === subId).reduce((s: number, tx: Tx) => s + tx.amount, 0);
  const spentInGroup = (gId: string) => relevant.filter((tx: Tx) => tx.type === 'expense' && (tx.groupId === gId)).reduce((s: number, tx: Tx) => s + tx.amount, 0);
  const budgetFor = (sub: Subcategory) => annual ? annualAmount(sub) : monthlyAmount(sub, mIdx);
  const groupTotal = (c: Category) => c.subcategories.reduce((s: number, x: Subcategory) => s + budgetFor(x), 0);

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
        // Setting for a specific month → override that month only.
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
      </View>
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
                {incomeSources.map((src: any) => {
                  const rec = relevant.filter((tx: Tx) => tx.type === 'income' && tx.groupId === src.id).reduce((sum: number, tx: Tx) => sum + tx.amount, 0);
                  const target = src.budgeted * (annual ? 12 : 1);
                  return (
                    <Pressable
                      key={src.id}
                      onPress={() => { setEditingEarn(src); setDraft(src.budgeted ? String(src.budgeted) : ''); }}
                      style={s.subcategoryRow}
                      testID={`budget-earn-${src.id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{src.name}</Text>
                        <Text style={{ fontSize: 8, color: C.muted2 }}>received / expected</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{MONEY(rec)} <Text style={{ color: '#c1b9ac', fontWeight: '400' }}>/ {MONEY(target)}</Text></Text>
                        <Text style={{ fontSize: 8, color: src.budgeted > 0 ? C.muted2 : '#c9a56c' }}>{src.budgeted > 0 ? '' : 'tap to set'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#c1b9ac'} />
                    </Pressable>
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
                        const overridden = !annual && sub.months && sub.months[mIdx] !== undefined;
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
                                  <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{sub.name}{overridden ? ' •' : ''}</Text>
                                </View>
                                {alertColor && (
                                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, backgroundColor: alertColor + '22', borderWidth: 1, borderColor: alertColor }}>
                                    <Text style={{ color: alertColor, fontSize: 8, fontWeight: '800' }}>{alertLevel === 'exceeded' ? 'OVER' : alertLevel === 'p80' ? '80%' : '50%'}</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={[s.subCol, t.textInk]}>{MONEY(a)}</Text>
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

      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
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
    if (filter === 'All') return true;
    const isTransfer = tx.type === 'transfer' || isSystemTransaction(tx);
    if (filter === 'Transfers') return isTransfer;
    if (isTransfer) return false; // Income/Expense filters exclude transfers
    if (filter === 'Income') return tx.type === 'income';
    if (filter === 'Expenses') return tx.type === 'expense';
    return true;
  });
  const save = (t: any) => {
    setTransactions((xs: Tx[]) => xs.some(x => x.id === t.id) ? xs.map(x => x.id === t.id ? t : x) : [{ ...t, id: `manual-${Date.now()}`, origin: 'Manual', period: currentMonth() }, ...xs]);
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
      <PeriodPills values={['All','Income','Expenses','Transfers']} value={filter} onChange={setFilter} testID="tx-filter" />
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
          const isTransferRow = tx.type === 'transfer' || isSystemTransaction(tx);
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
      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
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
  const isIncome = tx.type === 'income';
  const isTransfer = tx.type === 'transfer';
  const currentGroup = isIncome ? incomeSources.find((s: any) => s.id === tx.groupId) : categories.find((c: any) => c.id === tx.groupId);
  const currentSubs = !isIncome && currentGroup ? currentGroup.subcategories : [];
  const parsedAmount = Math.abs(Number((tx.amount || '').toString().replace(/[^0-9.]/g, '')) || 0);
  // Splits accounting — sum of allocations vs total transaction amount.
  const splitsTotal = (tx.splits || []).reduce((sum: number, sp: any) => sum + (Number(sp.amount) || 0), 0);
  const splitsRemaining = parsedAmount > 0 ? parsedAmount - splitsTotal : 0;
  const splitsValid = !showSplits || (tx.splits && tx.splits.length >= 2 && Math.abs(splitsRemaining) < 0.01 && tx.splits.every((sp: any) => (Number(sp.amount) || 0) > 0));

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
    const seed = tx.splits && tx.splits.length > 0 ? tx.splits : [
      { groupId: tx.groupId || firstCat?.id, detailId: tx.detailId || firstSub?.id, amount: '' },
    ];
    setT({
      ...tx,
      splits: [...seed, { groupId: firstCat?.id, detailId: firstSub?.id, amount: '' }],
    });
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
      {/* Type selector — Income / Expense / Transfer. Transfers never affect
          income or expense totals or Net Worth. */}
      <PeriodPills
        values={['Income', 'Expense', 'Transfer']}
        value={tx.type === 'income' ? 'Income' : tx.type === 'transfer' ? 'Transfer' : 'Expense'}
        onChange={(label: string) => {
          const v = label.toLowerCase();
          setT({
            ...tx,
            type: v,
            // For Transfer, no group/sub is required — clear them.
            groupId: v === 'transfer' ? '' : v === 'income' ? (incomeSources[0]?.id || 'w2') : (categories[0]?.id || 'steward'),
            detailId: v === 'transfer' ? undefined : v === 'income' ? undefined : (categories[0]?.subcategories?.[0]?.id),
            splits: v === 'transfer' ? [] : tx.splits,
          });
          if (v === 'transfer') setShowSplits(false);
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
        <TextInput style={[s.input, { paddingLeft: 26 }]} value={tx.amount} onChangeText={x => setT({ ...tx, amount: x })} keyboardType="numeric" testID="tx-amount" />
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

      {/* Transfer-specific: informational only. Transfers never affect
          income/expense totals or Net Worth. */}
      {isTransfer && (
        <View style={{ padding: 10, marginTop: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#c49450' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
          <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 3, lineHeight: 14 }}>
            This transaction is an internal movement between your own accounts (or a credit-card payment).
            It won&apos;t affect income, expense, or Net Worth totals.
          </Text>
        </View>
      )}

      {/* Category / subcategory picker — hidden for Transfer. Also hidden
          when the user has opted into a Split (categories are picked per-row). */}
      {!isTransfer && !showSplits && (
        <>
          <Text style={s.label}>{isIncome ? 'Earn source' : 'Category'}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(isIncome ? incomeSources : categories).map((g: any) => {
              const on = tx.groupId === g.id;
              return (
                <Pressable
                  key={g.id}
                  onPress={() => setT({ ...tx, groupId: g.id, detailId: isIncome ? undefined : g.subcategories?.[0]?.id })}
                  style={[s.pickerChip, on && s.pickerChipOn]}
                  testID={`tx-group-${g.id}`}
                >
                  <Text style={[s.pickerChipText, on && { color: '#fff' }]}>{g.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {!isIncome && currentSubs.length > 0 && (
            <>
              <Text style={s.label}>Subcategory</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {currentSubs.map((sub: any) => {
                  const on = tx.detailId === sub.id;
                  return (
                    <Pressable
                      key={sub.id}
                      onPress={() => setT({ ...tx, detailId: sub.id })}
                      style={[s.pickerChip, on && s.pickerChipOn]}
                      testID={`tx-sub-${sub.id}`}
                    >
                      <Text style={[s.pickerChipText, on && { color: '#fff' }]}>{sub.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
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
                const gOptions = isIncome ? incomeSources : categories;
                const g = gOptions.find((c: any) => c.id === sp.groupId);
                const subs = !isIncome && g ? g.subcategories : [];
                return (
                  <View key={idx} style={{ paddingVertical: 8, borderBottomWidth: idx < (tx.splits.length - 1) ? 1 : 0, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                          {gOptions.map((c: any) => (
                            <Pressable key={c.id} onPress={() => updateSplit(idx, { groupId: c.id, detailId: c.subcategories?.[0]?.id })} style={[s.pickerChip, sp.groupId === c.id && s.pickerChipOn, { paddingHorizontal: 8, paddingVertical: 4 }]} testID={`tx-split-${idx}-group-${c.id}`}>
                              <Text style={[s.pickerChipText, sp.groupId === c.id && { color: '#fff' }, { fontSize: 10 }]}>{c.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                        {!isIncome && subs.length > 0 && (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {subs.map((sub: any) => (
                              <Pressable key={sub.id} onPress={() => updateSplit(idx, { detailId: sub.id })} style={[s.pickerChip, sp.detailId === sub.id && s.pickerChipOn, { paddingHorizontal: 8, paddingVertical: 4 }]} testID={`tx-split-${idx}-sub-${sub.id}`}>
                                <Text style={[s.pickerChipText, sp.detailId === sub.id && { color: '#fff' }, { fontSize: 10 }]}>{sub.name}</Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                      <View style={{ width: 90 }}>
                        <View style={s.amountInput}>
                          <Text style={s.amountPrefix}>$</Text>
                          <TextInput
                            style={[s.input, { paddingLeft: 22, paddingRight: 6, fontSize: 12 }]}
                            value={String(sp.amount || '')}
                            onChangeText={(x) => updateSplit(idx, { amount: x })}
                            keyboardType="numeric"
                            placeholder="0"
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
              <View style={{ marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>Allocated {MONEY(splitsTotal)} / {MONEY(parsedAmount)}</Text>
                <Text style={{ fontSize: 10, fontWeight: '800', color: Math.abs(splitsRemaining) < 0.01 ? '#4c8b56' : '#b06a5b' }}>
                  {splitsRemaining > 0 ? `${MONEY(splitsRemaining)} left` : splitsRemaining < 0 ? `${MONEY(-splitsRemaining)} over` : 'Balanced'}
                </Text>
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
            const splitsClean = showSplits && Array.isArray(tx.splits)
              ? tx.splits.map((sp: any) => ({ groupId: sp.groupId, detailId: sp.detailId, amount: Number(sp.amount) || 0 }))
              : undefined;
            save({
              ...tx,
              amount: parsedAmount,
              merchant: merchantClean || undefined,
              splits: splitsClean,
              origin: tx.origin || 'Manual',
              period: tx.period || currentMonth(),
            });
          }}
          disabled={!tx.name || !parsedAmount || !splitsValid}
          testID="tx-save"
        />
        {showSplits && !splitsValid && (
          <Text style={{ fontSize: 10, color: '#b06a5b', marginTop: 6, textAlign: 'center' }}>
            Splits must total exactly {MONEY(parsedAmount)} and have at least 2 rows.
          </Text>
        )}
      </View>
      {remove && <Pressable onPress={() => remove(item.id)} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="tx-delete">
        <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Delete transaction</Text>
      </Pressable>}
    </View>
  );
};

/* ---------------- Net Worth ---------------- */
// Legacy fallback used only when a Plaid account row is missing a `category`
// (older cached rows). New code paths should rely on `r.category` which the
// backend `wealth_service.classify_plaid()` sets by type + subtype.
const isInvestmentAccount = (r: any) => {
  if (r?.category === 'investments') return true;
  if (r?.category) return false; // trust the backend classification
  const hay = `${r.name || ''} ${r.account_name || ''} ${r.org_name || ''}`.toLowerCase();
  if (r.provider === 'snaptrade') return true;
  return /(invest|brokerage|ira|401k|403b|roth|hsa|mutual|advisor|wealth|portfolio|etrade|schwab|fidelity|vanguard|robinhood)/.test(hay);
};

// Canonical labels for the Jaleter categories (mirrors backend `wealth_service.CATEGORY_LABELS`).
const CATEGORY_LABELS: Record<string, string> = {
  cash: 'Cash', investments: 'Investments', real_estate: 'Real Estate',
  vehicles: 'Vehicles', other_assets: 'Other Assets',
  credit_cards: 'Credit Cards', mortgage: 'Mortgage', auto_loans: 'Auto Loans',
  student_loans: 'Student Loans', other_liabilities: 'Other Liabilities',
};
const CATEGORY_ICONS: Record<string, any> = {
  cash: 'wallet-outline', investments: 'trending-up', real_estate: 'business-outline',
  vehicles: 'car-outline', other_assets: 'cube-outline',
  credit_cards: 'card-outline', mortgage: 'home-outline', auto_loans: 'car-sport-outline',
  student_loans: 'school-outline', other_liabilities: 'document-text-outline',
};
const LIABILITY_CATEGORIES = new Set(['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities']);

// Nicely humanises an ISO timestamp for the "Last updated" line on synced rows.
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}
const NetWorthScreen = ({ assets, setAssets, liabilities, setLiabilities, transactions, restrictedBuckets, setRestrictedBuckets, linkedRowsByCategory, linkedByCategory, onRefreshAccounts }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  const [restrictedOpen, setRestrictedOpen] = useState(false);
  // Category-collapse state — persisted in-memory only. Default collapsed
  // (categories expand on tap) so the Wealth screen stays scannable.
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const toggleCat = (slug: string) => setExpandedCats((prev) => ({ ...prev, [slug]: !prev[slug] }));
  const [syncingAll, setSyncingAll] = useState(false);
  // Legacy "adding" sheet — kept for backwards-compat with existing tests but
  // the new redesign uses an inline editing card (setEditingBucket).
  const [addingRestricted, setAddingRestricted] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketAmt, setNewBucketAmt] = useState('');
  const [newBucketTarget, setNewBucketTarget] = useState('');
  const [newBucketTargetDate, setNewBucketTargetDate] = useState('');
  const [newBucketRecurring, setNewBucketRecurring] = useState('');
  const [editingBucket, setEditingBucket] = useState<any>(null);
  // "Add" or "Use" mini-flow for a bucket (increment / decrement).
  const [txBucket, setTxBucket] = useState<{ bucket: any; action: 'add' | 'use' } | null>(null);
  const [txAmt, setTxAmt] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editRow, setEditRow] = useState<{ side: 'assets' | 'liabilities'; row: Asset } | null>(null);
  const [rowDraftName, setRowDraftName] = useState('');
  const [rowDraftAmt, setRowDraftAmt] = useState('');
  const [addingRowSide, setAddingRowSide] = useState<'assets' | 'liabilities' | null>(null);
  // Reclassify sheet — opened when the user taps a linked (Synced) account
  // in either the Assets or Liabilities card. Manual rows still use editRow.
  const [reclassifyAccount, setReclassifyAccount] = useState<any | null>(null);
  const refreshLinked = () => {
    if (!token) return;
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []))
      .catch(() => { /* keep last-known rows on failure */ });
  };
  useEffect(() => {
    if (!token) return;
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []))
      .catch(() => setLinkedRows([]));
  }, [token]);
  const [period, setPeriod] = useState('Quarter');
  const [visible, setVisible] = useState(true);

  // ---- Aggregate live-linked balances by Jaleter category ----
  // De-dupe by unique (link_id, account_id) to prevent double-counting when
  // the same account appears via multiple items or holdings pulls. Skip
  // zero-value insurance policies (term-life, disability, whole life w/
  // zero cash value) so they never inflate the Investments category.
  const validLinks = React.useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of linkedRows.filter((x: any) => !x.error)) {
      const key = `${r.link_id || ''}::${r.account_id || r.name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hay = `${r.name || ''} ${r.subtype || ''} ${r.type || ''}`.toLowerCase();
      const looksInsurance = /(term life|term-life|disability insurance|whole life|umbrella|renters insurance|auto insurance|life insurance)/.test(hay);
      const bal = Number(r.balance || 0);
      if (looksInsurance && bal === 0) continue;
      out.push(r);
    }
    return out;
  }, [linkedRows]);
  const linkedByCat: Record<string, any[]> = {};
  for (const r of validLinks) {
    const cat = (r.category as string) || (isInvestmentAccount(r) ? 'investments' : 'cash');
    (linkedByCat[cat] = linkedByCat[cat] || []).push(r);
  }
  const sumCat = (slug: string) =>
    (linkedByCat[slug] || []).reduce((sum, r: any) => sum + Number(r.balance || 0), 0);
  const linkedCash = sumCat('cash');
  const linkedInvest = sumCat('investments');
  const linkedRealEstate = sumCat('real_estate');
  const linkedVehicles = sumCat('vehicles');
  const linkedOtherAssets = sumCat('other_assets');
  const cashSources = linkedByCat['cash'] || [];
  const investSources = linkedByCat['investments'] || [];
  // ---- Category groups (collapsible) ---------------------------------------
  // Each category row shows the group name + total; expanding reveals every
  // underlying account. Category totals MUST equal the sum of the rows so
  // the UI never lies (spec fix). Manual seeds for Cash/Investments are
  // included in the totals via `manualCash` / `manualInvest` — they render
  // as a "Manual (edit)" row so users can still adjust them by tapping.
  const buildCategoryGroups = (side: 'assets' | 'liabilities') => {
    const slugs: string[] = side === 'assets'
      ? ['cash', 'investments', 'real_estate', 'vehicles', 'other_assets']
      : ['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities'];
    return slugs.map((slug) => {
      const linkedRows = linkedByCat[slug] || [];
      const linkedTotal = linkedRows.reduce((sum, r: any) => sum + Number(r.balance || 0), 0);
      // For assets, we also fold in the manual seeds (Cash + Investments).
      const manualSeedValue = slug === 'cash' ? manualCash : slug === 'investments' ? manualInvest : 0;
      // Manual "other" rows (Real Estate / Vehicles / Other assets, or
      // manual liabilities) — matched by icon lookup for the wealth slug.
      const manualExtras = side === 'assets'
        ? assets.filter((x: Asset) => {
            if (slug === 'cash' || slug === 'investments') return false;
            if (slug === 'real_estate') return x.id === 'real-estate';
            if (slug === 'vehicles') return x.id === 'vehicles';
            return x.id !== 'cash' && x.id !== 'investments' && x.id !== 'real-estate' && x.id !== 'vehicles';
          })
        : liabilities.filter((x: Asset) => {
            if (slug === 'mortgage') return x.id === 'mortgage';
            if (slug === 'auto_loans') return x.id === 'auto-loan';
            if (slug === 'credit_cards') return x.id === 'credit-cards' || x.id === 'credit-card';
            if (slug === 'student_loans') return x.id === 'student-loan' || x.id === 'student-loans';
            return !['mortgage', 'auto-loan', 'credit-cards', 'credit-card', 'student-loan', 'student-loans'].includes(x.id);
          });
      const manualExtrasTotal = manualExtras.reduce((sum: number, r: any) => sum + Number(r.value || 0), 0);
      const total = linkedTotal + manualSeedValue + manualExtrasTotal;
      return { slug, label: CATEGORY_LABELS[slug], icon: CATEGORY_ICONS[slug], linkedRows, manualExtras, manualSeedValue, total };
    });
  };
  const assetGroups = buildCategoryGroups('assets');
  const liabilityGroups = buildCategoryGroups('liabilities');
  const assetsCategoriesTotal = assetGroups.reduce((s, g) => s + g.total, 0);
  const liabilitiesCategoriesTotal = liabilityGroups.reduce((s, g) => s + g.total, 0);
  // Last-sync timestamp across all valid linked accounts — surfaced right
  // above the categories so users know how fresh the data is.
  const allSyncTimes = validLinks
    .map((r: any) => r.last_sync_at)
    .filter(Boolean)
    .map((v: string) => new Date(v).getTime())
    .filter((n: number) => !Number.isNaN(n));
  const lastSyncMs = allSyncTimes.length ? Math.max(...allSyncTimes) : 0;
  const lastSyncLabel = lastSyncMs
    ? `Last synced ${new Date(lastSyncMs).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : 'No sync yet';
  const doSyncAll = async () => {
    if (!token || syncingAll) return;
    setSyncingAll(true);
    try {
      await Promise.allSettled([
        apiCall('/api/plaid/sync', { method: 'POST' }, token),
        apiCall('/api/accounts/sync', { method: 'POST' }, token),
      ]);
      refreshLinked();
      onRefreshAccounts && onRefreshAccounts();
    } finally { setSyncingAll(false); }
  };

  const sourceLabel = (rows: any[], fallback: string) => {
    if (rows.length === 0) return fallback;
    const providers = Array.from(new Set(rows.map((r: any) => r.provider)));
    const orgs = Array.from(new Set(rows.map((r: any) => r.org_name).filter(Boolean)));
    const providerName = providers.length === 1
      ? (providers[0] === 'file' ? 'Imported' : providers[0] === 'snaptrade' ? 'SnapTrade' : 'Linked')
      : 'Linked';
    if (orgs.length === 1) return `${providerName} · ${orgs[0]}`;
    return `${providerName} · ${rows.length} account${rows.length > 1 ? 's' : ''}`;
  };

  // ---- Build the display asset list: Cash & Investments are auto-computed. Real estate / vehicles stay manual. ----
  const manualCash = assets.find((x: Asset) => x.id === 'cash')?.value || 0;
  const manualInvest = assets.find((x: Asset) => x.id === 'investments')?.value || 0;
  const manualOther = assets.filter((x: Asset) => x.id !== 'cash' && x.id !== 'investments');
  const displayAssets: (Asset & { linked?: boolean; account?: any })[] = [
    // Cash & Investments show a category header + one row per linked account
    // so users can see each checking/savings/brokerage separately (spec fix).
    { id: 'cash', name: 'Cash', value: manualCash + linkedCash, source: cashSources.length > 0 ? `Total across ${cashSources.length} account${cashSources.length > 1 ? 's' : ''}` : 'Manual', icon: 'wallet-outline', linked: cashSources.length > 0 },
    ...cashSources.map((r: any) => ({
      id: `linked-cash-${r.account_id}`,
      name: r.name,
      value: Number(r.balance || 0),
      source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
      icon: 'wallet-outline',
      linked: true,
      account: r,
    })),
    { id: 'investments', name: 'Investments', value: manualInvest + linkedInvest, source: investSources.length > 0 ? `Total across ${investSources.length} account${investSources.length > 1 ? 's' : ''}` : 'Manual', icon: 'trending-up', linked: investSources.length > 0 },
    ...investSources.map((r: any) => ({
      id: `linked-invest-${r.account_id}`,
      name: r.name,
      value: Number(r.balance || 0),
      source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
      icon: 'trending-up',
      linked: true,
      account: r,
    })),
    ...manualOther,
  ];
  // Linked non-cash / non-investment assets (Real Estate / Vehicles / Other Assets)
  // are treated as additional read-only rows. Manual rows for the same category
  // are still shown separately so the user can distinguish sources.
  const extraLinkedAssetRows: (Asset & { linked?: boolean; account?: any })[] = [];
  for (const slug of ['real_estate', 'vehicles', 'other_assets']) {
    for (const r of (linkedByCat[slug] || [])) {
      extraLinkedAssetRows.push({
        id: `linked-${r.account_id}`,
        name: r.name || CATEGORY_LABELS[slug],
        value: Number(r.balance || 0),
        source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
        icon: CATEGORY_ICONS[slug],
        linked: true,
        account: r,
      });
    }
  }

  // Liabilities: manual + all linked liability accounts, each shown as its own row.
  const linkedLiabilityRows: (Asset & { linked?: boolean; account?: any })[] = [];
  for (const slug of ['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities']) {
    for (const r of (linkedByCat[slug] || [])) {
      linkedLiabilityRows.push({
        id: `linked-${r.account_id}`,
        name: r.name || CATEGORY_LABELS[slug],
        value: Number(r.balance || 0),
        source: `${CATEGORY_LABELS[slug]} · ${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
        icon: CATEGORY_ICONS[slug],
        linked: true,
        account: r,
      });
    }
  }
  const combinedLiabilities: (Asset & { linked?: boolean; account?: any })[] = [
    ...linkedLiabilityRows,
    ...liabilities.map((x: Asset) => ({ ...x, source: x.source || 'Manual', linked: false })),
  ];

  const ta = displayAssets.reduce((sum: number, x: any) => sum + (x.value || 0), 0)
    + extraLinkedAssetRows.reduce((sum, x) => sum + (x.value || 0), 0);
  const tl = combinedLiabilities.reduce((sum, x) => sum + (x.value || 0), 0);
  const nw = ta - tl;
  const cash = displayAssets.find((x: any) => x.id === 'cash')?.value || 0;
  // Only ACTIVE (non-archived) buckets count toward Set Aside.
  const activeBuckets = restrictedBuckets.filter((b: any) => !b.archived);
  const archivedBuckets = restrictedBuckets.filter((b: any) => b.archived);
  const totalRestricted = activeBuckets.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
  const available = cash - totalRestricted; // may be negative; we now render red instead of clamping to 0
  const BUCKET_PRESETS = [
    { name: 'Emergency Fund', icon: 'shield-checkmark-outline' },
    { name: 'Taxes', icon: 'document-text-outline' },
    { name: 'Vacation / Travel', icon: 'airplane-outline' },
    { name: 'Home', icon: 'home-outline' },
    { name: 'Auto', icon: 'car-outline' },
    { name: 'Medical', icon: 'medkit-outline' },
    { name: 'Education', icon: 'school-outline' },
    { name: 'Gifts / Holidays', icon: 'gift-outline' },
    { name: 'Business', icon: 'briefcase-outline' },
    { name: 'Other', icon: 'ellipsis-horizontal-outline' },
  ];
  const resetBucketDraft = () => {
    setNewBucketName(''); setNewBucketAmt(''); setNewBucketTarget(''); setNewBucketTargetDate(''); setNewBucketRecurring('');
  };
  const openNewBucket = (presetName?: string) => {
    resetBucketDraft();
    if (presetName) setNewBucketName(presetName);
    setEditingBucket(null);
    setAddingRestricted(true);
  };
  const openEditBucket = (b: any) => {
    setEditingBucket(b);
    setNewBucketName(b.name);
    setNewBucketAmt(String(b.amount || 0));
    setNewBucketTarget(b.target ? String(b.target) : '');
    setNewBucketTargetDate(b.targetDate || '');
    setNewBucketRecurring(b.recurring ? String(b.recurring) : '');
    setAddingRestricted(true);
  };
  const saveBucket = () => {
    const cleanAmt = Math.max(0, Math.round(Number((newBucketAmt || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanTarget = Math.max(0, Math.round(Number((newBucketTarget || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanRecurring = Math.max(0, Math.round(Number((newBucketRecurring || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanName = newBucketName.trim();
    if (!cleanName) return;
    if (editingBucket) {
      setRestrictedBuckets((prev: any[]) => prev.map((x: any) => x.id === editingBucket.id ? {
        ...x,
        name: cleanName,
        amount: cleanAmt,
        target: cleanTarget > 0 ? cleanTarget : undefined,
        targetDate: newBucketTargetDate ? newBucketTargetDate.trim() : undefined,
        recurring: cleanRecurring > 0 ? cleanRecurring : undefined,
      } : x));
    } else {
      // Cap at 20 active buckets to keep UI usable and prevent runaway lists.
      if (activeBuckets.length >= 20) return;
      setRestrictedBuckets((prev: any[]) => [...prev, {
        id: `bucket-${Date.now().toString(36)}`,
        name: cleanName,
        amount: cleanAmt,
        target: cleanTarget > 0 ? cleanTarget : undefined,
        targetDate: newBucketTargetDate ? newBucketTargetDate.trim() : undefined,
        recurring: cleanRecurring > 0 ? cleanRecurring : undefined,
        createdAt: new Date().toISOString(),
      }]);
    }
    setAddingRestricted(false); setEditingBucket(null);
    resetBucketDraft();
  };
  const archiveBucket = (id: string) => {
    setRestrictedBuckets((prev: any[]) => prev.map((x: any) => x.id === id ? { ...x, archived: !x.archived } : x));
  };
  const deleteBucket = (id: string) => {
    const b = restrictedBuckets.find((x: any) => x.id === id);
    const name = b?.name || 'this bucket';
    const doIt = () => setRestrictedBuckets((prev: any[]) => prev.filter((x: any) => x.id !== id));
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}"?\n\nThe money returns to Available Cash. This cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'The money returns to Available Cash. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const commitBucketTx = () => {
    if (!txBucket) return;
    const raw = Math.max(0, Math.round(Number((txAmt || '').replace(/[^0-9.]/g, '')) || 0));
    if (raw <= 0) { setTxBucket(null); setTxAmt(''); return; }
    setRestrictedBuckets((prev: any[]) => prev.map((x: any) => {
      if (x.id !== txBucket.bucket.id) return x;
      const nextAmt = txBucket.action === 'add' ? (x.amount || 0) + raw : Math.max(0, (x.amount || 0) - raw);
      return { ...x, amount: nextAmt };
    }));
    setTxBucket(null); setTxAmt('');
  };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Net Worth" subtitle="Your full financial picture, in one place." action={
        <CircleBtn onPress={() => setVisible(!visible)} testID="nw-eye"><Ionicons name={visible ? 'eye-outline' : 'eye-off-outline'} size={18} color={C.ink3} /></CircleBtn>
      } />
      <View style={s.nwHero}>
        <Text style={{ color: '#c3bbb0', fontSize: 9, letterSpacing: 1.3 }}>TOTAL NET WORTH</Text>
        <Text style={s.nwHeroStrong}>{visible ? MONEY(nw) : '••••••'}</Text>
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <Ionicons name="trending-up" size={13} color="#7fac8d" />
          <Text style={{ color: '#7fac8d', fontSize: 10 }}>{validLinks.length > 0 ? `Live from ${validLinks.length} linked account${validLinks.length > 1 ? 's' : ''}` : 'Updates with your linked accounts'}</Text>
        </View>
        {nw > 0 && (
          <View style={s.nwChart}>
            {[62, 55, 48, 42, 33, 24, 15, 9].map((top, i, arr) => (
              <View key={i} style={[s.nwChartDot, { left: `${(i / (arr.length - 1)) * 100}%`, top }]} />
            ))}
          </View>
        )}
      </View>
      <PeriodPills values={['Month','Quarter','Year']} value={period} onChange={setPeriod} testID="nw-period" />
      <View style={[s.cashProtection, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <View style={{ flex: 1 }}><Text style={[s.cpSmall, t.textMuted]}>TOTAL CASH</Text><Text style={[s.cpStrong, t.textInk]}>{MONEY(cash)}</Text></View>
        <Text style={{ color: '#b99a6c' }}>−</Text>
        <Pressable onPress={() => setRestrictedOpen(true)} style={{ flex: 1 }} testID="nw-restricted">
          <Text style={[s.cpSmall, t.textMuted]}>SET ASIDE</Text>
          <Text style={[s.cpStrong, t.textInk]}>{MONEY(totalRestricted)}</Text>
          <Text style={{ color: '#c9a56c', fontSize: 8, marginTop: 2 }}>{activeBuckets.length > 0 ? `${activeBuckets.length} bucket${activeBuckets.length > 1 ? 's' : ''} · tap to manage` : 'tap to add'}</Text>
        </Pressable>
        <Text style={{ color: '#b99a6c' }}>=</Text>
        <View style={[{ flex: 1.2 }, s.cpAvailable]}>
          <Text style={[s.cpSmall, { color: '#c8b494' }]}>AVAILABLE</Text>
          <Text style={[s.cpStrong, { color: available < 0 ? '#f2b1a8' : '#f3dfbd' }]}>{MONEY(available)}</Text>
          {available < 0 && (
            <Text style={{ color: '#f2b1a8', fontSize: 8, marginTop: 2, fontWeight: '700' }}>Over-allocated</Text>
          )}
        </View>
      </View>
      <Sheet visible={restrictedOpen} close={() => { setRestrictedOpen(false); setAddingRestricted(false); setEditingBucket(null); resetBucketDraft(); }} title="Set Aside Cash" subtitle="Named buckets for money set aside — taxes, gifts, goals. Each bucket is subtracted from Available Cash but stays part of your Total Cash and Net Worth.">
        <View>
          {/* Preset chips — always visible so users can quickly add common
              buckets. Tapping a chip pre-fills the name in the add form. */}
          {!addingRestricted && activeBuckets.length < 20 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={[{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', marginBottom: 6 }]}>QUICK ADD</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {BUCKET_PRESETS.map((p) => (
                  <Pressable key={p.name} onPress={() => openNewBucket(p.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID={`bucket-preset-${p.name.replace(/\W+/g, '-').toLowerCase()}`}>
                    <Ionicons name={p.icon as any} size={12} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '700' }}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {activeBuckets.length === 0 && !addingRestricted && (
            <Text style={{ fontSize: 11, color: C.muted2, marginBottom: 12 }}>No active buckets yet. Tap a preset above or the button below to create your first.</Text>
          )}

          {/* Active buckets list — each with Add/Use quick actions and progress bar */}
          {activeBuckets.map((b: any) => {
            const target = Number(b.target || 0);
            const amt = Number(b.amount || 0);
            const pct = target > 0 ? Math.min(100, (amt / target) * 100) : 0;
            return (
              <View key={b.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable onPress={() => openEditBucket(b)} style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[{ fontSize: 13, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{b.name}</Text>
                        {target > 0 && (
                          <Text style={{ fontSize: 9, color: C.muted2 }}>
                            {MONEY(amt)} of {MONEY(target)}{b.targetDate ? ` · by ${b.targetDate}` : ''}
                          </Text>
                        )}
                        {target === 0 && (
                          <Text style={{ fontSize: 9, color: C.muted2 }}>Tap to set a target or details</Text>
                        )}
                      </View>
                      <Text style={[{ fontSize: 14, fontWeight: '800', color: '#9a6d32' }]}>{MONEY(amt)}</Text>
                    </View>
                    {target > 0 && (
                      <View style={{ height: 5, borderRadius: 4, backgroundColor: t.dark ? '#3a342b' : '#f0e7d1', marginTop: 6, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 100 ? '#4c8b56' : '#c49450' }} />
                      </View>
                    )}
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                  <Pressable onPress={() => { setTxBucket({ bucket: b, action: 'add' }); setTxAmt(''); }} style={{ flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#c49450', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} testID={`bucket-add-${b.id}`}>
                    <Ionicons name="add-circle-outline" size={13} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '800' }}>Add</Text>
                  </Pressable>
                  <Pressable onPress={() => { setTxBucket({ bucket: b, action: 'use' }); setTxAmt(''); }} style={{ flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#c49450', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} testID={`bucket-use-${b.id}`}>
                    <Ionicons name="remove-circle-outline" size={13} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '800' }}>Use</Text>
                  </Pressable>
                  <Pressable onPress={() => archiveBucket(b.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e6dcc5', alignItems: 'center', justifyContent: 'center' }} testID={`bucket-archive-${b.id}`}>
                    <Ionicons name="archive-outline" size={14} color="#9a6d32" />
                  </Pressable>
                  <Pressable onPress={() => deleteBucket(b.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e6dcc5', alignItems: 'center', justifyContent: 'center' }} testID={`bucket-del-${b.id}`}>
                    <Ionicons name="trash-outline" size={14} color="#b06a5b" />
                  </Pressable>
                </View>
              </View>
            );
          })}

          {addingRestricted ? (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Bucket name</Text>
              <TextInput style={s.input} value={newBucketName} onChangeText={setNewBucketName} placeholder="e.g., Q3 Taxes, Christmas Gifts" autoFocus testID="bucket-name" />
              <Text style={[s.label, { marginTop: 10 }]}>Current amount</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketAmt} onChangeText={setNewBucketAmt} keyboardType="numeric" placeholder="0" testID="bucket-amount" />
              </View>
              <Text style={[s.label, { marginTop: 10 }]}>Target amount (optional)</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketTarget} onChangeText={setNewBucketTarget} keyboardType="numeric" placeholder="0" testID="bucket-target" />
              </View>
              <Text style={[s.label, { marginTop: 10 }]}>Target date (optional)</Text>
              <TextInput style={s.input} value={newBucketTargetDate} onChangeText={setNewBucketTargetDate} placeholder="e.g., Dec 2026" testID="bucket-target-date" />
              <Text style={[s.label, { marginTop: 10 }]}>Recurring contribution / mo (optional)</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketRecurring} onChangeText={setNewBucketRecurring} keyboardType="numeric" placeholder="0" testID="bucket-recurring" />
              </View>
              <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
                Recurring is informational for now — a reminder of your plan. It never auto-moves money.
              </Text>
              <View style={{ marginTop: 14 }}>
                <GoldButton label={editingBucket ? 'Save bucket' : 'Add bucket'} onPress={saveBucket} disabled={!newBucketName.trim()} testID="bucket-save" />
              </View>
              <Pressable onPress={() => { setAddingRestricted(false); setEditingBucket(null); resetBucketDraft(); }} style={{ marginTop: 10, alignItems: 'center' }}>
                <Text style={{ color: C.muted2, fontSize: 11 }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            activeBuckets.length < 20 && (
              <Pressable onPress={() => openNewBucket()} style={[s.subcategoryRow, { justifyContent: 'center', marginTop: 12 }]} testID="bucket-add">
                <Ionicons name="add-circle-outline" size={16} color="#9a6d32" />
                <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>Add custom bucket</Text>
              </Pressable>
            )
          )}

          {activeBuckets.length >= 20 && !addingRestricted && (
            <Text style={{ fontSize: 10, color: C.muted2, marginTop: 8, textAlign: 'center' }}>
              You&apos;ve reached the 20-bucket limit. Archive or delete one to add more.
            </Text>
          )}

          {archivedBuckets.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Pressable onPress={() => setShowArchived(!showArchived)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }} testID="bucket-archived-toggle">
                <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39' }]}>ARCHIVED ({archivedBuckets.length})</Text>
                <Ionicons name={showArchived ? 'chevron-down' : 'chevron-forward'} size={13} color="#a97c39" />
              </Pressable>
              {showArchived && archivedBuckets.map((b: any) => (
                <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, opacity: 0.6 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{b.name}</Text>
                    <Text style={{ fontSize: 9, color: C.muted2 }}>{MONEY(b.amount)} · archived (not counted)</Text>
                  </View>
                  <Pressable onPress={() => archiveBucket(b.id)} style={{ paddingHorizontal: 8, paddingVertical: 6 }} testID={`bucket-unarchive-${b.id}`}>
                    <Ionicons name="arrow-undo-outline" size={14} color="#9a6d32" />
                  </Pressable>
                  <Pressable onPress={() => deleteBucket(b.id)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                    <Ionicons name="trash-outline" size={14} color="#b06a5b" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </Sheet>

      {/* Add / Use money sheet — quick +/- flow. Never lets a bucket go below $0. */}
      <Sheet visible={!!txBucket} close={() => { setTxBucket(null); setTxAmt(''); }} title={txBucket ? `${txBucket.action === 'add' ? 'Add to' : 'Use from'} ${txBucket.bucket.name}` : ''} subtitle={txBucket?.action === 'add' ? 'Allocate money from Available Cash to this bucket.' : 'Return money from this bucket to Available Cash. Bucket stays at $0 minimum.'}>
        {txBucket && (
          <View>
            <Text style={s.label}>Amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={txAmt} onChangeText={setTxAmt} keyboardType="numeric" placeholder="0" autoFocus testID="bucket-tx-amt" />
            </View>
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Current: {MONEY(txBucket.bucket.amount)}{txBucket.action === 'use' ? ` · Max you can use: ${MONEY(txBucket.bucket.amount)}` : ''}
            </Text>
            <View style={{ marginTop: 14 }}>
              <GoldButton label={`${txBucket.action === 'add' ? 'Add' : 'Use'} money`} onPress={commitBucketTx} testID="bucket-tx-save" />
            </View>
          </View>
        )}
      </Sheet>
      <Sheet visible={!!editRow} close={() => setEditRow(null)} title={editRow ? `Edit · ${editRow.row.name}` : ''} subtitle={editRow?.row.id === 'cash' || editRow?.row.id === 'investments' ? 'This value is added on top of any linked account balances.' : 'Update the name or amount at any time.'}>
        {editRow && (
          <View>
            {(editRow.row.id !== 'cash' && editRow.row.id !== 'investments') && (
              <>
                <Text style={s.label}>Name</Text>
                <TextInput style={s.input} value={rowDraftName} onChangeText={setRowDraftName} testID="row-name" />
              </>
            )}
            <Text style={s.label}>Amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={rowDraftAmt} onChangeText={setRowDraftAmt} keyboardType="numeric" placeholder="0" testID="row-amount" />
            </View>
            <View style={{ marginTop: 12 }}>
              <GoldButton label="Save" onPress={() => {
                const cleanAmt = Math.max(0, Math.round(Number((rowDraftAmt || '').replace(/[^0-9.]/g, '')) || 0));
                const cleanName = rowDraftName.trim() || editRow.row.name;
                if (editRow.side === 'assets') {
                  const isBuiltin = editRow.row.id === 'cash' || editRow.row.id === 'investments';
                  if (isBuiltin) setAssets((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, value: cleanAmt } : x));
                  else setAssets((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, name: cleanName, value: cleanAmt } : x));
                } else {
                  setLiabilities((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, name: cleanName, value: cleanAmt } : x));
                }
                setEditRow(null); setRowDraftName(''); setRowDraftAmt('');
              }} testID="row-save" />
            </View>
            {(editRow.row.id !== 'cash' && editRow.row.id !== 'investments') && (
              <Pressable onPress={() => {
                const doIt = () => {
                  if (editRow.side === 'assets') setAssets((prev: Asset[]) => prev.filter((x) => x.id !== editRow.row.id));
                  else setLiabilities((prev: Asset[]) => prev.filter((x) => x.id !== editRow.row.id));
                  setEditRow(null);
                };
                if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`Remove "${editRow.row.name}"?`)) doIt(); }
                else { Alert.alert(`Remove "${editRow.row.name}"?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: doIt }]); }
              }} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="row-delete">
                <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Remove</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>
      <Sheet visible={!!addingRowSide} close={() => { setAddingRowSide(null); setRowDraftName(''); setRowDraftAmt(''); }} title={addingRowSide === 'assets' ? 'Add asset' : 'Add liability'} subtitle="Anything you own (asset) or owe (liability).">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={rowDraftName} onChangeText={setRowDraftName} placeholder={addingRowSide === 'assets' ? 'e.g., Rental property, Jewelry' : 'e.g., Personal loan, Medical debt'} autoFocus testID="row-add-name" />
          <Text style={s.label}>Amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={rowDraftAmt} onChangeText={setRowDraftAmt} keyboardType="numeric" placeholder="0" testID="row-add-amount" />
          </View>
          <View style={{ marginTop: 12 }}>
            <GoldButton label={`Add ${addingRowSide === 'assets' ? 'asset' : 'liability'}`} onPress={() => {
              const cleanAmt = Math.max(0, Math.round(Number((rowDraftAmt || '').replace(/[^0-9.]/g, '')) || 0));
              const cleanName = rowDraftName.trim();
              if (!cleanName || !addingRowSide) return;
              const id = `${addingRowSide}-${Date.now()}`;
              const icon = addingRowSide === 'assets' ? 'cube-outline' : 'card-outline';
              const row: Asset = { id, name: cleanName, value: cleanAmt, source: 'Manual', icon };
              if (addingRowSide === 'assets') setAssets((prev: Asset[]) => [...prev, row]);
              else setLiabilities((prev: Asset[]) => [...prev, row]);
              setAddingRowSide(null); setRowDraftName(''); setRowDraftAmt('');
            }} disabled={!rowDraftName.trim()} testID="row-add-save" />
          </View>
        </View>
      </Sheet>
      <WorthCard title="Assets" total={ta} rows={[...displayAssets, ...extraLinkedAssetRows]} hidden={!visible} onRowPress={(row: any) => {
        if (row.linked && row.account) { setReclassifyAccount(row.account); return; }
        setEditRow({ side: 'assets', row });
        setRowDraftName(row.name);
        const raw = row.id === 'cash' ? manualCash : row.id === 'investments' ? manualInvest : row.value;
        setRowDraftAmt(raw ? String(raw) : '');
      }} onAdd={() => setAddingRowSide('assets')} />
      <WorthCard title="Liabilities" total={tl} rows={combinedLiabilities} hidden={!visible} onRowPress={(row: any) => {
        if (row.linked && row.account) { setReclassifyAccount(row.account); return; }
        setEditRow({ side: 'liabilities', row });
        setRowDraftName(row.name);
        setRowDraftAmt(row.value ? String(row.value) : '');
      }} onAdd={() => setAddingRowSide('liabilities')} />

      {/* By Category — collapsible list of Cash / Investments / Real Estate /
          Vehicles / Credit Cards / Mortgage / Auto / Student / Other. Each
          category shows its total; expanding reveals every account (bank,
          balance, last-sync). Totals here ALWAYS equal the sum of the
          accounts underneath (spec fix). */}
      <View style={[s.assumptionsCard, t.cardBg, { marginTop: 12 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={[{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, t.textInk]}>WEALTH BY CATEGORY</Text>
          <Pressable onPress={doSyncAll} disabled={syncingAll} testID="wealth-sync-all" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name={syncingAll ? 'sync-outline' : 'refresh-outline'} size={12} color="#9a6d32" />
            <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '700' }}>{syncingAll ? 'Syncing…' : 'Sync'}</Text>
          </Pressable>
        </View>
        <Text style={[{ fontSize: 9, marginBottom: 8 }, t.textMuted]} testID="wealth-last-sync">
          {lastSyncLabel}
        </Text>
        {(['assets', 'liabilities'] as const).map((side) => {
          const groups = side === 'assets' ? assetGroups : liabilityGroups;
          const sideTotal = side === 'assets' ? assetsCategoriesTotal : liabilitiesCategoriesTotal;
          return (
            <View key={side} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }, t.textInk]}>{side === 'assets' ? 'ASSETS' : 'LIABILITIES'}</Text>
                <Text style={[{ fontSize: 11, fontWeight: '800' }, t.textInk]}>{visible ? MONEY(sideTotal) : '••••'}</Text>
              </View>
              {groups.map((g) => {
                const isOpen = !!expandedCats[g.slug];
                const rowCount = g.linkedRows.length + g.manualExtras.length + (g.manualSeedValue > 0 ? 1 : 0);
                if (g.total === 0 && rowCount === 0) return null;
                return (
                  <View key={g.slug}>
                    <Pressable onPress={() => toggleCat(g.slug)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f5f0e6' }} testID={`wealth-cat-${g.slug}`}>
                      <Ionicons name={g.icon} size={14} color="#9a6d32" style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{g.label}</Text>
                        <Text style={[{ fontSize: 8 }, t.textMuted]}>{rowCount} account{rowCount === 1 ? '' : 's'}</Text>
                      </View>
                      <Text style={[{ fontSize: 12, fontWeight: '800', marginRight: 6 }, t.textInk]}>{visible ? MONEY(g.total) : '••••'}</Text>
                      <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={t.dark ? D.textMuted : '#aaa39a'} />
                    </Pressable>
                    {isOpen && (
                      <View style={{ paddingLeft: 20, paddingVertical: 4 }}>
                        {g.manualSeedValue > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>{g.slug === 'cash' ? 'Manual cash' : 'Manual investments'}</Text>
                              <Text style={[{ fontSize: 8 }, t.textMuted]}>Manual · edit in Wealth</Text>
                            </View>
                            <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(g.manualSeedValue) : '••••'}</Text>
                          </View>
                        )}
                        {g.linkedRows.map((r: any) => (
                          <Pressable key={`${r.link_id}-${r.account_id}`} onPress={() => setReclassifyAccount(r)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }} testID={`wealth-cat-acc-${r.account_id}`}>
                            <View style={{ flex: 1 }}>
                              <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]} numberOfLines={1}>{r.name}</Text>
                              <Text style={[{ fontSize: 8 }, t.textMuted]}>{r.org_name || 'Linked'} · Synced{r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}</Text>
                            </View>
                            <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(Number(r.balance || 0)) : '••••'}</Text>
                          </Pressable>
                        ))}
                        {g.manualExtras.map((r: Asset) => (
                          <Pressable key={`m-${r.id}`} onPress={() => { setEditRow({ side, row: r }); setRowDraftName(r.name); setRowDraftAmt(r.value ? String(r.value) : ''); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>{r.name}</Text>
                              <Text style={[{ fontSize: 8 }, t.textMuted]}>Manual</Text>
                            </View>
                            <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(r.value) : '••••'}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      <Sheet
        visible={!!reclassifyAccount}
        close={() => setReclassifyAccount(null)}
        title="Rename or reclassify"
        subtitle="Fix how this account contributes to your Net Worth."
      >
        {reclassifyAccount ? (
          <ReclassifySheet
            account={reclassifyAccount}
            token={token}
            isDark={t.dark}
            onDone={(_updated) => { setReclassifyAccount(null); refreshLinked(); }}
            onClose={() => setReclassifyAccount(null)}
          />
        ) : null}
      </Sheet>
    </ScrollView>
  );
};
const WorthCard = ({ title, total, rows, hidden, onRowPress, onAdd }: any) => {
  const t = useThemed();
  // A row is "empty" when it has no value AND no linked source. The seeded
  // Cash + Investments rows always exist, so an "empty" WorthCard for
  // Assets means both seeded rows are still at $0 and there are no manual
  // additions. Liabilities has no seeded rows, so any zero-length rows
  // array is truly empty.
  const nonZeroRows = rows.filter((r: any) => (r.value || 0) > 0 || r.linked);
  const isLiabilities = title !== 'Assets';
  const showEmptyState = isLiabilities
    ? rows.length === 0
    : nonZeroRows.length === 0;
  const emptyCopy = isLiabilities
    ? 'Connect a liability account or add one manually.'
    : 'Connect an account or add an asset to see your net worth.';
  return (
    <View style={[s.worthCard, t.cardBg]}>
      <View style={[s.worthCardHeading, t.dividerBorder]}>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{title}</Text>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{hidden ? '••••••' : MONEY(total)}</Text>
      </View>
      {showEmptyState ? (
        <View style={{ paddingVertical: 22, paddingHorizontal: 14, alignItems: 'center' }}>
          <Ionicons name={isLiabilities ? 'card-outline' : 'wallet-outline'} size={26} color={t.dark ? D.textMuted : '#c1b9ac'} />
          <Text style={[{ fontSize: 11, marginTop: 6, textAlign: 'center', maxWidth: 260, lineHeight: 15 }, t.textMuted]}>
            {emptyCopy}
          </Text>
          {onAdd && (
            <Pressable
              onPress={onAdd}
              style={{ marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#c49450' }}
              testID={`nw-empty-add-${title.toLowerCase()}`}
            >
              <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700' }}>Add {isLiabilities ? 'liability' : 'asset'}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        rows.map((r: Asset & { linked?: boolean }) => (
          <Pressable key={r.id} onPress={() => onRowPress?.(r)} style={[s.worthRow, t.dividerBorder]} testID={`nw-row-${r.id}`}>
            <View style={[s.worthIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={r.icon as any} size={17} color={t.dark ? D.textMuted : '#817969'} /></View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{r.name}</Text>
                <View style={{
                  paddingHorizontal: 5, paddingVertical: 1,
                  borderRadius: 4, borderWidth: 1,
                  borderColor: r.linked ? '#c49450' : (t.dark ? D.border : '#dcd4c6'),
                  backgroundColor: r.linked ? '#c4945020' : 'transparent',
                }}>
                  <Text style={{ fontSize: 7, fontWeight: '800', letterSpacing: 0.6, color: r.linked ? '#c49450' : (t.dark ? D.textMuted : '#a29b90') }}>
                    {r.linked ? 'SYNCED' : 'MANUAL'}
                  </Text>
                </View>
              </View>
              <Text style={[{ fontSize: 8, color: '#9b958c', marginTop: 1 }, t.textMuted]} numberOfLines={1}>{r.source}</Text>
            </View>
            <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{hidden ? '••••' : MONEY(r.value)}</Text>
            <Ionicons name="chevron-forward" size={12} color={t.dark ? D.textMuted : '#c1b9ac'} style={{ marginLeft: 4 }} />
          </Pressable>
        ))
      )}
      {onAdd && !showEmptyState && (
        <Pressable onPress={onAdd} style={[s.worthRow, t.dividerBorder, { justifyContent: 'center' }]} testID={`nw-add-${title.toLowerCase()}`}>
          <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
          <Text style={{ color: '#9a6d32', fontSize: 10, fontWeight: '700', marginLeft: 6 }}>Add {title === 'Assets' ? 'asset' : 'liability'}</Text>
        </Pressable>
      )}
    </View>
  );
};

/* ---------------- Legacy / Coaching / Membership / Settings / More ---------------- */
const LegacyScreen = ({ investmentTotal, totalCash, monthlyNet, timeframe, setTimeframe, contribution, setContribution, hypothetical, setHypothetical, hypoFrequency, setHypoFrequency, hypoDuration, setHypoDuration, returnRate, setReturnRate, cumulative, setCumulative, currentAge, setCurrentAge, retirementAge, setRetirementAge }: any) => {
  const t = useThemed();
  const [editingHypo, setEditingHypo] = useState(false);
  const [hypoDraft, setHypoDraft] = useState('');
  const [hypoFreqDraft, setHypoFreqDraft] = useState<'onetime' | 'monthly' | 'annual'>('onetime');
  const [hypoDurDraft, setHypoDurDraft] = useState<string>('');
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState<string>(String(returnRate ?? DEFAULT_LEGACY_RATE));
  const [showMath, setShowMath] = useState(false);
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
  const monthlySurplus = Number(monthlyNet) || 0; // may be negative

  // ---- Projection math -----------------------------------------------------
  // BUILD (1-5yr): current cash + investments compounded at RATE + surplus over the period.
  //   Hypotheticals: one-time adds to invest principal; monthly/annual add to
  //   cash accretion for their active duration (capped at n if user set one).
  // GROW (10yr+ / Retirement): investments ONLY, monthly compounding + monthly contributions.
  //   Hypotheticals: one-time adds to starting principal; monthly adds to
  //   contribution stream; annual becomes annual/12 added to contribution.
  const buildProjectionAt = (n: number): number => {
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, n);
    const grownInvest = (investmentTotal + h.addToPrincipal) * Math.pow(1 + RATE, n);
    const cashPortion = totalCash + monthlySurplus * 12 * n + h.addToCash;
    return Math.round(grownInvest + cashPortion);
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
  }, [years, isBuild, totalCash, investmentTotal, hypoValue, hypoFreq, hypoDur, monthlySurplus, contribution, currentAge, retirementAge, RATE, MONTHLY_RATE]);

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
    ? `Cash grows from surplus only. Investments compound at ${Math.round(RATE * 100)}%.`
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
        <Text style={s.projectionStrong}>{years > 0 ? MONEY(projection) : '—'}</Text>
        <Text style={{ color: '#b4ada3', fontSize: 12, textAlign: 'center', maxWidth: 300, alignSelf: 'center' }}>
          {projectionSubtitle}
        </Text>
        <View style={s.growthChart}>
          {(isBuild ? [.30,.42,.56,.72,.86,1] : [.16,.24,.34,.48,.66,.84,1]).map((f, i) => (
            <LinearGradient key={i} colors={['#e8c98f','#8b6437']} style={[s.growthBar, { height: `${Math.max(18, f * 100)}%` }]} />
          ))}
        </View>
      </View>

      {/* Assumption chips — tap any to edit. These are the exact inputs used
          in the projection above so users can see and adjust them inline. */}
      <View style={[s.assumptionsCard, t.cardBg]} testID="legacy-assumptions">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>YOUR ASSUMPTIONS</Text>
          <Text style={[{ fontSize: 8 }, t.textMuted]}>Tap to edit</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {/* Return rate chip — always shown */}
          <Pressable onPress={() => { setRateDraft(String(returnRate ?? DEFAULT_LEGACY_RATE)); setEditingRate(true); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID="legacy-chip-rate">
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>RETURN</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{Math.round(RATE * 100)}%</Text>
          </Pressable>
          {/* Monthly contribution — GROW modes only */}
          {!isBuild && (
            <Pressable onPress={() => setContribution(contribution)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>CONTRIB / MO</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(contribution)}</Text>
            </Pressable>
          )}
          {/* Cash chip — BUILD modes only */}
          {isBuild && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>CASH</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(totalCash)}</Text>
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
            <>
              <Text style={[{ fontSize: 10, lineHeight: 15 }, t.textInk]}>
                <Text style={{ fontWeight: '800' }}>BUILD mode ({timeframe})</Text> — {years} year{years === 1 ? '' : 's'}.{'\n'}
              </Text>
              <View style={{ marginTop: 6, gap: 4 }}>
                <Row label={`Cash (grows only from surplus)`} value={`${MONEY(totalCash)} + ${MONEY(monthlySurplus)} × 12 × ${years}${hypoValue > 0 && hypoFreq !== 'onetime' ? ' + hypo' : ''}`} muted={t.textMuted} ink={t.textInk} />
                <Row label={`= Cash at Y${years}`} value={MONEY(totalCash + monthlySurplus * 12 * years + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToCash)} muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56" />
                <View style={{ height: 6 }} />
                <Row label={`Investments (compound @ ${Math.round(RATE * 100)}%)`} value={`${MONEY(investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal)} × (1 + ${(RATE).toFixed(2)})^${years}`} muted={t.textMuted} ink={t.textInk} />
                <Row label={`= Investments at Y${years}`} value={MONEY(Math.round((investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal) * Math.pow(1 + RATE, years)))} muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56" />
                <View style={{ height: 6 }} />
                <Row label="TOTAL PROJECTION" value={MONEY(projection)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
              </View>
              <Text style={[{ fontSize: 9, marginTop: 8, lineHeight: 13 }, t.textMuted]}>
                Cash does not grow at {Math.round(RATE * 100)}% — only what you add to it (your monthly surplus). The {Math.round(RATE * 100)}% return applies only to the invested portion.
              </Text>
            </>
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
              <Text style={[{ flex: 1, fontSize: 10, fontWeight: '700', textAlign: 'right' }, t.textInk]}>{MONEY(r.value)}</Text>
              <Text style={[{ flex: 1, fontSize: 10, textAlign: 'right' }, { color: r.delta >= 0 ? '#4c8b56' : '#b0453d' }]}>
                {r.delta >= 0 ? '+' : ''}{MONEY(r.delta)}
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
              <Row label="Current Cash" value={MONEY(totalCash)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Current Investments" value={MONEY(investmentTotal)} muted={t.textMuted} ink={t.textInk} />
              <Row
                label="Monthly Budget Surplus"
                value={MONEY(monthlySurplus)}
                muted={t.textMuted}
                ink={t.textInk}
                valueColor={monthlySurplus < 0 ? '#b0453d' : undefined}
              />
              {monthlySurplus < 0 && (
                <Text style={{ fontSize: 9, color: '#b0453d', marginTop: 2 }}>
                  Your budget currently spends more than it earns. There is no positive surplus to build wealth right now.
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
        <Text style={{ color: '#cda86d', fontSize: 9, letterSpacing: 1.2 }}>PRIVATE SESSION · 30 MIN</Text>
        <Text style={s.coachingPrice}>$50</Text>
        <Text style={{ color: '#aaa298', fontSize: 10, textAlign: 'center' }}>Work through your budget, goals, or next financial decision with Danyell.</Text>
      </View>

      {/* Single CTA — Stripe on jaleter.com handles the checkout and then
          redirects the user directly into Calendly to pick their slot.
          The previous 2-step "Schedule then Pay" flow is retired. */}
      <View style={{ marginTop: 18 }}>
        <Pressable
          onPress={() => openJaleter('coaching')}
          style={s.coachingCta}
          testID="coaching-book-pay"
        >
          <Ionicons name="lock-closed-outline" size={16} color="#fff" />
          <Text style={s.coachingCtaText}>Book & Pay at jaleter.com</Text>
          <Ionicons name="open-outline" size={14} color="#fff" />
        </Pressable>
        <Text style={[{ fontSize: 10, textAlign: 'center', marginTop: 10 }, t.textMuted]}>
          Secure Stripe checkout — Calendly opens automatically after payment.
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

      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};
const MembershipScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [membership, setMembership] = useState<{ active: boolean; expires_at: string | null; plan: string | null } | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/user/membership', { method: 'GET' }, token);
      setMembership(data);
    } catch { setMembership(null); }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Membership" subtitle="One simple annual plan." back={back} />
      <View style={[s.priceCard, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>JALETER PREMIUM</Text>
        <Text style={[s.priceStrong, t.textInk]}>$90<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}>/year</Text></Text>
        {membership?.active && (
          <View style={{ marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#8fa88f22', alignSelf: 'flex-start' }}>
            <Text style={{ color: '#5a7f60', fontSize: 10, fontWeight: '700' }}>ACTIVE · renews {new Date(membership.expires_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
          </View>
        )}
        {['Private statement import (any bank)','Full Budget and Transactions','Net Worth and Legacy planning','Faith + Focus library'].map(item => (
          <View key={item} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: t.dark ? D.textSubtle : '#615b52', fontSize: 11 }}>{item}</Text>
          </View>
        ))}
      </View>
      <BillingWebsiteNotice target="membership" />
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
      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
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
        <Text style={s.privacyPara}>Premium membership is $90 per year. Coaching is a separate $50 per hour service. Renewal and cancellation details are shown before checkout.</Text>
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
  }>({ enabled: true, threshold: 80, perCategory: {}, singleExpense: { enabled: false, threshold: 200 } });
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
          if (data.transactions) setTransactions(data.transactions);
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
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);
  // Persist on change (skip auth-managed fields)
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities, legacyTimeframe, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyCumulative, legacyReturnRate, budgetYear, categoriesByYear, currentAge, retirementAge })).catch(() => {});
  }, [hydrated, experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities, legacyTimeframe, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyCumulative, legacyReturnRate, budgetYear, categoriesByYear, currentAge, retirementAge]);

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
  const [accountsRefreshTick, setAccountsRefreshTick] = useState(0);
  const refreshAccounts = React.useCallback(() => setAccountsRefreshTick(n => n + 1), []);
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
    if (!auth.token) { setLinkedAccountBalances([]); setLinkedTransactions([]); return; }
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
      .catch(() => { if (alive) setLinkedAccountBalances([]); });
    // 2. Bank transactions (include everything — Activity shows all; other
    //    surfaces filter out transfers/CC payments via `isSystemTransaction`).
    apiCall('/api/accounts/transactions?limit=200&include_transfers=true', { method: 'GET' }, auth.token)
      .then((data: any) => {
        if (!alive) return;
        const raw = Array.isArray(data?.transactions) ? data.transactions : [];
        const reshaped: Tx[] = raw.map((r: any) => {
          const amt = Number(r.amount) || 0;
          const dateStr = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString();
          const period = MONTHS[new Date(dateStr).getMonth()] || currentMonth();
          const sys = r.system_category || null;
          // Any transfer / credit-card-payment / loan-payment auto-detected by
          // the backend classifier becomes a first-class Transfer in the UI —
          // so it's never counted as income or expense (spec: transfers must
          // not affect Net Worth or Budget totals).
          const isSystemTransfer = sys === 'transfer' || sys === 'credit_card_payment' || sys === 'loan_payment' || !!r.is_transfer;
          const derivedType: Tx['type'] = isSystemTransfer ? 'transfer' : (amt >= 0 ? 'income' : 'expense');
          return {
            id: `bank-${r.external_id}`,
            external_id: r.external_id,
            date: dateStr,
            name: r.description || r.name || 'Transaction',
            merchant: (r.merchant || '').trim() || undefined,
            amount: Math.abs(amt),
            type: derivedType,
            groupId: '',
            detailId: '',
            origin: r.org_name || 'Linked',
            period,
            system_category: sys,
            is_transfer: !!r.is_transfer || isSystemTransfer,
          } as Tx;
        });
        setLinkedTransactions(reshaped);
      })
      .catch(() => { if (alive) setLinkedTransactions([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token, linkedAccounts.length, stage, accountsRefreshTick]);
  // Effective list used across the app — manual first (users' overrides
  // win), then linked. Duplicates by external_id are avoided since manual
  // txns don't set that field.
  const mergedTransactions = React.useMemo(() => {
    const seen = new Set<string>(transactions.filter(t => (t as any).external_id).map(t => (t as any).external_id));
    const linkedOnly = linkedTransactions.filter(t => !seen.has(t.external_id as string));
    return [...transactions, ...linkedOnly].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [transactions, linkedTransactions]);
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
  const manualInvestments = syncedAssets.find((x: any) => x.id === 'investments')?.value || 0;
  const investmentTotal = manualInvestments + linkedInvestmentTotal;
  const totalCash = syncedCash + linkedCashTotal; // Cash-only linked accounts, per spec #2
  // Net Worth = Manual assets (already includes cash/investments seeds) + linked
  // non-cash/non-investment assets - manual liabilities - linked liabilities.
  const manualLiabilitiesTotal = liabilities.reduce((sum, x) => sum + x.value, 0);
  const netWorth =
    manualAssetsTotal
    + linkedRealEstateTotal + linkedVehiclesTotal + linkedOtherAssetsTotal
    // syncedAssets already contains the manual cash/investment values; add the
    // linked cash + investment portions on top.
    + linkedCashTotal + linkedInvestmentTotal
    - manualLiabilitiesTotal - linkedLiabilitiesTotal;
  const monthlyBudgetIncome = incomeSources.reduce((sum, x) => sum + x.budgeted, 0);
  const monthlyBudgetExpense = categories.flatMap(c => c.subcategories).reduce((sum, x) => sum + x.budgeted, 0);
  const monthlyNet = monthlyBudgetIncome - monthlyBudgetExpense;
  const monthlyBudget = monthlyBudgetExpense;
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
          {active === 'home' && <HomeScreen name={displayName} initials={displayInitials} experience={experience} netWorth={netWorth} investmentTotal={investmentTotal} totalCash={totalCash} monthlyNet={monthlyNet} legacyContribution={legacyContribution} legacyHypothetical={legacyHypothetical} legacyHypoFrequency={legacyHypoFrequency} legacyHypoDuration={legacyHypoDuration} legacyReturnRate={legacyReturnRate} budgetUsage={budgetUsage} alertsEnabled={alerts.enabled} navigate={nav} />}
          {active === 'budget' && <BudgetScreen categories={categories} setCategories={setCategories} categoriesByYear={categoriesByYear} incomeSources={incomeSources} setIncomeSources={setIncomeSources} transactions={transactions} setTransactions={setTransactions} focusCategory={focusCategory} clearFocus={() => setFocusCategory(null)} alerts={alerts} budgetYear={budgetYear} onSwitchYear={switchBudgetYear} onCopyLastYear={(prevYear: number) => {
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
          {active === 'networth' && <NetWorthScreen assets={syncedAssets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} transactions={transactions} restrictedBuckets={restrictedBuckets} setRestrictedBuckets={setRestrictedBuckets} linkedRowsByCategory={linkedRowsByCategory} linkedByCategory={linkedByCategory} onRefreshAccounts={refreshAccounts} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={validLinked.length} onBack={() => setActive('home')} />}
          {active === 'legacy' && <LegacyScreen investmentTotal={investmentTotal} totalCash={totalCash} monthlyNet={monthlyNet} timeframe={legacyTimeframe} setTimeframe={setLegacyTimeframe} contribution={legacyContribution} setContribution={setLegacyContribution} hypothetical={legacyHypothetical} setHypothetical={setLegacyHypothetical} hypoFrequency={legacyHypoFrequency} setHypoFrequency={setLegacyHypoFrequency} hypoDuration={legacyHypoDuration} setHypoDuration={setLegacyHypoDuration} returnRate={legacyReturnRate} setReturnRate={setLegacyReturnRate} cumulative={legacyCumulative} setCumulative={setLegacyCumulative} currentAge={currentAge} setCurrentAge={setCurrentAge} retirementAge={retirementAge} setRetirementAge={setRetirementAge} />}
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
      {globalToast && <Toast message={globalToast} onHide={() => setGlobalToast(null)} />}
    </SafeAreaView>
    </ThemeCtx.Provider>
  );
}

/* ---------------- Styles ---------------- */
const s = StyleSheet.create({
  appShell: { flex: 1 },
  lightScreen: { flex: 1, backgroundColor: C.cream },
  page: { flex: 1, backgroundColor: C.cream, paddingHorizontal: 21, paddingTop: 12 },
  goldBtn: { borderRadius: 28, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  goldBtnText: { color: '#17130c', fontWeight: '700', fontSize: 15 },
  loginLink: { color: C.muted4, textAlign: 'center', fontSize: 12 },
  circleBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.creamAlt2, shadowColor: '#4d3824', shadowOpacity: 0.07, shadowRadius: 8 },
  /* Welcome */
  welcome: { flex: 1, backgroundColor: '#080807', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  welcomeGlow: { position: 'absolute', top: '18%', width: 480, height: 480, borderRadius: 240, backgroundColor: '#8a6222', opacity: 0.28 },
  welcomeCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, width: '100%' },
  sparkleCluster: { width: 60, height: 30, position: 'relative', marginBottom: 4 },
  welcomeH1: { color: '#f3d18b', fontSize: 82, fontFamily: F.serifBold, letterSpacing: -1.5, lineHeight: 92 },
  welcomeSubtitle: { color: '#c9c3ba', fontSize: 11, letterSpacing: 3, textAlign: 'center', marginTop: 2 },
  curveStack: { alignItems: 'center', width: '100%' },
  goldArc: { height: 34, borderTopWidth: 1, borderRadius: 320, alignSelf: 'center' },
  goldPill: { width: '82%', borderRadius: 30, overflow: 'hidden', shadowColor: '#e2b06a', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  goldPillFill: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  goldPillText: { color: '#1a1305', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  /* Onboarding */
  onboardHeading: { alignItems: 'center', marginTop: 30, marginBottom: 24 },
  miniLogo: { width: 47, height: 47, borderRadius: 15, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  miniLogoText: { color: '#e5bd79', fontSize: 25, fontFamily: F.serif, fontWeight: '600' },
  eyebrow: { color: C.goldEyebrow, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, marginBottom: 10 },
  onboardH1: { fontSize: 30, fontFamily: F.serif, fontWeight: '600', color: C.ink, textAlign: 'center', lineHeight: 34, marginBottom: 10 },
  onboardHint: { color: '#817b72', fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 18 },
  expCard: { minHeight: 88, borderWidth: 1, borderColor: C.border3, borderRadius: 20, padding: 15, backgroundColor: C.creamAlt, flexDirection: 'row', gap: 12, alignItems: 'center' },
  expCardSelected: { borderColor: '#c7924d', backgroundColor: '#fffcf6' },
  expIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  expName: { fontSize: 15, fontFamily: F.serif, fontWeight: '600', color: C.ink },
  expText: { color: '#837d74', fontSize: 10, lineHeight: 14, marginTop: 2 },
  expRecommended: { position: 'absolute', right: 14, top: 10, color: '#ae7e3f', fontSize: 8, letterSpacing: 0.7 },
  selDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: '#d8d0c4', alignItems: 'center', justifyContent: 'center' },
  selDotOn: { borderColor: '#b8813c', backgroundColor: '#b8813c' },
  /* Signup */
  label: { marginTop: 14, marginBottom: 6, fontSize: 10, fontWeight: '700', color: C.ink },
  input: { paddingHorizontal: 13, paddingVertical: 13, borderWidth: 1, borderColor: '#e2dcd2', borderRadius: 13, backgroundColor: '#fff', fontSize: 13, color: C.ink },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: '#d8d0c4', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#ad7938', borderColor: '#ad7938' },
  /* Connect */
  connectLock: { width: 65, height: 65, borderRadius: 21, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  connectBenefits: { marginVertical: 20, padding: 14, borderWidth: 1, borderColor: C.border3, borderRadius: 20, backgroundColor: C.creamAlt },
  /* Paywall */
  paywallMark: { width: 55, height: 55, borderRadius: 18, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 40 },
  priceCard: { marginVertical: 14, padding: 21, borderWidth: 1, borderColor: '#e2d3bd', borderRadius: 22, backgroundColor: '#fdf6e8' },
  priceStrong: { fontSize: 34, fontFamily: F.serif, fontWeight: '600', color: C.ink, marginVertical: 8 },
  /* Header */
  pageHeader: { paddingTop: 22, marginBottom: 19 },
  headerActions: { minHeight: 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  pageTitle: { fontSize: 30, fontFamily: F.serif, fontWeight: '600', color: C.ink, marginTop: 8 },
  pageSubtitle: { color: C.muted, fontSize: 12, marginTop: 4 },
  /* Segmented */
  segmented: { minHeight: 39, borderWidth: 1, borderColor: C.border, borderRadius: 15, padding: 3, flexDirection: 'row', backgroundColor: '#f6f2eb', marginBottom: 16 },
  pill: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  pillSelected: { backgroundColor: '#fff' },
  pillText: { fontSize: 11, color: '#746f68' },
  pillTextSelected: { color: C.ink2, fontWeight: '700' },
  /* Home */
  homeGreeting: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 24, marginBottom: 20 },
  homeDate: { color: C.goldEyebrow, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  homeName: { fontSize: 26, fontFamily: F.serif, fontWeight: '600', color: C.ink, marginTop: 5 },
  inspirationCard: { minHeight: 175, padding: 24, borderRadius: 22, backgroundColor: '#161511', marginBottom: 16 },
  inspirationQuote: { fontFamily: F.serif, fontSize: 17, color: '#f8f0e2', fontWeight: '500', lineHeight: 24, marginVertical: 16, maxWidth: 310 },
  coachCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161511', borderRadius: 18, padding: 16,
    marginBottom: 16, borderWidth: 1, borderColor: '#3a2f1c',
  },
  coachCardIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  coachCardTitle: { fontFamily: F.serif, fontSize: 16, color: '#f8f0e2', fontWeight: '600', marginTop: 3 },
  coachCardSub: { color: '#aaa297', fontSize: 10, lineHeight: 14, marginTop: 3, maxWidth: 240 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 12 },
  sectionH3: { fontSize: 13, fontWeight: '700', color: C.ink },
  sectionCap: { color: '#9a948b', fontSize: 10 },
  snapshotCard: { flex: 1, minHeight: 127, padding: 17, borderWidth: 1, borderColor: '#ece6dd', borderRadius: 19, backgroundColor: C.creamAlt2 },
  snapshotDark: { borderColor: '#1a1916', backgroundColor: C.ink3 },
  snapshotLabel: { color: '#736e67', fontSize: 10 },
  snapshotValue: { fontFamily: F.serif, fontWeight: '600', fontSize: 24, color: C.ink, marginVertical: 8 },
  snapshotMeta: { color: '#8d877f', fontSize: 9, marginTop: 8 },
  miniProgress: { height: 5, backgroundColor: '#ece7df', borderRadius: 5, overflow: 'hidden' },
  miniProgressBar: { height: '100%', backgroundColor: '#c79a59' },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 13, borderWidth: 1, borderColor: C.alertBorder, borderRadius: 17, backgroundColor: C.alertBg },
  alertIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.alertIconBg, alignItems: 'center', justifyContent: 'center' },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 13, borderWidth: 1, borderColor: C.streakBorder, borderRadius: 17, backgroundColor: C.streakBg },
  legacyTeaser: { minHeight: 150, padding: 22, borderRadius: 21, backgroundColor: '#161510', overflow: 'hidden', marginTop: 8 },
  legacyStrong: { fontFamily: F.serif, fontSize: 30, fontWeight: '600', color: '#fff', marginVertical: 6 },
  teaserBars: { position: 'absolute', right: 20, bottom: 20, width: 115, height: 80, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  teaserBar: { width: 11, borderRadius: 5 },
  teaserBarsFlow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 92, marginTop: 4 },
  teaserBarFlow: { width: 14, borderRadius: 5 },
  /* Budget */
  budgetSummary: { flexDirection: 'row', gap: 1, marginBottom: 12, borderRadius: 19, overflow: 'hidden', backgroundColor: '#302d28' },
  viewToggle: { flexDirection: 'row', gap: 4, backgroundColor: '#f2ecdf', borderRadius: 12, padding: 3 },
  viewTogglePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  viewTogglePillActive: { backgroundColor: '#fff' },
  budgetActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  budgetActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e7d9be', backgroundColor: '#fbf5e9' },
  budgetActionText: { color: '#9a6d32', fontSize: 11, fontWeight: '700' },
  gridHeader: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: '#faf5eb', borderRadius: 12, borderWidth: 1, borderColor: '#eadfc2', marginBottom: 6 },
  gridHeaderText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: '#7a6d55' },
  gridGroupRow: { paddingVertical: 6, paddingHorizontal: 8, backgroundColor: '#f5efdf' },
  gridGroupText: { fontSize: 10, fontWeight: '800', color: '#8a6d3a' },
  gridRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f1ede6' },
  gridSubText: { fontSize: 10, fontWeight: '600', color: C.ink3 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  alertPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: '#e2d6b7', backgroundColor: '#fbf5e9' },
  alertPillOn: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  alertPillText: { fontSize: 9, fontWeight: '800', color: '#8a6d3a' },
  gate: { flex: 1, backgroundColor: '#090908', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 40 },
  gateTitle: { color: '#f5e8ca', fontSize: 26, fontFamily: F.serif, fontWeight: '600', marginTop: 14, letterSpacing: 2.5 },
  gateSub: { color: '#a19381', fontSize: 12, marginTop: 6, marginBottom: 24 },
  pinDots: { flexDirection: 'row', gap: 12 },
  pinDot: { width: 14, height: 14, borderRadius: 8, borderWidth: 1, borderColor: '#7d6a4a', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: '#e2b96f', borderColor: '#e2b96f' },
  pinErr: { color: '#e79b7c', fontSize: 11, marginTop: 12, minHeight: 14 },
  pinPad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 20, maxWidth: 260 },
  pinBtn: { width: 70, height: 70, borderRadius: 40, backgroundColor: '#1b1915', alignItems: 'center', justifyContent: 'center' },
  pinBtnText: { color: '#f0e6cf', fontSize: 22, fontWeight: '500' },
  bioBtn: { marginTop: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: '#5a4a2f' },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  calNavBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fbf5e9', borderWidth: 1, borderColor: '#eadfc2', alignItems: 'center', justifyContent: 'center' },
  calMonth: { fontSize: 13, fontWeight: '700', fontFamily: F.serif },
  calWeekRow: { flexDirection: 'row', paddingHorizontal: 2, marginBottom: 4 },
  calWeekText: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '800', letterSpacing: 0.4, color: '#9a938a' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100/7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 22, marginBottom: 2 },
  calCellText: { fontSize: 12, fontWeight: '600' },
  calCellSelected: { backgroundColor: '#b28a4c' },
  timeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#eae3d5', backgroundColor: '#fff' },
  timeChipActive: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  timeChipText: { fontSize: 11, fontWeight: '700', color: '#3a3428' },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#eae3d5', backgroundColor: '#fff' },
  pickerChipOn: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  pickerChipText: { fontSize: 10, fontWeight: '700', color: '#3a3428' },
  stepCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#e7d9be', backgroundColor: '#fff' },
  coachingCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: '#0f0e0c',
  },
  coachingCtaText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f4e6c8', alignItems: 'center', justifyContent: 'center' },
  stepBadgeText: { color: '#8a6d3a', fontSize: 12, fontWeight: '800' },
  stepBtnPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#fbf5e9', borderWidth: 1, borderColor: '#e0cfa4' },
  stepBtnPillText: { color: '#8a6d3a', fontSize: 11, fontWeight: '800' },
  budgetSumCell: { flex: 1, padding: 14, backgroundColor: C.ink3 },
  bsSmall: { color: '#aaa39a', fontSize: 8 },
  bsStrong: { fontFamily: F.serif, fontWeight: '600', fontSize: 16, color: '#fff', marginVertical: 3 },
  budgetCategory: { padding: 15, borderWidth: 1, borderColor: C.border, borderRadius: 19, backgroundColor: C.creamAlt },
  categorySummary: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  purposeIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  purposeIconText: { color: C.goldSoft, fontSize: 16, fontFamily: F.serif, fontWeight: '600' },
  categoryProgress: { height: 5, marginTop: 12, backgroundColor: '#eee9e2', borderRadius: 5, overflow: 'hidden' },
  categoryProgressBar: { height: '100%' },
  categoryMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  subcategoryList: { marginTop: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: C.border2 },
  yearTotalTop: { backgroundColor: '#0f0e0c', borderRadius: 18, padding: 20, marginTop: 12, marginBottom: 4 },
  yearSelectorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  yearSelectorLabel: { fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 1.2 },
  yearPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fff' },
  yearPillActive: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  yearPillText: { fontSize: 11, fontWeight: '800', color: '#615b52', letterSpacing: 0.4 },
  yearPillTextActive: { color: '#fff' },
  yearTotalBottom: { backgroundColor: '#fbf6ec', borderRadius: 18, padding: 20, marginTop: 12, borderWidth: 1, borderColor: '#e8dcc4' },
  yearTotalEyebrow: { color: '#c9a56c', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  yearTotalStrong: { color: '#EED7AB', fontSize: 32, fontWeight: '700', marginTop: 4, fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }) },
  yearTotalSub: { color: '#8e8a83', fontSize: 10, marginTop: 4 },
  subcategoryRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1ede6' },
  subHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#e8dcc4' },
  subHeaderName: { flex: 1, fontSize: 8, fontWeight: '800', color: C.muted2, letterSpacing: 0.6, textTransform: 'uppercase' },
  subHeaderCol: { width: 62, textAlign: 'right', fontSize: 8, fontWeight: '800', color: C.muted2, letterSpacing: 0.6, textTransform: 'uppercase' },
  subCol: { width: 62, textAlign: 'right', fontSize: 11, fontWeight: '700', color: C.ink },
  /* Transactions */
  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderWidth: 1, borderColor: '#dce8dd', borderRadius: 17, backgroundColor: C.streakBg, marginBottom: 12 },
  syncIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#dfece1', alignItems: 'center', justifyContent: 'center' },
  transactionList: { marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 19, backgroundColor: C.creamAlt, overflow: 'hidden' },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderBottomWidth: 1, borderBottomColor: C.border2 },
  txIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#f2ece2', alignItems: 'center', justifyContent: 'center' },
  amountInput: { position: 'relative', marginTop: 6 },
  amountPrefix: { position: 'absolute', left: 14, top: 15, zIndex: 2, fontWeight: '500' },
  /* Net Worth */
  nwHero: { minHeight: 180, padding: 22, borderRadius: 23, backgroundColor: '#161512', marginBottom: 13, position: 'relative', overflow: 'hidden' },
  nwHeroStrong: { fontFamily: F.serif, fontSize: 34, fontWeight: '600', color: '#fff', marginVertical: 8 },
  nwChart: { position: 'absolute', left: 22, right: 22, bottom: 14, height: 80 },
  nwChartDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#d0a665', marginLeft: -3 },
  cashProtection: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 15, borderWidth: 1, borderColor: '#e3d4bd', borderRadius: 18, backgroundColor: '#fffaf2', marginBottom: 12 },
  cpSmall: { color: '#948a7c', fontSize: 8 },
  cpStrong: { fontFamily: F.serif, fontSize: 13, fontWeight: '600', color: C.ink, marginTop: 4 },
  cpAvailable: { padding: 9, borderRadius: 11, backgroundColor: C.ink3 },
  worthCard: { marginVertical: 8, borderWidth: 1, borderColor: C.border, borderRadius: 19, backgroundColor: C.creamAlt, overflow: 'hidden' },
  worthCardHeading: { padding: 15, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.border2 },
  worthRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 13, borderBottomWidth: 1, borderBottomColor: '#f0ebe4' },
  worthIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f1ece4', alignItems: 'center', justifyContent: 'center' },
  /* Legacy */
  projectionCard: { minHeight: 300, padding: 24, borderRadius: 24, backgroundColor: '#131210', alignItems: 'center' },
  projectionStrong: { fontFamily: F.serif, fontSize: 36, fontWeight: '600', color: '#fff', marginVertical: 8 },
  growthChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, marginTop: 30, width: '90%', height: 140, borderBottomWidth: 1, borderBottomColor: '#ffffff22' },
  growthBar: { flex: 1, maxWidth: 25, borderRadius: 6 },
  assumptionsCard: { marginTop: 13, padding: 20, borderWidth: 1, borderColor: C.border, borderRadius: 20, backgroundColor: C.creamAlt },
  stepBtn: { flex: 1, height: 40, borderRadius: 12, backgroundColor: '#eee9e2', alignItems: 'center', justifyContent: 'center' },
  /* Coaching / Membership / More */
  coachingCard: { padding: 24, borderRadius: 22, backgroundColor: C.ink3, alignItems: 'center' },
  coachingIcon: { width: 51, height: 51, borderRadius: 17, backgroundColor: '#2a251e', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  coachingPrice: { fontFamily: F.serif, fontSize: 26, fontWeight: '600', color: '#fff', marginVertical: 6 },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  moreHero: { padding: 22, marginBottom: 13, borderRadius: 22, backgroundColor: C.ink3 },
  moreHeroH2: { fontFamily: F.serif, fontSize: 23, fontWeight: '600', color: '#fff', marginVertical: 8 },
  moreGridBtn: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 18, backgroundColor: C.creamAlt },
  moreGridIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#f2ece2', alignItems: 'center', justifyContent: 'center' },
  /* Settings */
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  settingsSection: { marginVertical: 10, padding: 17, borderWidth: 1, borderColor: C.border, borderRadius: 20, backgroundColor: C.creamAlt },
  settingsH3: { fontSize: 13, fontWeight: '700', color: C.ink },
  settingsSub: { fontSize: 10, color: C.muted2, marginTop: 4, marginBottom: 12 },
  settingToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  toggle: { width: 37, height: 22, borderRadius: 15, backgroundColor: '#ddd8d0', padding: 2 },
  toggleOn: { backgroundColor: '#b48243' },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderWidth: 1, borderColor: '#ebd9d4', borderRadius: 16, backgroundColor: '#fff9f7', marginTop: 12 },
  formError: { color: C.danger, fontSize: 11, marginTop: 10, marginBottom: -4 },
  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: C.border, borderRadius: 14, backgroundColor: C.creamAlt, marginBottom: 8 },
  linkedIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#f2ece2', alignItems: 'center', justifyContent: 'center' },
  linkedBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f2ece2', alignItems: 'center', justifyContent: 'center' },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 12 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#d8d2c7' },
  orText: { fontSize: 10, color: C.muted2, letterSpacing: 1.5 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 46, borderWidth: 1, borderColor: '#dcd6cb', borderRadius: 26, backgroundColor: '#fff' },
  googleBtnText: { color: C.ink, fontSize: 13, fontWeight: '600' },
  settingsMenu: { marginVertical: 10, paddingHorizontal: 15, paddingVertical: 4, borderWidth: 1, borderColor: C.border, borderRadius: 20, backgroundColor: C.creamAlt },
  settingsMenuBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 61, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border2 },
  settingsRowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#f0ebe3', alignItems: 'center', justifyContent: 'center' },
  /* Sheets extra */
  bankBtn: { minWidth: '47%', minHeight: 70, padding: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e1dbd1', borderRadius: 15, backgroundColor: '#fff' },
  bankBtnSelected: { borderColor: '#b78343', backgroundColor: '#fff7e9' },
  secureHandoff: { alignItems: 'center', gap: 10, padding: 22, borderWidth: 1, borderColor: '#e7dfd3', borderRadius: 18, backgroundColor: C.creamAlt },
  subscriptionCard: { marginVertical: 12, padding: 20, borderRadius: 18, backgroundColor: C.ink3 },
  privacyPara: { color: '#625e58', fontSize: 11, lineHeight: 18, marginBottom: 8 },
  /* Bottom nav */
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 79, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 16, flexDirection: 'row', backgroundColor: '#faf8f2f5', borderTopWidth: 1, borderTopColor: C.border2 },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  navIndicator: { position: 'absolute', top: 0, width: 24, height: 2, backgroundColor: C.gold, borderRadius: 3 },
  navLabel: { fontSize: 9, color: '#918b83' },
  /* Modal */
  modalBackdrop: { flex: 1, backgroundColor: '#17130e66', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fbf9f4', padding: 24, paddingTop: 30, borderTopLeftRadius: 27, borderTopRightRadius: 27, maxHeight: '90%' },
  modalClose: { position: 'absolute', right: 20, top: 20, width: 35, height: 35, borderRadius: 18, backgroundColor: '#eee9e0', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  sheetTitle: { fontFamily: F.serif, fontSize: 24, fontWeight: '600', color: C.ink, marginRight: 45 },
  sheetSubtitle: { color: '#858078', fontSize: 11, marginTop: 5, marginBottom: 12 },
  /* Toast */
  toast: { position: 'absolute', left: 22, right: 22, bottom: 100, minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 13, borderRadius: 14, backgroundColor: '#181714ee' },
  toastText: { color: '#f3ecdf', fontSize: 11, flex: 1 },
});
