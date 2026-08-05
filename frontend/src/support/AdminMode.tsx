/**
 * Admin dashboard — all tickets across all users with a status filter.
 * Gated at the router level (`is_admin === true`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/src/jaleterTheme';
import { apiCall } from '@/src/AuthContext';
import { styles } from './styles';
import { Ticket } from './types';
import { StatusChip } from './shared';

export function AdminMode({
  token, onOpen, refreshAll, back,
}: {
  token: string | null; onOpen: (t: Ticket) => void; refreshAll: () => void; back: () => void;
}) {
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
        <Pressable key={t.ticket_id} onPress={() => onOpen(t)} style={styles.ticketRow} testID={`support-ticket-${t.ticket_id}`}>
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
