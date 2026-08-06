/**
 * Delete Account — permanent, irreversible deletion.
 *
 * For password-provider users we require re-entering the password before
 * calling the backend. Google/Apple users skip the password field because
 * their JWT is already proof of identity. In both cases the user must type
 * "DELETE" and see a warning of exactly what will be purged.
 *
 * Calls DELETE /api/auth/delete-account which cascades:
 *   - Plaid items (revoked upstream + local rows)
 *   - bank_transactions, linked_accounts, snaptrade_*, payments
 *   - support_tickets/requests, coaching_bookings
 *   - user_sessions, password_resets, email_verifications
 *   - user row itself
 * A goodbye email is sent from the backend as a best-effort courtesy.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/AuthContext';
import { styles } from './styles';

type Props = {
  back: () => void;
  onDeleted?: () => void;
};

export function DeleteAccountMode({ back, onDeleted }: Props) {
  const { user, deleteAccount } = useAuth();
  const isPassword = (user?.provider || 'password') === 'password';
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needed = 'DELETE';
  const confirmed = confirmText.trim() === needed;
  const canSubmit = confirmed && (!isPassword || password.length >= 6) && !busy;

  const submit = async () => {
    if (!confirmed) { setError(`Please type ${needed} to confirm.`); return; }
    if (isPassword && !password) { setError('Please enter your password to continue.'); return; }
    setError(''); setBusy(true);
    try {
      await deleteAccount(isPassword ? password : undefined);
      // Success: AuthContext already cleared the session. Notify parent so the
      // Support sheet dismisses; MainApp will drop back to the Welcome screen.
      try { onDeleted && onDeleted(); } catch {}
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 401 || msg.includes('incorrect password')) {
        setError('That password is incorrect. Please try again.');
      } else if (e?.status === 400 && msg.includes('password required')) {
        setError('Please enter your password to continue.');
      } else {
        setError(e?.message || 'Could not delete account. Try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={back} testID="support-back" style={{ alignSelf: 'flex-start' }}>
        <Text style={styles.backLink}>← Back</Text>
      </Pressable>

      <View style={[styles.hero, { backgroundColor: '#f8ecec', borderColor: '#e3caca' }]}>
        <Ionicons name="warning-outline" size={22} color="#b0453d" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: '#b0453d' }]}>Delete your account</Text>
          <Text style={styles.heroSub}>Permanent and irreversible. This runs immediately after you confirm.</Text>
        </View>
      </View>

      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#efe1c1', gap: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: '#8a6a2e' }}>What gets deleted</Text>
        <Text style={{ fontSize: 11, color: '#615b52', lineHeight: 16 }}>
          • Your profile ({user?.email || 'your account'}){'\n'}
          • Every linked bank connection (Plaid access revoked){'\n'}
          • All cached transactions, budgets, net-worth entries{'\n'}
          • Support tickets, coaching bookings, payment records{'\n'}
          • Active sessions on every device
        </Text>
      </View>

      {isPassword && (
        <>
          <Text style={styles.formLabel}>Enter your password</Text>
          <TextInput
            testID="delete-password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Your current password"
            placeholderTextColor="#b8ac9a"
            style={styles.input}
          />
        </>
      )}

      <Text style={styles.formLabel}>
        Type <Text style={{ fontWeight: '800' }}>{needed}</Text> to confirm
      </Text>
      <TextInput
        testID="delete-confirm"
        value={confirmText}
        onChangeText={setConfirmText}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="DELETE"
        placeholderTextColor="#b8ac9a"
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        testID="delete-submit"
        onPress={submit}
        disabled={!canSubmit}
        style={[styles.danger, !canSubmit && { opacity: 0.5 }]}
      >
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.dangerText}>Permanently delete my account</Text>}
      </Pressable>

      <Text style={{ fontSize: 10, color: '#928c83', textAlign: 'center', marginTop: 4 }}>
        We&apos;ll email you a confirmation. Deletion is final.
      </Text>
    </View>
  );
}
