/**
 * Slim banner that reminds signed-in users to verify their email.
 *
 * Shown ONLY when:
 *   - user is present, AND
 *   - user.provider === 'password' (OAuth accounts are verified by Google/Apple), AND
 *   - user.email_verified is falsy, AND
 *   - the user hasn't tapped "Not now" this session.
 *
 * Actions:
 *   - "Resend email"  → POST /api/auth/resend-verification. Shows a subtle
 *                       inline confirmation and (in dev preview) reveals the
 *                       token so QA can proceed without a live inbox.
 *   - "Enter token"   → expands an input; POST /api/auth/verify-email; on
 *                       success the banner disappears automatically.
 *   - "×"             → dismiss for this session (banner will return on relaunch).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/AuthContext';

export function EmailVerificationBanner({ isDark = false }: { isDark?: boolean }) {
  const { user, resendVerification, verifyEmail } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setStatus] = useState<'idle' | 'sent' | 'verified' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const shouldShow = useMemo(() => {
    if (!user) return false;
    if (dismissed) return false;
    if (user.email_verified) return false;
    // OAuth providers (google/apple) are trusted — no email verification needed.
    if (user.provider && user.provider !== 'password') return false;
    return true;
  }, [user, dismissed]);

  const resend = useCallback(async () => {
    setBusy(true); setStatus('idle'); setMsg(''); setDevToken(null);
    try {
      const r = await resendVerification();
      if (r?.already_verified) {
        setStatus('verified'); setMsg('Your email is already verified.');
      } else if (r?.dev_verification_token) {
        // Preview/dev mode — surface the token so QA can complete the flow.
        setStatus('sent'); setMsg('Preview mode — use token below to verify:');
        setDevToken(r.dev_verification_token);
      } else {
        setStatus('sent'); setMsg('Verification email sent. Check your inbox.');
      }
    } catch (e: any) {
      setStatus('error'); setMsg(e?.message || 'Could not send email.');
    } finally { setBusy(false); }
  }, [resendVerification]);

  const submitToken = useCallback(async () => {
    const t = (tokenInput || devToken || '').trim();
    if (!t) { setStatus('error'); setMsg('Paste your verification token first.'); return; }
    setBusy(true); setStatus('idle'); setMsg('');
    try {
      await verifyEmail(t);
      setStatus('verified'); setMsg('Email verified!');
    } catch (e: any) {
      setStatus('error'); setMsg(e?.message || 'Invalid or expired token.');
    } finally { setBusy(false); }
  }, [tokenInput, devToken, verifyEmail]);

  if (!shouldShow) return null;

  const bg = isDark ? '#3a2f1c' : '#fef3d9';
  const border = isDark ? '#5c4b30' : '#eddba1';
  const text = isDark ? '#f4e7c9' : '#7d5c17';
  const accent = '#c49450';

  return (
    <View style={[styles.wrap, { backgroundColor: bg, borderColor: border }]} testID="email-verify-banner">
      <View style={styles.row}>
        <Ionicons name="mail-outline" size={18} color={accent} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: text }]}>Verify your email</Text>
          <Text style={[styles.sub, { color: text, opacity: 0.85 }]} numberOfLines={2}>
            {msg || `We sent a verification link to ${user?.email || 'your inbox'}. Verify to secure your account and enable password recovery.`}
          </Text>
          {devToken ? (
            <Text selectable style={[styles.token, { color: text }]}>{devToken}</Text>
          ) : null}
          {expanded ? (
            <View style={styles.expandRow}>
              <TextInput
                testID="verify-token-input"
                value={tokenInput}
                onChangeText={setTokenInput}
                placeholder="Paste verification token"
                placeholderTextColor={isDark ? '#a0906a' : '#b8a468'}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: text, borderColor: border, backgroundColor: isDark ? '#2d2413' : '#fffbf0' }]}
              />
              <Pressable onPress={submitToken} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]} testID="verify-token-submit">
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.ctaText}>Verify</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <Pressable onPress={resend} disabled={busy} style={[styles.ghost, busy && { opacity: 0.5 }]} testID="verify-resend">
                {busy ? <ActivityIndicator size="small" color={accent} /> : <Text style={[styles.ghostText, { color: accent }]}>Resend email</Text>}
              </Pressable>
              <Pressable onPress={() => setExpanded(true)} style={styles.ghost} testID="verify-enter-token">
                <Text style={[styles.ghostText, { color: accent }]}>Enter token</Text>
              </Pressable>
            </View>
          )}
        </View>
        <Pressable onPress={() => setDismissed(true)} style={styles.close} testID="verify-dismiss" hitSlop={10}>
          <Ionicons name="close" size={16} color={text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    borderRadius: 14, borderWidth: 1, padding: 12,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 13, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  token: {
    fontFamily: undefined,
    fontSize: 11,
    marginTop: 6, padding: 8, borderRadius: 8,
    backgroundColor: '#fffbf0',
    borderWidth: 1, borderColor: '#eddba1',
  },
  btnRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  ghost: {
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 10, backgroundColor: 'transparent',
  },
  ghostText: { fontSize: 12, fontWeight: '700' },
  expandRow: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12,
  },
  cta: { backgroundColor: '#c49450', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  ctaText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  close: { padding: 4 },
});
