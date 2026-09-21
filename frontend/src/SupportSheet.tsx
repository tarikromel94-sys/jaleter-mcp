/**
 * SupportSheet — thin router that mounts the correct mode component.
 *
 * The Support UI is broken into focused files under `src/support/`:
 *   types.ts, styles.ts, shared.tsx  (shared foundation)
 *   HubMode.tsx     — landing + FAQ + grid
 *   NewMode.tsx     — general contact form
 *   ListMode.tsx    — my requests dashboard
 *   DetailMode.tsx  — ticket conversation + admin controls
 *   AdminMode.tsx   — cross-user admin list
 *   BugMode.tsx / PrivacyMode.tsx / DeleteMode.tsx / BillingMode.tsx /
 *   BankHelpMode.tsx  — Phase 2/3/4 specialized flows
 *
 * The sheet keeps only orchestration state here (current mode, active
 * ticket id, and the shared "my tickets" list used by hub + list).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { apiCall, useAuth } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';

import { SupportMode, Ticket } from '@/src/support/types';
import { HubMode } from '@/src/support/HubMode';
import { NewMode } from '@/src/support/NewMode';
import { ListMode } from '@/src/support/ListMode';
import { DetailMode } from '@/src/support/DetailMode';
import { AdminMode } from '@/src/support/AdminMode';
import { BugReportMode } from '@/src/support/BugMode';
import { PrivacyMode } from '@/src/support/PrivacyMode';
import { BillingMode } from '@/src/support/BillingMode';
import { BankHelpMode } from '@/src/support/BankHelpMode';

export function SupportSheet({ visible, close }: { visible: boolean; close: () => void }) {
  const { token, user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [mode, setMode] = useState<SupportMode>('hub');
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
  const onTicketCreated = (t: Ticket) => {
    setTickets((prev) => [t, ...prev]);
    setActiveTicketId(t.ticket_id);
    setMode('detail');
  };

  const title = useMemo(() => {
    switch (mode) {
      case 'new': return 'Contact Support';
      case 'list': return 'My Support Requests';
      case 'detail': return 'Ticket';
      case 'admin': return 'Admin Dashboard';
      case 'bug': return 'Report a Bug';
      case 'privacy': return 'Privacy Request';
      case 'billing': return 'Billing Help';
      case 'bank_help': return 'Bank Help Center';
      default: return 'Help & Support';
    }
  }, [mode]);

  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={sheetStyles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={sheetStyles.sheet}>
          <Pressable onPress={close} style={sheetStyles.closeBtn} testID="support-close">
            <Ionicons name="close" size={20} color={C.ink} />
          </Pressable>
          <Text style={sheetStyles.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 560 }}>
            {mode === 'hub' && (
              <HubMode
                tickets={tickets}
                loading={loading}
                goNew={() => setMode('new')}
                goList={() => setMode('list')}
                goAdmin={() => setMode('admin')}
                goHelp={(id) => setMode(id as SupportMode)}
                isAdmin={isAdmin}
              />
            )}
            {mode === 'new' && (
              <NewMode token={token} back={() => setMode('hub')} onCreated={onTicketCreated} />
            )}
            {mode === 'bug' && (
              <BugReportMode token={token} back={() => setMode('hub')} onCreated={onTicketCreated} />
            )}
            {mode === 'privacy' && (
              <PrivacyMode token={token} back={() => setMode('hub')} onCreated={onTicketCreated} />
            )}
            {mode === 'billing' && (
              <BillingMode token={token} back={() => setMode('hub')} onCreated={onTicketCreated} />
            )}
            {mode === 'bank_help' && (
              <BankHelpMode back={() => setMode('hub')} onOpenTicket={() => setMode('new')} />
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
              <AdminMode token={token} onOpen={openTicket} refreshAll={refresh} back={() => setMode('hub')} />
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// The sheet container has its own tiny styles here; every child styles come
// from the shared `src/support/styles.ts` so all modes share the same visual
// language.
const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#00000060',
    justifyContent: 'flex-end',
    // Web: pin to the real viewport (document-anchored overlay artifact).
    ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null),
  },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32 },
  closeBtn: { position: 'absolute', top: 14, right: 14, padding: 6, zIndex: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 14 },
});
