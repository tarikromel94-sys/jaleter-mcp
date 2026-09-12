/**
 * Shared utilities for Jaleter app screens.
 *
 * This module hosts UI atoms, theme utilities, common helpers, and the
 * canonical StyleSheet (`s`) — everything that would otherwise be
 * duplicated across the app's screens. Extracted from `/app/frontend/
 * app/index.tsx` on 2026-06-10 as the first step of the monolithic
 * screen refactor (P1).
 *
 * Guidelines for future contributors:
 *   - Do NOT introduce screen-specific state or props here.
 *   - Keep the module dependency-light — only import from
 *     `/src/jaleterTheme`, `/src/AuthContext`, expo packages, and
 *     react-native. Anything screen-specific belongs in the screen
 *     file itself or a dedicated helper module.
 *   - `s` (StyleSheet) is intentionally the single source of truth
 *     used by both `index.tsx` and every screen — keep it consistent.
 */
import React, { createContext, useContext, useEffect } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import { C, D, F } from '@/src/jaleterTheme';


// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------
export type Asset = {
  id: string;
  name: string;
  value: number;
  source: string;
  icon: string;
};


// -----------------------------------------------------------------------
// Theme context + helpers
// -----------------------------------------------------------------------
export const ThemeCtx = createContext<{ dark: boolean }>({ dark: false });
export const useDark = () => useContext(ThemeCtx).dark;

export const useThemed = () => {
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


// -----------------------------------------------------------------------
// Wealth-category helpers (mirrors backend `wealth_service.py`)
// -----------------------------------------------------------------------
export const CATEGORY_LABELS: Record<string, string> = {
  cash: 'Cash', investments: 'Investments', real_estate: 'Real Estate',
  vehicles: 'Vehicles', other_assets: 'Other Assets',
  credit_cards: 'Credit Cards', mortgage: 'Mortgage', auto_loans: 'Auto Loans',
  student_loans: 'Student Loans', other_liabilities: 'Other Liabilities',
};

export const CATEGORY_ICONS: Record<string, any> = {
  cash: 'wallet-outline', investments: 'trending-up', real_estate: 'business-outline',
  vehicles: 'car-outline', other_assets: 'cube-outline',
  credit_cards: 'card-outline', mortgage: 'home-outline', auto_loans: 'car-sport-outline',
  student_loans: 'school-outline', other_liabilities: 'document-text-outline',
};

export const LIABILITY_CATEGORIES = new Set([
  'credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities',
]);

/**
 * Legacy fallback used only when a Plaid account row is missing a `category`
 * (older cached rows). New code paths should rely on `r.category` which the
 * backend `wealth_service.classify_plaid()` sets by type + subtype.
 */
export const isInvestmentAccount = (r: any) => {
  // Null-safe: callers occasionally pass in a stale/undefined row (e.g. during
  // an import-in-progress race) — never throw for that, just return false.
  if (r == null || typeof r !== 'object') return false;
  if (r.category === 'investments') return true;
  if (r.category) return false; // trust the backend classification
  const hay = `${r.name || ''} ${r.account_name || ''} ${r.org_name || ''} ${r.type || ''} ${r.subtype || ''}`.toLowerCase();
  if (r.provider === 'snaptrade') return true;
  return /(invest|brokerage|ira|401k|403b|roth|hsa|mutual|advisor|wealth|portfolio|etrade|schwab|fidelity|vanguard|robinhood)/.test(hay);
};

/**
 * Humanise an ISO timestamp — "just now", "5 mins ago", "2 hrs ago", etc.
 * Used across Wealth rows to show freshness of synced balances.
 */
export function timeAgo(iso: string | null | undefined): string {
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


// -----------------------------------------------------------------------
// Shared UI atoms
// -----------------------------------------------------------------------
export const Sparkle = ({ size = 20, color = C.goldGlow, style }: any) => (
  <Text style={[{ color, fontSize: size, fontWeight: '700' }, style]}>✦</Text>
);

export const GoldButton = ({ label, onPress, disabled, testID }: any) => (
  <Pressable testID={testID} disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.45 : 1 }}>
    <LinearGradient colors={['#f2c779', '#ffe3a8', '#d09a4d']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.goldBtn}>
      <Text style={s.goldBtnText}>{label}</Text>
    </LinearGradient>
  </Pressable>
);

export const CircleBtn = ({ children, onPress, testID, dark }: any) => {
  const t = useThemed();
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.circleBtn, dark && { backgroundColor: '#24221e' }, t.circleBg]}>{children}</Pressable>
  );
};

export const PeriodPills = ({ values, value, onChange, testID }: any) => {
  const t = useThemed();
  // Short lists keep their original stretched (`flex:1`) layout so touch
  // targets stay large. Longer lists (Legacy's 8 timeframes, Budget's
  // Jan-Dec+Year) horizontally scroll with content-hugging widths so long
  // labels like "Retirement" and "September" aren't clipped.
  const scrollable = values.length > 5;
  const scrollRef = React.useRef<ScrollView | null>(null);
  const pillWidths = React.useRef<Record<string, number>>({});
  const pillOffsets = React.useRef<Record<string, number>>({});
  const [, setLayoutTick] = React.useState(0);
  const scrollToSelected = React.useCallback(() => {
    if (!scrollable || !scrollRef.current) return;
    const offset = pillOffsets.current[value];
    const width = pillWidths.current[value];
    if (typeof offset === 'number' && typeof width === 'number') {
      // Aim to center the active pill in the ~260px visible strip.
      const target = Math.max(0, offset - 130 + width / 2);
      scrollRef.current.scrollTo({ x: target, animated: true });
    }
  }, [scrollable, value]);
  // Auto-scroll on `value` change so switching months keeps the pill in view.
  React.useEffect(() => { scrollToSelected(); }, [value, scrollToSelected]);
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
      ref={scrollRef}
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
            onLayout={(e) => {
              pillWidths.current[v] = e.nativeEvent.layout.width;
              pillOffsets.current[v] = e.nativeEvent.layout.x;
              // Trigger the auto-scroll (spec #18) from the layout pass so
              // it runs on the very first mount, once the selected pill's
              // geometry is known. Debounced via a tick because RN may call
              // onLayout multiple times during initial render.
              if (v === value) {
                setLayoutTick((n) => n + 1);
                requestAnimationFrame(() => scrollToSelected());
              }
            }}
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

export const PageHeader = ({ title, subtitle, back, action }: any) => {
  const t = useThemed();
  return (
    <View style={s.pageHeader}>
      <View style={s.headerActions}>
        {back ? <CircleBtn onPress={back} testID="header-back"><Ionicons name="arrow-back" size={20} color={t.dark ? D.text : C.ink3} /></CircleBtn> : <View style={{ width: 38 }} />}
        {action || <View style={{ width: 38 }} />}
      </View>
      <Text style={[s.pageTitle, t.textInk]}>{title}</Text>
      {subtitle ? <Text style={[s.pageSubtitle, t.textSubtle]}>{subtitle}</Text> : null}
    </View>
  );
};

export const Sheet = ({ visible, close, title, subtitle, children }: any) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    {/* Core KeyboardAvoidingView (NOT keyboard-controller's) — RN Modals render
        in a separate native window on iOS, where keyboard-controller's tracking
        is unreliable. Core KAV listens to Keyboard frame events directly, so
        the WHOLE sheet (inputs + Save button) lifts above the iOS keyboard and
        settles back when it closes. Android resizes the window natively. */}
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.modalBackdrop}
    >
      <Pressable style={{ flex: 1 }} onPress={close} />
      <View style={s.modalSheet}>
        <Pressable testID="modal-close" onPress={close} style={s.modalClose}><Ionicons name="close" size={20} color={C.ink} /></Pressable>
        <Text style={s.sheetTitle}>{title}</Text>
        {subtitle ? <Text style={s.sheetSubtitle}>{subtitle}</Text> : null}
        {/* Keyboard-aware: if the lifted sheet is still taller than the space
            above the keyboard, the focused input is auto-scrolled into view
            with a 24px gap. Returns to normal once the keyboard closes. */}
        <KeyboardAwareScrollView style={{ maxHeight: 520 }} bottomOffset={24} keyboardShouldPersistTaps="handled">{children}</KeyboardAwareScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>
);

export const Toast = ({ message, onHide }: any) => {
  useEffect(() => { const t = setTimeout(onHide, 2800); return () => clearTimeout(t); }, [onHide]);
  return (
    <View style={s.toast}>
      <Ionicons name="checkmark" size={16} color={C.goldGlow} />
      <Text style={s.toastText}>{message}</Text>
      <Pressable onPress={onHide}><Ionicons name="close" size={14} color="#bdb6ac" /></Pressable>
    </View>
  );
};


// -----------------------------------------------------------------------
// Canonical StyleSheet — mirrors what used to live at the bottom of
// `index.tsx`. Any style additions/edits should happen here from now on.
// -----------------------------------------------------------------------
export const s = StyleSheet.create({
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
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 22, marginBottom: 2 },
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
