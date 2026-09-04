import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, D } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { useThemed } from '@/src/utils/appShared';

/* ---------------- Billing Website Notice (external web billing) ---------------- */
// Stripe checkout is hosted at jaleter.com; this component links to the
// hosted billing/coaching/membership page.
export const BillingWebsiteNotice = ({ compact = false, target = 'billing' as 'billing' | 'coaching' | 'membership' }: { compact?: boolean; target?: 'billing' | 'coaching' | 'membership' }) => {
  const t = useThemed();
  const label = target === 'coaching' ? 'Book & pay at jaleter.com' : target === 'membership' ? 'Manage membership at jaleter.com' : 'Billing lives at jaleter.com';
  return (
    <Pressable
      testID={`billing-notice-${target}`}
      onPress={() => openJaleter(target)}
      style={[billingNoticeStyles.card, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}
    >
      <View style={billingNoticeStyles.iconWrap}>
        <Ionicons name="globe-outline" size={16} color={C.goldEyebrow} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[billingNoticeStyles.title, t.textInk]}>{label}</Text>
        <Text style={[billingNoticeStyles.body, t.textMuted]}>
          {compact
            ? 'Tap to open on our website.'
            : 'Billing and subscription management is handled on our secure website. Tap here to open jaleter.com in your browser.'}
        </Text>
      </View>
      <Ionicons name="open-outline" size={16} color={C.goldEyebrow} />
    </Pressable>
  );
};
const billingNoticeStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8dcc4',
    backgroundColor: '#fbf6ec',
    marginTop: 10,
  },
  iconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#f4e6c9',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 12, fontWeight: '800', color: '#615b52', letterSpacing: 0.2 },
  body: { fontSize: 10, color: '#8a8378', marginTop: 3, lineHeight: 14 },
});
