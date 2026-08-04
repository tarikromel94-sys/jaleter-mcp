/**
 * Customer Support Sheet — Phase 1.
 *
 * Modes:
 *   'hub'    — Help & Support landing (New Request, My Requests, FAQ preview)
 *   'new'    — Contact Support form (subject/category/priority/description/attachments)
 *   'list'   — My Support Requests dashboard
 *   'detail' — Ticket detail with conversation + reply composer
 *
 * All attachments are stored as base64 on the server (5 MB cap enforced
 * server-side).  Admin dashboard is accessible only when the signed-in user
 * has `is_admin: true` (see AuthContext / /api/auth/me).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Modal, ActivityIndicator, Platform, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { apiCall, useAuth } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';

type Attachment = {
  filename: string;
  mime_type: string;
  data_base64: string;
  size_bytes?: number;
};

type Ticket = {
  ticket_id: string;
  ticket_number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  description?: string;
  attachments?: any[];
  replies?: any[];
  reply_count: number;
  attachment_count: number;
  user_email?: string;
  user_name?: string;
};

const CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Anything else' },
  { id: 'bug', label: 'Bug', hint: "Something isn't working" },
  { id: 'billing', label: 'Billing', hint: 'Payments, plans, invoices' },
  { id: 'bank_help', label: 'Bank Help', hint: 'Linking / import / sync' },
  { id: 'privacy', label: 'Privacy', hint: 'Data / access requests' },
  { id: 'delete_account', label: 'Delete account', hint: 'Close your account' },
];

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_COLORS: Record<string, string> = {
  open: '#c48a2b',
  in_progress: '#3d6ea0',
  waiting_on_user: '#8a7f70',
  resolved: '#4c8b56',
  closed: '#666',
};

const FAQS: { q: string; a: string }[] = [
  { q: 'How do I link a bank account?', a: 'Settings → Linked Accounts → tap "Connect a bank (Plaid)" for real-time sync, or "Import statement" to upload a CSV/OFX.' },
  { q: 'Where is billing managed?', a: 'All payments and subscriptions are handled at jaleter.com to keep prices honest and avoid App Store fees.' },
  { q: 'How do I export my budget?', a: 'Budget screen → tap Export → choose Excel (.xlsx). You get a 4-tab workbook: Summary, Monthly, Annual Grid, and Transactions.' },
  { q: 'Is my bank data safe?', a: 'Yes. Access tokens are Fernet-encrypted at rest and never returned to the app. Only short-lived link tokens ever reach the frontend.' },
  { q: 'How do I delete my account?', a: 'Open a support ticket with category "Delete account". Our team confirms your identity, then wipes your data within 30 days.' },
];

async function pickAttachment(): Promise<Attachment | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['image/png', 'image/jpeg', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const file = res.assets?.[0];
  if (!file?.uri) return null;
  // 5 MB pre-check based on size property (when available)
  if (file.size && file.size > 5 * 1024 * 1024) {
    Alert.alert('File too large', 'Attachments must be 5 MB or smaller.');
    return null;
  }
  let base64 = '';
  if (Platform.OS === 'web') {
    // On web, expo-document-picker returns a blob URL. Fetch → arrayBuffer → base64.
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

function StatusChip({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#666';
  return (
    <View style={[styles.chip, { borderColor: color, backgroundColor: color + '18' }]}>
      <Text style={[styles.chipText, { color }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

function PriorityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

/* ---------- Modes ---------- */

function HubMode({ tickets, loading, goNew, goList, goAdmin, isAdmin }: { tickets: Ticket[]; loading: boolean; goNew: () => void; goList: () => void; goAdmin: () => void; isAdmin: boolean }) {
  const open = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.hero}>
        <Ionicons name="help-buoy-outline" size={22} color={C.goldEyebrow} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSub}>Contact support, browse FAQs, or check on a request.</Text>
        </View>
      </View>

      <Pressable testID="support-new" onPress={goNew} style={styles.action}>
        <View style={styles.actionIcon}><Ionicons name="create-outline" size={20} color={C.goldEyebrow} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Contact Support</Text>
          <Text style={styles.actionSub}>Open a new request — attach screenshots if needed.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
      </Pressable>

      <Pressable testID="support-list" onPress={goList} style={styles.action}>
        <View style={styles.actionIcon}><Ionicons name="mail-open-outline" size={20} color={C.goldEyebrow} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>My Support Requests</Text>
          <Text style={styles.actionSub}>{loading ? 'Loading…' : `${tickets.length} total · ${open} open`}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
      </Pressable>

      {isAdmin ? (
        <Pressable testID="support-admin" onPress={goAdmin} style={[styles.action, { borderColor: '#b28a4c' }]}>
          <View style={[styles.actionIcon, { backgroundColor: '#f7edd5' }]}><Ionicons name="shield-checkmark-outline" size={20} color="#b28a4c" /></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.actionTitle, { color: '#b28a4c' }]}>Admin Dashboard</Text>
            <Text style={styles.actionSub}>Review every ticket and reply.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#b28a4c" />
        </Pressable>
      ) : null}

      <Text style={styles.sectionLabel}>QUICK ANSWERS</Text>
      {FAQS.map((f) => (
        <View key={f.q} style={styles.faq}>
          <Text style={styles.faqQ}>{f.q}</Text>
          <Text style={styles.faqA}>{f.a}</Text>
        </View>
      ))}
    </View>
  );
}

function NewMode({ token, onCreated, back }: { token: string | null; onCreated: (t: Ticket) => void; back: () => void }) {
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

function ListMode({ tickets, loading, refresh, onOpen, back }: { tickets: Ticket[]; loading: boolean; refresh: () => void; onOpen: (t: Ticket) => void; back: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={back} style={{ alignSelf: 'flex-start' }} testID="support-back">
        <Text style={styles.backLink}>← Back</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={styles.heroTitle}>My Requests</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={refresh} testID="support-refresh"><Ionicons name="refresh-outline" size={18} color={C.goldEyebrow} /></Pressable>
      </View>
      {loading ? <ActivityIndicator size="small" color={C.goldEyebrow} /> : null}
      {!loading && tickets.length === 0 ? (
        <Text style={styles.empty}>No requests yet. Tap &quot;Contact Support&quot; to open one.</Text>
      ) : null}
      {tickets.map((t) => (
        <Pressable key={t.ticket_id} onPress={() => onOpen(t)} style={styles.ticketRow} testID={`support-ticket-${t.ticket_id}`}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.ticketNumber}>#{t.ticket_number}</Text>
              <StatusChip status={t.status} />
            </View>
            <Text numberOfLines={1} style={styles.ticketSubject}>{t.subject}</Text>
            <Text style={styles.ticketMeta}>{t.category} · {t.priority} · {new Date(t.created_at).toLocaleDateString()}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
        </Pressable>
      ))}
    </View>
  );
}

function DetailMode({ token, ticketId, isAdmin, back, refreshAll }: { token: string | null; ticketId: string; isAdmin: boolean; back: () => void; refreshAll: () => void }) {
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
        {isAdmin ? (
          <Text style={styles.ticketMeta}>From: {ticket.user_name || ticket.user_email}</Text>
        ) : null}
      </View>

      {/* Description bubble */}
      <View style={styles.bubbleUser}>
        <Text style={styles.bubbleAuthor}>{ticket.user_name || 'You'}</Text>
        <Text style={styles.bubbleBody}>{ticket.description}</Text>
        {(ticket.attachments || []).map((a: any) => (
          <AttachmentPreview key={a.attachment_id} a={a} />
        ))}
      </View>

      {/* Replies */}
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

      {/* Admin controls */}
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

      {/* Reply composer */}
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

function AttachmentPreview({ a }: { a: any }) {
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

function AdminMode({ token, onOpen, refreshAll, back }: { token: string | null; onOpen: (t: Ticket) => void; refreshAll: () => void; back: () => void }) {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter ? `?status_filter=${filter}` : '';
      const data = await apiCall(`/api/support/admin/tickets${q}`, { method: 'GET' }, token);
      setRows(data?.tickets || []);
    } catch {
      setRows([]);
    } finally { setLoading(false); }
  }, [token, filter]);

  useEffect(() => { load(); refreshAll(); }, [load, refreshAll]);

  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={back} style={{ alignSelf: 'flex-start' }} testID="support-back">
        <Text style={styles.backLink}>← Back</Text>
      </Pressable>
      <Text style={styles.heroTitle}>Admin — All tickets</Text>
      <View style={styles.chipRow}>
        {['', 'open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].map((s) => (
          <Pressable key={s || 'all'} onPress={() => setFilter(s)} style={[styles.selectPill, filter === s && styles.selectPillActive]} testID={`admin-filter-${s || 'all'}`}>
            <Text style={[styles.selectPillText, filter === s && styles.selectPillTextActive]}>{s ? s.replace(/_/g, ' ') : 'all'}</Text>
          </Pressable>
        ))}
      </View>
      {loading ? <ActivityIndicator size="small" color={C.goldEyebrow} /> : null}
      {!loading && rows.length === 0 ? <Text style={styles.empty}>No tickets in this filter.</Text> : null}
      {rows.map((t) => (
        <Pressable key={t.ticket_id} onPress={() => onOpen(t)} style={styles.ticketRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.ticketNumber}>#{t.ticket_number}</Text>
              <StatusChip status={t.status} />
              <Text style={styles.ticketMeta}>{t.priority}</Text>
            </View>
            <Text numberOfLines={1} style={styles.ticketSubject}>{t.subject}</Text>
            <Text style={styles.ticketMeta}>{t.user_email} · {new Date(t.created_at).toLocaleDateString()}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- Root sheet ---------- */
export function SupportSheet({ visible, close }: { visible: boolean; close: () => void }) {
  const { token, user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [mode, setMode] = useState<'hub' | 'new' | 'list' | 'detail' | 'admin'>('hub');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiCall('/api/support/tickets', { method: 'GET' }, token);
      setTickets(data?.tickets || []);
    } catch { setTickets([]); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    if (visible) { setMode('hub'); refresh(); }
  }, [visible, refresh]);

  const openTicket = (t: Ticket) => { setActiveTicketId(t.ticket_id); setMode('detail'); };

  const title = useMemo(() => {
    if (mode === 'new') return 'Contact Support';
    if (mode === 'list') return 'My Support Requests';
    if (mode === 'detail') return 'Ticket';
    if (mode === 'admin') return 'Admin Dashboard';
    return 'Help & Support';
  }, [mode]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={styles.sheet}>
          <Pressable onPress={close} style={styles.closeBtn} testID="support-close">
            <Ionicons name="close" size={20} color={C.ink} />
          </Pressable>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 560 }}>
            {mode === 'hub' && (
              <HubMode
                tickets={tickets}
                loading={loading}
                goNew={() => setMode('new')}
                goList={() => setMode('list')}
                goAdmin={() => setMode('admin')}
                isAdmin={isAdmin}
              />
            )}
            {mode === 'new' && (
              <NewMode
                token={token}
                back={() => setMode('hub')}
                onCreated={(t) => {
                  setTickets((prev) => [t, ...prev]);
                  setActiveTicketId(t.ticket_id);
                  setMode('detail');
                }}
              />
            )}
            {mode === 'list' && (
              <ListMode
                tickets={tickets}
                loading={loading}
                refresh={refresh}
                onOpen={openTicket}
                back={() => setMode('hub')}
              />
            )}
            {mode === 'detail' && activeTicketId && (
              <DetailMode
                token={token}
                ticketId={activeTicketId}
                isAdmin={isAdmin}
                back={() => setMode(isAdmin ? 'admin' : 'list')}
                refreshAll={refresh}
              />
            )}
            {mode === 'admin' && isAdmin && (
              <AdminMode
                token={token}
                onOpen={openTicket}
                refreshAll={refresh}
                back={() => setMode('hub')}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32 },
  closeBtn: { position: 'absolute', top: 14, right: 14, padding: 6, zIndex: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 14, fontFamily: undefined },

  hero: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#e8dcc4' },
  heroTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  heroSub: { fontSize: 10, color: '#8a7f70', marginTop: 2 },

  action: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fff',
  },
  actionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f2e6c9', alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 12, fontWeight: '800', color: '#2a2620' },
  actionSub: { fontSize: 9, color: '#8a7f70', marginTop: 2 },

  sectionLabel: { fontSize: 9, fontWeight: '700', color: '#a97c39', letterSpacing: 1.2, marginTop: 8 },

  faq: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#f0e7d1' },
  faqQ: { fontSize: 11, fontWeight: '700', color: C.ink, marginBottom: 4 },
  faqA: { fontSize: 10, color: '#615b52', lineHeight: 15 },

  formLabel: { fontSize: 10, fontWeight: '700', color: '#615b52', letterSpacing: 0.5, marginTop: 2 },
  input: {
    borderWidth: 1, borderColor: '#e5decf', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 12, color: C.ink, backgroundColor: '#fff',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  selectPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fff' },
  selectPillActive: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  selectPillText: { fontSize: 10, fontWeight: '700', color: '#615b52', textTransform: 'capitalize' },
  selectPillTextActive: { color: '#fff' },

  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fbf6ec', alignSelf: 'flex-start' },
  attachBtnText: { fontSize: 10, color: '#8a7f70' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, padding: 6, borderRadius: 8, backgroundColor: '#f8f2e6' },

  primary: { backgroundColor: '#b28a4c', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  secondary: { backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#e8dcc4', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  secondaryText: { color: '#8a7f70', fontSize: 11, fontWeight: '700' },
  error: { fontSize: 10, color: '#b0453d' },
  empty: { fontSize: 11, color: '#8a7f70', textAlign: 'center', paddingVertical: 14 },
  backLink: { fontSize: 11, color: '#b28a4c', fontWeight: '700' },

  ticketRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fff',
  },
  ticketNumber: { fontSize: 10, fontWeight: '800', color: C.goldEyebrow },
  ticketSubject: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 4 },
  ticketMeta: { fontSize: 9, color: '#8a7f70', marginTop: 2 },
  detailSubject: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 4 },

  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  bubbleUser: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fbf6ec' },
  bubbleAdmin: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#c9dbe8', backgroundColor: '#eef4fa' },
  bubblePrivate: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e3caca', backgroundColor: '#f8ecec' },
  bubbleAuthor: { fontSize: 10, fontWeight: '800', color: '#615b52', marginBottom: 4 },
  bubbleBody: { fontSize: 11, color: C.ink, lineHeight: 16 },
  bubbleTime: { fontSize: 8, color: '#8a7f70', marginTop: 4 },

  adminBox: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#b28a4c', backgroundColor: '#f7edd5' },
});
