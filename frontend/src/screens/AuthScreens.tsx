import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Platform, Dimensions, StatusBar as RNStatusBar } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Ionicons from '@react-native-vector-icons/ionicons';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';
import { WELCOME_HTML } from '@/src/welcomeHtml';
import { openJaleter } from '@/src/jaleterLinks';
import { PoweredByJaleter } from '@/src/PoweredByJaleter';
import { s, CircleBtn, GoldButton } from '@/src/utils/appShared';

/* ---------------- Welcome (Get Started) ---------------- */
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const serifFont = Platform.select({ ios: 'PlayfairDisplay', android: 'PlayfairDisplay', default: 'PlayfairDisplay' });

/**
 * Background: pure #090908 field + a single, extremely faint warm glow
 * biased to the bottom-right. Never resembles a visible circle/panel;
 * gradient stops fade to full opacity by ~45% radius so >75% of the
 * background stays truly black.
 */
export const Welcome = ({ onStart, onLogin }: any) => {
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
export const Onboarding = ({ experience, setExperience, onContinue, back }: any) => {
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

/* ---------------- Apple Sign-In stub (temporarily disabled) ----------------
 * Sign in with Apple was TEMPORARILY removed from the iOS build because the
 * Apple Developer Portal App ID for `com.emergent.nochangesmobile.fl0fmc`
 * does not yet have the "Sign In with Apple" capability enabled. The EAS
 * provisioning profile therefore cannot include the
 * `com.apple.developer.applesignin` entitlement, and Xcode refuses to archive.
 *
 * Restore procedure (when the Portal capability is enabled + profile regenerated):
 *   1. `yarn expo install expo-apple-authentication`
 *   2. app.json: add `"usesAppleSignIn": true` under `ios`.
 *   3. Restore the real AppleSignInButton implementation (see git history).
 *   4. Restore `loginWithApple` in `AuthContext.tsx` (see git history).
 *
 * Email + Google (Emergent OAuth) remain the two supported sign-in methods.
 * ------------------------------------------------------------------------- */
/* ---------------- Apple Sign-In (native iOS only) ----------------
 * Restored June 2026 after the user enabled the "Sign In with Apple"
 * capability on App ID com.emergent.nochangesmobile.fl0fmc (active
 * provisioning profile already includes the entitlement, exp. 2027-08-25).
 * Requires app.json ios.usesAppleSignIn=true + expo-apple-authentication.
 * Renders nothing on web/Android/Expo Go-unsupported environments. */
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
export const Signup = ({ back, onCreated, goLogin }: any) => {
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
export const Login = ({ back, goSignup, goForgot }: any) => {
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
export const ForgotPassword = ({ back, onSent }: any) => {
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
export const ResetPassword = ({ back, email, prefilledToken, onDone }: any) => {
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
