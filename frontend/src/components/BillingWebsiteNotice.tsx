import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C, D } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { STORE_NAME, openStoreSubscriptions } from '@/src/storeLinks';
import { useThemed } from '@/src/utils/appShared';

/* ---------------- Billing Notice ---------------- */
// Premium is billed by the App Store / Google Play (tap → the store's
// subscription settings). Coaching is a separate Stripe purchase on jaleter.com.
export const BillingWebsiteNotice = ({ compact = false, target = 'billing' as 'billing' | 'coaching' | 'membership' }: { compact?: boolean; target?: 'billing' | 'coaching' | 'membership' }) => {
  const t = useThemed();
  const isStore = target !== 'coaching';
  const label = target === 'coaching' ? 'Book & pay at jaleter.com' : `Manage Premium in ${STORE_NAME}`;
  return (
    <Pressable
      testID={`billing-notice-${target}`}
      onPress={() => (isStore ? openStoreSubscriptions() : openJaleter(target))}
      style={[billingNoticeStyles.card, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}
    >
      <View style={billingNoticeStyles.iconWrap}>
        <Ionicons name={isStore ? 'card-outline' : 'globe-outline'} size={16} color={C.goldEyebrow} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[billingNoticeStyles.title, t.textInk]}>{label}</Text>
        <Text style={[billingNoticeStyles.body, t.textMuted]}>
          {isStore
            ? (compact ? `Renewals, receipts and cancellation are handled by ${STORE_NAME}.` : `Your Premium subscription is billed by ${STORE_NAME}. Tap to view, change or cancel it in your store subscription settings.`)
            : (compact ? 'Tap to open on our website.' : 'Coaching sessions are booked and paid on our secure website.')}
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
