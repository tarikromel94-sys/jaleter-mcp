/**
 * Delete Account request — red CTA, requires typing DELETE to confirm.
 * Never wipes the account directly — always creates a ticket that support
 * reviews within 30 days per our privacy policy.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/AuthContext';
import { styles } from './styles';
import { Ticket } from './types';
import { submitStructuredTicket } from './shared';

export function DeleteAccountMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needed = 'DELETE';
  const confirmed = confirmText.trim() === needed;

  const submit = async () => {
    if (!confirmed) { setError(`Please type ${needed} to confirm.`); return; }
    setError(''); setBusy(true);
    try {
      const t = await submitStructuredTicket(
        token,
        '[Delete Account] Close my Jaleter account',
        'delete_account',
        'urgent',
        [
          { label: 'Confirmation', value: `User typed ${needed} to confirm account closure request.` },
          { label: 'Reason (optional)', value: reason || '(none provided)' },
          { label: 'Account', value: `${user?.name || ''} · ${user?.email || ''}` },
          { label: 'Process', value: 'We will confirm your identity, then permanently delete your account data within 30 days per our privacy policy. You may cancel any time before then by replying to this ticket.' },
        ],
        [],
      );
      onCreated(t);
    } catch (e: any) { setError(e?.message || 'Could not send.'); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={back} testID="support-back" style={{ alignSelf: 'flex-start' }}><Text style={styles.backLink}>← Back</Text></Pressable>
      <View style={[styles.hero, { backgroundColor: '#f8ecec', borderColor: '#e3caca' }]}>
        <Ionicons name="warning-outline" size={22} color="#b0453d" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.heroTitle, { color: '#b0453d' }]}>Delete your account</Text>
          <Text style={styles.heroSub}>This starts a review process. Deletion completes within 30 days.</Text>
        </View>
      </View>
      <Text style={styles.formLabel}>Reason (optional)</Text>
      <TextInput value={reason} onChangeText={setReason} multiline placeholder="Help us improve by sharing why." style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} />
      <Text style={styles.formLabel}>Type <Text style={{ fontWeight: '800' }}>{needed}</Text> to confirm</Text>
      <TextInput testID="delete-confirm" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" placeholder="DELETE" style={styles.input} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable testID="delete-submit" onPress={submit} disabled={busy || !confirmed} style={[styles.danger, (busy || !confirmed) && { opacity: 0.6 }]}>
        <Text style={styles.dangerText}>{busy ? 'Sending…' : 'Request account deletion'}</Text>
      </Pressable>
    </View>
  );
}
