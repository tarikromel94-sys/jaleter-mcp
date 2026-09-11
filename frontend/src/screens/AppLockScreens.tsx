import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, Modal, Platform, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import Ionicons from '@react-native-vector-icons/ionicons';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';
import { s, GoldButton, Sparkle } from '@/src/utils/appShared';

/* ---------------- App Lock (PIN + Biometrics) ---------------- */
const APP_LOCK_KEY = 'jaleter_app_lock_pin';
const APP_LOCK_BIO_KEY = 'jaleter_app_lock_bio';
export async function loadAppLock() {
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

export const AppLockGate = ({ storedPin, biometricsEnabled, biometricsAvailable, onUnlock, onForgotPin }: any) => {
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
      {onForgotPin ? (
        <Pressable onPress={onForgotPin} style={{ marginTop: 22, paddingVertical: 8, paddingHorizontal: 12 }} testID="pin-forgot">
          <Text style={{ color: '#e2b96f', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 }}>Forgot PIN?</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/* ---------------- Forgot PIN Modal (verify account password to reset PIN) ---------------- */
export const ForgotPinModal = ({ visible, close, onReset }: { visible: boolean; close: () => void; onReset: () => void }) => {
  const { user, login } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!visible) {
      // Reset local state whenever the modal closes so a re-open starts clean.
      setPassword('');
      setError('');
      setBusy(false);
      setDone(false);
    }
  }, [visible]);
  const onSubmit = async () => {
    if (!user?.email) { setError('Not signed in.'); return; }
    if (password.length < 1) { setError('Enter your password.'); return; }
    setBusy(true);
    setError('');
    try {
      // Verifies the account by re-authenticating; the returned token replaces
      // the current session token (safe — same user), and we then wipe the
      // device PIN so the caller can prompt for a new one.
      await login(user.email, password);
      await clearAppLock();
      setDone(true);
      // Give the user a beat to read the success state before we close.
      setTimeout(() => { onReset(); }, 700);
    } catch (e: any) {
      setError(e?.message || 'Verification failed. Check your password and try again.');
    } finally {
      setBusy(false);
    }
  };
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#1a1a1a', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: 'rgba(226,185,111,0.15)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Ionicons name="lock-open-outline" size={22} color="#e2b96f" />
            <Text style={{ color: '#e2b96f', fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginLeft: 8 }}>RESET APP PIN</Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 6 }}>Verify your account</Text>
          <Text style={{ color: '#c7c1b6', fontSize: 12, marginTop: 8, lineHeight: 18 }}>
            Enter the password for {user?.email || 'your account'} to reset your device PIN. Face ID / Touch ID will also be reset — you can re-enable both from Settings.
          </Text>
          <View style={{ marginTop: 18 }}>
            <Text style={{ color: '#c7c1b6', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 }}>PASSWORD</Text>
            <TextInput
              testID="forgot-pin-password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Your account password"
              placeholderTextColor="#7a7166"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy && !done}
              style={{ backgroundColor: '#0f0f0f', color: '#fff', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(226,185,111,0.2)', paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 15 }}
            />
          </View>
          {error ? <Text style={{ color: '#e08a7a', fontSize: 12, marginTop: 12, fontWeight: '600' }}>{error}</Text> : null}
          {done ? <Text style={{ color: '#9ecf9a', fontSize: 12, marginTop: 12, fontWeight: '700' }}>PIN reset. You can set up a new PIN in Settings → App Lock.</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <Pressable onPress={close} disabled={busy} style={{ paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12 }} testID="forgot-pin-cancel">
              <Text style={{ color: '#c7c1b6', fontSize: 13, fontWeight: '700' }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={busy || done || password.length < 1}
              style={{ paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, backgroundColor: (busy || done || password.length < 1) ? 'rgba(226,185,111,0.4)' : '#e2b96f' }}
              testID="forgot-pin-submit"
            >
              {busy ? <ActivityIndicator size="small" color="#000" /> : (
                <Text style={{ color: '#000', fontSize: 13, fontWeight: '800' }}>{done ? 'Done' : 'Verify & Reset PIN'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export const AppLockConfigure = ({ close, currentPin, biometricsAvailable, biometricsEnabled, onSaved }: any) => {
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
