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
type Tx = { id: string; date: string; name: string; amount: number; type: 'income' | 'expense'; groupId: string; detailId?: string; origin: string; period: string; };
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
  return (
    <View style={[s.segmented, t.pillBg]} testID={testID}>
      {values.map((v: string) => (
        <Pressable key={v} testID={`${testID}-${v}`} onPress={() => onChange(v)} style={[s.pill, value === v && s.pillSelected, value === v && t.pillSelectedBg]}>
          <Text style={[s.pillText, t.textMuted, value === v && s.pillTextSelected, value === v && t.textInk]}>{v}</Text>
        </Pressable>
      ))}
    </View>
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
// Per Apple/Google in-app rules, this shows text-only guidance (no clickable link on iOS).
const BillingWebsiteNotice = ({ compact = false }: { compact?: boolean }) => {
  const t = useThemed();
  return (
    <View style={[billingNoticeStyles.card, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
      <View style={billingNoticeStyles.iconWrap}>
        <Ionicons name="globe-outline" size={16} color={C.goldEyebrow} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[billingNoticeStyles.title, t.textInk]}>Billing lives at jaleter.com</Text>
        <Text style={[billingNoticeStyles.body, t.textMuted]}>
          {compact
            ? 'Manage payments and subscriptions on our website.'
            : 'To keep prices honest and avoid App Store fees, all payments and subscription management happen on our secure website. Visit jaleter.com on any browser to purchase or renew.'}
        </Text>
      </View>
    </View>
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
          <Text style={{ fontSize: 12, color: C.ink, flex: 1 }}>I agree to Jaleter&apos;s Terms and Privacy Policy.</Text>
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
        <Text style={s.priceStrong}>$75<Text style={{ fontSize: 13, color: '#8d867d', fontWeight: '500' }}>/year</Text></Text>
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
const HomeScreen = ({ name, initials, experience, netWorth, investmentTotal, budgetUsage, alertsEnabled, navigate }: any) => {
  const t = useThemed();
  const q = dailyQuote(experience as QuoteType, new Date());
  // Same math as the Legacy screen: compound the user's real investment total at 8% over 33 years.
  // If they have no linked investments, show the "Start your legacy" CTA.
  const projected = investmentTotal > 0 ? Math.round(investmentTotal * Math.pow(1.08, 33)) : 0;
  const hasProjection = projected > 0;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <View style={s.homeGreeting}>
        <View style={{ flex: 1 }}>
          <Text style={s.homeDate}>{today}</Text>
          <Text style={[s.homeName, t.textInk]}>Good evening, {name}.</Text>
        </View>
        <CircleBtn onPress={() => navigate('settings')} testID="home-bell"><Ionicons name="notifications-outline" size={18} color={C.ink3} /></CircleBtn>
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
              33-year compounding of your current investments.
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
  const incomeActualForMonth = (srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi]).reduce((s: number, t: Tx) => s + t.amount, 0);
  const expenseActualForMonth = (subId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === subId && t.period === MONTHS[mi]).reduce((s: number, t: Tx) => s + t.amount, 0);
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
  ws1['!freeze'] = { xSplit: 0, ySplit: 4 };
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
  ws3['!freeze'] = { xSplit: 1, ySplit: 4 };
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
  ws4['!freeze'] = { xSplit: 0, ySplit: 1 };
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
const BudgetScreen = ({ categories, setCategories, incomeSources, setIncomeSources, transactions, focusCategory, clearFocus, alerts }: any) => {
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
  const annual = period === 'Year';
  const mIdx = annual ? -1 : monthIndex(period);
  useEffect(() => { if (focusCategory) { setExpanded(x => x.includes(focusCategory) ? x : [...x, focusCategory]); clearFocus(); } }, [focusCategory]);

  const relevant = transactions.filter((t: Tx) => annual || t.period === period);
  const actualIncome = relevant.filter((t: Tx) => t.type === 'income').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const actualExpenses = relevant.filter((t: Tx) => t.type === 'expense').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
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

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Budget" subtitle="Give first. Steward wisely. Grow intentionally." action={
        <View style={s.viewToggle}>
          <Pressable onPress={() => setView('cards')} style={[s.viewTogglePill, view === 'cards' && s.viewTogglePillActive]} testID="budget-view-cards"><Ionicons name="albums-outline" size={13} color={view === 'cards' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
          <Pressable onPress={() => setView('grid')} style={[s.viewTogglePill, view === 'grid' && s.viewTogglePillActive]} testID="budget-view-grid"><Ionicons name="grid-outline" size={13} color={view === 'grid' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
        </View>
      } />
      <PeriodPills values={[...MONTHS, 'Year']} value={period} onChange={setPeriod} testID="budget-period" />
      {annual && (
        <View style={s.yearTotalTop}>
          <Text style={s.yearTotalEyebrow}>TOTAL INCOME · {new Date().getFullYear()}</Text>
          <Text style={s.yearTotalStrong}>{MONEY(actualIncome)}</Text>
          <Text style={s.yearTotalSub}>Expected {MONEY(plannedIncome)} · {plannedIncome > 0 ? Math.round((actualIncome / plannedIncome) * 100) : 0}% received</Text>
        </View>
      )}
      {!annual && (
        <View style={s.budgetSummary}>
          <View style={s.budgetSumCell}><Text style={s.bsSmall}>Total Income</Text><Text style={s.bsStrong}>{MONEY(actualIncome)}</Text><Text style={s.bsSmall}>of {MONEY(plannedIncome)}</Text></View>
          <View style={s.budgetSumCell}><Text style={s.bsSmall}>Expenses</Text><Text style={s.bsStrong}>{MONEY(actualExpenses)}</Text><Text style={s.bsSmall}>actual</Text></View>
          <View style={s.budgetSumCell}><Text style={s.bsSmall}>Net</Text><Text style={s.bsStrong}>{MONEY(actualIncome - actualExpenses)}</Text><Text style={s.bsSmall}>remaining</Text></View>
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
          incomeReceivedForMonth={(srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi]).reduce((s: number, t: Tx) => s + t.amount, 0)}
          spentInSub={(id: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === id && t.period === MONTHS[mi]).reduce((s: number, t: Tx) => s + t.amount, 0)}
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
const TransactionsScreen = ({ transactions, setTransactions, categories, incomeSources, openLinkSheet }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [filter, setFilter] = useState('All');
  const [editing, setEditing] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [importing, setImporting] = useState(false);
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  const [linkedLoaded, setLinkedLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => { if (alive) { setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []); setLinkedLoaded(true); } })
      .catch(() => { if (alive) { setLinkedRows([]); setLinkedLoaded(true); } });
    return () => { alive = false; };
  }, [token, transactions.length]);
  const shown = transactions.filter((tx: Tx) => filter === 'All' || (filter === 'Income' ? tx.type === 'income' : tx.type === 'expense'));
  const save = (t: any) => {
    setTransactions((xs: Tx[]) => xs.some(x => x.id === t.id) ? xs.map(x => x.id === t.id ? t : x) : [{ ...t, id: `manual-${Date.now()}`, origin: 'Manual', period: currentMonth() }, ...xs]);
    setEditing(null); setToast('Transaction saved and totals refreshed.');
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
      <Pressable onPress={banner.kind === 'empty' ? openLinkSheet : undefined} style={[s.syncBanner, bannerBg]} testID="tx-sync-banner">
        <View style={[s.syncIcon, { backgroundColor: t.dark ? '#00000033' : '#ffffffbb' }]}><Ionicons name={banner.icon} size={18} color={banner.iconColor} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.text : '#3a3428' }}>{banner.title}</Text>
          <Text style={{ fontSize: 8, color: t.dark ? D.textMuted : '#7a6f5c' }}>{banner.sub}</Text>
        </View>
        <Ionicons name={banner.kind === 'empty' ? 'chevron-forward' : 'checkmark'} size={16} color={banner.iconColor} />
      </Pressable>
      <PeriodPills values={['All','Income','Expenses']} value={filter} onChange={setFilter} testID="tx-filter" />
      <View style={[s.transactionList, t.cardBg]}>
        {shown.length === 0 && (
          <View style={{ padding: 30, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={28} color={t.dark ? D.textMuted : '#c1b9ac'} />
            <Text style={[{ fontSize: 11, marginTop: 8 }, t.textMuted]}>No transactions yet.</Text>
            <Text style={[{ fontSize: 9, marginTop: 3 }, t.textMuted]}>Link a bank, import a file, or add one manually.</Text>
          </View>
        )}
        {shown.map((tx: Tx) => (
          <Pressable key={tx.id} style={[s.transactionRow, t.dividerBorder]} onPress={() => setEditing(tx)} testID={`tx-${tx.id}`}>
            <View style={[s.txIcon, tx.type === 'income' && { backgroundColor: '#e7f0e8' }]}>
              <Ionicons name={tx.type === 'income' ? 'trending-up' : 'receipt-outline'} size={16} color={tx.type === 'income' ? '#4e765c' : '#886f4b'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]}>{tx.name}</Text>
              <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>{tx.date} · {tx.origin}</Text>
            </View>
            <Text style={[{ fontSize: 11, fontWeight: '700', color: tx.type === 'income' ? '#568066' : C.ink }, tx.type === 'expense' && t.textInk]}>{tx.type === 'income' ? '+' : '−'}{EXACT(tx.amount)}</Text>
            <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#b1aaa0'} />
          </Pressable>
        ))}
      </View>
      <Sheet visible={!!editing} close={() => setEditing(null)} title={editing?.id ? 'Edit transaction' : 'Add transaction'} subtitle="Manual changes immediately update Budget and cash.">
        {editing && <TxForm item={editing} categories={categories} incomeSources={incomeSources} save={save} remove={editing.id ? remove : null} />}
      </Sheet>
      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};
const TxForm = ({ item, categories, incomeSources, save, remove }: any) => {
  const [t, setT] = useState({ ...item, amount: String(item.amount || '') });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const isIncome = t.type === 'income';
  const currentGroup = isIncome ? incomeSources.find((s: any) => s.id === t.groupId) : categories.find((c: any) => c.id === t.groupId);
  const currentSubs = !isIncome && currentGroup ? currentGroup.subcategories : [];

  // Parse the current date string. Fallback to today.
  const parsedDate = (() => {
    if (!t.date) return new Date();
    const d = new Date(t.date);
    return isNaN(d.getTime()) ? new Date() : d;
  })();
  const displayDate = parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const isoDateForInput = parsedDate.toISOString().slice(0, 10); // yyyy-mm-dd for native <input type="date">

  const setDateFromValue = (d: Date) => {
    if (!isNaN(d.getTime())) {
      setT({ ...t, date: d.toISOString() });
    }
  };

  return (
    <View>
      {/* Type selector — Income appears BEFORE Expense, both Title-Case */}
      <PeriodPills
        values={['Income', 'Expense']}
        value={t.type === 'income' ? 'Income' : 'Expense'}
        onChange={(label: string) => {
          const v = label.toLowerCase();
          setT({
            ...t,
            type: v,
            groupId: v === 'income' ? (incomeSources[0]?.id || 'w2') : (categories[0]?.id || 'steward'),
            detailId: v === 'income' ? undefined : (categories[0]?.subcategories?.[0]?.id),
          });
        }}
        testID="tx-type"
      />
      <Text style={s.label}>Description</Text>
      <TextInput style={s.input} value={t.name} onChangeText={x => setT({ ...t, name: x })} testID="tx-name" />
      <Text style={s.label}>Amount</Text>
      <View style={s.amountInput}>
        <Text style={s.amountPrefix}>$</Text>
        <TextInput style={[s.input, { paddingLeft: 26 }]} value={t.amount} onChangeText={x => setT({ ...t, amount: x })} keyboardType="numeric" testID="tx-amount" />
      </View>

      <Text style={s.label}>Date</Text>
      {Platform.OS === 'web' ? (
        // Web: use native browser date picker (perfect UX in Safari/Chrome/Firefox)
        React.createElement('input' as any, {
          type: 'date',
          value: isoDateForInput,
          onChange: (e: any) => {
            const iso = e.target.value; // yyyy-mm-dd
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
        // Native (iOS/Android): open modal calendar picker
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
                // On Android the picker closes automatically; on iOS keep it open until confirm
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
      <PeriodPills values={[...MONTHS]} value={t.period || currentMonth()} onChange={(v: string) => setT({ ...t, period: v })} testID="tx-month" />
      <Text style={s.label}>{isIncome ? 'Earn source' : 'Category'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(isIncome ? incomeSources : categories).map((g: any) => {
          const on = t.groupId === g.id;
          return (
            <Pressable
              key={g.id}
              onPress={() => setT({ ...t, groupId: g.id, detailId: isIncome ? undefined : g.subcategories?.[0]?.id })}
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
              const on = t.detailId === sub.id;
              return (
                <Pressable
                  key={sub.id}
                  onPress={() => setT({ ...t, detailId: sub.id })}
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
      <View style={{ marginTop: 14 }}>
        <GoldButton label="Save transaction" onPress={() => save({ ...t, amount: Number(t.amount), origin: t.origin || 'Manual', period: t.period || currentMonth() })} disabled={!t.name || !Number(t.amount)} testID="tx-save" />
      </View>
      {remove && <Pressable onPress={() => remove(item.id)} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="tx-delete">
        <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Delete transaction</Text>
      </Pressable>}
    </View>
  );
};

/* ---------------- Net Worth ---------------- */
const isInvestmentAccount = (r: any) => {
  const hay = `${r.name || ''} ${r.account_name || ''} ${r.org_name || ''}`.toLowerCase();
  if (r.provider === 'snaptrade') return true;
  return /(invest|brokerage|ira|401k|403b|roth|hsa|mutual|advisor|wealth|portfolio|etrade|schwab|fidelity|vanguard|robinhood)/.test(hay);
};
const NetWorthScreen = ({ assets, setAssets, liabilities, setLiabilities, transactions, restrictedBuckets, setRestrictedBuckets }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  const [restrictedOpen, setRestrictedOpen] = useState(false);
  const [addingRestricted, setAddingRestricted] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketAmt, setNewBucketAmt] = useState('');
  const [editingBucket, setEditingBucket] = useState<any>(null);
  const [editRow, setEditRow] = useState<{ side: 'assets' | 'liabilities'; row: Asset } | null>(null);
  const [rowDraftName, setRowDraftName] = useState('');
  const [rowDraftAmt, setRowDraftAmt] = useState('');
  const [addingRowSide, setAddingRowSide] = useState<'assets' | 'liabilities' | null>(null);
  useEffect(() => {
    if (!token) return;
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []))
      .catch(() => setLinkedRows([]));
  }, [token]);
  const [period, setPeriod] = useState('Quarter');
  const [visible, setVisible] = useState(true);

  // ---- Aggregate live-linked balances into the Cash / Investments buckets ----
  const validLinks = linkedRows.filter((r: any) => !r.error);
  const linkedCash = validLinks.filter((r: any) => !isInvestmentAccount(r)).reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
  const linkedInvest = validLinks.filter(isInvestmentAccount).reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
  const cashSources = validLinks.filter((r: any) => !isInvestmentAccount(r));
  const investSources = validLinks.filter(isInvestmentAccount);
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
  const displayAssets: (Asset & { linked?: boolean })[] = [
    { id: 'cash', name: 'Cash', value: manualCash + linkedCash, source: sourceLabel(cashSources, 'Manual'), icon: 'wallet-outline', linked: cashSources.length > 0 },
    { id: 'investments', name: 'Investments', value: manualInvest + linkedInvest, source: sourceLabel(investSources, 'Manual'), icon: 'trending-up', linked: investSources.length > 0 },
    ...manualOther,
  ];

  const ta = displayAssets.reduce((sum: number, x: any) => sum + (x.value || 0), 0);
  const tl = liabilities.reduce((sum: number, x: Asset) => sum + x.value, 0);
  const nw = ta - tl;
  const cash = displayAssets.find((x: any) => x.id === 'cash')?.value || 0;
  const totalRestricted = restrictedBuckets.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
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
          <Text style={[s.cpSmall, t.textMuted]}>RESTRICTED</Text>
          <Text style={[s.cpStrong, t.textInk]}>{MONEY(totalRestricted)}</Text>
          <Text style={{ color: '#c9a56c', fontSize: 8, marginTop: 2 }}>{restrictedBuckets.length > 0 ? `${restrictedBuckets.length} bucket${restrictedBuckets.length > 1 ? 's' : ''} · tap to manage` : 'tap to add'}</Text>
        </Pressable>
        <Text style={{ color: '#b99a6c' }}>=</Text>
        <View style={[{ flex: 1.2 }, s.cpAvailable]}><Text style={[s.cpSmall, { color: '#c8b494' }]}>AVAILABLE</Text><Text style={[s.cpStrong, { color: '#f3dfbd' }]}>{MONEY(Math.max(0, cash - totalRestricted))}</Text></View>
      </View>
      <Sheet visible={restrictedOpen} close={() => { setRestrictedOpen(false); setAddingRestricted(false); setEditingBucket(null); setNewBucketName(''); setNewBucketAmt(''); }} title="Restricted Cash" subtitle="Create named buckets for money set aside — taxes, gifts, goals. Each bucket is subtracted from Available.">
        <View>
          {restrictedBuckets.length === 0 && !addingRestricted && (
            <Text style={{ fontSize: 11, color: C.muted2, marginBottom: 12 }}>No buckets yet. Tap the button below to add your first.</Text>
          )}
          {restrictedBuckets.map((b: any) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1ede6' }}>
              <Pressable onPress={() => { setEditingBucket(b); setNewBucketName(b.name); setNewBucketAmt(String(b.amount)); setAddingRestricted(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{b.name}</Text>
                  <Text style={{ fontSize: 9, color: C.muted2 }}>tap to edit</Text>
                </View>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{MONEY(b.amount)}</Text>
              </Pressable>
              <Pressable onPress={() => {
                const doIt = () => setRestrictedBuckets((prev: any[]) => prev.filter((x: any) => x.id !== b.id));
                if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`Remove "${b.name}"?`)) doIt(); }
                else { Alert.alert(`Remove "${b.name}"?`, 'This allocation returns to Available cash.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: doIt }]); }
              }} hitSlop={6} style={{ paddingHorizontal: 8, paddingVertical: 6 }} testID={`bucket-del-${b.id}`}>
                <Ionicons name="close-circle-outline" size={16} color="#b06a5b" />
              </Pressable>
            </View>
          ))}
          {addingRestricted ? (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Bucket name</Text>
              <TextInput style={s.input} value={newBucketName} onChangeText={setNewBucketName} placeholder="e.g., Q3 Taxes, Christmas Gifts" autoFocus testID="bucket-name" />
              <Text style={s.label}>Amount</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketAmt} onChangeText={setNewBucketAmt} keyboardType="numeric" placeholder="0" testID="bucket-amount" />
              </View>
              <View style={{ marginTop: 12 }}>
                <GoldButton label={editingBucket ? 'Save bucket' : 'Add bucket'} onPress={() => {
                  const cleanAmt = Math.max(0, Math.round(Number((newBucketAmt || '').replace(/[^0-9.]/g, '')) || 0));
                  const cleanName = newBucketName.trim();
                  if (!cleanName) return;
                  if (editingBucket) {
                    setRestrictedBuckets((prev: any[]) => prev.map((x: any) => x.id === editingBucket.id ? { ...x, name: cleanName, amount: cleanAmt } : x));
                  } else {
                    setRestrictedBuckets((prev: any[]) => [...prev, { id: `bucket-${Date.now()}`, name: cleanName, amount: cleanAmt }]);
                  }
                  setAddingRestricted(false); setEditingBucket(null);
                  setNewBucketName(''); setNewBucketAmt('');
                }} disabled={!newBucketName.trim()} testID="bucket-save" />
              </View>
              <Pressable onPress={() => { setAddingRestricted(false); setEditingBucket(null); setNewBucketName(''); setNewBucketAmt(''); }} style={{ marginTop: 10, alignItems: 'center' }}>
                <Text style={{ color: C.muted2, fontSize: 11 }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setEditingBucket(null); setNewBucketName(''); setNewBucketAmt(''); setAddingRestricted(true); }} style={[s.subcategoryRow, { justifyContent: 'center', marginTop: 8 }]} testID="bucket-add">
              <Ionicons name="add-circle-outline" size={16} color="#9a6d32" />
              <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>Add restricted bucket</Text>
            </Pressable>
          )}
        </View>
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
      <WorthCard title="Assets" total={ta} rows={displayAssets} hidden={!visible} onRowPress={(row: Asset) => {
        setEditRow({ side: 'assets', row });
        setRowDraftName(row.name);
        const raw = row.id === 'cash' ? manualCash : row.id === 'investments' ? manualInvest : row.value;
        setRowDraftAmt(raw ? String(raw) : '');
      }} onAdd={() => setAddingRowSide('assets')} />
      <WorthCard title="Liabilities" total={tl} rows={liabilities} hidden={!visible} onRowPress={(row: Asset) => {
        setEditRow({ side: 'liabilities', row });
        setRowDraftName(row.name);
        setRowDraftAmt(row.value ? String(row.value) : '');
      }} onAdd={() => setAddingRowSide('liabilities')} />
    </ScrollView>
  );
};
const WorthCard = ({ title, total, rows, hidden, onRowPress, onAdd }: any) => {
  const t = useThemed();
  return (
    <View style={[s.worthCard, t.cardBg]}>
      <View style={[s.worthCardHeading, t.dividerBorder]}>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{title}</Text>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{hidden ? '••••••' : MONEY(total)}</Text>
      </View>
      {rows.map((r: Asset) => (
        <Pressable key={r.id} onPress={() => onRowPress?.(r)} style={[s.worthRow, t.dividerBorder]} testID={`nw-row-${r.id}`}>
          <View style={[s.worthIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={r.icon as any} size={17} color={t.dark ? D.textMuted : '#817969'} /></View>
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{r.name}</Text><Text style={[{ fontSize: 8, color: '#9b958c' }, t.textMuted]}>{r.source}</Text></View>
          <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{hidden ? '••••' : MONEY(r.value)}</Text>
          <Ionicons name="chevron-forward" size={12} color={t.dark ? D.textMuted : '#c1b9ac'} style={{ marginLeft: 4 }} />
        </Pressable>
      ))}
      {onAdd && (
        <Pressable onPress={onAdd} style={[s.worthRow, t.dividerBorder, { justifyContent: 'center' }]} testID={`nw-add-${title.toLowerCase()}`}>
          <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
          <Text style={{ color: '#9a6d32', fontSize: 10, fontWeight: '700', marginLeft: 6 }}>Add {title === 'Assets' ? 'asset' : 'liability'}</Text>
        </Pressable>
      )}
    </View>
  );
};

/* ---------------- Legacy / Coaching / Membership / Settings / More ---------------- */
const LegacyScreen = ({ investmentTotal, totalCash, monthlyNet }: any) => {
  const t = useThemed();
  const [timeframe, setTimeframe] = useState('Retirement');
  const [contribution, setContribution] = useState(0);
  const [hypothetical, setHypothetical] = useState('');
  const [editingHypo, setEditingHypo] = useState(false);
  const [hypoDraft, setHypoDraft] = useState('');
  const rate = 8;
  const shortTimeframes: Record<string, number> = { '1yr': 1, '2yr': 2, '3yr': 3, '5yr': 5 };
  const longTimeframes: Record<string, number> = { '10yr': 10, '20yr': 20, 'Retirement': 33 };
  const isShort = timeframe in shortTimeframes;
  const years = isShort ? shortTimeframes[timeframe] : longTimeframes[timeframe];
  const hypoValue = Math.max(0, Number((hypothetical || '').replace(/[^0-9.]/g, '')) || 0);
  const totalInvested = investmentTotal + hypoValue;

  // Short-horizon (1-5yr): uses REAL cash + real monthly net income, no compounding assumed
  // Long-horizon (10yr+/Retirement): compounding at 8% + optional recurring contribution
  const projection = isShort
    ? Math.round(totalCash + totalInvested + monthlyNet * 12 * years)
    : Math.round(totalInvested * Math.pow(1 + rate / 100, years) + contribution * 12 * ((Math.pow(1 + rate / 100, years) - 1) / (rate / 100)));

  const commitHypo = () => {
    const clean = Math.max(0, Math.round(Number(hypoDraft.replace(/[^0-9.]/g, '')) || 0));
    setHypothetical(clean > 0 ? String(clean) : '');
    setEditingHypo(false);
    setHypoDraft('');
  };

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Your Legacy" subtitle="See what consistent stewardship can become." />
      <PeriodPills values={['1yr','2yr','3yr','5yr','10yr','20yr','Retirement']} value={timeframe} onChange={setTimeframe} testID="legacy-period" />
      <View style={s.projectionCard}>
        <Text style={{ color: '#caa465', fontSize: 9, letterSpacing: 1.3, textAlign: 'center' }}>PROJECTED TOTAL ({timeframe})</Text>
        <Text style={s.projectionStrong}>{MONEY(projection)}</Text>
        <Text style={{ color: '#b4ada3', fontSize: 12, textAlign: 'center', maxWidth: 270, alignSelf: 'center' }}>
          {isShort
            ? 'Current cash + investments + your budgeted monthly net over the period.'
            : 'What you build faithfully can support generations you may never meet.'}
        </Text>
        <View style={s.growthChart}>
          {(isShort ? [.30,.42,.56,.72,.86,1] : [.16,.24,.34,.48,.66,.84,1]).map((f, i) => (
            <LinearGradient key={i} colors={['#e8c98f','#8b6437']} style={[s.growthBar, { height: `${Math.max(18, f * 100)}%` }]} />
          ))}
        </View>
      </View>

      <View style={[s.assumptionsCard, t.cardBg]}>
        <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>WHAT WE'RE PROJECTING FROM</Text>
        <View style={{ marginTop: 8, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[{ fontSize: 10 }, t.textMuted]}>Current investments (synced)</Text>
            <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{MONEY(investmentTotal)}</Text>
          </View>
          {isShort && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[{ fontSize: 10 }, t.textMuted]}>Current cash (synced)</Text>
                <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{MONEY(totalCash)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[{ fontSize: 10 }, t.textMuted]}>Monthly net (from Budget)</Text>
                <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{MONEY(monthlyNet)}</Text>
              </View>
            </>
          )}
          {hypoValue > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: '#c9a56c', fontSize: 10 }}>+ Hypothetical amount</Text>
              <Text style={{ color: '#c9a56c', fontSize: 10, fontWeight: '700' }}>{MONEY(hypoValue)}</Text>
            </View>
          )}
        </View>
      </View>

      <Pressable onPress={() => { setHypoDraft(hypothetical || ''); setEditingHypo(true); }} style={[s.assumptionsCard, t.cardBg]} testID="legacy-hypo-open">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Hypothetical Amount</Text>
            <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>Model a windfall or extra investment — kept separate from your synced number.</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32', marginLeft: 12 }}>{hypoValue > 0 ? MONEY(hypoValue) : '+ Add'}</Text>
        </View>
      </Pressable>

      {!isShort && (
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

      <Sheet visible={editingHypo} close={() => { setEditingHypo(false); setHypoDraft(''); }} title="Add hypothetical amount" subtitle="This is imaginary money — used only for what-if modeling on this screen.">
        <View>
          <Text style={s.label}>One-time amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={hypoDraft} onChangeText={setHypoDraft} keyboardType="numeric" placeholder="0" autoFocus testID="legacy-hypo-amount" />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label={hypoValue > 0 && Number(hypoDraft.replace(/[^0-9.]/g, '') || 0) === 0 ? 'Remove hypothetical' : 'Save'} onPress={commitHypo} testID="legacy-hypo-save" />
          </View>
        </View>
      </Sheet>
    </ScrollView>
  );
};
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

  const openCalendly = async () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(CALENDLY_URL, '_blank', 'noopener');
      } else {
        await WebBrowser.openBrowserAsync(CALENDLY_URL);
      }
    } catch (e: any) {
      setToast(e?.message || 'Could not open Calendly.');
    }
  };

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

      <View style={{ marginTop: 18, gap: 10 }}>
        <View style={[s.stepCard, t.cardBg]}>
          <View style={s.stepBadge}><Text style={s.stepBadgeText}>1</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Pick a time</Text>
            <Text style={[{ fontSize: 9, color: C.muted2, marginTop: 2 }, t.textMuted]}>Opens Calendly. Danyell will confirm by email.</Text>
          </View>
          <Pressable onPress={openCalendly} style={s.stepBtnPill} testID="coaching-open-calendly">
            <Text style={s.stepBtnPillText}>Schedule →</Text>
          </Pressable>
        </View>
        <View style={[s.stepCard, t.cardBg]}>
          <View style={s.stepBadge}><Text style={s.stepBadgeText}>2</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Pay $50 on the web</Text>
            <Text style={[{ fontSize: 9, color: C.muted2, marginTop: 2 }, t.textMuted]}>Complete payment at jaleter.com to lock your session.</Text>
          </View>
        </View>
      </View>

      <BillingWebsiteNotice />

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
        <Text style={[s.priceStrong, t.textInk]}>$75<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}>/year</Text></Text>
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
      <BillingWebsiteNotice />
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
          ['coaching','Book Coaching','Schedule + pay at jaleter.com','chatbubble-outline'],
          ['membership','Membership','Manage at jaleter.com','sparkles-outline'],
          ['settings','Settings',`${linkedCount} linked accounts`,'settings-outline'],
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
      </View>
    </ScrollView>
  );
};
const SettingsScreen = ({ experience, setExperience, appearance, setAppearance, alerts, setAlerts, onLogout, back, linkedAccounts, addLinked, onResetAppData, initials, categories, appLock, setAppLock }: any) => {
  const t = useThemed();
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const rows: [string, string, string, any][] = [
    ['accounts', 'Linked Accounts', `${linkedAccounts.length} connected`, 'link-outline'],
    ['notifications', 'Notification Details', 'Manage every reminder', 'notifications-outline'],
    ['terms', 'Terms of Use', 'Membership terms', 'document-text-outline'],
    ['privacy', 'Privacy Policy', 'Bank-data protection', 'lock-closed-outline'],
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
        {alerts.enabled && (categories || []).map((c: any) => (
          <View key={c.id} style={{ marginTop: 10 }}>
            <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }]}>{c.name.toUpperCase()}</Text>
            {c.subcategories.map((sub: any) => {
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
        ))}
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
          <Pressable key={id} onPress={() => setSheet(id)} style={[s.settingsMenuBtn, t.dividerBorder]} testID={`settings-${id}`}>
            <View style={[s.settingsRowIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={icon} size={17} color={t.dark ? D.textMuted : '#8a7b65'} /></View>
            <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{label}</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>{detail}</Text></View>
            <Ionicons name="chevron-forward" size={16} color={t.dark ? D.textMuted : '#b0aaa0'} />
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
      <Modal transparent visible={confirmReset} animationType="fade" onRequestClose={() => setConfirmReset(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 }}>
          <View style={[{ borderRadius: 22, padding: 22 }, { backgroundColor: t.dark ? D.surface : '#fff' }]}>
            <Text style={[{ fontSize: 18, fontFamily: F.serif, fontWeight: '600' }, t.textInk]}>Reset app data?</Text>
            <Text style={[{ fontSize: 12, marginTop: 8, lineHeight: 18 }, t.textMuted]}>
              This clears every locally cached transaction, budget adjustment, and preference in this browser. Your account, bookings, and membership are safe — they live on the server.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable onPress={() => setConfirmReset(false)} style={{ flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: t.dark ? D.border : '#e5decf', alignItems: 'center' }} testID="reset-cancel">
                <Text style={[{ fontWeight: '700', fontSize: 12 }, t.textInk]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={async () => { setConfirmReset(false); await onResetAppData?.(); setToast('App data reset. Fresh start.'); }} style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#b28a4c', alignItems: 'center' }} testID="reset-confirm">
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Reset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <LegalSheet visible={sheet === 'terms'} close={() => setSheet(null)} type="Terms of Use" />
      <LegalSheet visible={sheet === 'privacy'} close={() => setSheet(null)} type="Privacy Policy" />
      <NotificationsSheet visible={sheet === 'notifications'} close={() => setSheet(null)} onSave={(m: string) => { setSheet(null); setToast(m); }} />
      <AccountLinkSheet visible={sheet === 'accounts'} close={() => setSheet(null)} onConfirm={(accs: any[]) => { addLinked(accs); setSheet(null); setToast('Accounts connected and syncing.'); }} />
      {toast ? <Toast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Bottom Nav ---------------- */
const navItems = [
  { id: 'home', label: 'Home', icon: 'home-outline' as const },
  { id: 'budget', label: 'Budget', icon: 'menu-outline' as const },
  { id: 'transactions', label: 'Transactions', icon: 'receipt-outline' as const },
  { id: 'networth', label: 'Net Worth', icon: 'wallet-outline' as const },
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
        <Text style={s.privacyPara}>Premium membership is $75 per year. Coaching is a separate $50 per hour service. Renewal and cancellation details are shown before checkout.</Text>
        <Text style={s.privacyPara}>Projections are estimates and are not guarantees of future performance.</Text>
      </View>
    )}
    <View style={{ marginTop: 14 }}><GoldButton label="Close" onPress={close} testID="legal-close" /></View>
  </Sheet>
);
const NotificationsSheet = ({ visible, close, onSave }: any) => {
  const labels: Record<string, string> = { daily: 'Daily check-in', weekly: 'Weekly summary', streak: 'Streak reminders', transactions: 'Large transactions', coaching: 'Coaching reminders' };
  const [n, setN] = useState({ daily: true, weekly: true, streak: true, transactions: true, coaching: false });
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

// Bank-specific import guides — how to export CSV/OFX from major US institutions.
const BANK_IMPORT_GUIDES: { name: string; steps: string[]; format: string }[] = [
  {
    name: 'Chase',
    steps: [
      'Sign in at chase.com from a browser.',
      'Open the account you want to export.',
      'Click the download arrow icon (top right of transactions list).',
      'Choose the date range, then select "Spreadsheet (Excel, CSV)".',
      'Save the file, then import it in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Bank of America',
    steps: [
      'Log in at bankofamerica.com.',
      'Open the account, then click "Download".',
      'Choose "Microsoft Excel" or "Comma-delimited (CSV)".',
      'Select a date range and download.',
      'Upload the file into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Wells Fargo',
    steps: [
      'Sign in at wellsfargo.com.',
      'Open the account and go to "Download Account Activity".',
      'Choose date range and "Comma Delimited" format.',
      'Save and import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Capital One',
    steps: [
      'Sign in at capitalone.com.',
      'Open your account, click the three-dot menu next to Transactions.',
      'Choose "Download transactions".',
      'Pick a date range and CSV format.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Citi',
    steps: [
      'Sign in at citi.com.',
      'Choose the account and open "Statements".',
      'Click "Download activity" and choose CSV.',
      'Select date range and save.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'US Bank',
    steps: [
      'Log in at usbank.com.',
      'Open the account, click "Manage" then "Export transactions".',
      'Choose Excel/CSV.',
      'Save the export and upload it in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'PNC',
    steps: [
      'Log in at pnc.com.',
      'Open the account and click "Activity".',
      'Click the download icon and choose CSV.',
      'Select date range and save.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Discover Card',
    steps: [
      'Log in at discover.com.',
      'Go to "Account Details" then "Download activity".',
      'Choose CSV format and date range.',
      'Save and import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'American Express',
    steps: [
      'Log in at americanexpress.com.',
      'Open your card and go to "Statements & Activity".',
      'Click "Download" (icon near recent activity).',
      'Choose "CSV" and a date range.',
      'Save and import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'USAA',
    steps: [
      'Sign in at usaa.com.',
      'Open the account and click "Export".',
      'Choose "Comma Separated Values (CSV)" or "Quicken (QFX)".',
      'Save the file and upload it into Jaleter.',
    ],
    format: 'CSV or QFX',
  },
  {
    name: 'Truist',
    steps: [
      'Log in at truist.com.',
      'Open the account, click the download icon on the transactions list.',
      'Choose CSV and select your date range.',
      'Save and import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Credit Union / Other',
    steps: [
      'Log in to your credit union or bank on a browser.',
      'Look for "Download", "Export", or a download-arrow icon on the transactions/statements page.',
      'Choose CSV (preferred), OFX, QFX, or QBO — Jaleter supports all four.',
      'Save the file and upload it in Jaleter.',
      'If your bank has no export at all, use "Request an institution" to let us know.',
    ],
    format: 'CSV / OFX / QFX / QBO',
  },
];

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
  const syncOne = async (link_id: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const data = await apiCall(`/api/accounts/link/${link_id}/sync`, { method: 'POST' }, token);
      setMessage(`Refreshed. ${data?.synced ?? 0} new transactions.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'Sync failed.'); }
    finally { setSyncingId(null); }
  };
  const unlink = async (link_id: string, provider: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const path = provider === 'file' ? `/api/accounts/link/${link_id}` : `/api/accounts/link/${link_id}`;
      // Both providers use the same DELETE path in this backend.
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
                const canSync = row.provider === 'simplefin' && !!row.link_id;
                return (
                  <View key={key} style={s.linkedRow}>
                    <View style={s.linkedIcon}><Ionicons name={row.provider === 'file' ? 'document-attach-outline' : row.provider === 'snaptrade' ? 'trending-up' : 'card-outline'} size={16} color={C.goldEyebrow} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: C.ink }}>{row.name || row.account_name || 'Account'}</Text>
                      <Text style={{ fontSize: 8, color: C.muted2 }}>{row.org_name || (row.provider === 'file' ? 'Imported' : row.provider === 'snaptrade' ? 'SnapTrade' : 'Linked')}{row.balance !== undefined ? ` · ${MONEY(row.balance)}` : ''}</Text>
                      {row.error ? <Text style={{ fontSize: 8, color: C.danger }}>{row.error}</Text> : null}
                    </View>
                    {canSync && (
                      <Pressable testID={`link-sync-${row.link_id}`} onPress={() => syncOne(row.link_id)} disabled={isSyncing} style={s.linkedBtn}>
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
  const [incomeSources, setIncomeSources] = useState(initialIncome);
  const [restrictedBuckets, setRestrictedBuckets] = useState<Array<{ id: string; name: string; amount: number }>>([]);
  const [transactions, setTransactions] = useState<Tx[]>(initialTx);
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [liabilities, setLiabilities] = useState<Asset[]>(initialLiabilities);
  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<{ enabled: boolean; threshold: number; perCategory: Record<string, { p50: boolean; p80: boolean; exceeded: boolean }> }>({ enabled: true, threshold: 80, perCategory: {} });

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
            setRestrictedBuckets([{ id: 'legacy-restricted', name: 'Restricted', amount: data.restrictedCash }]);
          }
          if (Array.isArray(data.assets) && data.assets.length > 0) setAssets(data.assets);
          if (Array.isArray(data.liabilities) && data.liabilities.length > 0) setLiabilities(data.liabilities);
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);
  // Persist on change (skip auth-managed fields)
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities })).catch(() => {});
  }, [hydrated, experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources, restrictedBuckets, assets, liabilities]);

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
  useEffect(() => {
    if (!auth.token) { setLinkedAccountBalances([]); return; }
    let alive = true;
    apiCall('/api/accounts/all', { method: 'GET' }, auth.token)
      .then((data: any) => { if (alive) setLinkedAccountBalances(Array.isArray(data?.accounts) ? data.accounts : []); })
      .catch(() => { if (alive) setLinkedAccountBalances([]); });
    return () => { alive = false; };
  }, [auth.token, linkedAccounts.length]);
  const linkedAssetsTotal = linkedAccountBalances
    .filter((r: any) => !r.error)
    .reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
  const linkedInvestmentTotal = linkedAccountBalances
    .filter((r: any) => !r.error && isInvestmentAccount(r))
    .reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
  const linkedCashTotal = linkedAccountBalances
    .filter((r: any) => !r.error && !isInvestmentAccount(r))
    .reduce((sum: number, r: any) => sum + (r.balance || 0), 0);

  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const openingCash = 0;
  const syncedCash = openingCash + income - expense;
  const syncedAssets = assets.map(x => x.id === 'cash' ? { ...x, value: syncedCash } : x);
  const manualAssetsTotal = syncedAssets.reduce((sum, x) => sum + x.value, 0);
  const manualInvestments = syncedAssets.find((x: any) => x.id === 'investments')?.value || 0;
  const investmentTotal = manualInvestments + linkedInvestmentTotal;
  const totalCash = syncedCash + linkedCashTotal; // manual (synced) + linked cash
  const netWorth = manualAssetsTotal + linkedAssetsTotal - liabilities.reduce((sum, x) => sum + x.value, 0);
  const monthlyBudgetIncome = incomeSources.reduce((sum, x) => sum + x.budgeted, 0);
  const monthlyBudgetExpense = categories.flatMap(c => c.subcategories).reduce((sum, x) => sum + x.budgeted, 0);
  const monthlyNet = monthlyBudgetIncome - monthlyBudgetExpense;
  const monthlyBudget = monthlyBudgetExpense;
  const budgetUsage = monthlyBudget > 0 ? (expense / monthlyBudget) * 100 : 0;
  const nav = (screen: string, category: string | null = null) => { setActive(screen); if (category) setFocusCategory(category); };

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
          {active === 'home' && <HomeScreen name={displayName} initials={displayInitials} experience={experience} netWorth={netWorth} investmentTotal={investmentTotal} budgetUsage={budgetUsage} alertsEnabled={alerts.enabled} navigate={nav} />}
          {active === 'budget' && <BudgetScreen categories={categories} setCategories={setCategories} incomeSources={incomeSources} setIncomeSources={setIncomeSources} transactions={transactions} focusCategory={focusCategory} clearFocus={() => setFocusCategory(null)} alerts={alerts} />}
          {active === 'transactions' && <TransactionsScreen transactions={transactions} setTransactions={setTransactions} categories={categories} incomeSources={incomeSources} openLinkSheet={() => { setActive('settings'); }} />}
          {active === 'networth' && <NetWorthScreen assets={syncedAssets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} transactions={transactions} restrictedBuckets={restrictedBuckets} setRestrictedBuckets={setRestrictedBuckets} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={linkedAccounts.length} onBack={() => setActive('home')} />}
          {active === 'legacy' && <LegacyScreen investmentTotal={investmentTotal} totalCash={totalCash} monthlyNet={monthlyNet} />}
          {active === 'coaching' && <CoachingScreen back={() => nav('more')} />}
          {active === 'membership' && <MembershipScreen back={() => nav('more')} />}
          {active === 'settings' && <SettingsScreen initials={displayInitials} experience={experience} setExperience={setExperience} appearance={appearance} setAppearance={setAppearance} alerts={alerts} setAlerts={setAlerts} categories={categories} appLock={appLock} setAppLock={(next: any) => setAppLock({ ...appLock, ...next })} onLogout={async () => { await auth.logout(); setActive('home'); setStage('welcome'); }} back={() => nav('more')} linkedAccounts={linkedAccounts} addLinked={(a: any[]) => setLinkedAccounts([...linkedAccounts, ...a])} onResetAppData={async () => {
            try { await storage.removeItem(STORAGE_KEY); } catch {}
            for (const k of LEGACY_STORAGE_KEYS) { try { await storage.removeItem(k); } catch {} }
            setTransactions([]);
            setLinkedAccounts([]);
            setCategories(initialCategories);
            setIncomeSources(initialIncome);
            setRestrictedCash(0);
            setExperience('Faith');
            setAppearance('System');
            setAlerts({ enabled: true, threshold: 80, perCategory: {} });
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
