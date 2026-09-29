/**
 * /membership — web-facing account page for jaleter.com.
 *
 * Jaleter Premium is billed ONLY through Apple In-App Purchase (iPhone) and
 * Google Play Billing (Android) — there is no web checkout. Flow:
 *   (1) create an account or log in →
 *   (2) not yet subscribed → "Download the app and subscribe" (store links) /
 *       already subscribed → "You're all set" (same server-side verdict the
 *       app uses: GET /api/user/membership).
 *
 * Native builds never use this route — any native deep link here redirects
 * to the app root.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import Ionicons from '@react-native-vector-icons/ionicons';
import { AuthProvider, useAuth, apiCall } from '@/src/AuthContext';
import { Signup, Login, ForgotPassword, ResetPassword } from '@/src/screens/AuthScreens';
import { openJaleter } from '@/src/jaleterLinks';
import { openStoreListing } from '@/src/storeLinks';
import { F } from '@/src/jaleterTheme';

export default function MembershipRoute() {
  if (Platform.OS !== 'web') return <Redirect href="/" />;
  return (
    <AuthProvider>
      <MembershipFlow />
    </AuthProvider>
  );
}

function MembershipFlow() {
  const auth = useAuth();
  const [mode, setMode] = useState<'signup' | 'login' | 'forgot' | 'reset'>('signup');
  const [resetInfo, setResetInfo] = useState<{ email: string; token: string | null }>({ email: '', token: null });
  // null = membership not checked yet; true/false = server verdict.
  const [member, setMember] = useState<boolean | null>(null);

  const checkMembership = useCallback(async (reconcile = false): Promise<{ active: boolean; processing: boolean }> => {
    if (!auth.token) return { active: false, processing: false };
    const data = await apiCall(`/api/user/membership${reconcile ? '?refresh=1' : ''}`, { method: 'GET' }, auth.token);
    return { active: !!data?.active, processing: !!data?.processing };
  }, [auth.token]);

  // On sign-in / signup / session restore: ask the server whether this
  // account already has an active Premium subscription (Apple / Google).
  useEffect(() => {
    if (!auth.user) { setMember(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const m = await checkMembership(true);
        if (!cancelled) setMember(m.active);
      } catch { if (!cancelled) setMember(false); }
    })();
    return () => { cancelled = true; };
  }, [auth.user?.user_id, auth.token, checkMembership]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth.loading) return <View style={m.splash} testID="membership-loading" />;

  // ---- Signed out: create account / log in --------------------------------
  if (!auth.user) {
    if (mode === 'signup') return <Signup back={() => openJaleter('home')} onCreated={() => {}} goLogin={() => setMode('login')} />;
    if (mode === 'login') return <Login back={() => setMode('signup')} goSignup={() => setMode('signup')} goForgot={() => setMode('forgot')} />;
    if (mode === 'forgot') return <ForgotPassword back={() => setMode('login')} onSent={(email: string, token: string | null) => { setResetInfo({ email, token }); setMode('reset'); }} />;
    return <ResetPassword back={() => setMode('login')} email={resetInfo.email} prefilledToken={resetInfo.token} onDone={() => { setResetInfo({ email: '', token: null }); setMode('login'); }} />;
  }

  // ---- Signed in: waiting on the server verdict ----------------------------
  if (member === null) {
    return (
      <View style={[m.splash, { alignItems: 'center', justifyContent: 'center' }]} testID="membership-checking">
        <ActivityIndicator color="#d4af61" />
      </View>
    );
  }

  // ---- Signed in, no membership: download the app + subscribe in-store ----
  if (!member) {
    return (
      <ScrollView style={m.splash} contentContainerStyle={m.successWrap} testID="membership-subscribe-in-app">
        <Text style={m.wordmark}>Jaleter</Text>
        <Text style={m.h1}>Your account is ready</Text>
        <Text style={m.sub}>
          Signed in as <Text style={{ color: '#e5c37a', fontWeight: '700' }}>{auth.user.email}</Text>.
          Jaleter Premium ($89.99/year) is purchased inside the app through the App Store or Google Play.
        </Text>

        <View style={m.stepsCard}>
          {[
            ['phone-portrait-outline', 'Download the Jaleter app', 'Available for iPhone on the App Store and Android on Google Play.'],
            ['log-in-outline', 'Sign in with this same email', 'Your account, budgets and settings follow you onto your phone.'],
            ['diamond-outline', 'Tap Subscribe Now', 'Subscribe securely with Apple or Google — Premium and bank syncing unlock instantly.'],
          ].map(([icon, title, desc], i) => (
            <View key={title as string} style={[m.stepRow, i > 0 && { marginTop: 18 }]}>
              <View style={m.stepIcon}><Ionicons name={icon as any} size={18} color="#d4af61" /></View>
              <View style={{ flex: 1 }}>
                <Text style={m.stepTitle}>{title}</Text>
                <Text style={m.stepDesc}>{desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable onPress={() => openStoreListing('ios')} style={m.cta} testID="membership-store-ios">
          <Text style={m.ctaText}>Get Jaleter for iPhone</Text>
        </Pressable>
        <Pressable onPress={() => openStoreListing('android')} style={m.secondaryCta} testID="membership-store-android">
          <Text style={m.linkText}>Get Jaleter for Android</Text>
        </Pressable>

        <Pressable onPress={async () => { try { const r = await checkMembership(true); setMember(r.active); } catch {} }} hitSlop={8} style={{ marginTop: 18 }} testID="membership-refresh">
          <Text style={{ color: '#8f8672', fontSize: 11, fontWeight: '700' }}>Already subscribed in the app? Refresh</Text>
        </Pressable>

        <View style={m.linksRow}>
          <Pressable onPress={() => openJaleter('terms')} hitSlop={8}><Text style={m.linkText}>Terms</Text></Pressable>
          <Text style={m.linkDivider}>|</Text>
          <Pressable onPress={() => openJaleter('privacy')} hitSlop={8}><Text style={m.linkText}>Privacy</Text></Pressable>
          <Text style={m.linkDivider}>|</Text>
          <Pressable onPress={async () => { await auth.logout(); setMode('login'); }} hitSlop={8} testID="membership-signout">
            <Text style={m.linkText}>Sign Out</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', marginTop: 30 }}>
          <View style={m.goldRule} />
          <Text style={{ color: '#d4af61', fontSize: 14, marginTop: 10 }}>✦</Text>
        </View>
      </ScrollView>
    );
  }

  // ---- Active member: success + next steps ---------------------------------
  return (
    <ScrollView style={m.splash} contentContainerStyle={m.successWrap} testID="membership-success">
      <Text style={m.wordmark}>Jaleter</Text>
      <View style={m.checkCircle}><Ionicons name="checkmark" size={34} color="#171204" /></View>
      <Text style={m.h1}>You&apos;re all set</Text>
      <Text style={m.sub}>
        Your Jaleter Premium membership is active for{' '}
        <Text style={{ color: '#e5c37a', fontWeight: '700' }}>{auth.user.email}</Text>.
      </Text>

      <View style={m.stepsCard}>
        {[
          ['phone-portrait-outline', 'Download the Jaleter app', 'Get Jaleter on the App Store or Google Play.'],
          ['log-in-outline', 'Sign in with this same email', 'Your Premium subscription is recognized automatically on every device.'],
          ['sparkles-outline', 'Everything unlocks instantly', 'Budgets, insights, goal tracking, premium tools and priority support.'],
        ].map(([icon, title, desc], i) => (
          <View key={title as string} style={[m.stepRow, i > 0 && { marginTop: 18 }]}>
            <View style={m.stepIcon}><Ionicons name={icon as any} size={18} color="#d4af61" /></View>
            <View style={{ flex: 1 }}>
              <Text style={m.stepTitle}>{title}</Text>
              <Text style={m.stepDesc}>{desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <Pressable onPress={() => { if (typeof window !== 'undefined') (window as any).location.href = '/'; }} style={m.cta} testID="membership-open-app">
        <Text style={m.ctaText}>Open Jaleter on the Web</Text>
      </Pressable>

      <View style={m.linksRow}>
        <Pressable onPress={() => openJaleter('faq')} hitSlop={8}><Text style={m.linkText}>Manage in App Store / Google Play</Text></Pressable>
        <Text style={m.linkDivider}>|</Text>
        <Pressable onPress={() => openJaleter('support')} hitSlop={8}><Text style={m.linkText}>Support</Text></Pressable>
        <Text style={m.linkDivider}>|</Text>
        <Pressable onPress={async () => { await auth.logout(); setMode('login'); }} hitSlop={8} testID="membership-signout">
          <Text style={m.linkText}>Sign Out</Text>
        </Pressable>
      </View>

      <View style={{ alignItems: 'center', marginTop: 30 }}>
        <View style={m.goldRule} />
        <Text style={{ color: '#d4af61', fontSize: 14, marginTop: 10 }}>✦</Text>
      </View>
    </ScrollView>
  );
}

/* Dark luxury styles — matches the Paywall (intentionally dark in both themes). */
const m = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#0a0906' },
  successWrap: { paddingHorizontal: 24, paddingTop: 64, paddingBottom: 48, alignItems: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  wordmark: { color: '#e5c37a', fontSize: 44, fontFamily: F.serifBold },
  checkCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#d4af61', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  h1: { color: '#f4eee1', fontSize: 30, fontFamily: F.serifBold, textAlign: 'center', marginTop: 18 },
  sub: { color: '#a79d88', fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  stepsCard: { marginTop: 26, borderRadius: 18, borderWidth: 1, borderColor: '#33270f', backgroundColor: '#14100a', padding: 20, width: '100%' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1d1709', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#33270f' },
  stepTitle: { color: '#f4eee1', fontSize: 14, fontWeight: '700' },
  stepDesc: { color: '#8f8672', fontSize: 11, marginTop: 2, lineHeight: 15 },
  cta: { marginTop: 24, backgroundColor: '#d4af61', borderRadius: 14, paddingVertical: 15, alignItems: 'center', minHeight: 48, justifyContent: 'center', width: '100%' },
  ctaText: { color: '#171204', fontSize: 15, fontWeight: '800' },
  secondaryCta: { marginTop: 12, borderWidth: 1, borderColor: '#33270f', borderRadius: 14, paddingVertical: 12, alignItems: 'center', width: '100%' },
  linksRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  linkText: { color: '#d4af61', fontSize: 12, fontWeight: '700' },
  linkDivider: { color: '#4d4633', fontSize: 12 },
  goldRule: { width: 120, height: 2, borderRadius: 1, backgroundColor: '#d4af61', opacity: 0.7 },
});
