/**
 * Privacy request — 4-option radio (export / correct / restrict / delete data).
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { styles } from './styles';
import { Attachment, Ticket, PRIVACY_ACTIONS } from './types';
import { AttachmentPicker, submitStructuredTicket } from './shared';

export function PrivacyMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const [action, setAction] = useState('export');
  const [details, setDetails] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const chosen = PRIVACY_ACTIONS.find((p) => p.id === action);
      const t = await submitStructuredTicket(
        token,
        `[Privacy] ${chosen?.label || 'Request'}`,
        'privacy', 'high',
        [
          { label: 'Requested action', value: `${chosen?.label} — ${chosen?.hint}` },
          { label: 'Additional context', value: details || '(none provided)' },
        ],
        attachments,
      );
      onCreated(t);
    } catch (e: any) { setError(e?.message || 'Could not send.'); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={back} testID="support-back" style={{ alignSelf: 'flex-start' }}><Text style={styles.backLink}>← Back</Text></Pressable>
      <View style={styles.hero}>
        <Ionicons name="shield-checkmark-outline" size={22} color={C.goldEyebrow} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Privacy request</Text>
          <Text style={styles.heroSub}>We respond within 30 days per our privacy policy.</Text>
        </View>
      </View>
      <Text style={styles.formLabel}>What would you like us to do?</Text>
      {PRIVACY_ACTIONS.map((p) => (
        <Pressable key={p.id} onPress={() => setAction(p.id)} style={[styles.radioRow, action === p.id && styles.radioRowActive]} testID={`privacy-${p.id}`}>
          <View style={[styles.radioDot, action === p.id && styles.radioDotActive]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.radioLabel}>{p.label}</Text>
            <Text style={styles.radioHint}>{p.hint}</Text>
          </View>
        </Pressable>
      ))}
      <Text style={styles.formLabel}>Additional context (optional)</Text>
      <TextInput value={details} onChangeText={setDetails} multiline placeholder="Anything else that would help us process your request." style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} />
      <AttachmentPicker attachments={attachments} setAttachments={setAttachments} error={error} />
      <Pressable testID="privacy-submit" onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
        <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Submit privacy request'}</Text>
      </Pressable>
    </View>
  );
}
