/**
 * Cross-mode helpers + small pickers/badges used by multiple mode components.
 */
import React from 'react';
import { View, Text, Pressable, Alert, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { apiCall } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';
import { styles } from './styles';
import { Attachment, CATEGORIES, PRIORITIES, STATUS_COLORS, Ticket } from './types';

/** Prompt the OS document picker, convert the file to base64, enforce 5 MB. */
export async function pickAttachment(): Promise<Attachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['image/png', 'image/jpeg', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const file = res.assets?.[0];
  if (!file?.uri) return null;
  if (file.size && file.size > 5 * 1024 * 1024) {
    Alert.alert('File too large', 'Attachments must be 5 MB or smaller.');
    return null;
  }
  let base64 = '';
  if (Platform.OS === 'web') {
    // Web: expo-document-picker returns a blob URL — fetch → arrayBuffer → base64.
    const r = await fetch(file.uri);
    const buf = await r.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    base64 = (globalThis as unknown as { btoa: (s: string) => string }).btoa(binary);
  } else {
    const f = new File(file.uri);
    base64 = await f.base64();
  }
  return {
    filename: file.name || 'attachment',
    mime_type: file.mimeType || 'application/octet-stream',
    data_base64: base64,
    size_bytes: file.size,
  };
}

/**
 * Build a structured description from {label, value} parts, then create a ticket.
 * Skips empty values so the resulting ticket body reads cleanly.
 */
export async function submitStructuredTicket(
  token: string | null,
  subject: string,
  category: string,
  priority: string,
  parts: { label: string; value: string }[],
  attachments: Attachment[],
): Promise<Ticket> {
  const description = parts
    .filter((p) => p.value && p.value.trim().length > 0)
    .map((p) => `${p.label}:\n${p.value.trim()}`)
    .join('\n\n');
  return apiCall('/api/support/tickets', {
    method: 'POST',
    body: JSON.stringify({
      subject: subject.trim(),
      category, priority,
      description: description || subject.trim(),
      attachments,
    }),
  }, token);
}

export function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#666';
  return (
    <View style={[styles.chip, { borderColor: color, backgroundColor: color + '18' }]}>
      <Text style={[styles.chipText, { color }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

export function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {CATEGORIES.map((c) => (
        <Pressable key={c.id} onPress={() => onChange(c.id)} style={[styles.selectPill, value === c.id && styles.selectPillActive]} testID={`support-cat-${c.id}`}>
          <Text style={[styles.selectPillText, value === c.id && styles.selectPillTextActive]}>{c.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PriorityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipRow}>
      {PRIORITIES.map((p) => (
        <Pressable key={p} onPress={() => onChange(p)} style={[styles.selectPill, value === p && styles.selectPillActive]} testID={`support-pri-${p}`}>
          <Text style={[styles.selectPillText, value === p && styles.selectPillTextActive]}>{p}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function AttachmentPicker({
  attachments, setAttachments, error,
}: {
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  error?: string;
}) {
  const attach = async () => {
    try {
      const a = await pickAttachment();
      if (a) setAttachments((prev) => [...prev, a]);
    } catch (e: any) {
      Alert.alert('Attach failed', e?.message || 'Could not read the file.');
    }
  };
  return (
    <View>
      <Pressable onPress={attach} style={styles.attachBtn}>
        <Ionicons name="attach-outline" size={16} color={C.goldEyebrow} />
        <Text style={styles.attachBtnText}>Attach screenshot / PDF (5 MB max)</Text>
      </Pressable>
      {attachments.map((a, i) => (
        <View key={`${a.filename}-${i}`} style={styles.attachRow}>
          <Ionicons name={a.mime_type.startsWith('image/') ? 'image-outline' : 'document-outline'} size={14} color={C.goldEyebrow} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 10 }}>{a.filename}</Text>
          <Pressable onPress={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}>
            <Ionicons name="close-circle" size={14} color="#b0453d" />
          </Pressable>
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function AttachmentPreview({ a }: { a: any }) {
  const isImage = (a.mime_type || '').startsWith('image/');
  if (isImage && a.data_base64) {
    return (
      <Image
        source={{ uri: `data:${a.mime_type};base64,${a.data_base64}` }}
        style={{ width: '100%', height: 140, borderRadius: 8, marginTop: 8, backgroundColor: '#f4ecd8' }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, padding: 6, borderRadius: 8, backgroundColor: '#fbf6ec' }}>
      <Ionicons name="document-outline" size={14} color={C.goldEyebrow} />
      <Text numberOfLines={1} style={{ fontSize: 10, flex: 1 }}>{a.filename}</Text>
    </View>
  );
}
