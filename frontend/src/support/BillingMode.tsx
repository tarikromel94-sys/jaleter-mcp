/**
 * Billing help — 5-option issue picker + jaleter.com deep-link banner.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { styles } from './styles';
import { Attachment, Ticket, BILLING_ISSUE_TYPES } from './types';
import { AttachmentPicker, submitStructuredTicket } from './shared';

export function BillingMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const [issue, setIssue] = useState('other');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [details, setDetails] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      const issueLabel = BILLING_ISSUE_TYPES.find((b) => b.id === issue)?.label || 'Billing question';
      const t = await submitStructuredTicket(
        token,
        `[Billing] ${issueLabel}`,
        'billing', 'high',
        [
          { label: 'Issue type', value: issueLabel },
          { label: 'Amount (USD)', value: amount ? `$${amount}` : '(not provided)' },
          { label: 'Transaction / invoice #', value: ref || '(not provided)' },
          { label: 'Details', value: details || '(none provided)' },
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
        <Ionicons name="wallet-outline" size={22} color={C.goldEyebrow} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Billing help</Text>
          <Text style={styles.heroSub}>Payments and subscriptions are managed at jaleter.com.</Text>
        </View>
      </View>
      <Pressable onPress={() => openJaleter('billing')} style={styles.linkBanner} testID="billing-open-web">
        <Ionicons name="globe-outline" size={16} color={C.goldEyebrow} />
        <Text style={styles.linkBannerText}>Open jaleter.com/billing</Text>
        <Ionicons name="open-outline" size={14} color={C.goldEyebrow} />
      </Pressable>
      <Text style={styles.formLabel}>Issue type</Text>
      <View style={styles.chipRow}>
        {BILLING_ISSUE_TYPES.map((b) => (
          <Pressable key={b.id} onPress={() => setIssue(b.id)} style={[styles.selectPill, issue === b.id && styles.selectPillActive]} testID={`billing-issue-${b.id}`}>
            <Text style={[styles.selectPillText, issue === b.id && styles.selectPillTextActive]}>{b.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.formLabel}>Amount (USD)</Text>
      <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="e.g. 29.00" style={styles.input} />
      <Text style={styles.formLabel}>Transaction / invoice #</Text>
      <TextInput value={ref} onChangeText={setRef} placeholder="Optional, from your email receipt" style={styles.input} />
      <Text style={styles.formLabel}>Details</Text>
      <TextInput value={details} onChangeText={setDetails} multiline placeholder="Tell us what happened or what you need." style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} />
      <AttachmentPicker attachments={attachments} setAttachments={setAttachments} error={error} />
      <Pressable testID="billing-submit" onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
        <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Submit billing request'}</Text>
      </Pressable>
    </View>
  );
}
