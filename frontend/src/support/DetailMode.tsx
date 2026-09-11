/**
 * Ticket detail — conversation bubbles + reply composer.
 * When rendered for an admin user, also shows status/private-note controls.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { apiCall } from '@/src/AuthContext';
import { styles } from './styles';
import { Attachment, Ticket } from './types';
import { AttachmentPreview, StatusChip, pickAttachment } from './shared';

export function DetailMode({
  token, ticketId, isAdmin, back, refreshAll,
}: {
  token: string | null; ticketId: string; isAdmin: boolean; back: () => void; refreshAll: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [privateNote, setPrivateNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const path = isAdmin ? `/api/support/admin/tickets/${ticketId}` : `/api/support/tickets/${ticketId}`;
      const t = await apiCall(path, { method: 'GET' }, token);
      setTicket(t);
    } catch (e: any) {
      setError(e?.message || 'Failed to load ticket.');
    } finally {
      setLoading(false);
    }
  }, [token, ticketId, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const attach = async () => {
    try {
      const a = await pickAttachment();
      if (a) setAttachments((prev) => [...prev, a]);
    } catch (e: any) { setError(e?.message || 'Attach failed'); }
  };

  const submitReply = async () => {
    if (reply.trim().length < 1) { setError('Type a message first.'); return; }
    setError(''); setBusy(true);
    try {
      const path = isAdmin ? `/api/support/admin/tickets/${ticketId}/reply` : `/api/support/tickets/${ticketId}/reply`;
      await apiCall(path, { method: 'POST', body: JSON.stringify({ message: reply.trim(), attachments }) }, token);
      setReply(''); setAttachments([]);
      await load();
      refreshAll();
    } catch (e: any) { setError(e?.message || 'Could not send.'); }
    finally { setBusy(false); }
  };

  const submitAdminNote = async () => {
    if (privateNote.trim().length < 1) return;
    setBusy(true);
    try {
      await apiCall(`/api/support/admin/tickets/${ticketId}/note`, { method: 'POST', body: JSON.stringify({ note: privateNote.trim() }) }, token);
      setPrivateNote('');
      await load();
    } catch (e: any) { setError(e?.message || 'Note failed.'); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status: string) => {
    setBusy(true);
    try {
      await apiCall(`/api/support/admin/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status }) }, token);
      await load(); refreshAll();
    } catch (e: any) { setError(e?.message || 'Update failed.'); }
    finally { setBusy(false); }
  };

  if (loading || !ticket) return (
    <View style={{ paddingVertical: 24, alignItems: 'center' }}>
      <ActivityIndicator size="small" color={C.goldEyebrow} />
      {error ? <Text style={[styles.error, { marginTop: 8 }]}>{error}</Text> : null}
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={back} testID="support-back" style={{ alignSelf: 'flex-start' }}>
        <Text style={styles.backLink}>← Back to requests</Text>
      </Pressable>

      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Text style={styles.ticketNumber}>#{ticket.ticket_number}</Text>
          <StatusChip status={ticket.status} />
          <Text style={styles.ticketMeta}>{ticket.priority}</Text>
        </View>
        <Text style={styles.detailSubject}>{ticket.subject}</Text>
        <Text style={styles.ticketMeta}>{ticket.category} · {new Date(ticket.created_at).toLocaleString()}</Text>
        {isAdmin ? (<Text style={styles.ticketMeta}>From: {ticket.user_name || ticket.user_email}</Text>) : null}
      </View>

      <View style={styles.bubbleUser}>
        <Text style={styles.bubbleAuthor}>{ticket.user_name || 'You'}</Text>
        <Text style={styles.bubbleBody}>{ticket.description}</Text>
        {(ticket.attachments || []).map((a: any) => (<AttachmentPreview key={a.attachment_id} a={a} />))}
      </View>

      {(ticket.replies || []).map((r: any) => (
        <View key={r.reply_id} style={r.is_private ? styles.bubblePrivate : (r.is_admin ? styles.bubbleAdmin : styles.bubbleUser)}>
          <Text style={styles.bubbleAuthor}>
            {r.is_admin ? '🛡 ' : ''}{r.author_name || 'User'}
            {r.is_private ? ' · PRIVATE NOTE' : ''}
          </Text>
          <Text style={styles.bubbleBody}>{r.message}</Text>
          {(r.attachments || []).map((a: any) => <AttachmentPreview key={a.attachment_id} a={a} />)}
          <Text style={styles.bubbleTime}>{new Date(r.created_at).toLocaleString()}</Text>
        </View>
      ))}

      {isAdmin ? (
        <View style={styles.adminBox}>
          <Text style={styles.sectionLabel}>ADMIN CONTROLS</Text>
          <View style={styles.chipRow}>
            {['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].map((st) => (
              <Pressable key={st} onPress={() => changeStatus(st)} style={[styles.selectPill, ticket.status === st && styles.selectPillActive]} testID={`admin-status-${st}`}>
                <Text style={[styles.selectPillText, ticket.status === st && styles.selectPillTextActive]}>{st.replace(/_/g, ' ')}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            testID="admin-note"
            value={privateNote}
            onChangeText={setPrivateNote}
            multiline
            placeholder="Private admin note (never visible to the user)"
            style={[styles.input, { minHeight: 60, textAlignVertical: 'top', marginTop: 8 }]}
          />
          <Pressable testID="admin-note-submit" onPress={submitAdminNote} style={[styles.secondary, { marginTop: 6 }]}>
            <Text style={styles.secondaryText}>Save private note</Text>
          </Pressable>
        </View>
      ) : null}

      {ticket.status !== 'closed' ? (
        <View style={{ marginTop: 4 }}>
          <Text style={styles.formLabel}>{isAdmin ? 'Reply to user (public)' : 'Add a reply'}</Text>
          <TextInput
            testID="support-reply"
            value={reply}
            onChangeText={setReply}
            multiline
            placeholder="Type your message…"
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          />
          <Pressable onPress={attach} style={styles.attachBtn}>
            <Ionicons name="attach-outline" size={16} color={C.goldEyebrow} />
            <Text style={styles.attachBtnText}>Attach (5 MB max)</Text>
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
          <Pressable testID="support-reply-submit" onPress={submitReply} disabled={busy} style={[styles.primary, { marginTop: 8 }, busy && { opacity: 0.6 }]}>
            <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send reply'}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.empty}>This ticket is closed. Please open a new request if you need more help.</Text>
      )}
    </View>
  );
}
