import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Platform, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, apiCall } from '@/src/AuthContext';
import { C, D } from '@/src/jaleterTheme';
import { openJaleter } from '@/src/jaleterLinks';
import { PoweredByJaleter } from '@/src/PoweredByJaleter';
import { s, useThemed, PageHeader, Toast as SharedToast, Sparkle } from '@/src/utils/appShared';
import { usePayment, formatBookingDate } from '@/src/hooks/usePayment';

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
  const pay = usePayment();
  const [membership, setMembership] = useState<{
    active: boolean;
    status: string | null;
    plan: string | null;
    price: number | null;
    currency: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    premium_since: string | null;
  } | null>(null);
  // "Confirming…" state — set true after a subscribe attempt returns, cleared
  // once the backend reports `active: true` (or after we give up polling).
  const [confirming, setConfirming] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'subscribe' | 'portal' | 'cancel' | 'resume' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return null;
    try {
      const data = await apiCall('/api/user/membership', { method: 'GET' }, token);
      setMembership(data);
      return data;
    } catch { setMembership(null); return null; }
  }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  // Polls /api/user/membership for up to ~60 seconds after Stripe redirect
  // until the webhook flips the user to active. Never activates locally;
  // this is a READ loop.
  const waitForActivation = useCallback(async () => {
    setConfirming(true);
    setConfirmMsg('Payment received. Confirming membership…');
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      const m = await refresh();
      if (m?.active) {
        setConfirming(false);
        setConfirmMsg(null);
        setNotice('Membership activated. Thanks for supporting Jaleter!');
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    setConfirming(false);
    setConfirmMsg(null);
    setNotice("We haven't heard back from Stripe yet. Pull to refresh in a moment — your access will unlock as soon as we receive Stripe's confirmation.");
  }, [refresh]);

  const startSubscribe = async () => {
    if (!token) return;
    setBusy('subscribe');
    setNotice(null);
    try {
      const res = await pay.start('jaleter_premium');
      // Regardless of the outcome (success, canceled, dismissed) we ask the
      // backend for the authoritative status. The webhook — not the redirect
      // — decides entitlement.
      if (res.ok && res.sessionId) {
        await waitForActivation();
      } else if (res.error) {
        setNotice(res.error);
      }
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    if (!token) return;
    setBusy('portal');
    try {
      const res = await apiCall('/api/payments/billing-portal', { method: 'POST', body: JSON.stringify({}) }, token);
      if (res?.url) {
        if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.location.href = res.url; }
        else { await WebBrowser.openBrowserAsync(res.url); }
      }
    } catch (e: any) {
      setNotice(e?.message || 'Could not open the billing portal.');
    } finally { setBusy(null); refresh(); }
  };

  const cancelAtPeriodEnd = async () => {
    if (!token) return;
    setBusy('cancel');
    try {
      await apiCall('/api/payments/cancel-at-period-end', { method: 'POST', body: JSON.stringify({}) }, token);
      setNotice("Cancellation scheduled. You'll keep access until the end of the current billing period.");
    } catch (e: any) { setNotice(e?.message || 'Could not schedule cancellation.'); }
    finally { setBusy(null); refresh(); }
  };

  const resume = async () => {
    if (!token) return;
    setBusy('resume');
    try {
      await apiCall('/api/payments/resume', { method: 'POST', body: JSON.stringify({}) }, token);
      setNotice('Your subscription will renew as normal.');
    } catch (e: any) { setNotice(e?.message || 'Could not resume subscription.'); }
    finally { setBusy(null); refresh(); }
  };

  const renewsOn = membership?.current_period_end
    ? new Date(membership.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Membership" subtitle="One simple annual plan." back={back} />

      {/* Confirming banner — visible while polling the backend after Stripe redirect. */}
      {confirming && (
        <View style={{
          padding: 12, borderRadius: 12, marginBottom: 10,
          backgroundColor: t.dark ? '#26221c' : '#fbf6ec',
          borderWidth: 1, borderColor: '#e6dcc5',
          flexDirection: 'row', gap: 10, alignItems: 'center',
        }}>
          <ActivityIndicator color="#9a6d32" />
          <Text style={[{ flex: 1, fontSize: 12 }, t.textInk]}>{confirmMsg}</Text>
        </View>
      )}
      {notice && !confirming && (
        <View style={{
          padding: 12, borderRadius: 12, marginBottom: 10,
          backgroundColor: t.dark ? '#1f2620' : '#f4f9ee',
          borderWidth: 1, borderColor: '#c9d9c1',
        }}>
          <Text style={[{ fontSize: 12 }, t.textInk]}>{notice}</Text>
        </View>
      )}

      <View style={[s.priceCard, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <Text style={{ color: C.goldEyebrow2, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>JALETER PREMIUM</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: t.dark ? D.text : C.ink, marginTop: 4 }}>Annual Membership</Text>
        <Text style={[{ color: t.dark ? D.textMuted : '#8d867d', fontSize: 11, marginTop: 2 }]}>Everything you need to plan, track, and grow your money.</Text>
        <Text style={[s.priceStrong, t.textInk, { marginTop: 6 }]}>$90<Text style={{ fontSize: 13, color: t.dark ? D.textMuted : '#8d867d', fontWeight: '500' }}> / year</Text></Text>
        <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', marginTop: 2 }}>$7.50 / month equivalent · auto-renews annually</Text>

        {/* Membership state pill: ACTIVE / PAST DUE / CANCELING / INACTIVE. */}
        {membership && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {membership.active ? (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#4c8b5622' }}>
                <Text style={{ color: '#4c8b56', fontSize: 10, fontWeight: '800' }}>
                  {membership.cancel_at_period_end ? `ACTIVE · ends ${renewsOn || ''}` : `ACTIVE · renews ${renewsOn || ''}`}
                </Text>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#8b643722' }}>
                <Text style={{ color: '#8b6437', fontSize: 10, fontWeight: '800' }}>
                  {membership.status === 'past_due' ? 'PAYMENT ISSUE' : (membership.status || 'INACTIVE').toUpperCase()}
                </Text>
              </View>
            )}
            {membership.status === 'past_due' && (
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#b0453d22' }}>
                <Text style={{ color: '#b0453d', fontSize: 10, fontWeight: '800' }}>UPDATE PAYMENT METHOD</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ marginTop: 12, gap: 6 }}>
          {[
            'Secure bank & account syncing',
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

      {/* Action buttons — different set depending on membership state. */}
      <View style={{ marginTop: 14, gap: 10 }}>
        {!membership?.active && (
          <Pressable
            onPress={startSubscribe}
            disabled={busy === 'subscribe' || confirming}
            style={{
              backgroundColor: '#9a6d32', paddingVertical: 14, borderRadius: 12, alignItems: 'center',
              opacity: (busy === 'subscribe' || confirming) ? 0.6 : 1,
            }}
            testID="membership-subscribe"
          >
            {busy === 'subscribe'
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Start membership — $90 / year</Text>}
          </Pressable>
        )}
        {membership?.active && !membership.cancel_at_period_end && (
          <>
            <Pressable
              onPress={openPortal}
              disabled={busy === 'portal'}
              style={{ borderWidth: 1, borderColor: '#c9b98f', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
              testID="membership-manage"
            >
              {busy === 'portal' ? <ActivityIndicator color="#8b6437" /> : <Text style={{ color: '#8b6437', fontWeight: '800', fontSize: 13 }}>Manage subscription</Text>}
            </Pressable>
            <Pressable
              onPress={cancelAtPeriodEnd}
              disabled={busy === 'cancel'}
              style={{ paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
              testID="membership-cancel"
            >
              {busy === 'cancel'
                ? <ActivityIndicator color="#b0453d" />
                : <Text style={{ color: '#b0453d', fontWeight: '600', fontSize: 12 }}>Cancel at period end</Text>}
            </Pressable>
          </>
        )}
        {membership?.active && membership.cancel_at_period_end && (
          <Pressable
            onPress={resume}
            disabled={busy === 'resume'}
            style={{ backgroundColor: '#4c8b56', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
            testID="membership-resume"
          >
            {busy === 'resume'
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Resume subscription</Text>}
          </Pressable>
        )}
      </View>
      <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d867d', textAlign: 'center', marginTop: 12, lineHeight: 14 }}>
        Membership is $90.00 USD per year, billed by Stripe. Your subscription renews automatically each year at $90.00 USD unless you cancel at least 24 hours before the renewal date. You can cancel, update your card, or download invoices any time from Manage subscription or at jaleter.com/billing.
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
        <Text style={{ color: '#aaa298', fontSize: 10 }}>Every feature is designed to connect today's stewardship with tomorrow's freedom.</Text>
      </View>
      <View style={{ gap: 10 }}>
        {[
          ['coach','Jaleter Coach','AI insights on your money','sparkles-outline'],
          ['coaching','Book Coaching','Schedule + pay at jaleter.com','chatbubble-outline'],
          ['membership','Membership','Manage at jaleter.com','sparkles-outline'],
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
