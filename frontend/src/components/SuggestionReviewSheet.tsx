import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, ActivityIndicator } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C, D } from '@/src/jaleterTheme';
import { EXACT } from '@/src/quoteLibrary';
import { useThemed, Sheet, GoldButton } from '@/src/utils/appShared';

/* ---------------- Smart Categorization — Review sheet ----------------
 * Shows every suggested category with a "Review" status. Users tick the
 * rows they agree with (high-confidence rows are pre-ticked, mixed-use
 * merchants are not), change any suggestion, optionally make it an
 * "Always" rule for that merchant, and approve in bulk. New categories are
 * only PROPOSED here — created solely when the user taps "Add & assign".
 */
export type Suggestion = {
  external_id: string;
  merchant_key: string;
  label: string;
  type: 'income' | 'expense';
  group_id: string;
  detail_id?: string | null;
  category_name: string;
  confidence: number;
  source: 'rule' | 'history' | 'plaid' | 'keywords';
  reason: string;
  mixed_use: boolean;
  refund: boolean;
};
export type Proposal = {
  key: string; name: string; suggested_group_id: string; count: number; total: number;
  sample_merchants: string[]; external_ids: string[];
};
export type Approval = { external_id: string; type: 'income' | 'expense'; group_id: string; detail_id?: string | null; category_name: string; merchant_key: string; always: boolean };

type Props = {
  visible: boolean;
  close: () => void;
  loading: boolean;
  suggestions: Suggestion[];
  proposals: Proposal[];
  txById: Record<string, any>;
  categories: any[];
  incomeSources: any[];
  onApprove: (items: Approval[]) => void;
  onAddCategoryAndAssign: (proposal: Proposal, groupId: string) => void;
};

const confidenceLabel = (c: number) => (c >= 0.9 ? 'Very likely' : c >= 0.7 ? 'Likely' : 'Review');

export const SuggestionReviewSheet = ({ visible, close, loading, suggestions, proposals, txById, categories, incomeSources, onApprove, onAddCategoryAndAssign }: Props) => {
  const t = useThemed();
  const [overrides, setOverrides] = useState<Record<string, { type: 'income' | 'expense'; group_id: string; detail_id?: string | null; category_name: string }>>({});
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  const [checkedLow, setCheckedLow] = useState<Record<string, boolean>>({});
  const [always, setAlways] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [proposalGroup, setProposalGroup] = useState<Record<string, string>>({});

  const effective = (sg: Suggestion) => overrides[sg.external_id] || { type: sg.type, group_id: sg.group_id, detail_id: sg.detail_id, category_name: sg.category_name };
  const isChecked = (sg: Suggestion) => {
    if (unchecked[sg.external_id]) return false;
    if (sg.confidence >= 0.7 && !sg.mixed_use) return true;
    return !!checkedLow[sg.external_id] || !!overrides[sg.external_id];
  };
  const toggle = (sg: Suggestion) => {
    if (isChecked(sg)) {
      setUnchecked((u) => ({ ...u, [sg.external_id]: true }));
      setCheckedLow((u) => ({ ...u, [sg.external_id]: false }));
    } else {
      setUnchecked((u) => ({ ...u, [sg.external_id]: false }));
      setCheckedLow((u) => ({ ...u, [sg.external_id]: true }));
    }
  };
  const selected = useMemo(() => suggestions.filter(isChecked), [suggestions, unchecked, checkedLow, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectAll = (on: boolean) => {
    const u: Record<string, boolean> = {}; const l: Record<string, boolean> = {};
    for (const sg of suggestions) { u[sg.external_id] = !on; l[sg.external_id] = on; }
    setUnchecked(u); setCheckedLow(l);
  };

  const approve = () => {
    const items: Approval[] = selected.map((sg) => {
      const e = effective(sg);
      return { external_id: sg.external_id, type: e.type, group_id: e.group_id, detail_id: e.detail_id, category_name: e.category_name, merchant_key: sg.merchant_key, always: !!always[sg.external_id] };
    });
    onApprove(items);
  };

  const pickerTarget = picking ? suggestions.find((x) => x.external_id === picking) : null;
  const sub = (fs: number) => ({ fontSize: fs, color: t.dark ? D.textMuted : '#6f685c' });

  return (
    <>
      <Sheet visible={visible} close={close} title="Review suggested categories" subtitle="Approve what looks right. Nothing changes your budget until you approve it.">
        {loading ? (
          <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator color="#c49450" /><Text style={[{ marginTop: 8 }, sub(11)]}>Looking at merchants and Plaid categories…</Text></View>
        ) : suggestions.length === 0 && proposals.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Ionicons name="checkmark-done-circle-outline" size={28} color="#4c8b56" />
            <Text style={[{ fontSize: 13, fontWeight: '700', marginTop: 8 }, t.textInk]}>You&apos;re all caught up</Text>
            <Text style={[{ marginTop: 4, textAlign: 'center', lineHeight: 16 }, sub(11)]}>New suggestions appear here as transactions sync. Transfers and card payments are left out automatically.</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
            {suggestions.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }}>SUGGESTED · {suggestions.length}</Text>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <Pressable onPress={() => selectAll(true)} hitSlop={8} testID="suggest-select-all"><Text style={{ fontSize: 11, fontWeight: '700', color: '#9a6d32' }}>Select all</Text></Pressable>
                    <Pressable onPress={() => selectAll(false)} hitSlop={8} testID="suggest-select-none"><Text style={[{ fontSize: 11, fontWeight: '700' }, sub(11)]}>None</Text></Pressable>
                  </View>
                </View>
                {suggestions.map((sg) => {
                  const tx = txById[sg.external_id];
                  const e = effective(sg);
                  const on = isChecked(sg);
                  return (
                    <View key={sg.external_id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? D.border : '#efe8d9' }} testID={`suggest-row-${sg.external_id}`}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <Pressable onPress={() => toggle(sg)} hitSlop={8} style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: on ? '#c49450' : (t.dark ? D.border : '#cfc5b2'), backgroundColor: on ? '#c49450' : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }} testID={`suggest-check-${sg.external_id}`}>
                          {on ? <Ionicons name="checkmark" size={16} color="#fffdf9" /> : null}
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                            <Text style={[{ fontSize: 12, fontWeight: '700', flex: 1 }, t.textInk]} numberOfLines={1}>{sg.label}</Text>
                            <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{sg.type === 'income' || sg.refund ? '+' : '−'}{EXACT(Math.abs(Number(tx?.amount || 0)))}</Text>
                          </View>
                          <Text style={sub(10)}>{tx?.date?.slice(0, 10)} · {tx?.origin}{sg.refund ? ' · Refund' : ''}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <Pressable onPress={() => setPicking(sg.external_id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: '#c4945018', borderWidth: 1, borderColor: '#c4945066' }} testID={`suggest-change-${sg.external_id}`}>
                              <Ionicons name="pricetag-outline" size={12} color="#9a6d32" />
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#9a6d32' }}>{e.category_name || 'Choose…'}</Text>
                              <Ionicons name="chevron-down" size={12} color="#9a6d32" />
                            </Pressable>
                            <View style={{ paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, backgroundColor: sg.mixed_use ? '#b06a5b22' : sg.confidence >= 0.9 ? '#4c8b5622' : '#8b643722' }}>
                              <Text style={{ fontSize: 9, fontWeight: '800', color: sg.mixed_use ? '#b06a5b' : sg.confidence >= 0.9 ? '#4c8b56' : '#8b6437' }}>{overrides[sg.external_id] ? 'Changed' : confidenceLabel(sg.confidence)}</Text>
                            </View>
                          </View>
                          <Text style={[{ marginTop: 4, lineHeight: 13 }, sub(9)]}>{sg.reason}</Text>
                          {sg.source !== 'rule' && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                              <Text style={[sub(10), sg.mixed_use && { color: '#b06a5b' }]}>{sg.mixed_use ? 'Mixed-use merchant — "Always" not recommended' : `Always categorize "${sg.label}" this way`}</Text>
                              <Switch value={!!always[sg.external_id]} onValueChange={(v) => setAlways((a) => ({ ...a, [sg.external_id]: v }))} trackColor={{ true: '#c49450' }} testID={`suggest-always-${sg.external_id}`} />
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {proposals.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39', marginBottom: 6 }}>NEW CATEGORY IDEAS · {proposals.length}</Text>
                <Text style={[{ marginBottom: 8, lineHeight: 14 }, sub(10)]}>Your budget has no matching category for these. Nothing is created unless you tap Add.</Text>
                {proposals.map((p) => {
                  const gid = proposalGroup[p.key] || p.suggested_group_id;
                  return (
                    <View key={p.key} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#e6dcc5', marginBottom: 8, backgroundColor: t.dark ? '#26221c' : '#fbf6ec' }} testID={`proposal-${p.key.replace(/\W/g, '')}`}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{p.name}</Text>
                        <Text style={sub(11)}>{p.count} txn{p.count > 1 ? 's' : ''} · {EXACT(p.total)}</Text>
                      </View>
                      <Text style={[{ marginTop: 2 }, sub(10)]} numberOfLines={1}>{p.sample_merchants.join(', ')}</Text>
                      <Text style={[{ marginTop: 8, fontWeight: '700' }, sub(10)]}>Add under</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {categories.map((g: any) => (
                          <Pressable key={g.id} onPress={() => setProposalGroup((pg) => ({ ...pg, [p.key]: g.id }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: gid === g.id ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: gid === g.id ? '#c4945018' : 'transparent' }} testID={`proposal-group-${p.key.replace(/\W/g, '')}-${g.id}`}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: gid === g.id ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>{g.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable onPress={() => onAddCategoryAndAssign(p, gid)} style={{ marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#c49450' }} testID={`proposal-add-${p.key.replace(/\W/g, '')}`}>
                        <Text style={{ color: '#fffdf9', fontSize: 11, fontWeight: '700' }}>{`Add "${p.name}" & assign ${p.count}`}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
        {suggestions.length > 0 && !loading && (
          <View style={{ marginTop: 12 }}>
            <GoldButton label={`Approve selected (${selected.length})`} onPress={approve} disabled={selected.length === 0} testID="suggest-approve" />
            <Text style={[{ textAlign: 'center', marginTop: 6 }, sub(9)]}>Approved categories update Budget actuals and remaining balances instantly.</Text>
          </View>
        )}
      </Sheet>

      {/* Change-category picker */}
      <Sheet visible={!!pickerTarget} close={() => setPicking(null)} title="Choose a category" subtitle={pickerTarget ? pickerTarget.label : ''}>
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39', marginBottom: 6 }}>INCOME</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {incomeSources.map((src: any) => (
              <Pressable key={src.id} onPress={() => { if (pickerTarget) { setOverrides((o) => ({ ...o, [pickerTarget.external_id]: { type: 'income', group_id: src.id, detail_id: null, category_name: src.name } })); setUnchecked((u) => ({ ...u, [pickerTarget.external_id]: false })); } setPicking(null); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#e6dcc5' }} testID={`suggest-pick-income-${src.id}`}>
                <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{src.name}</Text>
              </Pressable>
            ))}
          </View>
          {categories.map((g: any) => (
            <View key={g.id} style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39', marginBottom: 6 }}>{String(g.name || '').toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(g.subcategories || []).map((sb: any) => (
                  <Pressable key={sb.id} onPress={() => { if (pickerTarget) { setOverrides((o) => ({ ...o, [pickerTarget.external_id]: { type: 'expense', group_id: g.id, detail_id: sb.id, category_name: sb.name } })); setUnchecked((u) => ({ ...u, [pickerTarget.external_id]: false })); } setPicking(null); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#e6dcc5' }} testID={`suggest-pick-${sb.id}`}>
                    <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{sb.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
};
