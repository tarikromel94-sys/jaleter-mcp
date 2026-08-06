/**
 * Bug Report — structured form (summary / steps / expected / actual).
 * Auto-attaches best-effort device + app info so support can reproduce.
 *
 * Fix for issue #19: `Platform.Version` is undefined on web and the previous
 * template rendered as "web undefined · Jaleter —". We now collect every
 * available signal (browser UA on web, native OS version elsewhere, expo
 * config version + native build number) and only include the fields that
 * actually have a value.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, Platform } from 'react-native';
import Constants from 'expo-constants';
import { styles } from './styles';
import { Attachment, Ticket } from './types';
import { AttachmentPicker, submitStructuredTicket } from './shared';

function collectDeviceInfo(): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  // Platform + version. Platform.Version is undefined on web.
  const platform = Platform.OS ? Platform.OS.charAt(0).toUpperCase() + Platform.OS.slice(1) : '';
  const osVersion = Platform.Version !== undefined && Platform.Version !== null
    ? String(Platform.Version)
    : '';
  if (platform) {
    rows.push({ label: 'Platform', value: osVersion ? `${platform} ${osVersion}` : platform });
  }

  // Web browser — pull the user-agent for extra context.
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    try {
      const ua = navigator?.userAgent;
      if (ua && typeof ua === 'string') rows.push({ label: 'Browser', value: ua });
    } catch {
      /* SSR / restricted environments */
    }
  }

  // App version — prefer Expo config, fall back to native version, else omit.
  const appVersion =
    (Constants.expoConfig as any)?.version ||
    (Constants as any).nativeAppVersion ||
    '';
  if (appVersion) rows.push({ label: 'App version', value: String(appVersion) });

  // Native build number when Expo Application module surfaces it.
  const buildNumber =
    (Constants as any).nativeBuildVersion ||
    ((Constants.expoConfig as any)?.ios?.buildNumber) ||
    ((Constants.expoConfig as any)?.android?.versionCode) ||
    '';
  if (buildNumber) rows.push({ label: 'Build', value: String(buildNumber) });

  // Device model when available (from expo-constants).
  const deviceName = (Constants as any).deviceName || (Constants as any).platform?.ios?.model || '';
  if (deviceName) rows.push({ label: 'Device', value: String(deviceName) });

  return rows;
}

function formatDeviceInfo(rows: { label: string; value: string }[]): string {
  if (!rows.length) return '(device info unavailable)';
  return rows.map((r) => `${r.label}: ${r.value}`).join('\n');
}

export function BugReportMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const deviceRows = useMemo(collectDeviceInfo, []);
  const deviceInfo = useMemo(() => formatDeviceInfo(deviceRows), [deviceRows]);

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
        {deviceRows.length > 0 ? (
          deviceRows.map((r) => (
            <Text key={r.label} style={styles.metaValue} numberOfLines={2}>
              <Text style={{ fontWeight: '700' }}>{r.label}: </Text>{r.value}
            </Text>
          ))
        ) : (
          <Text style={styles.metaValue}>Device information not available.</Text>
        )}
      </View>
      <AttachmentPicker attachments={attachments} setAttachments={setAttachments} error={error} />
      <Pressable testID="bug-submit" onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
        <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Submit bug report'}</Text>
      </Pressable>
    </View>
  );
}
