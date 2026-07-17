import React, { useState, useMemo, useEffect, useCallback, createContext, useContext } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Modal, StatusBar as RNStatusBar, Platform, Linking, Dimensions } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { storage } from '@/src/utils/storage';
import { AuthProvider, useAuth, apiCall } from '@/src/AuthContext';
import { C, D, F } from '@/src/jaleterTheme';
import { dailyQuote, MONEY, EXACT, QuoteType } from '@/src/quoteLibrary';

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

const MONTHS = ['July', 'Aug', 'Sep'];

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
    { id: 'investments', name: 'Investments', budgeted: 0 }, { id: 'emergency', name: 'Emergency Fund', budgeted: 0 }, { id: 'education', name: 'Education', budgeted: 0 }] },
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

const Welcome = ({ onStart, onLogin }: any) => (
  <View style={welcomeStyles.screen}>
    <RNStatusBar barStyle="light-content" backgroundColor="transparent" translucent />
    <BackgroundArtwork />
    <SafeAreaView style={welcomeStyles.safeArea}>
      <View style={welcomeStyles.content}>
        {/* Brand block — sits at ~28-32% from top via paddingTop */}
        <View style={welcomeStyles.brandSection}>
          <View style={welcomeStyles.sparkles} pointerEvents="none">
            <Text style={welcomeStyles.largeSparkle}>✦</Text>
            <Text style={welcomeStyles.smallSparkle}>✦</Text>
          </View>
          <Text style={welcomeStyles.logo} numberOfLines={1} adjustsFontSizeToFit testID="welcome-wordmark">
            Jaleter
          </Text>
          <Text style={welcomeStyles.tagline}>SMART BUDGETING.</Text>
          <Text style={welcomeStyles.tagline}>WEALTHY LIVING.</Text>
        </View>
        {/* Bottom actions */}
        <View style={welcomeStyles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Get Started"
            testID="welcome-get-started"
            onPress={onStart}
            style={({ pressed }) => [welcomeStyles.buttonWrap, pressed && welcomeStyles.buttonPressed]}
          >
            <LinearGradient
              colors={['#F4D28F', '#DEAA55']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={welcomeStyles.primaryButton}
            >
              <Text style={welcomeStyles.primaryButtonText}>Get Started</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log in"
            testID="welcome-login"
            onPress={onLogin}
            hitSlop={12}
            style={({ pressed }) => [welcomeStyles.loginButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={welcomeStyles.loginText}>
              Already have an account? <Text style={welcomeStyles.loginLink}>Log in</Text>
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  </View>
);

const welcomeStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#090908' },
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
        <Text style={s.onboardHint}>Sign in with your Jaleter email or Google account.</Text>
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
  const [showLink, setShowLink] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!setupToken.trim()) { setError('Please paste your SimpleFIN Setup Token.'); return; }
    setError(''); setBusy(true);
    try {
      const data = await apiCall('/api/accounts/simplefin/link', {
        method: 'POST',
        body: JSON.stringify({ setup_token: setupToken.trim() }),
      }, token);
      onConnect(data);
    } catch (e: any) {
      setError(e?.message || 'Could not link SimpleFIN.');
    } finally { setBusy(false); }
  };
  return (
    <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 60, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <View style={{ marginTop: 45, alignItems: 'center' }}>
        <View style={s.connectLock}><Ionicons name="link" size={29} color={C.goldText} /></View>
        <Text style={[s.eyebrow, { marginTop: 17 }]}>YOUR MONEY, IN ONE VIEW</Text>
        <Text style={[s.onboardH1, { textAlign: 'center' }]}>Connect your first{'\n'}financial account.</Text>
        <Text style={[s.onboardHint, { textAlign: 'center' }]}>Jaleter uses SimpleFIN to securely sync balances and transactions. We never ask for or store your bank password.</Text>
      </View>
      <View style={s.connectBenefits}>
        {[
          ['Automatic transactions', 'Keep Budget actuals current.'],
          ['Accurate net worth', 'See cash and liabilities together.'],
        ].map(([b, sm]) => (
          <View key={b} style={{ flexDirection: 'row', gap: 11, alignItems: 'center', marginVertical: 10 }}>
            <Ionicons name="checkmark" size={16} color="#a57537" />
            <View style={{ flex: 1 }}><Text style={{ fontSize: 12, fontWeight: '700', color: C.ink }}>{b}</Text><Text style={{ fontSize: 10, color: C.muted2 }}>{sm}</Text></View>
          </View>
        ))}
      </View>
      {!showLink ? (
        <GoldButton label="Connect with SimpleFIN" onPress={() => setShowLink(true)} testID="connect-simplefin" />
      ) : (
        <View>
          <Text style={{ color: C.muted, fontSize: 11, marginBottom: 6, lineHeight: 16 }}>
            1. Visit <Text style={{ fontWeight: '700', color: C.goldEyebrow }}>beta-bridge.simplefin.org</Text> and log in.
            {'\n'}2. Tap <Text style={{ fontWeight: '700' }}>Create Setup Token</Text>, then copy it.
            {'\n'}3. Paste the token below.
          </Text>
          <TextInput
            testID="connect-setup-token"
            style={[s.input, { minHeight: 80 }]}
            value={setupToken}
            onChangeText={setSetupToken}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Paste your SimpleFIN Setup Token here…"
          />
          {error ? <Text testID="connect-error" style={s.formError}>{error}</Text> : null}
          <View style={{ marginTop: 12 }}>
            <GoldButton label={busy ? 'Linking…' : 'Link accounts'} onPress={submit} disabled={busy || !setupToken.trim()} testID="connect-submit" />
          </View>
        </View>
      )}
      <Pressable onPress={onSkip} testID="connect-skip"><Text style={[s.loginLink, { marginTop: 20 }]}>Skip and enter manually</Text></Pressable>
    </ScrollView>
  );
};

/* ---------------- Paywall ---------------- */
const Paywall = ({ onContinue }: any) => {
  const { start } = usePayment();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const onSubscribe = async () => {
    setBusy(true);
    setToast(null);
    const res = await start('jaleter_premium');
    setBusy(false);
    if (res.paid) {
      setToast('Membership activated — welcome to Jaleter Premium.');
      setTimeout(onContinue, 900);
    } else if (res.canceled) {
      setToast('Checkout canceled. You can start again anytime.');
    } else if (res.error) {
      setToast(res.error);
    } else if (Platform.OS !== 'web') {
      setToast('Payment is still processing. We\'ll unlock premium once Stripe confirms.');
    }
  };
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
        {['Secure SimpleFIN syncing', 'Budgets, Net Worth, and Legacy', '100 curated Faith + Focus messages'].map(t => (
          <View key={t} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: '#615b52', fontSize: 11 }}>{t}</Text>
          </View>
        ))}
      </View>
      <GoldButton label={busy ? 'Opening secure checkout…' : 'Subscribe — $75 / year'} onPress={onSubscribe} disabled={busy} testID="paywall-checkout" />
      <Pressable onPress={onContinue} testID="paywall-preview"><Text style={[s.loginLink, { marginTop: 20 }]}>Continue in preview mode</Text></Pressable>
      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};

/* ---------------- Home ---------------- */
const HomeScreen = ({ name, experience, netWorth, budgetUsage, alertsEnabled, navigate }: any) => {
  const t = useThemed();
  const q = dailyQuote(experience as QuoteType, new Date());
  // Project only what we can actually project: 33 years of compounding on the user's real net worth.
  // No hidden assumed contributions — the deep Legacy screen has a slider for that.
  const projected = netWorth > 0 ? Math.round(netWorth * Math.pow(1.08, 33)) : 0;
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
              33-year compounding of your current net worth.
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
const BudgetScreen = ({ categories, setCategories, incomeSources, transactions, focusCategory, clearFocus }: any) => {
  const t = useThemed();
  const [period, setPeriod] = useState('July');
  const [expanded, setExpanded] = useState<string[]>(['give']);
  const [editing, setEditing] = useState<{ groupId: string; sub: any } | null>(null);
  const [draft, setDraft] = useState('');
  const annual = period === 'Year';
  useEffect(() => { if (focusCategory) { setExpanded(x => x.includes(focusCategory) ? x : [...x, focusCategory]); clearFocus(); } }, [focusCategory]);
  const relevant = transactions.filter((t: Tx) => annual || t.period === period);
  const actualIncome = relevant.filter((t: Tx) => t.type === 'income').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const actualExpenses = relevant.filter((t: Tx) => t.type === 'expense').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
  const spent = (id: string) => relevant.filter((t: Tx) => t.type === 'expense' && (t.detailId === id || t.groupId === id)).reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const budgetFor = (subBudget: number) => subBudget * (annual ? 12 : 1);

  const startEdit = (groupId: string, sub: any) => { setEditing({ groupId, sub }); setDraft(sub.budgeted ? String(sub.budgeted) : ''); };
  const commitEdit = () => {
    if (!editing) return;
    const clean = Math.max(0, Math.round(Number(draft.replace(/[^0-9.]/g, '')) || 0));
    setCategories((prev: any[]) => prev.map((c) => c.id !== editing.groupId ? c : {
      ...c,
      subcategories: c.subcategories.map((sc: any) => sc.id !== editing.sub.id ? sc : { ...sc, budgeted: clean }),
    }));
    setEditing(null);
    setDraft('');
  };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Budget" subtitle="Give first. Steward wisely. Grow intentionally." />
      <PeriodPills values={[...MONTHS, 'Year']} value={period} onChange={setPeriod} testID="budget-period" />
      <View style={s.budgetSummary}>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Total Income</Text><Text style={s.bsStrong}>{MONEY(actualIncome)}</Text><Text style={s.bsSmall}>of {MONEY(plannedIncome)}</Text></View>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Expenses</Text><Text style={s.bsStrong}>{MONEY(actualExpenses)}</Text><Text style={s.bsSmall}>actual</Text></View>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Net</Text><Text style={s.bsStrong}>{MONEY(actualIncome - actualExpenses)}</Text><Text style={s.bsSmall}>remaining</Text></View>
      </View>
      <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Plan by Purpose</Text><Text style={[s.sectionCap, t.textMuted]}>Tap any row to set an amount</Text></View>
      <View style={{ gap: 11 }}>
        {categories.map((c: any) => {
          const total = c.subcategories.reduce((sum: number, x: any) => sum + budgetFor(x.budgeted), 0);
          const actual = spent(c.id);
          const pct = total ? actual / total * 100 : 0;
          const open = expanded.includes(c.id);
          const barColor = pct >= 100 ? C.red : pct >= 80 ? C.amber : C.green;
          return (
            <View key={c.id} style={[s.budgetCategory, t.cardBg, open && { borderColor: '#ddc7a6' }]}>
              <Pressable style={s.categorySummary} onPress={() => setExpanded(xs => xs.includes(c.id) ? xs.filter(x => x !== c.id) : [...xs, c.id])} testID={`budget-cat-${c.id}`}>
                <View style={s.purposeIcon}><Text style={s.purposeIconText}>{c.name[0]}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '700', color: C.ink }, t.textInk]}>{c.name}</Text>
                  <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>{c.tagline}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]}>{MONEY(actual)}</Text>
                  <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>of {MONEY(total)}</Text>
                </View>
                <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={17} color={t.dark ? D.textMuted : C.muted} />
              </Pressable>
              <View style={s.categoryProgress}><View style={[s.categoryProgressBar, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]} /></View>
              <View style={s.categoryMeta}>
                <Text style={{ color: '#999289', fontSize: 8 }}>{Math.round(pct)}% used</Text>
                <Text style={{ color: '#999289', fontSize: 8 }}>{MONEY(total - actual)} remaining</Text>
              </View>
              {open && (
                <View style={s.subcategoryList}>
                  {c.subcategories.map((sub: any) => (
                    <Pressable
                      key={sub.id}
                      onPress={() => startEdit(c.id, sub)}
                      style={s.subcategoryRow}
                      testID={`budget-sub-${sub.id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{sub.name}</Text>
                        <Text style={{ fontSize: 8, color: C.muted2 }}>{MONEY(spent(sub.id))} actual</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{MONEY(budgetFor(sub.budgeted))}</Text>
                        <Text style={{ fontSize: 8, color: sub.budgeted > 0 ? C.muted2 : '#c9a56c' }}>{sub.budgeted > 0 ? 'budgeted' : 'tap to set'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#c1b9ac'} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Sheet visible={!!editing} close={() => { setEditing(null); setDraft(''); }} title={editing ? `Set budget · ${editing.sub.name}` : ''} subtitle="Amount is budgeted per month. Year view multiplies by 12.">
        {editing && (
          <View>
            <Text style={s.label}>Monthly amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput
                style={[s.input, { paddingLeft: 26 }]}
                value={draft}
                onChangeText={setDraft}
                keyboardType="numeric"
                placeholder="0"
                autoFocus
                testID="budget-edit-amount"
              />
            </View>
            <View style={{ marginTop: 14 }}>
              <GoldButton label="Save amount" onPress={commitEdit} testID="budget-edit-save" />
            </View>
            {editing.sub.budgeted > 0 && (
              <Pressable onPress={() => { setDraft('0'); }} style={{ marginTop: 12, alignItems: 'center' }} testID="budget-edit-clear">
                <Text style={{ color: C.muted2, fontSize: 11 }}>Clear this amount</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>
    </ScrollView>
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
    setTransactions((xs: Tx[]) => xs.some(x => x.id === t.id) ? xs.map(x => x.id === t.id ? t : x) : [{ ...t, id: `manual-${Date.now()}`, origin: 'Manual', period: 'July' }, ...xs]);
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
    if (!ms) return 'never';
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
          <CircleBtn testID="tx-add" onPress={() => setEditing({ type: 'expense', name: '', amount: '', date: 'Jul 15', groupId: 'steward', detailId: 'housing' })}>
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
  return (
    <View>
      <PeriodPills values={['expense','income']} value={t.type} onChange={(v: string) => setT({ ...t, type: v, groupId: v === 'income' ? 'w2' : 'steward', detailId: v === 'income' ? undefined : 'housing' })} testID="tx-type" />
      <Text style={s.label}>Description</Text>
      <TextInput style={s.input} value={t.name} onChangeText={x => setT({ ...t, name: x })} testID="tx-name" />
      <Text style={s.label}>Amount</Text>
      <View style={s.amountInput}>
        <Text style={s.amountPrefix}>$</Text>
        <TextInput style={[s.input, { paddingLeft: 26 }]} value={t.amount} onChangeText={x => setT({ ...t, amount: x })} keyboardType="numeric" testID="tx-amount" />
      </View>
      <Text style={s.label}>Date</Text>
      <TextInput style={s.input} value={t.date} onChangeText={x => setT({ ...t, date: x })} testID="tx-date" />
      <View style={{ marginTop: 14 }}>
        <GoldButton label="Save transaction" onPress={() => save({ ...t, amount: Number(t.amount), origin: t.origin || 'Manual', period: t.period || 'July' })} disabled={!t.name || !Number(t.amount)} testID="tx-save" />
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
const NetWorthScreen = ({ assets, liabilities, transactions }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
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
      ? (providers[0] === 'simplefin' ? 'SimpleFIN' : providers[0] === 'file' ? 'Imported' : providers[0] === 'snaptrade' ? 'SnapTrade' : 'Linked')
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
        <View style={{ flex: 1 }}><Text style={[s.cpSmall, t.textMuted]}>COMMITTED</Text><Text style={[s.cpStrong, t.textInk]}>{MONEY(0)}</Text></View>
        <Text style={{ color: '#b99a6c' }}>=</Text>
        <View style={[{ flex: 1.2 }, s.cpAvailable]}><Text style={[s.cpSmall, { color: '#c8b494' }]}>AVAILABLE</Text><Text style={[s.cpStrong, { color: '#f3dfbd' }]}>{MONEY(Math.max(0, cash))}</Text></View>
      </View>
      <WorthCard title="Assets" total={ta} rows={displayAssets} hidden={!visible} />
      <WorthCard title="Liabilities" total={tl} rows={liabilities} hidden={!visible} />
    </ScrollView>
  );
};
const WorthCard = ({ title, total, rows, hidden }: any) => {
  const t = useThemed();
  return (
    <View style={[s.worthCard, t.cardBg]}>
      <View style={[s.worthCardHeading, t.dividerBorder]}>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{title}</Text>
        <Text style={[{ fontSize: 13, fontWeight: '700', color: C.ink }, t.textInk]}>{hidden ? '••••••' : MONEY(total)}</Text>
      </View>
      {rows.map((r: Asset) => (
        <View key={r.id} style={[s.worthRow, t.dividerBorder]}>
          <View style={[s.worthIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={r.icon as any} size={17} color={t.dark ? D.textMuted : '#817969'} /></View>
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{r.name}</Text><Text style={[{ fontSize: 8, color: '#9b958c' }, t.textMuted]}>{r.source}</Text></View>
          <Text style={[{ fontSize: 10, fontWeight: '700' }, t.textInk]}>{hidden ? '••••' : MONEY(r.value)}</Text>
        </View>
      ))}
    </View>
  );
};

/* ---------------- Legacy / Coaching / Membership / Settings / More ---------------- */
const LegacyScreen = ({ startingNetWorth, back }: any) => {
  const t = useThemed();
  const [timeframe, setTimeframe] = useState('Retirement');
  const [contribution, setContribution] = useState(1250);
  const rate = 8;
  const years = timeframe === '5yr' ? 5 : timeframe === '10yr' ? 10 : timeframe === '20yr' ? 20 : 33;
  const projection = Math.round(startingNetWorth * Math.pow(1 + rate / 100, years) + contribution * 12 * ((Math.pow(1 + rate / 100, years) - 1) / (rate / 100)));
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Your Legacy" subtitle="See what consistent stewardship can become." back={back} />
      <PeriodPills values={['5yr','10yr','20yr','Retirement']} value={timeframe} onChange={setTimeframe} testID="legacy-period" />
      <View style={s.projectionCard}>
        <Text style={{ color: '#caa465', fontSize: 9, letterSpacing: 1.3, textAlign: 'center' }}>PROJECTED TOTAL</Text>
        <Text style={s.projectionStrong}>{MONEY(projection)}</Text>
        <Text style={{ color: '#b4ada3', fontSize: 12, textAlign: 'center', maxWidth: 270, alignSelf: 'center' }}>What you build faithfully can support generations you may never meet.</Text>
        <View style={s.growthChart}>
          {[.16,.24,.34,.48,.66,.84,1].map((f, i) => (
            <LinearGradient key={i} colors={['#e8c98f','#8b6437']} style={[s.growthBar, { height: `${Math.max(18, f * 100)}%` }]} />
          ))}
        </View>
      </View>
      <View style={[s.assumptionsCard, t.cardBg]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Monthly Contribution</Text><Text style={[{ fontSize: 8, color: '#999289' }, t.textMuted]}>Adjust consistent investment</Text></View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32' }}>{MONEY(contribution)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pressable onPress={() => setContribution(Math.max(100, contribution - 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-minus"><Text style={t.textInk}>-</Text></Pressable>
          <Pressable onPress={() => setContribution(Math.min(5000, contribution + 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-plus"><Text style={t.textInk}>+</Text></Pressable>
        </View>
      </View>
    </ScrollView>
  );
};
const CoachingScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const { start } = usePayment();
  const [slots] = useState(() => upcomingCoachingSlots(10));
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const onBookAndPay = async () => {
    if (!selected) { setToast('Please choose a time slot.'); return; }
    setBusy(true);
    setToast(null);
    const res = await start('coaching_session', { scheduled_at: selected });
    setBusy(false);
    if (res.paid) {
      const iso = selected;
      setSelected(null);
      setToast(`Session confirmed for ${formatBookingDate(iso)}.`);
      refreshBookings();
    } else if (res.canceled) {
      setToast('Payment canceled. Your time slot was released.');
    } else if (res.error) {
      setToast(res.error);
    } else if (Platform.OS !== 'web') {
      setToast('Payment is still processing. It will confirm shortly.');
      setTimeout(refreshBookings, 2500);
    }
  };

  const upcoming = bookings
    .filter((b) => b.status === 'confirmed' && new Date(b.scheduled_at).getTime() > Date.now())
    .slice(0, 3);

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Coaching" subtitle="Personal financial clarity, one hour at a time." back={back} />
      <View style={s.coachingCard}>
        <View style={s.coachingIcon}><Ionicons name="chatbubble-outline" size={24} color={C.goldText} /></View>
        <Text style={{ color: '#cda86d', fontSize: 9, letterSpacing: 1.2 }}>PRIVATE SESSION · 60 MIN</Text>
        <Text style={s.coachingPrice}>$50</Text>
        <Text style={{ color: '#aaa298', fontSize: 10, textAlign: 'center' }}>Work through your budget, goals, or next financial decision with Danyell.</Text>
      </View>

      {upcoming.length > 0 && (
        <View style={{ marginTop: 18 }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }, t.textInk]}>UPCOMING</Text>
          {upcoming.map((b) => (
            <View key={b.booking_id} style={[s.slotRow, { borderColor: '#c9a56c33', backgroundColor: t.dark ? D.surface : '#faf4e9' }]}>
              <Ionicons name="checkmark-circle" size={17} color="#8fa88f" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '600' }, t.textInk]}>{formatBookingDate(b.scheduled_at)}</Text>
              <Text style={{ color: '#8fa88f', fontSize: 9, fontWeight: '700' }}>CONFIRMED</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ marginTop: 18 }}>
        <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }, t.textInk]}>PICK A TIME</Text>
        {slots.map((slot) => {
          const active = selected === slot.iso;
          return (
            <Pressable
              key={slot.iso}
              onPress={() => setSelected(slot.iso)}
              style={[s.slotRow, { borderColor: active ? '#c9a56c' : (t.dark ? D.border : '#eae3d5'), backgroundColor: active ? (t.dark ? '#2a2521' : '#fff8ec') : (t.dark ? D.surface : '#fff') }]}
              testID={`coaching-slot-${slot.iso}`}
            >
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={16} color={active ? '#c9a56c' : '#9b958c'} />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: active ? '700' : '500' }, t.textInk]}>{slot.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ marginTop: 18 }}>
        <GoldButton label={busy ? 'Opening secure checkout…' : 'Book & Pay $50'} onPress={onBookAndPay} disabled={busy || !selected} testID="coaching-book" />
      </View>
      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};
const MembershipScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const { start } = usePayment();
  const [membership, setMembership] = useState<{ active: boolean; expires_at: string | null; plan: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/user/membership', { method: 'GET' }, token);
      setMembership(data);
    } catch { setMembership(null); }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const onSubscribe = async () => {
    setBusy(true);
    setToast(null);
    const res = await start('jaleter_premium');
    setBusy(false);
    if (res.paid) {
      setToast('Membership activated for the next 12 months.');
      refresh();
    } else if (res.canceled) {
      setToast('Checkout canceled.');
    } else if (res.error) {
      setToast(res.error);
    } else if (Platform.OS !== 'web') {
      setToast('Payment is still processing. Membership will unlock shortly.');
      setTimeout(refresh, 2500);
    }
  };

  const label = membership?.active
    ? `Renew — $75 (extends to ${new Date(new Date(membership.expires_at as string).getTime() + 365 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`
    : busy ? 'Opening secure checkout…' : 'Subscribe — $75 / year';

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
        {['SimpleFIN account syncing','Full Budget and Transactions','Net Worth and Legacy planning','Faith + Focus library'].map(item => (
          <View key={item} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: t.dark ? D.textSubtle : '#615b52', fontSize: 11 }}>{item}</Text>
          </View>
        ))}
      </View>
      <GoldButton label={label} onPress={onSubscribe} disabled={busy} testID="membership-manage" />
      {toast && <Toast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};
const MoreScreen = ({ navigate, linkedCount }: any) => {
  const t = useThemed();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="More" subtitle="Your legacy, membership, and preferences." />
      <View style={s.moreHero}>
        <Sparkle size={22} color="#d7ad6b" />
        <Text style={s.moreHeroH2}>Build with purpose.</Text>
        <Text style={{ color: '#aaa298', fontSize: 10 }}>Every feature is designed to connect today's stewardship with tomorrow's freedom.</Text>
      </View>
      <View style={{ gap: 10 }}>
        {[
          ['legacy','Your Legacy','Projection synced to Net Worth','trending-up-outline'],
          ['coaching','Book Coaching','$50 per hour','chatbubble-outline'],
          ['membership','Membership','$75 per year','sparkles-outline'],
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
const SettingsScreen = ({ experience, setExperience, appearance, setAppearance, alerts, setAlerts, onLogout, back, linkedAccounts, addLinked, onResetAppData }: any) => {
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
      <PageHeader title="Settings" subtitle="Make Jaleter work your way." back={back} action={<View style={s.avatar}><Text style={{ color: C.goldText, fontSize: 11, fontWeight: '700' }}>AW</Text></View>} />
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
        <Text style={[s.settingsSub, t.textMuted]}>Stay aware without feeling overwhelmed.</Text>
        <Pressable onPress={() => setAlerts({ ...alerts, enabled: !alerts.enabled })} style={s.settingToggleRow} testID="settings-alerts">
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Enable alerts</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>Budget notifications</Text></View>
          <View style={[s.toggle, alerts.enabled && s.toggleOn]}><View style={[s.toggleKnob, alerts.enabled && { transform: [{ translateX: 14 }] }]} /></View>
        </Pressable>
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
  { id: 'more', label: 'More', icon: 'ellipsis-horizontal' as const },
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
        <Text style={s.privacyPara}>Jaleter displays financial information you choose to link. Financial credentials are handled by SimpleFIN and are not stored by Jaleter.</Text>
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
const AccountLinkSheet = ({ visible, close, onConfirm }: any) => {
  const { token } = useAuth();
  const [mode, setMode] = useState<'menu' | 'simplefin' | 'file' | 'request'>('menu');
  const [setupToken, setSetupToken] = useState('');
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
  useEffect(() => { if (visible) { setMode('menu'); setSetupToken(''); setError(''); setMessage(''); setInstitution(''); setNotes(''); setBusy(false); refresh(); } }, [visible]);
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
  const submitSimpleFin = async () => {
    if (!setupToken.trim()) { setError('Paste your SimpleFIN Setup Token.'); return; }
    setError(''); setBusy(true);
    try {
      const data = await apiCall('/api/accounts/simplefin/link', { method: 'POST', body: JSON.stringify({ setup_token: setupToken.trim() }) }, token);
      onConfirm(data?.accounts || []);
      await refresh();
      setMode('menu');
      setMessage(`Linked ${data?.linked_count || 0} accounts.`);
    } catch (e: any) { setError(e?.message || 'Could not link SimpleFIN.'); }
    finally { setBusy(false); }
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
    <Sheet visible={visible} close={close} title={mode === 'menu' ? 'Linked accounts' : mode === 'simplefin' ? 'SimpleFIN' : mode === 'file' ? 'Upload statement' : 'Request an institution'} subtitle={mode === 'menu' ? 'Refresh, remove, or add a new account.' : ''}>
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
            { id: 'simplefin', icon: 'link' as const, label: 'Connect a bank via SimpleFIN', sub: 'Checking, savings, credit cards, loans.' },
            { id: 'file', icon: 'document-attach-outline' as const, label: 'Upload CSV / OFX / QFX / QBO', sub: 'For banks SimpleFIN can\u2019t reach.' },
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
      {mode === 'simplefin' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 10, lineHeight: 16 }}>
            Visit <Text style={{ fontWeight: '700', color: C.goldEyebrow }}>beta-bridge.simplefin.org</Text>, tap <Text style={{ fontWeight: '700' }}>Create Setup Token</Text>, and paste it below.
          </Text>
          <TextInput testID="link-setup-token" style={[s.input, { minHeight: 90 }]} value={setupToken} onChangeText={setSetupToken} multiline autoCapitalize="none" autoCorrect={false} placeholder="Paste your Setup Token here…" />
          {error ? <Text testID="link-error" style={s.formError}>{error}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Linking…' : 'Link account'} onPress={submitSimpleFin} disabled={busy || !setupToken.trim()} testID="link-submit" />
          </View>
        </View>
      )}
      {mode === 'file' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 12, lineHeight: 16 }}>
            Choose a CSV export or an OFX/QFX/QBO statement from your bank. We&apos;ll detect columns, dedupe transactions and update balances automatically.
          </Text>
          {error ? <Text testID="import-error" style={s.formError}>{error}</Text> : null}
          {message ? <Text style={{ color: C.green, fontSize: 11 }}>{message}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Uploading…' : 'Choose file'} onPress={submitFile} disabled={busy} testID="import-choose" />
          </View>
        </View>
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
  const [stage, setStage] = useState<'welcome'|'onboarding'|'signup'|'login'|'forgot'|'reset'|'connect'|'paywall'|'app'>('welcome');
  const [resetInfo, setResetInfo] = useState<{ email: string; token: string | null }>({ email: '', token: null });
  const [experience, setExperience] = useState('Both');
  const [appearance, setAppearance] = useState('Light');
  const [active, setActive] = useState('home');
  const [categories, setCategories] = useState(initialCategories);
  const [incomeSources, setIncomeSources] = useState(initialIncome);
  const [transactions, setTransactions] = useState<Tx[]>(initialTx);
  const [assets] = useState<Asset[]>(initialAssets);
  const [liabilities] = useState<Asset[]>(initialLiabilities);
  const [linkedAccounts, setLinkedAccounts] = useState<any[]>([]);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [alerts, setAlerts] = useState({ enabled: true, threshold: 80 });

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
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);
  // Persist on change (skip auth-managed fields)
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources })).catch(() => {});
  }, [hydrated, experience, appearance, transactions, linkedAccounts, alerts, categories, incomeSources]);

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

  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const openingCash = 0;
  const syncedCash = openingCash + income - expense;
  const syncedAssets = assets.map(x => x.id === 'cash' ? { ...x, value: syncedCash } : x);
  const manualAssetsTotal = syncedAssets.reduce((sum, x) => sum + x.value, 0);
  const netWorth = manualAssetsTotal + linkedAssetsTotal - liabilities.reduce((sum, x) => sum + x.value, 0);
  const monthlyBudget = categories.flatMap(c => c.subcategories).reduce((sum, x) => sum + x.budgeted, 0);
  const budgetUsage = monthlyBudget > 0 ? (expense / monthlyBudget) * 100 : 0;
  const nav = (screen: string, category: string | null = null) => { setActive(screen); if (category) setFocusCategory(category); };

  if (!hydrated || auth.loading) return <View style={{ flex: 1, backgroundColor: C.cream }} testID="auth-loading" />;

  const bg = isDark ? D.bg : C.cream;
  const displayName = (auth.user?.name || 'Friend').split(' ')[0];

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
      {auth.user && stage === 'app' && (
        <View style={[{ flex: 1 }, isDark && { backgroundColor: D.bg }]}>
          {active === 'home' && <HomeScreen name={displayName} experience={experience} netWorth={netWorth} budgetUsage={budgetUsage} alertsEnabled={alerts.enabled} navigate={nav} />}
          {active === 'budget' && <BudgetScreen categories={categories} setCategories={setCategories} incomeSources={incomeSources} transactions={transactions} focusCategory={focusCategory} clearFocus={() => setFocusCategory(null)} />}
          {active === 'transactions' && <TransactionsScreen transactions={transactions} setTransactions={setTransactions} categories={categories} incomeSources={incomeSources} openLinkSheet={() => { setActive('settings'); }} />}
          {active === 'networth' && <NetWorthScreen assets={syncedAssets} liabilities={liabilities} transactions={transactions} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={linkedAccounts.length} />}
          {active === 'legacy' && <LegacyScreen startingNetWorth={netWorth} back={() => nav('more')} />}
          {active === 'coaching' && <CoachingScreen back={() => nav('more')} />}
          {active === 'membership' && <MembershipScreen back={() => nav('more')} />}
          {active === 'settings' && <SettingsScreen experience={experience} setExperience={setExperience} appearance={appearance} setAppearance={setAppearance} alerts={alerts} setAlerts={setAlerts} onLogout={async () => { await auth.logout(); setActive('home'); setStage('welcome'); }} back={() => nav('more')} linkedAccounts={linkedAccounts} addLinked={(a: any[]) => setLinkedAccounts([...linkedAccounts, ...a])} onResetAppData={async () => {
            try { await storage.removeItem(STORAGE_KEY); } catch {}
            for (const k of LEGACY_STORAGE_KEYS) { try { await storage.removeItem(k); } catch {} }
            setTransactions([]);
            setLinkedAccounts([]);
            setCategories(initialCategories);
            setIncomeSources(initialIncome);
            setExperience('Faith');
            setAppearance('System');
            setAlerts({ enabled: true, threshold: 80 });
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
  subcategoryRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1ede6' },
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
