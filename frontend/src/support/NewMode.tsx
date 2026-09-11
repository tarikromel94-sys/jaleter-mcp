/**
 * Contact Support (general) form — free-form subject/category/priority/desc.
 * Powers the "Contact Support (general)" entry point and the BankHelp fallback.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { apiCall } from '@/src/AuthContext';
import { styles } from './styles';
import { Attachment, Ticket } from './types';
import { CategoryPicker, PriorityPicker, pickAttachment } from './shared';

export function NewMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const attach = async () => {
    try {
      const a = await pickAttachment();
      if (a) setAttachments((prev) => [...prev, a]);
    } catch (e: any) {
      setError(e?.message || 'Attach failed');
    }
  };

  const submit = async () => {
    if (subject.trim().length < 2) { setError('Please add a subject.'); return; }
    if (description.trim().length < 2) { setError('Please describe your issue.'); return; }
    setError(''); setBusy(true);
    try {
      const t: Ticket = await apiCall('/api/support/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(),
          category, priority,
          description: description.trim(),
          attachments,
        }),
      }, token);
      onCreated(t);
    } catch (e: any) {
      setError(e?.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={back} style={{ alignSelf: 'flex-start' }} testID="support-back">
        <Text style={styles.backLink}>← Back</Text>
      </Pressable>
      <Text style={styles.formLabel}>Subject</Text>
      <TextInput testID="support-subject" value={subject} onChangeText={setSubject} placeholder="e.g. Bank sync stopped working" style={styles.input} />
      <Text style={styles.formLabel}>Category</Text>
      <CategoryPicker value={category} onChange={setCategory} />
      <Text style={styles.formLabel}>Priority</Text>
      <PriorityPicker value={priority} onChange={setPriority} />
      <Text style={styles.formLabel}>Describe your issue</Text>
      <TextInput
        testID="support-description"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="Tell us what happened, what you expected, and any steps to reproduce."
        style={[styles.input, { minHeight: 110, textAlignVertical: 'top' }]}
      />
      <View>
        <Pressable testID="support-attach" onPress={attach} style={styles.attachBtn}>
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
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable testID="support-submit" onPress={submit} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
        <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send request'}</Text>
      </Pressable>
    </View>
  );
}
