/**
 * "My Support Requests" dashboard — lists the current user's tickets.
 */
import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { styles } from './styles';
import { Ticket } from './types';
import { StatusChip } from './shared';

export function ListMode({
  tickets, loading, refresh, onOpen, back,
}: {
  tickets: Ticket[]; loading: boolean; refresh: () => void; onOpen: (t: Ticket) => void; back: () => void;
}) {
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
