/**
 * Bug Report — structured form (summary / steps / expected / actual).
 * Auto-attaches device + app version to help repro.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, Platform } from 'react-native';
import Constants from 'expo-constants';
import { styles } from './styles';
import { Attachment, Ticket } from './types';
import { AttachmentPicker, submitStructuredTicket } from './shared';

export function BugReportMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const deviceInfo = useMemo(() => {
    const appVersion = Constants.expoConfig?.version || Constants.nativeAppVersion || '—';
    return `${Platform.OS} ${Platform.Version} · Jaleter ${appVersion}`;
  }, []);

  const submit = async () => {
    if (summary.trim().length < 4) { setError('Please add a short summary.'); return; }
    setError(''); setBusy(true);
    try {
      const t = await submitStructuredTicket(
        token,
        `[Bug] ${summary.trim()}`,
        'bug',
        'high',
        [
          { label: 'Summary', value: summary },
          { label: 'Steps to reproduce', value: steps },
          { label: 'Expected behavior', value: expected },
          { label: 'Actual behavior', value: actual },
          { label: 'Device / version', value: deviceInfo },
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
      <Text style={styles.formLabel}>Short summary</Text>
      <TextInput testID="bug-summary" value={summary} onChangeText={setSummary} placeholder="e.g. Budget totals not updating on iPad" style={styles.input} />
      <Text style={styles.formLabel}>Steps to reproduce</Text>
      <TextInput testID="bug-steps" value={steps} onChangeText={setSteps} multiline placeholder={'1. Go to Budget\n2. Tap …\n3. See error'} style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} />
      <Text style={styles.formLabel}>Expected behavior</Text>
      <TextInput testID="bug-expected" value={expected} onChangeText={setExpected} multiline placeholder="What should have happened?" style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} />
      <Text style={styles.formLabel}>Actual behavior</Text>
      <TextInput testID="bug-actual" value={actual} onChangeText={setActual} multiline placeholder="What actually happened?" style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} />
      <View style={styles.metaBox}>
        <Text style={styles.metaLabel}>Auto-attached</Text>
        <Text style={styles.metaValue}>{deviceInfo}</Text>
      </View>
      <AttachmentPicker attachments={attachments} setAttachments={setAttachments} error={error} />
      <Pressable testID="bug-submit" onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
        <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Submit bug report'}</Text>
      </Pressable>
    </View>
  );
}
