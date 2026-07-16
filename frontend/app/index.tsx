import React, { useState, useMemo, useEffect, createContext, useContext } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Modal, StatusBar as RNStatusBar, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { storage } from '@/src/utils/storage';
import { AuthProvider, useAuth } from '@/src/AuthContext';
import { C, D, F } from '@/src/jaleterTheme';
import { dailyQuote, MONEY, EXACT, QuoteType } from '@/src/quoteLibrary';

const STORAGE_KEY = 'jaleter-state-v1';

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

/* ---------------- DATA ---------------- */
const initialCategories = [
  { id: 'give', name: 'Give', tagline: 'Lead with generosity', subcategories: [
    { id: 'tithe', name: 'Tithe', budgeted: 900 }, { id: 'missions', name: 'Missions', budgeted: 150 }, { id: 'extra-giving', name: 'Extra Giving', budgeted: 150 }] },
  { id: 'steward', name: 'Steward', tagline: 'Protect what you have', subcategories: [
    { id: 'housing', name: 'Housing', budgeted: 1650 }, { id: 'food', name: 'Food & Dining', budgeted: 800 }, { id: 'transport', name: 'Transportation', budgeted: 550 }, { id: 'utilities', name: 'Utilities', budgeted: 600 }] },
  { id: 'grow', name: 'Grow', tagline: 'Build future wealth', subcategories: [
    { id: 'investments', name: 'Investments', budgeted: 900 }, { id: 'emergency', name: 'Emergency Fund', budgeted: 500 }, { id: 'education', name: 'Education', budgeted: 300 }] },
  { id: 'enjoy', name: 'Enjoy', tagline: 'Enjoy life responsibly', subcategories: [
    { id: 'travel', name: 'Travel', budgeted: 450 }, { id: 'shopping', name: 'Shopping', budgeted: 350 }, { id: 'entertainment', name: 'Entertainment', budgeted: 300 }] },
];
const initialIncome = [{ id: 'w2', name: 'W-2 Income', budgeted: 5200 }, { id: 'contract', name: 'Contract Income', budgeted: 1500 }, { id: 'business', name: 'Business Income', budgeted: 900 }];
type Tx = { id: string; date: string; name: string; amount: number; type: 'income' | 'expense'; groupId: string; detailId?: string; origin: string; period: string; };
const initialTx: Tx[] = ([
  ['tx1','Jul 01','Paycheck',5200,'income','w2'],['tx2','Jul 05','Client project',1400,'income','contract'],['tx3','Jul 10','Business deposit',1000,'income','business'],
  ['tx4','Jul 02','Tithe',900,'expense','give','tithe'],['tx5','Jul 04','Missions',60,'expense','give','missions'],['tx6','Jul 03','Mortgage',1450,'expense','steward','housing'],
  ['tx7','Jul 08','Groceries & dining',680.5,'expense','steward','food'],['tx8','Jul 09','Transportation',420,'expense','steward','transport'],['tx9','Jul 11','Utilities',384.5,'expense','steward','utilities'],
  ['tx10','Jul 06','Investments',700,'expense','grow','investments'],['tx11','Jul 12','Emergency Fund',250,'expense','grow','emergency'],['tx12','Jul 13','Education',90,'expense','grow','education'],
  ['tx13','Jul 07','Travel',420,'expense','enjoy','travel'],['tx14','Jul 13','Shopping',310,'expense','enjoy','shopping'],['tx15','Jul 14','Entertainment',285,'expense','enjoy','entertainment'],
] as any[]).map(([id,date,name,amount,type,groupId,detailId]) => ({ id, date, name, amount, type, groupId, detailId, origin: id==='tx12'?'Manual':'SimpleFIN', period: 'July' }));

type Asset = { id: string; name: string; value: number; source: string; icon: string; };
const initialAssets: Asset[] = [
  { id: 'cash', name: 'Cash', value: 18450, source: 'SimpleFIN', icon: 'wallet-outline' },
  { id: 'investments', name: 'Investments', value: 42750, source: 'SimpleFIN', icon: 'trending-up' },
  { id: 'real-estate', name: 'Real Estate', value: 185000, source: 'Manual', icon: 'business-outline' },
  { id: 'vehicles', name: 'Vehicles', value: 42000, source: 'Manual', icon: 'car-outline' },
];
const initialLiabilities: Asset[] = [
  { id: 'mortgage', name: 'Mortgage', value: 151300, source: 'Manual', icon: 'home-outline' },
  { id: 'auto-loan', name: 'Auto Loan', value: 26400, source: 'SimpleFIN', icon: 'car-outline' },
  { id: 'credit-cards', name: 'Credit Cards', value: 2200, source: 'SimpleFIN', icon: 'card-outline' },
  { id: 'student-loans', name: 'Student Loans', value: 29850, source: 'Manual', icon: 'cash-outline' },
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

/* ---------------- Welcome ---------------- */
const Welcome = ({ onStart, onLogin }: any) => (
  <View style={s.welcome}>
    <View style={s.welcomeContent}>
      <View style={s.brandMark}>
        <Sparkle size={22} style={{ position: 'absolute', right: 3, top: 0 }} />
        <Sparkle size={10} style={{ position: 'absolute', left: 8, top: 14 }} />
      </View>
      <Text style={s.welcomeH1}>Jaleter</Text>
      <Text style={s.welcomeSubtitle}>SMART BUDGETING.{'\n'}WEALTHY LIVING.</Text>
    </View>
    {/* gold waves */}
    <View style={s.goldWavesWrap} pointerEvents="none">
      {[65,80,95,112,132].map((top, i) => (
        <View key={i} style={[s.goldWave, { top, borderColor: i===3 ? '#f0bd67' : '#ad7d3d' }]} />
      ))}
    </View>
    <View style={s.welcomeActions}>
      <GoldButton label="Get Started" onPress={onStart} testID="welcome-get-started" />
      <Pressable onPress={onLogin} testID="welcome-login" style={{ marginTop: 26 }}>
        <Text style={s.loginLink}>Already have an account? <Text style={{ color: '#d9c5a5' }}>Log in</Text></Text>
      </Pressable>
    </View>
  </View>
);

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
const Login = ({ back, goSignup }: any) => {
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

/* ---------------- Connect ---------------- */
const FirstConnect = ({ onConnect, onSkip }: any) => (
  <ScrollView style={s.lightScreen} contentContainerStyle={{ padding: 23, paddingTop: 60, paddingBottom: 28 }}>
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
    <GoldButton label="Connect with SimpleFIN" onPress={onConnect} testID="connect-simplefin" />
    <Pressable onPress={onSkip} testID="connect-skip"><Text style={[s.loginLink, { marginTop: 20 }]}>Skip and enter manually</Text></Pressable>
  </ScrollView>
);

/* ---------------- Paywall ---------------- */
const Paywall = ({ onContinue }: any) => (
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
    <GoldButton label="Continue to secure checkout" onPress={onContinue} testID="paywall-checkout" />
    <Pressable onPress={onContinue} testID="paywall-preview"><Text style={[s.loginLink, { marginTop: 20 }]}>Continue in preview mode</Text></Pressable>
  </ScrollView>
);

/* ---------------- Home ---------------- */
const HomeScreen = ({ name, experience, netWorth, budgetUsage, alertsEnabled, navigate }: any) => {
  const t = useThemed();
  const q = dailyQuote(experience as QuoteType, new Date());
  const projected = Math.round(netWorth * Math.pow(1.08, 33) + 1250 * 12 * ((Math.pow(1.08, 33) - 1) / 0.08));
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
            <Ionicons name="trending-up" size={12} color={C.greenSoft} />
            <Text style={{ color: C.greenSoft, fontSize: 9 }}>4.8% this quarter</Text>
          </View>
        </Pressable>
      </View>
      {alertsEnabled && (
        <Pressable style={s.alertBanner} onPress={() => navigate('budget', 'enjoy')} testID="home-alert">
          <View style={s.alertIcon}><Ionicons name="notifications" size={18} color={C.alertIconText} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 11, color: C.alertText }}>Enjoy is approaching its limit</Text>
            <Text style={{ color: '#8d806e', fontSize: 9 }}>You've used 92% of this month's budget.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={C.alertText} />
        </Pressable>
      )}
      <View style={s.streakBanner}>
        <Sparkle size={22} color="#77a17f" style={{ width: 36, textAlign: 'center' as any }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', fontSize: 11, color: C.streakText }}>7-day stewardship streak</Text>
          <Text style={{ color: '#8d806e', fontSize: 9 }}>You've checked in every day this week.</Text>
        </View>
        <Ionicons name="trophy" size={20} color="#80a487" />
      </View>
      <View style={s.sectionTitle}>
        <Text style={[s.sectionH3, t.textInk]}>Your Legacy</Text>
        <Pressable onPress={() => navigate('legacy')} testID="home-legacy-link" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#857b6d', fontSize: 11 }}>Explore </Text>
          <Ionicons name="chevron-forward" size={13} color="#857b6d" />
        </Pressable>
      </View>
      <Pressable style={s.legacyTeaser} onPress={() => navigate('legacy')} testID="home-legacy">
        <Text style={{ color: '#c9a56c', fontSize: 8, letterSpacing: 1.3 }}>RETIREMENT PROJECTION</Text>
        <Text style={s.legacyStrong}>{MONEY(projected)}</Text>
        <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15 }}>Consistency today can change your family's tomorrow.</Text>
        <View style={s.teaserBars}>
          {[28,36,44,57,70,88].map((h,i) => <LinearGradient key={i} colors={['#e5c38b','#7d5b31']} style={[s.teaserBar, { height: `${h}%` }]} />)}
        </View>
      </Pressable>
    </ScrollView>
  );
};

/* ---------------- Budget ---------------- */
const BudgetScreen = ({ categories, incomeSources, transactions, focusCategory, clearFocus }: any) => {
  const t = useThemed();
  const [period, setPeriod] = useState('July');
  const [expanded, setExpanded] = useState<string[]>(['give']);
  const annual = period === 'Year';
  useEffect(() => { if (focusCategory) { setExpanded(x => x.includes(focusCategory) ? x : [...x, focusCategory]); clearFocus(); } }, [focusCategory]);
  const relevant = transactions.filter((t: Tx) => annual || t.period === period);
  const actualIncome = relevant.filter((t: Tx) => t.type === 'income').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const actualExpenses = relevant.filter((t: Tx) => t.type === 'expense').reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
  const spent = (id: string) => relevant.filter((t: Tx) => t.type === 'expense' && (t.detailId === id || t.groupId === id)).reduce((sum: number, t: Tx) => sum + t.amount, 0);
  const budgetFor = (subBudget: number) => subBudget * (annual ? 12 : 1);
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Budget" subtitle="Give first. Steward wisely. Grow intentionally." />
      <PeriodPills values={[...MONTHS, 'Year']} value={period} onChange={setPeriod} testID="budget-period" />
      <View style={s.budgetSummary}>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Total Income</Text><Text style={s.bsStrong}>{MONEY(actualIncome)}</Text><Text style={s.bsSmall}>of {MONEY(plannedIncome)}</Text></View>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Expenses</Text><Text style={s.bsStrong}>{MONEY(actualExpenses)}</Text><Text style={s.bsSmall}>actual</Text></View>
        <View style={s.budgetSumCell}><Text style={s.bsSmall}>Net</Text><Text style={s.bsStrong}>{MONEY(actualIncome - actualExpenses)}</Text><Text style={s.bsSmall}>remaining</Text></View>
      </View>
      <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Plan by Purpose</Text><Text style={[s.sectionCap, t.textMuted]}>Budget vs. actual</Text></View>
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
                    <View key={sub.id} style={s.subcategoryRow}>
                      <View style={{ flex: 1 }}><Text style={{ fontSize: 10, fontWeight: '700' }}>{sub.name}</Text><Text style={{ fontSize: 8, color: C.muted2 }}>{MONEY(spent(sub.id))} actual</Text></View>
                      <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 10, fontWeight: '700' }}>{MONEY(budgetFor(sub.budgeted))}</Text><Text style={{ fontSize: 8, color: C.muted2 }}>budgeted</Text></View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
};

/* ---------------- Transactions ---------------- */
const TransactionsScreen = ({ transactions, setTransactions, categories, incomeSources }: any) => {
  const t = useThemed();
  const [filter, setFilter] = useState('All');
  const [editing, setEditing] = useState<any>(null);
  const [toast, setToast] = useState('');
  const shown = transactions.filter((t: Tx) => filter === 'All' || (filter === 'Income' ? t.type === 'income' : t.type === 'expense'));
  const save = (t: any) => {
    setTransactions((xs: Tx[]) => xs.some(x => x.id === t.id) ? xs.map(x => x.id === t.id ? t : x) : [{ ...t, id: `manual-${Date.now()}`, origin: 'Manual', period: 'July' }, ...xs]);
    setEditing(null); setToast('Transaction saved and totals refreshed.');
  };
  const remove = (id: string) => { setTransactions((xs: Tx[]) => xs.filter(x => x.id !== id)); setEditing(null); setToast('Transaction deleted.'); };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Transactions" subtitle="Synced automatically. Editable anytime." action={
        <CircleBtn testID="tx-add" onPress={() => setEditing({ type: 'expense', name: '', amount: '', date: 'Jul 15', groupId: 'steward', detailId: 'housing' })}>
          <Ionicons name="add" size={19} color={C.ink3} />
        </CircleBtn>
      } />
      <View style={s.syncBanner}>
        <View style={s.syncIcon}><Ionicons name="link" size={18} color="#50715b" /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: C.streakText }}>SimpleFIN sync is current</Text>
          <Text style={{ fontSize: 8, color: '#829087' }}>Budget actuals and Net Worth cash update here.</Text>
        </View>
        <Ionicons name="checkmark" size={16} color="#50715b" />
      </View>
      <PeriodPills values={['All','Income','Expenses']} value={filter} onChange={setFilter} testID="tx-filter" />
      <View style={[s.transactionList, t.cardBg]}>
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
const NetWorthScreen = ({ assets, liabilities }: any) => {
  const t = useThemed();
  const [period, setPeriod] = useState('Quarter');
  const [visible, setVisible] = useState(true);
  const ta = assets.reduce((sum: number, x: Asset) => sum + x.value, 0);
  const tl = liabilities.reduce((sum: number, x: Asset) => sum + x.value, 0);
  const nw = ta - tl;
  const cash = assets.find((x: Asset) => x.id === 'cash')?.value || 0;
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
          <Text style={{ color: '#7fac8d', fontSize: 10 }}>+4.8% this {period.toLowerCase()}</Text>
        </View>
        {/* Faux ascending line chart (no react-native-svg installed) */}
        <View style={s.nwChart}>
          {[62, 55, 48, 42, 33, 24, 15, 9].map((top, i, arr) => (
            <View key={i} style={[s.nwChartDot, { left: `${(i / (arr.length - 1)) * 100}%`, top }]} />
          ))}
        </View>
      </View>
      <PeriodPills values={['Month','Quarter','Year']} value={period} onChange={setPeriod} testID="nw-period" />
      <View style={[s.cashProtection, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <View style={{ flex: 1 }}><Text style={[s.cpSmall, t.textMuted]}>TOTAL CASH</Text><Text style={[s.cpStrong, t.textInk]}>{MONEY(cash)}</Text></View>
        <Text style={{ color: '#b99a6c' }}>−</Text>
        <View style={{ flex: 1 }}><Text style={[s.cpSmall, t.textMuted]}>COMMITTED</Text><Text style={[s.cpStrong, t.textInk]}>{MONEY(5050)}</Text></View>
        <Text style={{ color: '#b99a6c' }}>=</Text>
        <View style={[{ flex: 1.2 }, s.cpAvailable]}><Text style={[s.cpSmall, { color: '#c8b494' }]}>AVAILABLE</Text><Text style={[s.cpStrong, { color: '#f3dfbd' }]}>{MONEY(Math.max(0, cash - 5050))}</Text></View>
      </View>
      <WorthCard title="Assets" total={ta} rows={assets} hidden={!visible} />
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
  const [booked, setBooked] = useState(false);
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Coaching" subtitle="Personal financial clarity, one hour at a time." back={back} />
      <View style={s.coachingCard}>
        <View style={s.coachingIcon}><Ionicons name="chatbubble-outline" size={24} color={C.goldText} /></View>
        <Text style={{ color: '#cda86d', fontSize: 9, letterSpacing: 1.2 }}>PRIVATE SESSION</Text>
        <Text style={s.coachingPrice}>$50 / hour</Text>
        <Text style={{ color: '#aaa298', fontSize: 10, textAlign: 'center' }}>Work through your budget, goals, or next financial decision with Danyell.</Text>
      </View>
      <View style={{ marginTop: 14 }}>
        <GoldButton label="Book time with Danyell" onPress={() => setBooked(true)} testID="coaching-book" />
      </View>
      {booked && <Toast message="Session reserved for July 22 at 10:00 AM." onHide={() => setBooked(false)} />}
    </ScrollView>
  );
};
const MembershipScreen = ({ back }: any) => {
  const t = useThemed();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Membership" subtitle="One simple annual plan." back={back} />
      <View style={[s.priceCard, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>JALETER PREMIUM</Text>
        <Text style={[s.priceStrong, t.textInk]}>$75<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}>/year</Text></Text>
        {['SimpleFIN account syncing','Full Budget and Transactions','Net Worth and Legacy planning','Faith + Focus library'].map(item => (
          <View key={item} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 5 }}>
            <Ionicons name="checkmark" size={15} color="#a57537" />
            <Text style={{ color: t.dark ? D.textSubtle : '#615b52', fontSize: 11 }}>{item}</Text>
          </View>
        ))}
      </View>
      <GoldButton label="Manage on secure website" onPress={() => {}} testID="membership-manage" />
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
const SettingsScreen = ({ experience, setExperience, appearance, setAppearance, alerts, setAlerts, onLogout, back, linkedAccounts, addLinked }: any) => {
  const t = useThemed();
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
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
        <Text style={s.settingsH3}>Your Experience</Text>
        <Text style={s.settingsSub}>100 approved messages. No generated scripture.</Text>
        <PeriodPills values={['Faith','Both','Motivation']} value={experience} onChange={setExperience} testID="settings-exp" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={s.settingsH3}>Appearance</Text>
        <Text style={s.settingsSub}>Choose a look or follow your device.</Text>
        <PeriodPills values={['Light','System','Dark']} value={appearance} onChange={setAppearance} testID="settings-appear" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={s.settingsH3}>Budget Alerts</Text>
        <Text style={s.settingsSub}>Stay aware without feeling overwhelmed.</Text>
        <Pressable onPress={() => setAlerts({ ...alerts, enabled: !alerts.enabled })} style={s.settingToggleRow} testID="settings-alerts">
          <View style={{ flex: 1 }}><Text style={{ fontSize: 11, fontWeight: '700' }}>Enable alerts</Text><Text style={{ fontSize: 9, color: C.muted3 }}>Budget notifications</Text></View>
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
      <Pressable onPress={onLogout} style={s.logoutBtn} testID="settings-logout">
        <Ionicons name="log-out-outline" size={17} color={C.danger} />
        <Text style={{ color: C.danger, fontSize: 12, fontWeight: '700' }}>Log Out</Text>
      </Pressable>
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
  const [step, setStep] = useState(1);
  const [institution, setInstitution] = useState('');
  useEffect(() => { if (visible) { setStep(1); setInstitution(''); } }, [visible]);
  const banks = ['Chase', 'Bank of America', 'Capital One', 'Other'];
  return (
    <Sheet visible={visible} close={close} title="Connect with SimpleFIN" subtitle={`Step ${step} of 3 · Secure preview flow`}>
      {step === 1 && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 12 }}>Choose your financial institution.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {banks.map(b => (
              <Pressable key={b} testID={`bank-${b}`} onPress={() => setInstitution(b)} style={[s.bankBtn, institution === b && s.bankBtnSelected]}>
                <Ionicons name="business-outline" size={18} color={institution === b ? '#8e632f' : '#5f5a52'} />
                <Text style={{ fontSize: 11, color: institution === b ? '#8e632f' : '#5f5a52', marginTop: 6 }}>{b}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 14 }}><GoldButton label="Continue" onPress={() => setStep(2)} disabled={!institution} testID="link-step2" /></View>
        </View>
      )}
      {step === 2 && (
        <View style={s.secureHandoff}>
          <Ionicons name="shield-checkmark" size={31} color="#a8783c" />
          <Text style={{ fontFamily: F.serif, fontSize: 16, fontWeight: '700', marginTop: 8 }}>Authenticate on {institution}</Text>
          <Text style={{ color: '#817b72', fontSize: 11, textAlign: 'center', marginTop: 6 }}>SimpleFIN handles authentication. Jaleter never receives your bank credentials.</Text>
          <View style={{ marginTop: 14, alignSelf: 'stretch' }}><GoldButton label="Continue securely" onPress={() => setStep(3)} testID="link-step3" /></View>
        </View>
      )}
      {step === 3 && (
        <View>
          <View style={s.subscriptionCard}>
            <Text style={{ color: '#c9a86f', fontSize: 9, letterSpacing: 1 }}>READY TO CONNECT</Text>
            <Text style={{ fontFamily: F.serif, fontSize: 18, fontWeight: '700', color: '#fff', marginVertical: 6 }}>{institution}</Text>
            <Text style={{ color: '#a9a198', fontSize: 10 }}>2 accounts selected · daily transaction sync</Text>
          </View>
          <GoldButton label="Confirm connection" onPress={() => onConfirm([{ id: `${institution}-c`, name: 'Everyday Checking', institution }, { id: `${institution}-s`, name: 'High-Yield Savings', institution }])} testID="link-confirm" />
        </View>
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
  const [stage, setStage] = useState<'welcome'|'onboarding'|'signup'|'login'|'connect'|'paywall'|'app'>('welcome');
  const [experience, setExperience] = useState('Both');
  const [appearance, setAppearance] = useState('Light');
  const [active, setActive] = useState('home');
  const [categories] = useState(initialCategories);
  const [incomeSources] = useState(initialIncome);
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
        const raw = await storage.getItem(STORAGE_KEY, '' as string);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.experience) setExperience(data.experience);
          if (data.appearance) setAppearance(data.appearance);
          if (data.transactions) setTransactions(data.transactions);
          if (data.linkedAccounts) setLinkedAccounts(data.linkedAccounts);
          if (data.alerts) setAlerts(data.alerts);
        }
      } catch {}
      setHydrated(true);
    })();
  }, []);
  // Persist on change (skip auth-managed fields)
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify({ experience, appearance, transactions, linkedAccounts, alerts })).catch(() => {});
  }, [hydrated, experience, appearance, transactions, linkedAccounts, alerts]);

  // When Login/Google flow completes, jump straight to the app.
  // Signup flow stays on 'connect'/'paywall' cosmetic screens (handled by onCreated).
  useEffect(() => {
    if (auth.user && (stage === 'login' || stage === 'welcome')) setStage('app');
    if (!auth.user && stage === 'app') setStage('welcome');
  }, [auth.user]);

  const isDark = appearance === 'Dark';
  const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const openingCash = 16800;
  const syncedCash = openingCash + income - expense;
  const syncedAssets = assets.map(x => x.id === 'cash' ? { ...x, value: syncedCash } : x);
  const netWorth = syncedAssets.reduce((sum, x) => sum + x.value, 0) - liabilities.reduce((sum, x) => sum + x.value, 0);
  const monthlyBudget = categories.flatMap(c => c.subcategories).reduce((sum, x) => sum + x.budgeted, 0);
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
      {!auth.user && stage === 'login' && <Login back={() => setStage('welcome')} goSignup={() => setStage('signup')} />}
      {auth.user && stage === 'connect' && <FirstConnect onConnect={() => { setLinkedAccounts([{ id: 'chase-checking', name: 'Everyday Checking' }]); setStage('paywall'); }} onSkip={() => setStage('paywall')} />}
      {auth.user && stage === 'paywall' && <Paywall onContinue={() => setStage('app')} />}
      {auth.user && stage === 'app' && (
        <View style={[{ flex: 1 }, isDark && { backgroundColor: D.bg }]}>
          {active === 'home' && <HomeScreen name={displayName} experience={experience} netWorth={netWorth} budgetUsage={expense / monthlyBudget * 100} alertsEnabled={alerts.enabled} navigate={nav} />}
          {active === 'budget' && <BudgetScreen categories={categories} incomeSources={incomeSources} transactions={transactions} focusCategory={focusCategory} clearFocus={() => setFocusCategory(null)} />}
          {active === 'transactions' && <TransactionsScreen transactions={transactions} setTransactions={setTransactions} categories={categories} incomeSources={incomeSources} />}
          {active === 'networth' && <NetWorthScreen assets={syncedAssets} liabilities={liabilities} />}
          {active === 'more' && <MoreScreen navigate={nav} linkedCount={linkedAccounts.length} />}
          {active === 'legacy' && <LegacyScreen startingNetWorth={netWorth} back={() => nav('more')} />}
          {active === 'coaching' && <CoachingScreen back={() => nav('more')} />}
          {active === 'membership' && <MembershipScreen back={() => nav('more')} />}
          {active === 'settings' && <SettingsScreen experience={experience} setExperience={setExperience} appearance={appearance} setAppearance={setAppearance} alerts={alerts} setAlerts={setAlerts} onLogout={async () => { await auth.logout(); setActive('home'); setStage('welcome'); }} back={() => nav('more')} linkedAccounts={linkedAccounts} addLinked={(a: any[]) => setLinkedAccounts([...linkedAccounts, ...a])} />}
          <BottomNav active={active} setActive={(id: string) => { setActive(id); }} isDark={isDark} />
        </View>
      )}
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
  welcome: { flex: 1, backgroundColor: '#0b0b0a', alignItems: 'center', justifyContent: 'flex-start' },
  welcomeContent: { alignItems: 'center', marginTop: '30%' },
  brandMark: { height: 30, width: 40, position: 'relative', marginBottom: 8 },
  welcomeH1: { color: '#f3d18f', fontSize: 62, fontFamily: F.serif, fontWeight: '500', letterSpacing: -1, paddingHorizontal: 20, marginBottom: 20 },
  welcomeSubtitle: { color: '#c5c0b9', fontSize: 12, letterSpacing: 2.2, textAlign: 'center', lineHeight: 22 },
  goldWavesWrap: { position: 'absolute', left: 0, right: 0, top: '52%', height: 200, overflow: 'hidden' },
  goldWave: { position: 'absolute', left: -100, right: -100, height: 90, borderTopWidth: 1, borderRadius: 999 },
  welcomeActions: { position: 'absolute', left: 40, right: 40, bottom: 60 },
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
