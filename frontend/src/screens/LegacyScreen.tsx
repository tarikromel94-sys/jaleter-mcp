import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { C, D } from '@/src/jaleterTheme';
import { MONEY } from '@/src/quoteLibrary';
import ProjectionLineChart from '@/src/components/ProjectionLineChart';
import { s, useThemed, PeriodPills, PageHeader, Sheet, GoldButton } from '@/src/utils/appShared';
import { DEFAULT_LEGACY_RATE, hypoContributions } from '@/src/utils/legacyMath';

/* ---------------- Net Worth ---------------- */
// Wealth-classification helpers (isInvestmentAccount, CATEGORY_LABELS,
// CATEGORY_ICONS, LIABILITY_CATEGORIES, timeAgo) are imported from
// `@/src/utils/appShared`.


/* ---------------- Legacy / Coaching / Membership / Settings / More ---------------- */
export const LegacyScreen = ({ investmentTotal, totalCash, availableCash, totalRestricted, monthlyNet, monthlyBudgetIncome, monthlyBudgetExpense, monthlyBudgetPeriod, perMonthNet, financialsReady, timeframe, setTimeframe, contribution, setContribution, hypothetical, setHypothetical, hypoFrequency, setHypoFrequency, hypoDuration, setHypoDuration, returnRate, setReturnRate, cumulative, setCumulative, currentAge, setCurrentAge, retirementAge, setRetirementAge }: any) => {
  const t = useThemed();
  const [editingHypo, setEditingHypo] = useState(false);
  const [hypoDraft, setHypoDraft] = useState('');
  // Direct-typed Monthly Contribution editor (spec #3). Users tap the
  // contribution chip → sheet opens with a TextInput pre-filled with the
  // current value. Save applies immediately and closes the sheet.
  const [editingContrib, setEditingContrib] = useState(false);
  const [contribDraft, setContribDraft] = useState('');
  const commitContribution = () => {
    const clean = Math.max(0, Math.round(Number((contribDraft || '').replace(/[^0-9.]/g, '')) || 0));
    setContribution(clean);
    setEditingContrib(false);
    setContribDraft('');
  };
  const [hypoFreqDraft, setHypoFreqDraft] = useState<'onetime' | 'monthly' | 'annual'>('onetime');
  const [hypoDurDraft, setHypoDurDraft] = useState<string>('');
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState<string>(String(returnRate ?? DEFAULT_LEGACY_RATE));
  const [showMath, setShowMath] = useState(false);
  const [showSurplusBreakdown, setShowSurplusBreakdown] = useState(false);
  const [ageDraft, setAgeDraft] = useState<string>(String(currentAge ?? ''));
  const [retDraft, setRetDraft] = useState<string>(String(retirementAge ?? ''));
  // Whenever the persisted ages change (e.g. loaded from storage), sync the
  // drafts so users always see the current value in the inputs.
  React.useEffect(() => { setAgeDraft(String(currentAge ?? '')); }, [currentAge]);
  React.useEffect(() => { setRetDraft(String(retirementAge ?? '')); }, [retirementAge]);
  React.useEffect(() => { setRateDraft(String(returnRate ?? DEFAULT_LEGACY_RATE)); }, [returnRate]);
  const [ageError, setAgeError] = useState('');

  // Rate assumption used across every Legacy projection + mirrored on Home.
  // Now user-editable — defaults to DEFAULT_LEGACY_RATE (7%) but can be
  // adjusted via the assumption chip beside the projection card.
  const RATE = (Number(returnRate) || DEFAULT_LEGACY_RATE) / 100;   // e.g. 0.07
  const MONTHLY_RATE = RATE / 12;       // monthly compounding

  // ---- BUILD vs GROW split (spec #21) --------------------------------------
  const BUILD: Record<string, number> = { '1yr': 1, '2yr': 2, '3yr': 3, '5yr': 5 };
  const GROW: Record<string, { years: number | null; isRetirement?: boolean }> = {
    '10yr': { years: 10 }, '20yr': { years: 20 }, '30yr': { years: 30 },
    'Retirement': { years: null, isRetirement: true },
  };
  const isBuild = timeframe in BUILD;
  const isRetirement = timeframe === 'Retirement';

  // Compute effective years (Retirement uses ages; everything else is fixed).
  const yearsUntilRetirement = Math.max(0, (Number(retirementAge) || 0) - (Number(currentAge) || 0));
  const years = isBuild
    ? BUILD[timeframe]
    : (isRetirement ? yearsUntilRetirement : (GROW[timeframe]?.years || 0));

  const hypoValue = Math.max(0, Number((hypothetical || '').replace(/[^0-9.]/g, '')) || 0);
  const hypoFreq: 'onetime' | 'monthly' | 'annual' = hypoFrequency || 'onetime';
  const hypoDur: number | null = typeof hypoDuration === 'number' ? hypoDuration : null;

  // Raw monthly net (Budgeted Income − Budgeted Expenses) — used for the
  // headline "Monthly Budget Net" card and the fallback for months without
  // explicit per-month budget overrides. Kept SIGNED (spec #4: "Do not
  // change negative months to $0"). BUILD math preserves the sign as well
  // so a real deficit reduces the projection.
  const rawMonthlyNet = Number(monthlyNet) || 0;

  // Per-month Net for BUILD projections (spec #4). Comes from App-level
  // `legacyPerMonthNet` which classifies each month as ACTUAL / BUDGETED /
  // ESTIMATED. Falls back to a signed carry of the current budget net when
  // the App didn't pass the callback (older callers, tests).
  const perMonthNetFn = React.useCallback((totalMonths: number): { month: number; net: number; source: 'actual' | 'budgeted' | 'estimated'; label?: string }[] => {
    if (typeof perMonthNet === 'function') return perMonthNet(totalMonths);
    const carry = rawMonthlyNet;
    const rows: { month: number; net: number; source: 'actual' | 'budgeted' | 'estimated'; label?: string }[] = [];
    for (let i = 0; i < totalMonths; i++) {
      rows.push({ month: i + 1, net: carry, source: i === 0 ? 'budgeted' : 'estimated' });
    }
    return rows;
  }, [perMonthNet, rawMonthlyNet]);

  // BUILD spec (Jun 2026): Current Wealth = AVAILABLE Cash + Total Investments,
  // pulled directly from the Wealth tab. Available Cash = Total Cash − Set
  // Aside Cash: money already reserved in buckets is never treated as
  // deployable in the projection (and is never double-counted — buckets are
  // a subset of Total Cash, not an extra asset). Investments are held flat —
  // no 7% return applied. The 7% assumption is a GROW/Retirement concept only.
  const buildStartingCash = (typeof availableCash === 'number' ? availableCash : (typeof totalCash === 'number' ? totalCash : 0)) || 0;

  // ---- ONE calculation engine for BUILD ------------------------------
  // Everything BUILD-related — the projected wealth headline, the chart
  // points, the tooltip deltas, the year-by-year table, and the "How
  // this is calculated" drill-down — derives from this single memo. If
  // you find yourself computing BUILD math anywhere else, wire it here.
  const buildBreakdown = React.useMemo(() => {
    const months = Math.max(0, Math.round(years * 12));
    const rows = perMonthNetFn(months) as any;
    const runRate = typeof rows.runRate === 'number' ? rows.runRate : 0;
    const runRateSlice = Array.isArray(rows.runRateSlice) ? rows.runRateSlice : [];
    const allBudgetMonths = Array.isArray(rows.allBudgetMonths) ? rows.allBudgetMonths : [];
    // Hypothetical contribution — surfaced separately so it can never
    // become an invisible adjustment.
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, years);
    const hypoCashAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n).addToCash;
    const hypoPrincipalAt = (n: number) => hypoContributions(hypoValue, hypoFreq, hypoDur, n).addToPrincipal;
    // Yearly snapshots — startWealth, sumOfMonths, hypo add-on, endWealth.
    const yearSnaps: { year: number; startWealth: number; monthsSum: number; hypoAdd: number; endWealth: number; startIdx: number; endIdx: number }[] = [];
    const startingWealth = buildStartingCash + investmentTotal;
    let prevEnd = startingWealth;
    let cumNet = 0;
    for (let y = 1; y <= years; y++) {
      const startIdx = (y - 1) * 12;
      const endIdx = y * 12 - 1;
      const yearMonths = rows.slice(startIdx, endIdx + 1);
      const monthsSum = yearMonths.reduce((s: number, r: any) => s + (r?.net || 0), 0);
      cumNet += monthsSum;
      const hypoAdd = hypoCashAt(y) + hypoPrincipalAt(y);
      const endWealth = Math.round(startingWealth + cumNet + hypoAdd);
      yearSnaps.push({
        year: y,
        startWealth: Math.round(prevEnd),
        monthsSum: Math.round(monthsSum),
        hypoAdd: Math.round(hypoAdd - (y > 1 ? (hypoCashAt(y - 1) + hypoPrincipalAt(y - 1)) : 0)),
        endWealth,
        startIdx,
        endIdx,
      });
      prevEnd = endWealth;
    }
    // The "projected monthly cash flow" figure shown on the assumptions
    // card must equal the run rate that the projection actually uses for
    // unbudgeted months — this is the number the user can multiply by 12
    // to reproduce Y1 (approximately, when the current month is +
    // rest-of-year budgeted separately).
    const projectedMonthlyCashFlow = runRate;
    return {
      months: rows as any[],
      runRate,
      runRateSlice,
      allBudgetMonths,
      startingCash: buildStartingCash,
      startingInvestments: investmentTotal,
      startingWealth,
      hypo: h,
      hypoCashAt,
      hypoPrincipalAt,
      yearSnaps,
      projectedMonthlyCashFlow,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, buildStartingCash, investmentTotal, perMonthNetFn, hypoValue, hypoFreq, hypoDur]);

  const buildProjectionAt = (n: number): number => {
    // BUILD: budget-based only. investments held FLAT — no return
    // assumption applied. Cash portion accumulates the per-month
    // Budgeted / Estimated net (both surpluses AND deficits included).
    // Reads from `buildBreakdown` when n === years to guarantee an
    // exact match with the drill-down; falls back to a direct
    // computation for arbitrary n (used by the chart's yearly points).
    const months = Math.max(0, Math.round(n * 12));
    const netRows = perMonthNetFn(months);
    const cashFromNet = netRows.reduce((sum: number, r: any) => sum + (r?.net || 0), 0);
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, n);
    const heldInvestments = investmentTotal + h.addToPrincipal;
    const cashAtN = buildStartingCash + cashFromNet + h.addToCash;
    return Math.round(heldInvestments + cashAtN);
  };
  const growProjectionAt = (n: number): number => {
    const h = hypoContributions(hypoValue, hypoFreq, hypoDur, n);
    // Monthly compounding: FV = P * (1+r/12)^(n*12) + C * [((1+r/12)^(n*12) - 1) / (r/12)]
    const months = Math.max(0, Math.round(n * 12));
    const growthFactor = Math.pow(1 + MONTHLY_RATE, months);
    const startingPrincipal = investmentTotal + h.addToPrincipal;
    const effectiveContribution = contribution + h.addToMonthlyContrib;
    const fvPrincipal = startingPrincipal * growthFactor;
    const fvContrib = MONTHLY_RATE > 0
      ? effectiveContribution * ((growthFactor - 1) / MONTHLY_RATE)
      : effectiveContribution * months;
    return Math.round(fvPrincipal + fvContrib);
  };
  const projectionAtYear = (n: number): number => (isBuild ? buildProjectionAt(n) : growProjectionAt(n));
  const projection = projectionAtYear(years);

  // Cumulative year-by-year table — only rendered when the toggle is on.
  const cumulativeRows = useMemo(() => {
    const rows: { year: number; value: number; delta: number }[] = [];
    let prev = isBuild
      ? buildStartingCash + investmentTotal + hypoValue
      : investmentTotal + hypoValue;
    for (let y = 1; y <= years; y++) {
      const v = projectionAtYear(y);
      rows.push({ year: y, value: v, delta: v - prev });
      prev = v;
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years, isBuild, buildStartingCash, investmentTotal, hypoValue, hypoFreq, hypoDur, rawMonthlyNet, perMonthNetFn, contribution, currentAge, retirementAge, RATE, MONTHLY_RATE]);

  const commitHypo = () => {
    const clean = Math.max(0, Math.round(Number(hypoDraft.replace(/[^0-9.]/g, '')) || 0));
    const durClean = (hypoDurDraft || '').replace(/[^0-9]/g, '');
    const durNum = durClean ? Math.max(1, Math.min(50, Number(durClean))) : null;
    setHypothetical(clean > 0 ? String(clean) : '');
    setHypoFrequency(clean > 0 ? hypoFreqDraft : 'onetime');
    setHypoDuration(clean > 0 && hypoFreqDraft !== 'onetime' ? durNum : null);
    setEditingHypo(false);
    setHypoDraft('');
    setHypoDurDraft('');
  };

  const commitRate = () => {
    const cleanNum = Number((rateDraft || '').replace(/[^0-9.]/g, ''));
    const clamped = !isFinite(cleanNum) || cleanNum <= 0 ? DEFAULT_LEGACY_RATE : Math.min(30, Math.max(0.1, cleanNum));
    setReturnRate(clamped);
    setEditingRate(false);
  };

  const commitAges = () => {
    // Each field falls back to its persisted value when the draft is blank,
    // so users can update one age without needing to retype the other. This
    // was the bug where entering only a new "Current age" would fail with
    // "Please enter a retirement age" because retDraft was empty.
    const parsed = (draft: string, fallback: number) => {
      const clean = (draft || '').replace(/[^0-9]/g, '');
      if (!clean) return fallback;
      return Math.max(0, Math.round(Number(clean) || 0));
    };
    const a = parsed(ageDraft, currentAge || 0);
    const r = parsed(retDraft, retirementAge || 0);
    if (!a) { setAgeError('Please enter your current age.'); return; }
    if (!r) { setAgeError('Please enter a retirement age.'); return; }
    if (r <= a) { setAgeError(`Retirement age must be greater than ${a}.`); return; }
    setCurrentAge(a); setRetirementAge(r); setAgeError('');
    setAgeDraft(String(a));
    setRetDraft(String(r));
  };

  const projectionTitle = isBuild ? 'PROJECTED WEALTH' : 'PROJECTED INVESTMENTS';
  const projectionSubtitle = isBuild
    ? `Based on your current wealth and projected monthly cash flow.`
    : `Assumes a ${Math.round(RATE * 100)}% annual return and your selected monthly contribution.`;

  const hypoDesc = hypoValue > 0
    ? (hypoFreq === 'onetime'
        ? `${MONEY(hypoValue)} one-time`
        : hypoFreq === 'monthly'
          ? `${MONEY(hypoValue)}/mo${hypoDur ? ` for ${hypoDur}yr${hypoDur === 1 ? '' : 's'}` : ''}`
          : `${MONEY(hypoValue)}/yr${hypoDur ? ` for ${hypoDur}yr${hypoDur === 1 ? '' : 's'}` : ''}`)
    : '+ Add';

  return (
    <KeyboardAwareScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }} bottomOffset={90} keyboardShouldPersistTaps="handled">
      <PageHeader title="Your Legacy" subtitle="See what consistent stewardship can become." />
      {/* Spec #21 — BUILD vs GROW top organisation. Only one row is
          "active" at a time; the other is grayed out so users can see the
          full menu but understand what they're switching between. */}
      <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
        <Text style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: '800', color: '#c49450' }}>BUILD</Text>
        <Text style={[{ fontSize: 9, marginTop: 2, marginBottom: 6 }, t.textMuted]}>What your money + budget habits could build.</Text>
        <PeriodPills values={Object.keys(BUILD)} value={isBuild ? timeframe : ''} onChange={setTimeframe} testID="legacy-build-period" />
        <Text style={{ fontSize: 10, letterSpacing: 1.4, fontWeight: '800', color: '#c49450', marginTop: 14 }}>GROW</Text>
        <Text style={[{ fontSize: 9, marginTop: 2, marginBottom: 6 }, t.textMuted]}>What your investments could grow into.</Text>
        <PeriodPills values={Object.keys(GROW)} value={!isBuild ? timeframe : ''} onChange={setTimeframe} testID="legacy-grow-period" />
      </View>

      {/* Retirement-age card — only visible when the user selects Retirement (spec #24). */}
      {isRetirement && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Retirement age</Text>
          <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>
            {yearsUntilRetirement > 0
              ? `Projecting for ${yearsUntilRetirement} year${yearsUntilRetirement === 1 ? '' : 's'} (age ${currentAge} → ${retirementAge}).`
              : 'Enter your current age and desired retirement age to see the projection.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>Current age</Text>
              <TextInput
                keyboardType="numeric"
                value={ageDraft}
                onChangeText={(v) => { setAgeDraft(v.replace(/[^0-9]/g, '')); setAgeError(''); }}
                onBlur={commitAges}
                selectTextOnFocus
                placeholder="30"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: t.dark ? D.text : C.ink }}
                testID="legacy-current-age"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>Retirement age</Text>
              <TextInput
                keyboardType="numeric"
                value={retDraft}
                onChangeText={(v) => { setRetDraft(v.replace(/[^0-9]/g, '')); setAgeError(''); }}
                onBlur={commitAges}
                selectTextOnFocus
                placeholder="65"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: t.dark ? D.text : C.ink }}
                testID="legacy-retirement-age"
              />
            </View>
          </View>
          {ageError ? <Text style={{ fontSize: 10, color: '#b0453d', marginTop: 8 }}>{ageError}</Text> : null}
        </View>
      )}

      {/* Projection card — labeled per selected mode. */}
      <View style={s.projectionCard}>
        <Text style={{ color: '#caa465', fontSize: 9, letterSpacing: 1.3, textAlign: 'center' }}>
          {projectionTitle} ({isRetirement && yearsUntilRetirement > 0 ? `${yearsUntilRetirement}yr` : timeframe})
        </Text>
        <Text style={s.projectionStrong}>{!financialsReady ? '••••••' : years > 0 ? MONEY(projection) : '—'}</Text>
        <Text style={{ color: '#b4ada3', fontSize: 12, textAlign: 'center', maxWidth: 300, alignSelf: 'center' }}>
          {projectionSubtitle}
        </Text>
        {/* Real-data line chart — every point is a computed projection value
            from the SAME math as the headline number. The final plotted point
            must exactly equal MONEY(projection) (spec reconciliation). */}
        <ProjectionLineChart
          ready={!!financialsReady && years > 0}
          height={110}
          strokeColor="#8b6437"
          gradientTop="rgba(232,201,143,0.35)"
          gradientBottom="rgba(232,201,143,0)"
          emptyLabel={years > 0 ? 'Updating…' : 'Select a timeframe to see the projection.'}
          deltaMode={isBuild ? 'from-today' : 'previous'}
          points={(() => {
            // Real-data chart points — every value comes from the SAME
            // projection math as the headline number.
            //
            // BUILD (spec #22): 1-5yr — plot yearly checkpoints. Each
            // point equals `buildProjectionAt(y)` which sums the actual
            // per-month Net (Actual/Budgeted/Estimated) with investments
            // held flat.
            //
            // GROW / Retirement (spec #21, #23): use meaningful long-term
            // checkpoints — Now, 5yr, 10yr, 15yr, 20yr, 25yr, 30yr and
            // (if applicable) Retirement — so the compounding curve is
            // visible. `growProjectionAt(y)` applies the compound formula
            // with the currently-selected return rate + contribution.
            if (years <= 0) return [];
            if (isBuild) {
              const pts: any[] = [];
              for (let y = 0; y <= Math.min(years, 5); y++) {
                pts.push({
                  label: y === 0 ? 'Now' : `${y}YR`,
                  value: buildProjectionAt(y),
                  meta: {
                    source: y === 0 ? 'actual' : 'projected',
                    fullLabel: y === 0 ? 'Today' : `${y} year${y === 1 ? '' : 's'} from now`,
                    subtitle: 'BUILD · investments held flat',
                  },
                });
              }
              return pts;
            }
            // Long-horizon (GROW / Retirement) — meaningful checkpoints.
            const checkpoints: number[] = [];
            if (isRetirement) {
              // Every 5 yrs up to Retirement, then the exact retirement year.
              for (let y = 0; y <= years; y += 5) checkpoints.push(y);
              if (checkpoints[checkpoints.length - 1] !== years) checkpoints.push(years);
            } else {
              // GROW modes (10/20/30yr): every 5 yrs.
              for (let y = 0; y <= years; y += 5) checkpoints.push(y);
              if (checkpoints[checkpoints.length - 1] !== years) checkpoints.push(years);
            }
            return checkpoints.map((y, i) => ({
              label: y === 0 ? 'Now' : (isRetirement && i === checkpoints.length - 1 ? 'RETIRE' : `${y}YR`),
              value: growProjectionAt(y),
              meta: {
                source: y === 0 ? 'actual' : 'projected',
                fullLabel: y === 0
                  ? 'Today'
                  : (isRetirement && i === checkpoints.length - 1
                      ? 'Retire'
                      : `Year ${y}`),
                subtitle: `${isRetirement ? 'Retirement' : 'GROW'} · ${Math.round(RATE * 100)}% compound`,
              },
            }));
          })()}
        />
      </View>

      {/* Assumption chips — tap any to edit. These are the exact inputs used
          in the projection above so users can see and adjust them inline. */}
      <View style={[s.assumptionsCard, t.cardBg]} testID="legacy-assumptions">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>YOUR ASSUMPTIONS</Text>
          <Text style={[{ fontSize: 8 }, t.textMuted]}>Tap to edit</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {/* Return rate chip — only shown on GROW/Retirement modes, where
              the assumption actually applies. BUILD holds investments flat,
              so surfacing "7% Return" there is confusing. */}
          {!isBuild && (
            <Pressable onPress={() => { setRateDraft(String(returnRate ?? DEFAULT_LEGACY_RATE)); setEditingRate(true); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID="legacy-chip-rate">
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>RETURN</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{Math.round(RATE * 100)}%</Text>
          </Pressable>
          )}
          {/* Monthly contribution — GROW modes only. Spec #3: tap to type
              the exact dollar amount instead of using +/- buttons. */}
          {!isBuild && (
            <Pressable
              onPress={() => { setContribDraft(String(contribution || '')); setEditingContrib(true); }}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}
              testID="legacy-chip-contrib"
            >
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>CONTRIB / MO</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(contribution)}</Text>
            </Pressable>
          )}
          {/* Cash chip — BUILD modes only (uses AVAILABLE Cash = Total − Set Aside, per Wealth tab). */}
          {isBuild && (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
              <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>AVAILABLE CASH</Text>
              <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(buildStartingCash)}</Text>
            </View>
          )}
          <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>INVESTMENTS</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{MONEY(investmentTotal)}</Text>
          </View>
          <Pressable onPress={() => { setHypoDraft(hypothetical || ''); setHypoFreqDraft(hypoFreq); setHypoDurDraft(hypoDur ? String(hypoDur) : ''); setEditingHypo(true); }} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#c49450', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID="legacy-chip-hypo">
            <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>HYPOTHETICAL</Text>
            <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{hypoDesc}</Text>
          </Pressable>
          {isRetirement && (
            <>
              <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
                <Text style={{ fontSize: 8, color: '#a97c39', fontWeight: '800', letterSpacing: 0.6 }}>YEARS</Text>
                <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2 }, t.textInk]}>{yearsUntilRetirement}</Text>
              </View>
            </>
          )}
        </View>
        <Text style={[{ fontSize: 8, marginTop: 8, fontStyle: 'italic' }, t.textMuted]}>
          Actual data · assumptions in gold borders are user-editable.
        </Text>
      </View>

      {/* How the math works — collapsible explanation directly wired to the
          numbers above. Answers "why is my Y1 not just 1.07x my money?". */}
      <Pressable onPress={() => setShowMath(!showMath)} style={[s.assumptionsCard, t.cardBg, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} testID="legacy-math-toggle">
        <View style={{ flex: 1 }}>
          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>How this is calculated</Text>
          <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>Step-by-step math for the number above.</Text>
        </View>
        <Ionicons name={showMath ? 'chevron-down' : 'chevron-forward'} size={16} color={t.dark ? D.textMuted : '#aaa39a'} />
      </Pressable>
      {showMath && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          {isBuild ? (
            (() => {
              // Fully transparent breakdown so every displayed number
              // reconciles: starting wealth → each month with source →
              // yearly rollups → projection. All values come from ONE
              // memo (`buildBreakdown`) so the card, chart, tooltip and
              // year-by-year table can never disagree.
              const bd = buildBreakdown;
              const hypoActive = hypoValue > 0;
              return (
                <>
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1 }]}>PROJECTED WEALTH</Text>
                  <Text style={[{ fontSize: 32, fontWeight: '800', marginTop: 4 }, t.textInk]}>{MONEY(projection)}</Text>
                  <Text style={[{ fontSize: 10, marginTop: 2 }, t.textMuted]}>in {years} year{years === 1 ? '' : 's'}</Text>

                  {/* --- Starting Wealth --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>STARTING WEALTH</Text>
                  <View style={{ marginTop: 6, gap: 4 }}>
                    <Row label="Available Cash (Total − Set Aside)" value={MONEY(bd.startingCash)} muted={t.textMuted} ink={t.textInk} />
                    <Row label="Investments" value={MONEY(bd.startingInvestments)} muted={t.textMuted} ink={t.textInk} />
                    <View style={{ height: 1, backgroundColor: t.dark ? '#332e26' : '#efe6d0', marginVertical: 4 }} />
                    <Row label="Starting Wealth" value={MONEY(bd.startingWealth)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
                  </View>

                  {/* --- Projected monthly cash flow (aka run rate) --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>PROJECTED MONTHLY BUDGET CASH FLOW</Text>
                  {bd.allBudgetMonths.length === 0 ? (
                    <View style={{ marginTop: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#26221c' : '#fbf6ec' }}>
                      <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>No finalized budgets yet</Text>
                      <Text style={[{ fontSize: 10, marginTop: 4, lineHeight: 14 }, t.textMuted]}>
                        BUILD needs at least one finalized monthly budget to project forward. Head to Budget → pick a month → tap <Text style={{ fontWeight: '800' }}>Finalize Budget</Text>. Draft budgets are ignored.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ marginTop: 6, gap: 4 }}>
                      <Row
                        label={bd.allBudgetMonths.length === 0 ? 'No finalized budget yet' : bd.allBudgetMonths.length === 1 ? `From ${bd.allBudgetMonths[0].label}` : `Average of ${bd.runRateSlice.length} finalized budget month${bd.runRateSlice.length === 1 ? '' : 's'}`}
                        value={`${bd.projectedMonthlyCashFlow >= 0 ? '+' : '−'}${MONEY(Math.abs(Math.round(bd.projectedMonthlyCashFlow)))}`}
                        muted={t.textMuted} ink={t.textInk}
                        valueColor={bd.projectedMonthlyCashFlow >= 0 ? '#4c8b56' : '#b0453d'}
                      />
                      {bd.runRateSlice.length > 0 && (
                        <View style={{ marginTop: 4, gap: 3, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#e6dcc5' }}>
                          {bd.runRateSlice.map((rs: any, idx: number) => (
                            <View key={`rr-${idx}-${rs.ym}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={[{ fontSize: 9 }, t.textMuted]}>{rs.label}</Text>
                              <Text style={[{ fontSize: 9, fontWeight: '600' }, t.textInk]}>{rs.net >= 0 ? '+' : '−'}{MONEY(Math.abs(rs.net))}</Text>
                            </View>
                          ))}
                          {bd.runRateSlice.length >= 2 && (
                            <Text style={[{ fontSize: 9, marginTop: 2, fontStyle: 'italic' }, t.textMuted]}>
                              (sum ÷ {bd.runRateSlice.length}) = {bd.projectedMonthlyCashFlow >= 0 ? '+' : '−'}{MONEY(Math.abs(Math.round(bd.projectedMonthlyCashFlow)))} / mo
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  )}

                  {/* --- Month by month projection --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>MONTH-BY-MONTH</Text>
                  <View style={{ marginTop: 6, gap: 2 }}>
                    <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderColor: t.dark ? '#332e26' : '#efe6d0' }}>
                      <Text style={[{ flex: 2, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39' }]}>MONTH</Text>
                      <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39', textAlign: 'right' }]}>AMOUNT</Text>
                      <Text style={[{ flex: 2, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: '#a97c39', textAlign: 'right' }]}>SOURCE</Text>
                    </View>
                    {bd.months.map((r: any, idx: number) => (
                      <View key={`mo-${idx}-${r.ym}`} style={{ flexDirection: 'row', paddingVertical: 2 }}>
                        <Text style={[{ flex: 2, fontSize: 10 }, t.textInk]}>{r.label}</Text>
                        <Text style={[{ flex: 1, fontSize: 10, fontWeight: '600', textAlign: 'right', color: (r.net || 0) >= 0 ? '#4c8b56' : '#b0453d' }]}>
                          {(r.net || 0) >= 0 ? '+' : '−'}{MONEY(Math.abs(r.net || 0))}
                        </Text>
                        <Text style={[{ flex: 2, fontSize: 9, textAlign: 'right' }, t.textMuted]}>
                          {r.source === 'budgeted' ? 'Finalized budget' : 'Estimated from budget average'}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* --- Hypothetical contribution (only if user opted in) --- */}
                  {hypoActive && (
                    <>
                      <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>HYPOTHETICAL CONTRIBUTION</Text>
                      <View style={{ marginTop: 6, gap: 4 }}>
                        <Row
                          label={`${MONEY(hypoValue)} ${hypoFreq}${hypoDur ? ` × ${hypoDur}yr` : ''}`}
                          value={`+${MONEY(Math.round(bd.hypo.addToCash + bd.hypo.addToPrincipal))}`}
                          muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56"
                        />
                        <Text style={[{ fontSize: 9, fontStyle: 'italic' }, t.textMuted]}>
                          Extra cash you&apos;re modeling on top of your budget projection. Set to $0 to remove.
                        </Text>
                      </View>
                    </>
                  )}

                  {/* --- Year-by-year rollup --- */}
                  <Text style={[{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 1, marginTop: 16 }]}>YEAR-BY-YEAR</Text>
                  <View style={{ marginTop: 6, gap: 8 }}>
                    {bd.yearSnaps.map((y: any) => (
                      <View key={`ys-${y.year}`} style={{ backgroundColor: t.dark ? '#242019' : '#fbf6ec', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: t.dark ? '#332e26' : '#efe6d0' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '800' }, t.textInk]}>Year {y.year} projected wealth</Text>
                        <View style={{ marginTop: 4, gap: 2 }}>
                          <Row label={y.year === 1 ? 'Starting Wealth' : `Year ${y.year - 1} Ending Wealth`} value={MONEY(y.startWealth)} muted={t.textMuted} ink={t.textInk} />
                          <Row label={`+ Budget cash flow (months ${y.startIdx + 1}–${y.endIdx + 1})`} value={`${y.monthsSum >= 0 ? '+' : '−'}${MONEY(Math.abs(y.monthsSum))}`} muted={t.textMuted} ink={t.textInk} valueColor={y.monthsSum >= 0 ? '#4c8b56' : '#b0453d'} />
                          {hypoActive && y.hypoAdd !== 0 && (
                            <Row label="+ Hypothetical contribution" value={`${y.hypoAdd >= 0 ? '+' : '−'}${MONEY(Math.abs(y.hypoAdd))}`} muted={t.textMuted} ink={t.textInk} valueColor="#4c8b56" />
                          )}
                          <View style={{ height: 1, backgroundColor: t.dark ? '#332e26' : '#efe6d0', marginVertical: 2 }} />
                          <Row label={`= Year ${y.year} Ending Wealth`} value={MONEY(y.endWealth)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
                        </View>
                      </View>
                    ))}
                  </View>

                  <Text style={[{ fontSize: 10, marginTop: 14, lineHeight: 14, fontStyle: 'italic' }, t.textMuted]}>
                    Based on your current wealth and projected budget cash flow. Investments are held flat in BUILD — 7% growth belongs to GROW/Retirement.
                  </Text>
                </>
              );
            })()
          ) : (
            <>
              <Text style={[{ fontSize: 10, lineHeight: 15 }, t.textInk]}>
                <Text style={{ fontWeight: '800' }}>GROW mode ({isRetirement ? `${years}yr Retirement` : timeframe})</Text> — investments only.{'\n'}
              </Text>
              <View style={{ marginTop: 6, gap: 4 }}>
                <Row label="Starting principal" value={MONEY(investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal)} muted={t.textMuted} ink={t.textInk} />
                <Row label={`× (1 + ${Math.round(RATE * 100)}%/12)^(${years} × 12)`} value={MONEY(Math.round((investmentTotal + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToPrincipal) * Math.pow(1 + MONTHLY_RATE, years * 12)))} muted={t.textMuted} ink={t.textInk} />
                <View style={{ height: 4 }} />
                <Row label={`Monthly contributions (${MONEY(contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib)}/mo × ${years * 12})`} value={MONEY(Math.round(MONTHLY_RATE > 0 ? (contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib) * ((Math.pow(1 + MONTHLY_RATE, years * 12) - 1) / MONTHLY_RATE) : (contribution + hypoContributions(hypoValue, hypoFreq, hypoDur, years).addToMonthlyContrib) * years * 12))} muted={t.textMuted} ink={t.textInk} />
                <View style={{ height: 6 }} />
                <Row label="TOTAL PROJECTION" value={MONEY(projection)} muted={t.textMuted} ink={t.textInk} valueColor="#9a6d32" />
              </View>
              <Text style={[{ fontSize: 9, marginTop: 8, lineHeight: 13 }, t.textMuted]}>
                Cash is intentionally excluded from GROW projections — retirement wealth compounds from your invested portion + ongoing contributions.
              </Text>
            </>
          )}
        </View>
      )}

      {/* Cumulative-year toggle. */}
      {years > 0 && (
        <Pressable onPress={() => setCumulative(!cumulative)} style={[s.assumptionsCard, t.cardBg, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} testID="legacy-cumulative-toggle">
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Cumulative year-by-year</Text>
            <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>Show growth for every year up to {isRetirement ? `year ${years}` : timeframe}.</Text>
          </View>
          <View style={[{ width: 34, height: 20, borderRadius: 10, backgroundColor: cumulative ? '#b28a4c' : '#e5decf', padding: 2 }]}>
            <View style={[{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', transform: [{ translateX: cumulative ? 14 : 0 }] }]} />
          </View>
        </Pressable>
      )}

      {cumulative && years > 0 && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderColor: t.dark ? '#333' : '#f0e7d1' }}>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6 }]}>YEAR</Text>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6, textAlign: 'right' }]}>TOTAL</Text>
            <Text style={[{ flex: 1, fontSize: 9, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6, textAlign: 'right' }]}>Δ</Text>
          </View>
          {cumulativeRows.map((r) => (
            <View key={r.year} style={{ flexDirection: 'row', paddingVertical: 4 }}>
              <Text style={[{ flex: 1, fontSize: 10 }, t.textInk]}>Year {r.year}</Text>
              <Text style={[{ flex: 1, fontSize: 10, fontWeight: '700', textAlign: 'right' }, t.textInk]}>{financialsReady ? MONEY(r.value) : '••••••'}</Text>
              <Text style={[{ flex: 1, fontSize: 10, textAlign: 'right' }, { color: r.delta >= 0 ? '#4c8b56' : '#b0453d' }]}>
                {financialsReady ? `${r.delta >= 0 ? '+' : ''}${MONEY(r.delta)}` : '••••'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* WHAT WE'RE PROJECTING FROM — content differs by mode per spec #22 / #23. */}
      <View style={[s.assumptionsCard, t.cardBg]}>
        <Text style={[{ fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }, t.textInk]}>WHAT WE&apos;RE PROJECTING FROM</Text>
        <View style={{ marginTop: 8, gap: 6 }}>
          {isBuild ? (
            <>
              <Row label="Cash (from Wealth)" value={MONEY(buildStartingCash)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Current Investments (held flat)" value={MONEY(investmentTotal)} muted={t.textMuted} ink={t.textInk} />
              {/* This month's budget net — the same figure as the Budget
                  module for the current month. Kept as-is so users can
                  reconcile it 1:1 with the Budget page. */}
              <Pressable onPress={() => setShowSurplusBreakdown(true)} hitSlop={4} testID="legacy-surplus-drill">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[{ fontSize: 11, fontWeight: '600', color: '#9a6d32' }, t.textInk]}>This Month&apos;s Budget Cash Flow</Text>
                    <Ionicons name="information-circle-outline" size={12} color="#9a6d32" />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: rawMonthlyNet < 0 ? '#b0453d' : '#9a6d32' }}>
                    {MONEY(rawMonthlyNet)}
                  </Text>
                </View>
                <Text style={[{ fontSize: 8, marginTop: 2 }, t.textMuted]}>Same as the Budget page for {monthlyBudgetPeriod || 'this month'} — tap for breakdown</Text>
              </Pressable>
              {/* Run rate — the projected monthly cash flow BUILD uses for
                  unbudgeted future months. Differs from "this month" when
                  the user has entered per-month overrides for multiple
                  months. This is the number the user can multiply by 12
                  to reconcile Y1 against the chart. */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTopWidth: 1, borderTopColor: t.dark ? '#332e26' : '#efe6d0' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>Projected Monthly Budget Cash Flow</Text>
                  <Text style={[{ fontSize: 8, marginTop: 2 }, t.textMuted]}>
                    {buildBreakdown.allBudgetMonths.length === 0
                      ? 'Finalize a monthly budget to start projecting BUILD.'
                      : buildBreakdown.allBudgetMonths.length === 1
                        ? `From ${buildBreakdown.allBudgetMonths[0].label}`
                        : `Average of ${buildBreakdown.runRateSlice.length} finalized budget month${buildBreakdown.runRateSlice.length === 1 ? '' : 's'} — see math below`}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: buildBreakdown.runRate < 0 ? '#b0453d' : '#9a6d32' }}>
                  {buildBreakdown.runRate >= 0 ? '+' : '−'}{MONEY(Math.abs(Math.round(buildBreakdown.runRate)))}
                </Text>
              </View>
              {rawMonthlyNet < 0 && (
                <Text style={{ fontSize: 9, color: '#b0453d', marginTop: 2 }}>
                  Your Budget is currently net-negative — BUILD reflects this.
                </Text>
              )}
            </>
          ) : (
            <>
              <Row label="Current Investments" value={MONEY(investmentTotal)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Monthly Contribution" value={MONEY(contribution)} muted={t.textMuted} ink={t.textInk} />
              <Row label="Assumed Return" value={`${Math.round(RATE * 100)}%`} muted={t.textMuted} ink={t.textInk} />
            </>
          )}
          {hypoValue > 0 && (
            <Row label={`+ Hypothetical (${hypoFreq === 'onetime' ? 'one-time' : hypoFreq === 'monthly' ? 'monthly' : 'annual'}${hypoDur ? ` × ${hypoDur}yr` : ''})`} value={MONEY(hypoValue)} muted={t.textMuted} ink={t.textInk} valueColor="#c9a56c" labelColor="#c9a56c" />
          )}
        </View>
      </View>

      {/* Monthly contribution — only GROW modes (spec #23 / #26). */}
      {!isBuild && (
        <View style={[s.assumptionsCard, t.cardBg]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Monthly Contribution</Text><Text style={[{ fontSize: 8, color: '#999289' }, t.textMuted]}>Extra amount you plan to invest each month</Text></View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32' }}>{MONEY(contribution)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable onPress={() => setContribution(Math.max(0, contribution - 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-minus"><Text style={t.textInk}>−</Text></Pressable>
            <Pressable onPress={() => setContribution(Math.min(10000, contribution + 250))} style={[s.stepBtn, t.dark && { backgroundColor: D.surfaceAlt }]} testID="contrib-plus"><Text style={t.textInk}>+</Text></Pressable>
          </View>
        </View>
      )}

      {/* Hypothetical amount — clearly labeled as modeling only (spec #25). */}
      <Pressable onPress={() => { setHypoDraft(hypothetical || ''); setHypoFreqDraft(hypoFreq); setHypoDurDraft(hypoDur ? String(hypoDur) : ''); setEditingHypo(true); }} style={[s.assumptionsCard, t.cardBg]} testID="legacy-hypo-open">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Hypothetical Amount</Text>
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: '#c4945020' }}>
                <Text style={{ fontSize: 7, fontWeight: '800', letterSpacing: 0.6, color: '#c49450' }}>MODELED</Text>
              </View>
            </View>
            <Text style={[{ fontSize: 9, marginTop: 2 }, t.textMuted]}>
              For what-if modeling only. Never changes your actual Wealth, Budget, or account balances.
            </Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#9a6d32', marginLeft: 12 }}>{hypoDesc}</Text>
        </View>
      </Pressable>

      <Sheet visible={editingHypo} close={() => { setEditingHypo(false); setHypoDraft(''); setHypoDurDraft(''); }} title="Add hypothetical amount" subtitle="Model a what-if. Choose one-time, monthly, or annual — with an optional duration.">
        <View>
          <Text style={s.label}>Frequency</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
            {(['onetime', 'monthly', 'annual'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setHypoFreqDraft(f)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  alignItems: 'center',
                  borderColor: hypoFreqDraft === f ? '#c49450' : (t.dark ? D.border : '#ece5d5'),
                  backgroundColor: hypoFreqDraft === f ? '#c4945018' : 'transparent',
                }}
                testID={`legacy-hypo-freq-${f}`}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: hypoFreqDraft === f ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>
                  {f === 'onetime' ? 'One-time' : f === 'monthly' ? 'Monthly' : 'Annual'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.label}>{hypoFreqDraft === 'onetime' ? 'One-time amount' : hypoFreqDraft === 'monthly' ? 'Amount per month' : 'Amount per year'}</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={hypoDraft} onChangeText={setHypoDraft} keyboardType="numeric" placeholder="0" autoFocus testID="legacy-hypo-amount" />
          </View>
          {hypoFreqDraft !== 'onetime' && (
            <>
              <Text style={[s.label, { marginTop: 12 }]}>Duration in years (optional)</Text>
              <TextInput
                style={s.input}
                value={hypoDurDraft}
                onChangeText={(v) => setHypoDurDraft(v.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="Leave blank to apply for the full projection horizon"
                placeholderTextColor={t.dark ? D.textMuted : C.muted}
                testID="legacy-hypo-duration"
              />
              <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
                Blank = ongoing (applies for the entire 1/5/10/20/30yr horizon). Set a number to model a bounded item like a car loan or bonus period.
              </Text>
            </>
          )}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={hypoValue > 0 && Number(hypoDraft.replace(/[^0-9.]/g, '') || 0) === 0 ? 'Remove hypothetical' : 'Save'} onPress={commitHypo} testID="legacy-hypo-save" />
          </View>
        </View>
      </Sheet>

      {/* Return rate sheet — tap the RETURN chip to edit. Clamped 0.1-30%. */}
      <Sheet visible={editingRate} close={() => setEditingRate(false)} title="Expected annual return" subtitle="This is the compounding rate applied to your invested portion. 7% is a common long-term U.S. stock market assumption.">
        <View>
          <Text style={s.label}>Return %</Text>
          <TextInput
            style={s.input}
            value={rateDraft}
            onChangeText={(v) => setRateDraft(v.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
            placeholder="7"
            autoFocus
            testID="legacy-rate-input"
          />
          <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
            Reasonable values: 3-4% conservative (bonds/CDs), 6-8% balanced, 9-10% aggressive equities. Past performance is not a guarantee.
          </Text>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Save" onPress={commitRate} testID="legacy-rate-save" />
          </View>
          <Pressable onPress={() => { setRateDraft(String(DEFAULT_LEGACY_RATE)); }} style={{ marginTop: 10, alignItems: 'center' }}>
            <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700' }}>Reset to {DEFAULT_LEGACY_RATE}%</Text>
          </Pressable>
        </View>
      </Sheet>
      {/* Monthly Contribution editor (spec #3) — direct-typed dollar entry. */}
      <Sheet
        visible={editingContrib}
        close={() => { setEditingContrib(false); setContribDraft(''); }}
        title="Monthly Contribution"
        subtitle="Type the exact dollar amount you plan to contribute each month."
      >
        <View>
          <Text style={s.label}>Amount / month</Text>
          <View style={s.amountInput}>
            <Text style={[s.amountPrefix, t.textInk]}>$</Text>
            <TextInput
              style={[s.input, { paddingLeft: 26 }]}
              value={contribDraft}
              onChangeText={(v) => setContribDraft(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1'))}
              keyboardType="decimal-pad"
              placeholder="0"
              autoFocus
              testID="legacy-contrib-input"
            />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Save" onPress={commitContribution} testID="legacy-contrib-save" />
          </View>
        </View>
      </Sheet>

      {/* Monthly Budget Net drill-down — read-only breakdown so users can
          verify the projection input. Shows Budgeted Income − Budgeted Expenses
          = Monthly Budget Net (signed). Renamed from "Surplus" per spec #5
          since negative values are valid and BUILD reflects them. */}
      <Sheet
        visible={showSurplusBreakdown}
        close={() => setShowSurplusBreakdown(false)}
        title="Monthly Budget Net"
        subtitle={`Based on ${monthlyBudgetPeriod || 'your current Budget'}`}
      >
        <View>
          <View style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={[{ fontSize: 12 }, t.textInk]}>Budgeted Monthly Income</Text>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{MONEY(monthlyBudgetIncome || 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.dark ? '#3a342b' : '#efe6d0' }}>
              <Text style={[{ fontSize: 12 }, t.textInk]}>− Budgeted Monthly Expenses</Text>
              <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{MONEY(monthlyBudgetExpense || 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.dark ? '#3a342b' : '#efe6d0' }}>
              <Text style={[{ fontSize: 12, fontWeight: '800' }, t.textInk]}>= Monthly Budget Net</Text>
              <Text style={{ fontSize: 14, fontWeight: '800', color: rawMonthlyNet < 0 ? '#b0453d' : '#9a6d32' }}>
                {MONEY(rawMonthlyNet)}
              </Text>
            </View>
          </View>
          {rawMonthlyNet < 0 && (
            <View style={{ marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#b0453d' }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#b0453d' }}>Net-negative Budget</Text>
              <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d806e', marginTop: 4, lineHeight: 14 }}>
                Your Budget currently plans to spend more than it earns. BUILD projections reflect this — Available Cash decreases each month by the net deficit. Increase Earn or trim category budgets to turn this positive.
              </Text>
            </View>
          )}
          <Text style={[{ fontSize: 9, marginTop: 12, textAlign: 'center' }, t.textMuted]}>
            This is view-only. Edit your budget in the Budget tab to change these numbers.
          </Text>
        </View>
      </Sheet>

      {/* Legal / financial disclaimer required at the bottom of Legacy so
          users understand these numbers are educational estimates, not a
          guarantee. Kept concise + subtle to match the luxury feel. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={12} color={t.dark ? D.textMuted : '#8b8478'} style={{ marginTop: 1 }} />
          <Text style={[{ fontSize: 9, lineHeight: 14, flex: 1 }, t.textMuted]}>
            Projections are estimates for planning only. Actual returns will vary and are not guaranteed. Jaleter does not provide investment, tax, or legal advice — consult a licensed professional for personalized guidance.
          </Text>
        </View>
      </View>
    </KeyboardAwareScrollView>
  );
};

// Small reusable row for the "WHAT WE'RE PROJECTING FROM" card.
const Row = ({ label, value, ink, muted, valueColor, labelColor }: any) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
    <Text style={[{ fontSize: 10 }, muted, labelColor && { color: labelColor }]}>{label}</Text>
    <Text style={[{ fontSize: 10, fontWeight: '700' }, ink, valueColor && { color: valueColor }]}>{value}</Text>
  </View>
);
