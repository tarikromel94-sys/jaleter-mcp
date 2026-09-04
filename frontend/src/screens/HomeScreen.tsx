import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C, D } from '@/src/jaleterTheme';
import { dailyQuote, MONEY, QuoteType } from '@/src/quoteLibrary';
import ProjectionLineChart from '@/src/components/ProjectionLineChart';
import { s, useThemed, CircleBtn, Sparkle } from '@/src/utils/appShared';
import { DEFAULT_LEGACY_RATE, hypoContributions, longTermInvestment } from '@/src/utils/legacyMath';

export const HomeScreen = ({ name, initials, experience, netWorth, investmentTotal, totalCash, availableCash, monthlyNet, legacyContribution, legacyHypothetical, legacyHypoFrequency, legacyHypoDuration, legacyReturnRate, budgetUsage, alertsEnabled, navigate, financialsReady }: any) => {
  const t = useThemed();
  const q = dailyQuote(experience as QuoteType, new Date());
  const hypoValue = Math.max(0, Number((legacyHypothetical || '').replace(/[^0-9.]/g, '')) || 0);
  const hypoFreq: 'onetime' | 'monthly' | 'annual' = legacyHypoFrequency || 'onetime';
  const hypoDur: number | null = typeof legacyHypoDuration === 'number' ? legacyHypoDuration : null;
  const rate = Number(legacyReturnRate) || DEFAULT_LEGACY_RATE;
  const hypoAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n);
  // Home teaser projection — 33yr compound of current investments at the user's chosen rate.
  const h33 = hypoAt(33);
  const projected = investmentTotal > 0 ? longTermInvestment(investmentTotal, h33.addToPrincipal, (legacyContribution || 0) + h33.addToMonthlyContrib, 33, rate) : 0;
  const hasProjection = projected > 0;
  // BUILD (Jun 2026 spec): starts with Total Cash + Investments per Wealth.
  // Investments held FLAT — no compounding assumption. Cash accumulates by
  // the current monthly budget net (positive or negative).
  const buildStartingCash = (typeof totalCash === 'number' ? totalCash : 0) || 0;
  const signedMonthlyNet = Number(monthlyNet || 0);
  const buildAt = (n: number) => {
    // Home BUILD teaser math: investments held flat, cash accumulates by
    // monthly budget net over `n` years. Mirror of LegacyScreen's BUILD.
    const h = hypoAt(n);
    const months = Math.max(0, Math.round(n * 12));
    const heldInvestments = (investmentTotal || 0) + h.addToPrincipal;
    const cashPortion = buildStartingCash + signedMonthlyNet * months + h.addToCash;
    return Math.round(heldInvestments + cashPortion);
  };
  const build1 = buildAt(1);
  const build2 = buildAt(2);
  const build3 = buildAt(3);
  const build5 = buildAt(5);
  // GROW checkpoint — 10yr labelled clearly as "10YR GROW" so users
  // understand it is investment-compound math (never cash-linear).
  const grow10 = longTermInvestment(investmentTotal || 0, hypoAt(10).addToPrincipal, (legacyContribution || 0) + hypoAt(10).addToMonthlyContrib, 10, rate);
  const grow20 = longTermInvestment(investmentTotal || 0, hypoAt(20).addToPrincipal, (legacyContribution || 0) + hypoAt(20).addToMonthlyContrib, 20, rate);
  const grow30 = longTermInvestment(investmentTotal || 0, hypoAt(30).addToPrincipal, (legacyContribution || 0) + hypoAt(30).addToMonthlyContrib, 30, rate);
  const showSnapshot = (totalCash || 0) > 0 || (investmentTotal || 0) > 0 || (monthlyNet || 0) > 0;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <View style={s.homeGreeting}>
        <View style={{ flex: 1 }}>
          <Text style={s.homeDate}>{today}</Text>
          <Text style={[s.homeName, t.textInk]}>Good evening, {name}.</Text>
        </View>
        <CircleBtn onPress={() => navigate('settings')} testID="home-bell"><Ionicons name="notifications-outline" size={18} color={t.dark ? D.text : C.ink3} /></CircleBtn>
        <Pressable onPress={() => navigate('more')} testID="home-profile" style={[s.avatar, { marginLeft: 8 }]}>
          <Text style={{ color: C.goldText, fontSize: 11, fontWeight: '700' }}>{initials}</Text>
        </Pressable>
      </View>
      <Pressable testID="home-inspiration" onPress={() => navigate('settings')} style={s.inspirationCard}>
        <Sparkle size={21} style={{ position: 'absolute', right: 20, top: 18, color: '#f0c77f' }} />
        <Sparkle size={9} style={{ position: 'absolute', right: 45, top: 42, color: '#f0c77f' }} />
        <Text style={{ color: '#d9af6d', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 }}>{q.type.toUpperCase()}</Text>
        <Text style={s.inspirationQuote}>{q.quote}</Text>
        <Text style={{ color: '#aaa297', fontSize: 9 }}>{q.source}</Text>
      </Pressable>
      {/* Prominent Coach AI entry point — replaces the bottom-nav slot.
          Kept visible on the Home screen so users can always reach the coach
          in one tap from the primary landing surface. */}
      <Pressable testID="home-coach-card" onPress={() => navigate('coach')} style={s.coachCard}>
        <LinearGradient
          colors={['#f5d698', '#c49450', '#8a6428']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.coachCardIcon}
        >
          <Ionicons name="sparkles" size={22} color="#fffdf9" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#d9af6d', fontSize: 9, fontWeight: '700', letterSpacing: 1.4 }}>JALETER COACH · AI</Text>
          <Text style={s.coachCardTitle}>Ask about your money</Text>
          <Text style={s.coachCardSub}>Personalized insights grounded in your real budget & spending.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#e5c38b" />
      </Pressable>
      <View style={s.sectionTitle}><Text style={[s.sectionH3, t.textInk]}>Right Now</Text><Text style={[s.sectionCap, t.textMuted]}>Your financial pulse</Text></View>
      <View style={{ flexDirection: 'row', gap: 11 }}>
        <Pressable style={[s.snapshotCard, t.cardBg]} onPress={() => navigate('budget')} testID="home-budget-card">
          <Text style={[s.snapshotLabel, t.textMuted]}>Budget</Text>
          <Text style={[s.snapshotValue, t.textInk]}>{financialsReady ? `${Math.round(budgetUsage)}%` : '••••'}</Text>
          <View style={s.miniProgress}><View style={[s.miniProgressBar, { width: `${financialsReady ? Math.min(budgetUsage, 100) : 0}%` }]} /></View>
          <Text style={[s.snapshotMeta, t.textMuted]}>{financialsReady ? 'used this month' : 'Updating…'}</Text>
        </Pressable>
        <Pressable style={[s.snapshotCard, s.snapshotDark]} onPress={() => navigate('networth')} testID="home-networth-card">
          <Text style={[s.snapshotLabel, { color: '#c4bdb2' }]}>Net Worth</Text>
          <Text style={[s.snapshotValue, { color: '#fff' }]}>{financialsReady ? MONEY(netWorth) : '••••••'}</Text>
          <View style={{ flexDirection: 'row', gap: 3, marginTop: 8, alignItems: 'center' }}>
            <Ionicons name="wallet-outline" size={12} color={C.greenSoft} />
            <Text style={{ color: C.greenSoft, fontSize: 9 }}>{financialsReady ? 'Assets − Liabilities' : 'Updating…'}</Text>
          </View>
        </Pressable>
      </View>
      {alertsEnabled && budgetUsage >= 80 && (
        <Pressable style={s.alertBanner} onPress={() => navigate('budget')} testID="home-alert">
          <View style={s.alertIcon}><Ionicons name="notifications" size={18} color={C.alertIconText} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', fontSize: 11, color: C.alertText }}>You're approaching your budget limit</Text>
            <Text style={{ color: '#8d806e', fontSize: 9 }}>{Math.round(budgetUsage)}% of this month's budget used.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={C.alertText} />
        </Pressable>
      )}
      <View style={s.sectionTitle}>
        <Text style={[s.sectionH3, t.textInk]}>Your Legacy</Text>
        <Pressable onPress={() => navigate('legacy')} testID="home-legacy-link" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#857b6d', fontSize: 11 }}>Explore </Text>
          <Ionicons name="chevron-forward" size={13} color="#857b6d" />
        </Pressable>
      </View>
      <Pressable style={s.legacyTeaser} onPress={() => navigate('legacy')} testID="home-legacy">
        <Text style={{ color: '#c9a56c', fontSize: 8, letterSpacing: 1.3 }}>RETIREMENT PROJECTION</Text>
        {!financialsReady ? (
          <>
            <Text style={s.legacyStrong}>••••••</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 14 }}>Updating your projections…</Text>
          </>
        ) : hasProjection ? (
          <>
            <Text style={s.legacyStrong}>{MONEY(projected)}</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 14 }}>
              33-year compounding of your current investments at {rate}%.
            </Text>
            <View style={{ marginTop: 8 }}>
              <ProjectionLineChart
                ready={true}
                height={80}
                showLabels={false}
                strokeColor="#e5c38b"
                gradientTop="rgba(229,195,139,0.35)"
                gradientBottom="rgba(229,195,139,0)"
                points={(() => {
                  // Real 33-year compounding curve of current investments at
                  // the user's rate. Same math as the headline number.
                  const pts: any[] = [];
                  for (let y = 0; y <= 33; y += 3) {
                    const h33 = hypoAt(y);
                    pts.push({ label: `${y}YR`, value: (investmentTotal || 0) > 0 ? longTermInvestment(investmentTotal, h33.addToPrincipal, (legacyContribution || 0) + h33.addToMonthlyContrib, y, rate) : 0 });
                  }
                  return pts;
                })()}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={s.legacyStrong}>{MONEY(0)}</Text>
            <Text style={{ color: '#aaa297', fontSize: 10, lineHeight: 15, marginBottom: 12 }}>
              Link an account or add assets, then open the Legacy page to model your future.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#e5c38b', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>Start your legacy</Text>
              <Ionicons name="chevron-forward" size={13} color="#e5c38b" />
            </View>
          </>
        )}
      </Pressable>

      {/* Legacy Snapshot — mirrors the Legacy tab exactly. BUILD row = 1/2/3/5
          year, GROW row = 10/20/30 year. Labels match so Home ↔ Legacy stay
          in sync and users never see conflicting "Y10 Cash" numbers. All
          numbers are masked while the financials-ready gate is still false
          so users never see a stale/partial projection. */}
      {showSnapshot && (
        <Pressable style={[s.assumptionsCard, t.cardBg, { marginTop: 12 }]} onPress={() => navigate('legacy')} testID="home-legacy-snapshot">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, t.textInk]}>LEGACY SNAPSHOT</Text>
            <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#aaa39a'} />
          </View>
          <Text style={[{ fontSize: 9, marginBottom: 6 }, t.textMuted]}>
            {financialsReady
              ? `BUILD projects your wealth from your budget cash flow (investments held flat). GROW compounds investments at ${rate}%.`
              : 'Updating projections — numbers will appear once your accounts finish loading.'}
          </Text>
          {/* BUILD row — near-term (1/2/3/5 yr). Same math as Legacy BUILD. */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 4 }}>BUILD · CURRENT WEALTH + BUDGET CASH FLOW</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: '1YR', v: build1 },
              { label: '2YR', v: build2 },
              { label: '3YR', v: build3 },
              { label: '5YR', v: build5 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 11, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{financialsReady ? MONEY(row.v) : '••••'}</Text>
              </View>
            ))}
          </View>
          {/* GROW row — long-term investment compounding. 10YR labeled clearly. */}
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8, marginTop: 10 }}>GROW · INVESTMENTS COMPOUND @ {rate}%</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            {[
              { label: '10YR GROW', v: grow10 },
              { label: '20YR GROW', v: grow20 },
              { label: '30YR GROW', v: grow30 },
            ].map((row) => (
              <View key={row.label} style={{ flex: 1, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? '#3a342b' : '#f0e7d1', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 0.8 }}>{row.label}</Text>
                <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 3 }, t.textInk]} numberOfLines={1}>{financialsReady ? MONEY(row.v) : '••••'}</Text>
              </View>
            ))}
          </View>
        </Pressable>
      )}
    </ScrollView>
  );
};
