/**
 * Help hub — landing view for the Support Sheet.
 * Shows the specialized-help grid, the general contact / my-requests entry
 * points, an FAQ preview, and a "visit our full help center" link.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { PoweredByJaleter } from '@/src/PoweredByJaleter';
import { styles } from './styles';
import { Ticket, FAQS, HELP_ACTIONS } from './types';

type Props = {
  tickets: Ticket[];
  loading: boolean;
  goNew: () => void;
  goList: () => void;
  goAdmin: () => void;
  goHelp: (id: string) => void;
  isAdmin: boolean;
};

export function HubMode({ tickets, loading, goNew, goList, goAdmin, goHelp, isAdmin }: Props) {
  const open = tickets.filter((t) => !['resolved', 'closed'].includes(t.status)).length;
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.hero}>
        <Ionicons name="help-buoy-outline" size={22} color={C.goldEyebrow} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSub}>Pick a topic below, or open a general ticket.</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>GET HELP</Text>
      <View style={styles.grid}>
        {HELP_ACTIONS.map((a) => (
          <Pressable key={a.id} onPress={() => goHelp(a.id)} style={styles.gridBtn} testID={`support-help-${a.id}`}>
            <View style={styles.gridIcon}><Ionicons name={a.icon} size={20} color={C.goldEyebrow} /></View>
            <Text style={styles.gridLabel} numberOfLines={1}>{a.label}</Text>
            <Text style={styles.gridSub} numberOfLines={2}>{a.sub}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable testID="support-new" onPress={goNew} style={styles.action}>
        <View style={styles.actionIcon}><Ionicons name="create-outline" size={20} color={C.goldEyebrow} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Contact Support (general)</Text>
          <Text style={styles.actionSub}>Open a general request — attach screenshots if needed.</Text>
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
      <Pressable onPress={() => openJaleter('support')} style={styles.linkBanner} testID="support-visit-website">
        <Ionicons name="globe-outline" size={16} color={C.goldEyebrow} />
        <Text style={styles.linkBannerText}>Visit our full Help Center at jaleter.com/support</Text>
        <Ionicons name="open-outline" size={14} color={C.goldEyebrow} />
      </Pressable>
      <PoweredByJaleter />
    </View>
  );
}
