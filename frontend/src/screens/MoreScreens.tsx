import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useAuth, apiCall } from '@/src/AuthContext';
import { C, D } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { PoweredByJaleter } from '@/src/PoweredByJaleter';
import { s, useThemed, PageHeader, Toast as SharedToast, Sparkle } from '@/src/utils/appShared';
import { formatBookingDate } from '@/src/hooks/usePayment';
import { STORE_NAME, openStoreSubscriptions } from '@/src/storeLinks';

export const CoachingScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);

  const refreshBookings = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/coaching/bookings', { method: 'GET' }, token);
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { refreshBookings(); }, [refreshBookings]);

  const upcoming = bookings
    .filter((b) => b.status === 'confirmed')
    .sort((a, b) => (new Date(b.created_at).getTime()) - (new Date(a.created_at).getTime()))
    .slice(0, 5);

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Coaching" subtitle="Personal financial clarity, one hour at a time." back={back} />
      <View style={s.coachingCard}>
        <View style={s.coachingIcon}><Ionicons name="chatbubble-outline" size={24} color={C.goldText} /></View>
        <Text style={{ color: '#cda86d', fontSize: 9, letterSpacing: 1.2 }}>COACHING · 1 HOUR</Text>
        <Text style={[{ fontSize: 22, fontWeight: '700', color: '#f2e5c8', marginVertical: 4, textAlign: 'center' }]}>Private Financial Clarity Session</Text>
        <Text style={s.coachingPrice}>$75<Text style={{ fontSize: 13, color: '#aaa298', fontWeight: '500' }}> / session</Text></Text>
        <Text style={{ color: '#aaa298', fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 15 }}>
          One focused session to get clear on a financial question, budget concern, or next step.
        </Text>
        <View style={{ marginTop: 12, alignSelf: 'stretch', gap: 6 }}>
          {[
            'Review one primary financial concern',
            'Budget, cash-flow, or goal review',
            'Identify priorities and opportunities',
            'Questions answered during the session',
            'Clear next steps',
          ].map((line) => (
            <View key={line} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ color: '#e8c98f', fontSize: 12, fontWeight: '800' }}>✓</Text>
              <Text style={{ color: '#e6ddca', fontSize: 11, flex: 1, lineHeight: 15 }}>{line}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Single CTA — Stripe on jaleter.com handles the checkout and then
          redirects the user directly into Calendly to pick their slot. */}
      <View style={{ marginTop: 18 }}>
        <Pressable
          onPress={() => openJaleter('coaching')}
          style={s.coachingCta}
          testID="coaching-book-pay"
        >
          <Ionicons name="lock-closed-outline" size={16} color="#fff" />
          <Text style={s.coachingCtaText}>Book & Pay — $75</Text>
          <Ionicons name="open-outline" size={14} color="#fff" />
        </Pressable>
        <Text style={[{ fontSize: 10, textAlign: 'center', marginTop: 10 }, t.textMuted]}>
          You&apos;ll choose your session time right after payment.
        </Text>
      </View>

      {upcoming.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 }, t.textInk]}>PAID SESSIONS</Text>
          {upcoming.map((b) => (
            <View key={b.booking_id} style={[s.slotRow, { borderColor: '#c9a56c33', backgroundColor: t.dark ? D.surface : '#faf4e9' }]}>
              <Ionicons name="checkmark-circle" size={17} color="#8fa88f" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '600' }, t.textInk]}>{b.scheduled_at ? formatBookingDate(b.scheduled_at) : 'Scheduled via Calendly'}</Text>
              <Text style={{ color: '#8fa88f', fontSize: 9, fontWeight: '700' }}>CONFIRMED</Text>
            </View>
          ))}
        </View>
      )}

      {toast && <SharedToast message={toast} onHide={() => setToast(null)} />}
    </ScrollView>
  );
};
export const MembershipScreen = ({ back }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [membership, setMembership] = useState<{
    active: boolean;
    status: string | null;
    source?: 'iap' | 'legacy_stripe' | 'admin' | null;
    billing_platform?: string | null;
    plan: string | null;
    price: number | null;
    currency: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    premium_since: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await apiCall('/api/user/membership', { method: 'GET' }, token);
      setMembership(data);
      return data;
    } catch { setMembership(null); return null; }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const endsOn = membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  // Which store bills this member: the platform recorded at purchase time,
  // falling back to the device we're on.
  const billedVia = membership?.billing_platform === 'android' ? 'Google Play'
    : membership?.billing_platform === 'ios' ? 'App Store' : STORE_NAME;
  const isLegacy = membership?.source === 'legacy_stripe';

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Membership" subtitle="One simple annual plan." back={back} />

      <View style={[s.priceCard, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>JALETER PREMIUM</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: t.dark ? D.text : C.ink, marginTop: 4 }}>Annual Membership</Text>
        <Text style={[{ color: t.dark ? D.textMuted : '#8d867d', fontSize: 11, marginTop: 2 }]}>Everything you need to plan, track, and grow your money.</Text>
        <Text style={[s.priceStrong, t.textInk, { marginTop: 6 }]}>$89.99<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}> / year</Text></Text>
        <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', marginTop: 2 }}>Less than $7.50 / month · auto-renews annually via {STORE_NAME}</Text>

        {/* Membership state pill */}
        {membership && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }} testID="membership-state">
            {membership.active ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#4c8b5622' }}>
                <Text style={{ color: '#4c8b56', fontSize: 10, fontWeight: '800' }}>
                  {membership.source === 'admin' ? 'ACTIVE'
                    : isLegacy ? `ACTIVE · paid through ${endsOn || ''}`
                    : `ACTIVE · renews ${endsOn || ''}`}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#8b643722' }}>
                <Text style={{ color: '#8b6437', fontSize: 10, fontWeight: '800' }}>INACTIVE</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ marginTop: 12, gap: 6 }}>
          {[
            'Secure bank & account syncing (Plaid)',
            'Budgeting + transaction tracking',
            'Reports & spending insights',
            'Net Worth + Set Aside goals',
            'Build, Grow & retirement projections',
            'Jaleter Coach AI',
            'Faith + Focus library',
            'Statement import from supported bank files',
          ].map(item => (
            <View key={item} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Text style={{ color: '#a57537', fontSize: 12, fontWeight: '800' }}>✓</Text>
              <Text style={{ color: t.dark ? D.textSubtle : '#615b52', fontSize: 11, flex: 1, lineHeight: 15 }}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Grandfathered web members: their already-paid period is honored, but
          it will not renew — after it ends they subscribe in the app. */}
      {isLegacy && (
        <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: t.dark ? '#26221c' : '#fbf6ec', borderWidth: 1, borderColor: '#e6dcc5' }} testID="membership-legacy-notice">
          <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Your web membership is paid through {endsOn}.</Text>
          <Text style={[{ fontSize: 11, marginTop: 4, lineHeight: 15 }, t.textMuted]}>
            Jaleter Premium is now billed through the {STORE_NAME}. You keep full access until then with no further charges. When that date arrives, tap Subscribe in the app to continue — your data and account stay exactly as they are.
          </Text>
        </View>
      )}

      {/* Billing management lives in the store that sold the subscription. */}
      <View style={{ marginTop: 14, gap: 10 }}>
        {membership?.active && membership.source === 'iap' && (
          <Pressable
            onPress={openStoreSubscriptions}
            style={{ borderWidth: 1, borderColor: '#c9b98f', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
            testID="membership-manage-store"
          >
            <Text style={{ color: '#8b6437', fontWeight: '800', fontSize: 13 }}>Manage in {billedVia} settings</Text>
          </Pressable>
        )}
        {membership && !membership.active && (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.dark ? '#26221c' : '#fbf6ec', borderWidth: 1, borderColor: '#e6dcc5' }} testID="membership-inactive-notice">
            <Text style={[{ fontSize: 11, lineHeight: 15 }, t.textMuted]}>
              Subscribe to Jaleter Premium from the {STORE_NAME} inside the app to unlock every feature. Already subscribed? Use Restore Purchase on the subscribe screen.
            </Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', textAlign: 'center', marginTop: 12, lineHeight: 14 }}>
        {isLegacy
          ? 'Your remaining paid period was purchased on jaleter.com and is honored in full. No further web charges will occur.'
          : `Jaleter Premium is $89.99 USD per year, billed through your ${billedVia} subscription. It renews automatically each year unless you cancel at least 24 hours before the renewal date in your ${billedVia} subscription settings. Canceling keeps access until the end of the paid period.`}
      </Text>
    </ScrollView>
  );
};
export const MoreScreen = ({ navigate, linkedCount, onBack }: any) => {
  const t = useThemed();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="More" subtitle="Your legacy, membership, and preferences." back={onBack} />
      <View style={s.moreHero}>
        <Sparkle size={22} color="#d7ad6b" />
        <Text style={s.moreHeroH2}>Build with purpose.</Text>
        <Text style={{ color: '#aaa298', fontSize: 10 }}>Every feature is designed to connect today&apos;s stewardship with tomorrow&apos;s freedom.</Text>
      </View>
      <View style={{ gap: 10 }}>
        {[
          ['coach','Jaleter Coach','AI insights on your money','sparkles-outline'],
          ['coaching','Book Coaching','Schedule + pay at jaleter.com','chatbubble-outline'],
          ['membership','Membership',`Billed via ${STORE_NAME}`,'sparkles-outline'],
          ['settings','Settings','Profile, alerts, appearance','settings-outline'],
        ].map(([id, name, sub, icon]) => (
          <Pressable key={id} style={[s.moreGridBtn, t.cardBg]} onPress={() => navigate(id)} testID={`more-${id}`}>
            <View style={[s.moreGridIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={icon as any} size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{name}</Text>
              <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>{sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
          </Pressable>
        ))}

        {/* External-website quick links — open jaleter.com in the browser. */}
        <Pressable style={[s.moreGridBtn, t.cardBg]} onPress={() => openJaleter('home')} testID="more-visit-jaleter">
          <View style={[s.moreGridIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name="globe-outline" size={20} color={C.goldEyebrow} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Visit jaleter.com</Text>
            <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>Blog, pricing, resources</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
        </Pressable>
      </View>
      <PoweredByJaleter />
    </ScrollView>
  );
};
