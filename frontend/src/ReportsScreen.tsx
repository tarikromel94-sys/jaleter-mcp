/**
 * Reports Screen — Income & Expense analytics.
 *
 * Uses only real user data (transactions + categories). All charts are
 * hand-rolled with `react-native-svg` — no extra chart dependencies.
 *
 * Breakdowns:
 *  - Income vs Expense pie (last N months window)
 *  - Category share pie (expenses only)
 *  - Subcategory horizontal bars (top 10 subcategories by spend)
 *  - Monthly trend bar chart (income vs expense per month)
 *  - Top merchants / sources list (top 10 by count + total)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import { C } from '@/src/jaleterTheme';
import { MONEY } from '@/src/quoteLibrary';

type Transaction = {
  id?: string;
  date: string; // 'YYYY-MM-DD' or full ISO
  amount: number; // positive = income, negative = expense in this app's convention
  category?: string;
  subcategory?: string;
  name?: string;
  merchant?: string;
  origin?: string; // 'Manual', 'Chase', etc.
};

type Category = {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
};

const PIE_COLORS = ['#b28a4c', '#3d6ea0', '#4c8b56', '#c48a2b', '#8a4c8f', '#a4522e', '#5b7d8a', '#b06565', '#8a7f3a', '#6e5a8f'];
const WINDOWS: { label: string; months: number }[] = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
  { label: 'YTD', months: -1 },
  { label: 'All', months: -2 },
  { label: 'Custom', months: -3 },
];

const INITIAL_LIST_SIZE = 10;

function parseDate(v: string): Date {
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  const parts = v.split('-');
  if (parts.length >= 3) return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Date();
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y} Z`;
}

function Pie({ data, size = 180 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  if (total <= 0) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="#f2ead6" />
        <SvgText x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#8a7f70">No data</SvgText>
      </Svg>
    );
  }
  let acc = 0;
  return (
    <Svg width={size} height={size}>
      <G>
        {data.map((d, i) => {
          const start = (acc / total) * 360;
          acc += d.value;
          const end = (acc / total) * 360;
          const path = end - start >= 359.99 ? '' : arcPath(cx, cy, r, start, end);
          if (!path) {
            return <Circle key={i} cx={cx} cy={cy} r={r} fill={d.color} />;
          }
          return <Path key={i} d={path} fill={d.color} />;
        })}
        <Circle cx={cx} cy={cy} r={r * 0.45} fill="#ffffff" />
        <SvgText x={cx} y={cy - 2} textAnchor="middle" fontSize={10} fill="#8a7f70" fontWeight="700">TOTAL</SvgText>
        <SvgText x={cx} y={cy + 12} textAnchor="middle" fontSize={12} fill={C.ink} fontWeight="800">{shortMoney(total)}</SvgText>
      </G>
    </Svg>
  );
}

function shortMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(v / 100) / 10}k`;
  return `$${Math.round(v).toLocaleString()}`;
}

function Legend({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      {data.map((d, i) => (
        <View key={i} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: d.color }]} />
          <Text style={styles.legendLabel} numberOfLines={1}>{d.label}</Text>
          <Text style={styles.legendValue}>{MONEY(d.value)}</Text>
          <Text style={styles.legendPct}>{Math.round((d.value / total) * 100)}%</Text>
        </View>
      ))}
    </View>
  );
}

function HorizontalBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {data.map((d, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.barLabel} numberOfLines={1}>{d.label}</Text>
            <Text style={styles.barValue}>{MONEY(d.value)}</Text>
          </View>
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${Math.max(3, (d.value / max) * 100)}%` }]} />
          </View>
        </View>
      ))}
      {data.length === 0 ? <Text style={styles.empty}>No data.</Text> : null}
    </View>
  );
}

function MonthlyChart({ data, height = 130 }: { data: { key: string; income: number; expense: number }[]; height?: number }) {
  const width = 320;
  const pad = { l: 32, r: 8, t: 8, b: 26 };
  const inner = { w: width - pad.l - pad.r, h: height - pad.t - pad.b };
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const barW = data.length > 0 ? Math.max(4, (inner.w / data.length) * 0.35) : 6;
  return (
    <Svg width={width} height={height}>
      {/* baseline */}
      <Path d={`M ${pad.l} ${pad.t + inner.h} L ${pad.l + inner.w} ${pad.t + inner.h}`} stroke="#e5decf" />
      {data.map((d, i) => {
        const slot = inner.w / Math.max(1, data.length);
        const x = pad.l + i * slot + slot / 2;
        const incH = (d.income / max) * inner.h;
        const expH = (d.expense / max) * inner.h;
        return (
          <G key={d.key}>
            <Rect x={x - barW - 1} y={pad.t + inner.h - incH} width={barW} height={incH} fill="#4c8b56" rx={2} />
            <Rect x={x + 1} y={pad.t + inner.h - expH} width={barW} height={expH} fill="#b0453d" rx={2} />
            <SvgText x={x} y={height - 8} textAnchor="middle" fontSize={8} fill="#8a7f70">{monthLabel(d.key).slice(0, 3)}</SvgText>
          </G>
        );
      })}
      {/* y axis label */}
      <SvgText x={4} y={pad.t + 8} fontSize={8} fill="#8a7f70">{shortMoney(max)}</SvgText>
      <SvgText x={4} y={pad.t + inner.h + 2} fontSize={8} fill="#8a7f70">$0</SvgText>
    </Svg>
  );
}

export function ReportsScreen({ transactions, categories, incomeSources = [], back }: { transactions: Transaction[]; categories: Category[]; incomeSources?: { id: string; name: string }[]; back: () => void }) {
  const [windowIdx, setWindowIdx] = useState(2); // default 6M
  // Custom date range (YYYY-MM-DD) — used when the selected window is 'Custom'.
  // `today` is stable across renders so useMemo dependencies stay clean.
  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => new Date(today.getFullYear(), today.getMonth() - 3, 1), [today]);
  const [customStart, setCustomStart] = useState<Date>(defaultStart);
  const [customEnd, setCustomEnd] = useState<Date>(today);
  const [customOpen, setCustomOpen] = useState(false);
  // Native pickers control (iOS/Android modal, invisible on web where we use text inputs).
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);
  // Pagination: how many rows to show for merchants + subcategories lists.
  const [merchantsShown, setMerchantsShown] = useState<number>(INITIAL_LIST_SIZE);
  const [subcatsShown, setSubcatsShown] = useState<number>(INITIAL_LIST_SIZE);

  const filtered = useMemo(() => {
    const w = WINDOWS[windowIdx];
    let start: Date;
    let end: Date | null = null;
    if (w.months === -3) {
      // Custom range — clamp end to end-of-day so txns on the last day are included.
      start = new Date(customStart);
      start.setHours(0, 0, 0, 0);
      end = new Date(customEnd);
      end.setHours(23, 59, 59, 999);
    } else if (w.months === -1) {
      start = new Date(today.getFullYear(), 0, 1);
    } else if (w.months === -2) {
      start = new Date(1970, 0, 1);
    } else {
      start = new Date(today.getFullYear(), today.getMonth() - w.months + 1, 1);
    }
    return (transactions || []).filter((t) => {
      const d = parseDate(t.date);
      if (d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [transactions, windowIdx, customStart, customEnd, today]);

  // Reset pagination whenever the window/range changes.
  React.useEffect(() => {
    setMerchantsShown(INITIAL_LIST_SIZE);
    setSubcatsShown(INITIAL_LIST_SIZE);
  }, [windowIdx, customStart, customEnd]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    filtered.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (amt >= 0) income += amt;
      else expense += -amt;
    });
    return { income, expense, net: income - expense };
  }, [filtered]);

  const categoryPie = useMemo(() => {
    const catMap = new Map<string, number>();
    const catNames = new Map<string, string>();
    (categories || []).forEach((c) => {
      c.subcategories.forEach((s) => catNames.set(s.id, c.name));
    });
    filtered.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (amt >= 0) return; // expenses only
      const catKey = t.category || catNames.get(t.subcategory || '') || 'Uncategorized';
      catMap.set(catKey, (catMap.get(catKey) || 0) + -amt);
    });
    return Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  }, [filtered, categories]);

  // Income sources — mirrors the category pie for expenses, but on the income
  // side. Uses `incomeSources` to resolve source ids → readable names when
  // transactions carry a `subcategory` that matches an income source id;
  // otherwise falls back to merchant/name/origin so unclassified income is
  // still attributed.
  const incomePie = useMemo(() => {
    const srcNames = new Map<string, string>();
    (incomeSources || []).forEach((src) => srcNames.set(src.id, src.name));
    const map = new Map<string, number>();
    filtered.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (amt <= 0) return; // income only
      const key =
        srcNames.get(t.subcategory || '') ||
        (t.merchant || t.name || t.origin || 'Other income').trim() ||
        'Other income';
      map.set(key, (map.get(key) || 0) + amt);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  }, [filtered, incomeSources]);

  const subcategoryBars = useMemo(() => {
    const subMap = new Map<string, number>();
    const subNames = new Map<string, string>();
    (categories || []).forEach((c) => c.subcategories.forEach((s) => subNames.set(s.id, s.name)));
    filtered.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (amt >= 0) return;
      const key = t.subcategory ? (subNames.get(t.subcategory) || t.subcategory) : (t.name || 'Uncategorized');
      subMap.set(key, (subMap.get(key) || 0) + -amt);
    });
    return Array.from(subMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
  }, [filtered, categories]);

  const monthly = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    filtered.forEach((t) => {
      const key = monthKey(parseDate(t.date));
      const bucket = map.get(key) || { income: 0, expense: 0 };
      const amt = Number(t.amount) || 0;
      if (amt >= 0) bucket.income += amt; else bucket.expense += -amt;
      map.set(key, bucket);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([key, v]) => ({ key, ...v }));
  }, [filtered]);

  const merchants = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    filtered.forEach((t) => {
      const amt = Number(t.amount) || 0;
      if (amt >= 0) return;
      const key = (t.merchant || t.name || t.origin || 'Unknown').trim() || 'Unknown';
      const b = map.get(key) || { count: 0, total: 0 };
      b.count += 1; b.total += -amt;
      map.set(key, b);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, v]) => ({ name, count: v.count, total: v.total }));
  }, [filtered]);

  const incomeVsExpense = [
    { label: 'Income', value: totals.income, color: '#4c8b56' },
    { label: 'Expense', value: totals.expense, color: '#b0453d' },
  ];

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 130 }}>
      <View style={styles.header}>
        <Pressable onPress={back} testID="reports-back" style={styles.headerBack}>
          <Ionicons name="chevron-back" size={20} color={C.ink} />
        </Pressable>
        <View>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.subtitle}>Income and expense breakdowns — from your real transactions.</Text>
        </View>
      </View>

      {/* window picker */}
      <View style={styles.periodPills}>
        {WINDOWS.map((w, i) => (
          <Pressable
            key={w.label}
            onPress={() => { setWindowIdx(i); if (w.months === -3) setCustomOpen(true); }}
            style={[styles.pill, windowIdx === i && styles.pillActive]}
            testID={`reports-window-${w.label}`}
          >
            <Text style={[styles.pillText, windowIdx === i && styles.pillTextActive]}>{w.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Custom date range summary + edit affordance */}
      {WINDOWS[windowIdx].months === -3 ? (
        <Pressable onPress={() => setCustomOpen(true)} style={styles.customBanner} testID="reports-custom-banner">
          <Ionicons name="calendar-outline" size={16} color={C.goldEyebrow} />
          <Text style={styles.customBannerText}>
            {customStart.toLocaleDateString()} — {customEnd.toLocaleDateString()}
          </Text>
          <Ionicons name="pencil" size={12} color={C.goldEyebrow} />
        </Pressable>
      ) : null}

      {/* summary tiles */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>INCOME</Text>
          <Text style={[styles.summaryValue, { color: '#4c8b56' }]}>{MONEY(totals.income)}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>EXPENSE</Text>
          <Text style={[styles.summaryValue, { color: '#b0453d' }]}>{MONEY(totals.expense)}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>NET</Text>
          <Text style={[styles.summaryValue, { color: totals.net >= 0 ? '#4c8b56' : '#b0453d' }]}>{MONEY(totals.net)}</Text>
        </View>
      </View>

      {/* income vs expense pie */}
      <Section title="Income vs Expense">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pie data={incomeVsExpense} />
          <View style={{ flex: 1 }}><Legend data={incomeVsExpense} /></View>
        </View>
      </Section>

      {/* income sources — where the money came from (by source / merchant) */}
      <Section title="Where the money came from (by source)">
        {incomePie.length === 0 ? <Text style={styles.empty}>No income in this range.</Text> : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pie data={incomePie} />
            <View style={{ flex: 1 }}><Legend data={incomePie} /></View>
          </View>
        )}
      </Section>

      {/* category pie */}
      <Section title="Where the money went (by category)">
        {categoryPie.length === 0 ? <Text style={styles.empty}>No expenses in this range.</Text> : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pie data={categoryPie} />
            <View style={{ flex: 1 }}><Legend data={categoryPie} /></View>
          </View>
        )}
      </Section>

      {/* subcategory bars */}
      <Section title="Top subcategories">
        <HorizontalBars data={subcategoryBars.slice(0, subcatsShown)} />
        {subcategoryBars.length > subcatsShown ? (
          <Pressable onPress={() => setSubcatsShown((n) => n + INITIAL_LIST_SIZE)} style={styles.loadMoreBtn} testID="reports-more-subcats">
            <Text style={styles.loadMoreText}>Show more ({subcategoryBars.length - subcatsShown} left)</Text>
          </Pressable>
        ) : null}
      </Section>

      {/* monthly trend */}
      <Section title="Monthly trend (income vs expense)">
        {monthly.length === 0 ? <Text style={styles.empty}>No transactions in this range.</Text> : (
          <>
            <MonthlyChart data={monthly} />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <View style={styles.legendRowInline}><View style={[styles.legendDot, { backgroundColor: '#4c8b56' }]} /><Text style={styles.legendLabel}>Income</Text></View>
              <View style={styles.legendRowInline}><View style={[styles.legendDot, { backgroundColor: '#b0453d' }]} /><Text style={styles.legendLabel}>Expense</Text></View>
            </View>
          </>
        )}
      </Section>

      {/* merchants */}
      <Section title="Top merchants / sources">
        {merchants.length === 0 ? <Text style={styles.empty}>No expenses to analyze.</Text> : (
          <View style={{ gap: 6 }}>
            {merchants.slice(0, merchantsShown).map((m, i) => (
              <View key={i} style={styles.merchantRow}>
                <View style={styles.merchantIcon}><Text style={{ fontSize: 10, fontWeight: '800', color: C.goldEyebrow }}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.merchantName} numberOfLines={1}>{m.name}</Text>
                  <Text style={styles.merchantMeta}>{m.count} transaction{m.count === 1 ? '' : 's'}</Text>
                </View>
                <Text style={styles.merchantValue}>{MONEY(m.total)}</Text>
              </View>
            ))}
            {merchants.length > merchantsShown ? (
              <Pressable onPress={() => setMerchantsShown((n) => n + INITIAL_LIST_SIZE)} style={styles.loadMoreBtn} testID="reports-more-merchants">
                <Text style={styles.loadMoreText}>Show more ({merchants.length - merchantsShown} left)</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </Section>

      {/* Custom date range picker modal */}
      <CustomRangeModal
        visible={customOpen}
        start={customStart}
        end={customEnd}
        onCancel={() => setCustomOpen(false)}
        onApply={(s, e) => { setCustomStart(s); setCustomEnd(e); setCustomOpen(false); }}
        pickerFor={pickerFor}
        setPickerFor={setPickerFor}
      />
    </ScrollView>
  );
}

function CustomRangeModal({
  visible, start, end, onCancel, onApply, pickerFor, setPickerFor,
}: {
  visible: boolean; start: Date; end: Date;
  onCancel: () => void; onApply: (s: Date, e: Date) => void;
  pickerFor: 'start' | 'end' | null; setPickerFor: (v: 'start' | 'end' | null) => void;
}) {
  const [localStart, setLocalStart] = useState<Date>(start);
  const [localEnd, setLocalEnd] = useState<Date>(end);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (visible) { setLocalStart(start); setLocalEnd(end); setError(''); }
  }, [visible, start, end]);

  const apply = () => {
    if (localStart > localEnd) { setError('Start date must be on or before end date.'); return; }
    onApply(localStart, localEnd);
  };

  // On web the native picker is unavailable — use plain YYYY-MM-DD text inputs.
  const [startText, setStartText] = useState(fmtISO(localStart));
  const [endText, setEndText] = useState(fmtISO(localEnd));
  React.useEffect(() => { setStartText(fmtISO(localStart)); setEndText(fmtISO(localEnd)); }, [localStart, localEnd]);

  const commitTextStart = () => {
    const d = new Date(startText);
    if (!isNaN(d.getTime())) setLocalStart(d);
  };
  const commitTextEnd = () => {
    const d = new Date(endText);
    if (!isNaN(d.getTime())) setLocalEnd(d);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Custom date range</Text>

          <Text style={styles.formLabel}>From</Text>
          {Platform.OS === 'web' ? (
            <TextInput
              testID="reports-custom-start"
              value={startText}
              onChangeText={setStartText}
              onBlur={commitTextStart}
              placeholder="YYYY-MM-DD"
              style={styles.input}
            />
          ) : (
            <Pressable onPress={() => setPickerFor('start')} style={styles.input} testID="reports-custom-start">
              <Text style={{ fontSize: 12, color: C.ink }}>{localStart.toLocaleDateString()}</Text>
            </Pressable>
          )}

          <Text style={styles.formLabel}>To</Text>
          {Platform.OS === 'web' ? (
            <TextInput
              testID="reports-custom-end"
              value={endText}
              onChangeText={setEndText}
              onBlur={commitTextEnd}
              placeholder="YYYY-MM-DD"
              style={styles.input}
            />
          ) : (
            <Pressable onPress={() => setPickerFor('end')} style={styles.input} testID="reports-custom-end">
              <Text style={{ fontSize: 12, color: C.ink }}>{localEnd.toLocaleDateString()}</Text>
            </Pressable>
          )}

          {pickerFor && Platform.OS !== 'web' ? (
            <DateTimePicker
              value={pickerFor === 'start' ? localStart : localEnd}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_evt, date) => {
                setPickerFor(null);
                if (date) {
                  if (pickerFor === 'start') setLocalStart(date);
                  else setLocalEnd(date);
                }
              }}
              maximumDate={new Date(2100, 0, 1)}
            />
          ) : null}

          {error ? <Text style={styles.modalError}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Pressable testID="reports-custom-cancel" onPress={onCancel} style={[styles.modalBtnSecondary, { flex: 1 }]}>
              <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable testID="reports-custom-apply" onPress={apply} style={[styles.modalBtnPrimary, { flex: 1 }]}>
              <Text style={styles.modalBtnPrimaryText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f1e4', padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  headerBack: { padding: 6, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5decf' },
  title: { fontSize: 22, fontWeight: '700', color: C.ink },
  subtitle: { fontSize: 10, color: '#8a7f70' },

  periodPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  pillText: { fontSize: 10, fontWeight: '700', color: '#615b52' },
  pillTextActive: { color: '#fff' },

  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  summaryTile: {
    flex: 1, padding: 10, borderRadius: 12,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#efe6d3',
  },
  summaryLabel: { fontSize: 8, letterSpacing: 1.2, color: '#8a7f70', fontWeight: '700' },
  summaryValue: { fontSize: 14, fontWeight: '800', marginTop: 4 },

  section: {
    padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#efe6d3',
    backgroundColor: '#fff', marginBottom: 12,
  },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, color: '#8a7f70', marginBottom: 8, textTransform: 'uppercase' },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendRowInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1, fontSize: 10, color: C.ink },
  legendValue: { fontSize: 10, fontWeight: '700', color: C.ink },
  legendPct: { fontSize: 9, color: '#8a7f70', width: 32, textAlign: 'right' },

  barLabel: { flex: 1, fontSize: 10, color: C.ink, fontWeight: '600' },
  barValue: { fontSize: 10, color: '#8a7f70', fontWeight: '700' },
  barBg: { height: 6, borderRadius: 3, backgroundColor: '#f2ead6', marginTop: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: '#b28a4c' },

  merchantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 8, borderRadius: 10, backgroundColor: '#fbf6ec',
  },
  merchantIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#f2e6c9', alignItems: 'center', justifyContent: 'center' },
  merchantName: { fontSize: 11, fontWeight: '700', color: C.ink },
  merchantMeta: { fontSize: 9, color: '#8a7f70', marginTop: 2 },
  merchantValue: { fontSize: 11, fontWeight: '800', color: '#b0453d' },

  empty: { fontSize: 10, color: '#8a7f70', textAlign: 'center', paddingVertical: 6 },

  /* Pagination + custom-date-range additions */
  loadMoreBtn: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5decf',
    backgroundColor: '#fbf6ec',
    alignItems: 'center',
  },
  loadMoreText: { fontSize: 10, color: '#b28a4c', fontWeight: '700' },

  customBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#e8dcc4', backgroundColor: '#fbf6ec',
    marginBottom: 12,
  },
  customBannerText: { flex: 1, fontSize: 11, fontWeight: '700', color: C.ink },

  modalBackdrop: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', padding: 24 },
  modalSheet: { backgroundColor: '#fff', borderRadius: 18, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: C.ink, marginBottom: 8 },
  formLabel: { fontSize: 10, fontWeight: '700', color: '#615b52', letterSpacing: 0.5, marginTop: 6, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#e5decf', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 12, color: C.ink, backgroundColor: '#fff',
    justifyContent: 'center',
  },
  modalError: { fontSize: 10, color: '#b0453d', marginTop: 6 },
  modalBtnPrimary: { backgroundColor: '#b28a4c', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  modalBtnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  modalBtnSecondary: { backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#e8dcc4', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  modalBtnSecondaryText: { color: '#8a7f70', fontSize: 12, fontWeight: '700' },
});
