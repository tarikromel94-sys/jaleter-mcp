import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Platform, Alert } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth, apiCall } from '@/src/AuthContext';
import StatementImportSheet from '@/src/StatementImportSheet';
import { SuggestionReviewSheet, type Suggestion, type Proposal, type Approval } from '@/src/components/SuggestionReviewSheet';
import { C, D } from '@/src/jaleterTheme';
import { MONEY, EXACT } from '@/src/quoteLibrary';
import { s, useThemed, CircleBtn, PeriodPills, PageHeader, Sheet, Toast as SharedToast, GoldButton } from '@/src/utils/appShared';
import {
  MONTHS, currentMonth, isSystemTransaction,
  type Tx,
} from '@/src/utils/budgetModel';

/* ---------------- Transactions ---------------- */
export const TransactionsScreen = ({ transactions, setTransactions, categories, incomeSources, openLinkSheet, alerts, onRefresh, addSubcategory }: any) => {
  const t = useThemed();
  const { token } = useAuth();

  // ---- Smart categorization (suggestions for uncategorized linked rows) ----
  // Uncategorized = linked/imported row (has external_id) with no category
  // assigned yet and not a transfer / card payment / loan payment.
  const uncategorized: Tx[] = React.useMemo(
    () => transactions.filter((tx: Tx) => tx.external_id && !tx.groupId && !(tx.splits && tx.splits.length) && !isSystemTransaction(tx)),
    [transactions],
  );
  const uncategorizedKey = uncategorized.map((x) => x.external_id).sort().join('|');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const catShape = React.useMemo(() => (categories || []).map((g: any) => ({ id: g.id, name: g.name, subcategories: (g.subcategories || []).map((sb: any) => ({ id: sb.id, name: sb.name })) })), [categories]);
  const incShape = React.useMemo(() => (incomeSources || []).map((x: any) => ({ id: x.id, name: x.name })), [incomeSources]);
  useEffect(() => {
    let alive = true;
    if (!token || uncategorized.length === 0) { setSuggestions([]); setProposals([]); return; }
    setSuggestLoading(true);
    apiCall('/api/categorization/suggest', { method: 'POST', body: JSON.stringify({ external_ids: uncategorized.map((x) => x.external_id), categories: catShape, income_sources: incShape }) }, token)
      .then((data: any) => { if (alive) { setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []); setProposals(Array.isArray(data?.new_category_proposals) ? data.new_category_proposals : []); } })
      .catch(() => { if (alive) { setSuggestions([]); setProposals([]); } })
      .finally(() => { if (alive) setSuggestLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, uncategorizedKey, catShape, incShape]);
  const suggestionByExt = React.useMemo(() => {
    const m: Record<string, Suggestion> = {};
    for (const sg of suggestions) m[sg.external_id] = sg;
    return m;
  }, [suggestions]);
  const txByExt = React.useMemo(() => {
    const m: Record<string, Tx> = {};
    for (const tx of uncategorized) if (tx.external_id) m[tx.external_id] = tx;
    return m;
  }, [uncategorized]);

  // Approve = exactly what a manual assignment does: write an overlay row
  // with the chosen group/detail. Budget actuals & remaining update because
  // they are derived from these rows. Then remember the merchant choice.
  const approveSuggestions = (items: Approval[]) => {
    if (items.length === 0) return;
    const byExt: Record<string, Approval> = {};
    for (const it of items) byExt[it.external_id] = it;
    setTransactions((xs: Tx[]) => {
      const existing = new Set(xs.map((x) => x.id));
      const added: Tx[] = [];
      const updated = xs.map((x) => {
        const it = x.external_id ? byExt[x.external_id] : undefined;
        if (!it) return x;
        return { ...x, type: it.type, groupId: it.group_id, detailId: it.detail_id || undefined };
      });
      for (const it of items) {
        const src = txByExt[it.external_id];
        if (!src || existing.has(src.id)) continue;
        added.push({ ...src, type: it.type, groupId: it.group_id, detailId: it.detail_id || undefined, origin: src.origin || 'Linked', period: src.period || currentMonth() });
      }
      return [...added, ...updated];
    });
    if (token) {
      apiCall('/api/categorization/learn', { method: 'POST', body: JSON.stringify({ items: items.map((it) => ({ merchant_key: it.merchant_key, group_id: it.group_id, detail_id: it.detail_id || null, tx_type: it.type, category_name: it.category_name, always: it.always })) }) }, token).catch(() => {});
    }
    setToast(`${items.length} transaction${items.length > 1 ? 's' : ''} categorized. Budget updated.`);
    if (items.length >= suggestions.length) setReviewOpen(false);
  };
  const addCategoryAndAssign = (p: Proposal, groupId: string) => {
    if (!addSubcategory) return;
    const sid = addSubcategory(groupId, p.name);
    if (!sid) return;
    const items: Approval[] = p.external_ids.filter((e) => txByExt[e]).map((e) => {
      const sg = suggestionByExt[e];
      const tx = txByExt[e];
      return { external_id: e, type: 'expense', group_id: groupId, detail_id: sid, category_name: p.name, merchant_key: sg?.merchant_key || String(tx?.merchant || tx?.name || '').toLowerCase().slice(0, 60), always: false };
    });
    approveSuggestions(items);
    setToast(`Added "${p.name}" and categorized ${items.length}.`);
  };
  const [filter, setFilter] = useState('All');
  const [accountFilter, setAccountFilter] = useState<string>('All');
  const [dateRange, setDateRange] = useState<string>('All');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  const [linkedLoaded, setLinkedLoaded] = useState(false);
  const refreshLinkedRows = React.useCallback(() => {
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => { setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []); setLinkedLoaded(true); })
      .catch(() => { setLinkedRows([]); setLinkedLoaded(true); });
  }, [token]);
  useEffect(() => {
    let alive = true;
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => { if (alive) { setLinkedRows(Array.isArray(data?.accounts) ? data.accounts : []); setLinkedLoaded(true); } })
      .catch(() => { if (alive) { setLinkedRows([]); setLinkedLoaded(true); } });
    return () => { alive = false; };
  }, [token, transactions.length]);
  // Tap the sync banner to force a Plaid + SimpleFIN resync followed by a
  // full refetch of accounts and transactions. Users kept asking "why aren't
  // my new transactions showing?" — this makes the answer a single tap.
  const runManualSync = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    try {
      // Fire both provider syncs in parallel — silent on individual failures.
      await Promise.allSettled([
        apiCall('/api/plaid/sync', { method: 'POST' }, token),
        apiCall('/api/accounts/sync', { method: 'POST' }, token),
      ]);
      refreshLinkedRows();
      // Force the App-level useEffect that fetches /accounts/transactions to re-run.
      onRefresh && onRefresh();
      setToast('Refreshed. New transactions will appear momentarily.');
    } catch { setToast('Refresh failed. Please try again.'); }
    finally { setSyncing(false); }
  };
  const shown = transactions.filter((tx: Tx) => {
    // Type filter — Activity is now only All / Income / Expenses (spec #10).
    // Transfer-flagged rows still surface here so users can see them; they
    // just don't count in Budget/Reports.
    const isTransfer = isSystemTransaction(tx);
    if (filter === 'Income' && (tx.type !== 'income' || isTransfer)) return false;
    if (filter === 'Expenses' && (tx.type !== 'expense' || isTransfer)) return false;
    // Account/bank filter — matches `origin` (e.g. "Chase", "Bank of America", "Manual")
    if (accountFilter !== 'All' && tx.origin !== accountFilter) return false;
    // Date-range filter
    if (dateRange !== 'All') {
      const isoMatch = typeof tx.date === 'string' ? tx.date.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
      if (!isoMatch) return false;
      const txDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      const now = new Date();
      if (dateRange === '30d') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (txDate < cutoff) return false;
      } else if (dateRange === 'This Month') {
        if (txDate.getFullYear() !== now.getFullYear() || txDate.getMonth() !== now.getMonth()) return false;
      } else if (dateRange === 'Last Month') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        if (txDate.getFullYear() !== lm.getFullYear() || txDate.getMonth() !== lm.getMonth()) return false;
      } else if (dateRange === 'YTD') {
        if (txDate.getFullYear() !== now.getFullYear()) return false;
      } else if (dateRange === 'Custom') {
        if (customFrom) {
          const [y, m, d] = customFrom.split('-').map(Number);
          if (txDate < new Date(y, (m || 1) - 1, d || 1)) return false;
        }
        if (customTo) {
          const [y, m, d] = customTo.split('-').map(Number);
          if (txDate > new Date(y, (m || 1) - 1, d || 1)) return false;
        }
      }
    }
    return true;
  });
  // Unique origins (banks) for the account filter — computed once per render.
  const originOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const tx of transactions) if (tx.origin) set.add(tx.origin);
    return ['All', ...Array.from(set).sort()];
  }, [transactions]);
  const save = (t: any) => {
    // Overlay vs manual: when editing a linked (Plaid) transaction we MUST
    // preserve the original `origin` (e.g. "Chase", "Ally Bank") instead of
    // stamping "Manual" — that was the root cause of #9 (Chase txns showing
    // as Manual). Real Manual entries — no external_id — still default to
    // "Manual" as before.
    setTransactions((xs: Tx[]) => {
      if (xs.some(x => x.id === t.id)) {
        return xs.map(x => x.id === t.id ? t : x);
      }
      const isOverlay = !!(t as any).external_id;
      const newEntry: any = {
        ...t,
        id: isOverlay ? t.id : `manual-${Date.now()}`,
        origin: isOverlay ? (t.origin || 'Linked') : (t.origin || 'Manual'),
        period: t.period || currentMonth(),
      };
      return [newEntry, ...xs];
    });
    setEditing(null); setToast('Transaction saved and totals refreshed.');
    // Single-expense alert (spec #16) — fires only for eligible expense
    // transactions. Transfers, refunds, credit-card payments and income
    // deposits are ignored per the exclusion list.
    const isEligibleExpense =
      t.type === 'expense'
      && !isSystemTransaction(t)
      && Number(t.amount) > 0;
    const threshold = alerts?.singleExpense?.threshold ?? 0;
    if (isEligibleExpense && alerts?.enabled && alerts?.singleExpense?.enabled && threshold > 0 && Math.abs(Number(t.amount)) > threshold) {
      try {
        Alert.alert(
          'Large expense alert',
          `"${t.name}" was ${MONEY(Math.abs(Number(t.amount)))} — over your $${threshold} alert threshold. Review it in the Budget or Activity screens if it wasn't expected.`,
          [{ text: 'OK' }],
        );
      } catch { /* Alert.alert isn't available on web preview — silent */ }
    }
  };
  const remove = (id: string) => { setTransactions((xs: Tx[]) => xs.filter(x => x.id !== id)); setEditing(null); setToast('Transaction deleted.'); };
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const importFile = () => setImportSheetOpen(true);

  // Sync banner state — reflects the ACTUAL backend state, never fakes
  const okLinks = linkedRows.filter((r: any) => !r.error);
  const errLinks = linkedRows.filter((r: any) => r.error);
  const totalLinks = linkedRows.length;
  const timestamps = okLinks.map((r: any) => r.last_sync_at).filter(Boolean).map((v: string) => new Date(v).getTime()).filter((n: number) => !Number.isNaN(n));
  const lastSyncMs = timestamps.length ? Math.max(...timestamps) : 0;
  const formatAgo = (ms: number) => {
    if (!ms) return 'just now';
    const diff = Math.max(0, Date.now() - ms);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };
  let banner: { icon: any; iconColor: string; title: string; sub: string; kind: 'empty' | 'ok' | 'warn' };
  if (!linkedLoaded) {
    banner = { icon: 'sync-outline', iconColor: '#7d8f92', title: 'Checking sync status…', sub: 'Refreshing linked accounts.', kind: 'empty' };
  } else if (totalLinks === 0) {
    banner = { icon: 'alert-circle-outline', iconColor: '#b28a4c', title: 'No accounts linked yet', sub: 'Link a bank via Settings → Linked Accounts, or import a CSV.', kind: 'empty' };
  } else if (errLinks.length > 0) {
    banner = { icon: 'warning-outline', iconColor: '#b46b41', title: `${errLinks.length} account${errLinks.length > 1 ? 's need' : ' needs'} attention`, sub: 'Re-link or refresh from Settings → Linked Accounts.', kind: 'warn' };
  } else {
    banner = { icon: 'link', iconColor: '#50715b', title: `${okLinks.length} account${okLinks.length > 1 ? 's' : ''} synced`, sub: `Last sync ${formatAgo(lastSyncMs)}.`, kind: 'ok' };
  }
  const bannerBg = banner.kind === 'empty' ? { backgroundColor: t.dark ? '#28241d' : '#f6efe1', borderColor: '#e5d5b3' }
                 : banner.kind === 'warn' ? { backgroundColor: t.dark ? '#2d2118' : '#fbebe0', borderColor: '#e6b593' }
                 : { backgroundColor: t.dark ? '#1e2d22' : '#eaf3ec', borderColor: '#c6dcc8' };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Transactions" subtitle="Synced automatically. Editable anytime." action={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <CircleBtn testID="tx-import" onPress={importFile}><Ionicons name={importing ? 'hourglass-outline' : 'cloud-upload-outline'} size={18} color={t.dark ? D.text : C.ink3} /></CircleBtn>
          <CircleBtn testID="tx-add" onPress={() => {
            const now = new Date();
            const firstCat = categories?.[0];
            setEditing({ type: 'expense', name: '', amount: '', date: now.toISOString(), groupId: firstCat?.id || 'steward', detailId: firstCat?.subcategories?.[0]?.id, period: currentMonth() });
          }}>
            <Ionicons name="add" size={19} color={t.dark ? D.text : C.ink3} />
          </CircleBtn>
        </View>
      } />
      <Pressable onPress={banner.kind === 'empty' ? openLinkSheet : runManualSync} disabled={syncing} style={[s.syncBanner, bannerBg, syncing && { opacity: 0.7 }]} testID="tx-sync-banner">
        <View style={[s.syncIcon, { backgroundColor: t.dark ? '#00000033' : '#ffffffbb' }]}><Ionicons name={syncing ? 'sync-outline' : banner.icon} size={18} color={banner.iconColor} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.text : '#3a3428' }}>{syncing ? 'Refreshing…' : banner.title}</Text>
          <Text style={{ fontSize: 8, color: t.dark ? D.textMuted : '#7a6f5c' }}>{syncing ? 'Pulling the latest transactions from your linked banks.' : (banner.kind === 'empty' ? banner.sub : `${banner.sub} · Tap to refresh`)}</Text>
        </View>
        <Ionicons name={banner.kind === 'empty' ? 'chevron-forward' : (syncing ? 'sync-outline' : 'refresh-outline')} size={16} color={banner.iconColor} />
      </Pressable>
      {(suggestions.length > 0 || proposals.length > 0) && (
        <Pressable onPress={() => setReviewOpen(true)} style={[s.syncBanner, { backgroundColor: t.dark ? '#2a2415' : '#fbf3e2', borderColor: '#e2c98f' }]} testID="tx-suggest-banner">
          <View style={[s.syncIcon, { backgroundColor: t.dark ? '#00000033' : '#ffffffbb' }]}><Ionicons name="sparkles-outline" size={18} color="#b58a3a" /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: t.dark ? D.text : '#3a3428' }}>
              {suggestions.length > 0 ? `${suggestions.length} suggested categor${suggestions.length > 1 ? 'ies' : 'y'} to review` : `${proposals.length} new category idea${proposals.length > 1 ? 's' : ''}`}
            </Text>
            <Text style={{ fontSize: 9, color: t.dark ? D.textMuted : '#7a6f5c' }}>Based on your merchants and bank categories · approve in one tap</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#b58a3a" />
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PeriodPills values={['All','Income','Expenses']} value={filter} onChange={setFilter} testID="tx-filter" />
        </View>
        {/* Filter button — opens a bottom sheet with Date range + Account
            source pills. Consolidated so the Activity header stays clean. */}
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: (dateRange !== 'All' || accountFilter !== 'All') ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: (dateRange !== 'All' || accountFilter !== 'All') ? '#c4945018' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 4 }}
          testID="tx-open-filters"
        >
          <Ionicons name="options-outline" size={13} color="#9a6d32" />
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#9a6d32' }}>Filter</Text>
          {(dateRange !== 'All' || accountFilter !== 'All') && (
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#c49450' }} />
          )}
        </Pressable>
      </View>
      <Sheet
        visible={filterSheetOpen}
        close={() => setFilterSheetOpen(false)}
        title="Filter transactions"
        subtitle="Narrow by date range and account/bank source."
      >
        <View>
          <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }]}>DATE RANGE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {(['All', '30d', 'This Month', 'Last Month', 'YTD', 'Custom'] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => setDateRange(r)}
                style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: dateRange === r ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: dateRange === r ? '#c4945018' : 'transparent' }}
                testID={`tx-range-${r.replace(/\W/g, '')}`}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: dateRange === r ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>{r === '30d' ? 'Last 30d' : r}</Text>
              </Pressable>
            ))}
          </View>
          {dateRange === 'Custom' && (
            <View style={{ marginTop: 10 }}>
              <Text style={[{ fontSize: 9, marginBottom: 4 }, t.textMuted]}>From (YYYY-MM-DD)</Text>
              {Platform.OS === 'web'
                ? React.createElement('input' as any, {
                    type: 'date', value: customFrom,
                    onChange: (e: any) => setCustomFrom(e.target.value),
                    style: { padding: '8px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #d9cfbf', background: '#fbf6ec', color: '#2d2820', outline: 'none', width: '100%' },
                    'data-testid': 'tx-custom-from',
                  })
                : (
                  <TextInput style={s.input} value={customFrom} onChangeText={setCustomFrom} placeholder="2026-07-01" testID="tx-custom-from" />
                )
              }
              <Text style={[{ fontSize: 9, marginTop: 8, marginBottom: 4 }, t.textMuted]}>To (YYYY-MM-DD)</Text>
              {Platform.OS === 'web'
                ? React.createElement('input' as any, {
                    type: 'date', value: customTo,
                    onChange: (e: any) => setCustomTo(e.target.value),
                    style: { padding: '8px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #d9cfbf', background: '#fbf6ec', color: '#2d2820', outline: 'none', width: '100%' },
                    'data-testid': 'tx-custom-to',
                  })
                : (
                  <TextInput style={s.input} value={customTo} onChangeText={setCustomTo} placeholder="2026-07-31" testID="tx-custom-to" />
                )
              }
            </View>
          )}
          {originOptions.length > 2 && (
            <>
              <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39', marginTop: 16 }]}>ACCOUNT / BANK</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {originOptions.map((o) => (
                  <Pressable
                    key={o}
                    onPress={() => setAccountFilter(o)}
                    style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: accountFilter === o ? '#c49450' : (t.dark ? D.border : '#e6dcc5'), backgroundColor: accountFilter === o ? '#c4945018' : 'transparent' }}
                    testID={`tx-account-${o.replace(/\W/g, '')}`}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: accountFilter === o ? '#9a6d32' : (t.dark ? D.textMuted : C.muted2) }}>{o}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
            <Pressable
              onPress={() => { setDateRange('All'); setAccountFilter('All'); setCustomFrom(''); setCustomTo(''); }}
              style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', alignItems: 'center' }}
              testID="tx-filters-reset"
            >
              <Text style={{ fontSize: 12, color: t.dark ? D.textMuted : C.muted2, fontWeight: '700' }}>Reset</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <GoldButton label="Done" onPress={() => setFilterSheetOpen(false)} testID="tx-filters-done" />
            </View>
          </View>
        </View>
      </Sheet>
      <View style={[s.transactionList, t.cardBg]}>
        {shown.length === 0 && (
          <View style={{ padding: 30, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={28} color={t.dark ? D.textMuted : '#c1b9ac'} />
            <Text style={[{ fontSize: 12, marginTop: 8, fontWeight: '700' }, t.textInk]}>No transactions yet</Text>
            <Text style={[{ fontSize: 10, marginTop: 4, textAlign: 'center', maxWidth: 260, lineHeight: 14 }, t.textMuted]}>
              Connect a bank, import transactions, or add a transaction manually.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable
                onPress={() => openLinkSheet && openLinkSheet()}
                testID="tx-empty-connect"
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: '#c49450' }}
              >
                <Text style={{ color: '#fffdf9', fontSize: 11, fontWeight: '700' }}>Connect account</Text>
              </Pressable>
              <Pressable
                onPress={() => setEditing({ id: '', name: '', amount: 0, date: new Date().toISOString().slice(0, 10), category: '', type: 'expense', origin: 'Manual' } as any)}
                testID="tx-empty-add"
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#c49450' }}
              >
                <Text style={{ color: '#c49450', fontSize: 11, fontWeight: '700' }}>Add transaction</Text>
              </Pressable>
            </View>
          </View>
        )}
        {shown.map((tx: Tx) => {
          const isTransferRow = isSystemTransaction(tx);
          const isIncomeRow = tx.type === 'income' && !isTransferRow;
          const iconBg = isIncomeRow ? '#e7f0e8' : isTransferRow ? (t.dark ? '#2e2b3a' : '#e9e6f2') : undefined;
          const iconName = isIncomeRow ? 'trending-up' : isTransferRow ? 'swap-horizontal-outline' : 'receipt-outline';
          const iconColor = isIncomeRow ? '#4e765c' : isTransferRow ? '#6f5e9a' : '#886f4b';
          const amountColor = isIncomeRow ? '#568066' : isTransferRow ? '#6f5e9a' : (t.dark ? D.text : C.ink);
          const prefix = isIncomeRow ? '+' : isTransferRow ? '↔ ' : '−';
          return (
            <Pressable key={tx.id} style={[s.transactionRow, t.dividerBorder]} onPress={() => setEditing(tx)} testID={`tx-${tx.id}`}>
              <View style={[s.txIcon, iconBg ? { backgroundColor: iconBg } : null]}>
                <Ionicons name={iconName as any} size={16} color={iconColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]} numberOfLines={1}>
                  {tx.name}{tx.merchant && tx.merchant !== tx.name ? <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}> · {tx.merchant}</Text> : null}
                </Text>
                <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>
                  {tx.date?.slice(0, 10)} · {tx.origin}{isTransferRow ? ' · Transfer' : ''}{tx.splits && tx.splits.length > 0 ? ` · Split (${tx.splits.length})` : ''}
                </Text>
                {tx.external_id && suggestionByExt[tx.external_id] ? (
                  <Pressable onPress={() => setReviewOpen(true)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9, backgroundColor: '#c4945018', borderWidth: 1, borderColor: '#c4945055' }} testID={`tx-suggest-chip-${tx.external_id}`}>
                    <Ionicons name="sparkles-outline" size={10} color="#9a6d32" />
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#9a6d32' }}>Suggested: {suggestionByExt[tx.external_id].category_name} · Review</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[{ fontSize: 11, fontWeight: '700', color: amountColor }]}>{prefix}{EXACT(tx.amount)}</Text>
              <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#b1aaa0'} />
            </Pressable>
          );
        })}
      </View>
      <Sheet visible={!!editing} close={() => setEditing(null)} title={editing?.id ? 'Edit transaction' : 'Add transaction'} subtitle="Manual changes immediately update Budget and cash.">
        {editing && <TxForm item={editing} categories={categories} incomeSources={incomeSources} save={save} remove={editing.id ? remove : null} />}
      </Sheet>
      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
      <SuggestionReviewSheet
        visible={reviewOpen}
        close={() => setReviewOpen(false)}
        loading={suggestLoading}
        suggestions={suggestions}
        proposals={proposals}
        txById={txByExt}
        categories={categories || []}
        incomeSources={incomeSources || []}
        onApprove={approveSuggestions}
        onAddCategoryAndAssign={addCategoryAndAssign}
      />
      <StatementImportSheet
        visible={importSheetOpen}
        token={token}
        dark={!!t.dark}
        onClose={() => setImportSheetOpen(false)}
        onDone={async (msg) => { setToast(msg); await onRefresh?.(); }}
      />
    </ScrollView>
  );
};
export const TxForm = ({ item, categories, incomeSources, save, remove }: any) => {
  const t = useThemed();
  const [tx, setT] = useState<any>({
    ...item,
    amount: String(item.amount || ''),
    merchant: item.merchant || '',
    splits: Array.isArray(item.splits) ? item.splits.map((sp: any) => ({ ...sp, amount: String(sp.amount || '') })) : [],
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showSplits, setShowSplits] = useState(Array.isArray(item.splits) && item.splits.length > 0);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  // Split-line category picker (latest spec). Tracks which split row is
  // currently choosing its category. null = closed. Uses the same
  // searchable Sheet UX as the regular Activity picker so users only
  // learn one pattern.
  const [splitPickerIdx, setSplitPickerIdx] = useState<number | null>(null);
  const [splitPickerQuery, setSplitPickerQuery] = useState('');
  const isIncome = tx.type === 'income';
  const isTransfer = isSystemTransaction(tx);
  const currentGroup = isIncome ? incomeSources.find((s: any) => s.id === tx.groupId) : categories.find((c: any) => c.id === tx.groupId);
  const currentSubs = !isIncome && currentGroup ? currentGroup.subcategories : [];
  const parsedAmount = Math.abs(Number((tx.amount || '').toString().replace(/[^0-9.]/g, '')) || 0);
  // Splits accounting in INTEGER CENTS (spec #14) — floating-point dollars
  // lose precision at 2 decimals (48.80 + 3.70 becomes 52.500000000000004).
  // Round each side to cents, then compare/validate/sum on cents so users
  // can enter values like $20.25 / $28.55 / $48.80 without the app quietly
  // rounding them into whole dollars.
  const dollarsToCents = (v: string | number): number => {
    const s = String(v ?? '').replace(/[^0-9.\-]/g, '');
    if (!s) return 0;
    // Parse then round to nearest cent to eliminate FP drift.
    return Math.round(Number(s) * 100);
  };
  const parsedAmountCents = dollarsToCents(tx.amount);
  const splitsTotalCents = (tx.splits || []).reduce((sum: number, sp: any) => sum + dollarsToCents(sp.amount), 0);
  const splitsRemainingCents = parsedAmountCents > 0 ? parsedAmountCents - splitsTotalCents : 0;
  const splitsTotal = splitsTotalCents / 100;
  const splitsRemaining = splitsRemainingCents / 100;
  // Save enables when allocated cents EXACTLY equals the transaction cents.
  const splitsValid = !showSplits || (
    tx.splits &&
    tx.splits.length >= 2 &&
    splitsRemainingCents === 0 &&
    tx.splits.every((sp: any) => dollarsToCents(sp.amount) > 0)
  );

  // Parse the current date string. Fallback to today.
  const parsedDate = (() => {
    if (!tx.date) return new Date();
    const d = new Date(tx.date);
    return isNaN(d.getTime()) ? new Date() : d;
  })();
  const displayDate = parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const isoDateForInput = parsedDate.toISOString().slice(0, 10);

  const setDateFromValue = (d: Date) => {
    if (!isNaN(d.getTime())) {
      setT({ ...tx, date: d.toISOString() });
    }
  };

  const addSplit = () => {
    const firstCat = categories[0];
    const firstSub = firstCat?.subcategories?.[0];
    // Toggle behavior: first invocation opens the splits UI with EXACTLY
    // one empty row so users can build up the allocation deliberately.
    // Subsequent invocations append one row (spec test copy: "Add split").
    if (!tx.splits || tx.splits.length === 0) {
      setT({
        ...tx,
        splits: [{ groupId: tx.groupId || firstCat?.id, detailId: tx.detailId || firstSub?.id, amount: '' }],
      });
    } else {
      setT({
        ...tx,
        splits: [...tx.splits, { groupId: firstCat?.id, detailId: firstSub?.id, amount: '' }],
      });
    }
    setShowSplits(true);
  };
  const updateSplit = (idx: number, patch: any) => {
    const next = [...(tx.splits || [])];
    next[idx] = { ...next[idx], ...patch };
    setT({ ...tx, splits: next });
  };
  const removeSplit = (idx: number) => {
    const next = (tx.splits || []).filter((_: any, i: number) => i !== idx);
    setT({ ...tx, splits: next });
    if (next.length === 0) setShowSplits(false);
  };

  return (
    <View>
      {/* Type selector — Income / Expense only (spec #10). Transfer is a
          CATEGORY option that lives under the group picker below, not a
          third type. Assigning Transfer preserves the transaction's sign
          but excludes it from Budget / Reports / Net Income totals. */}
      <PeriodPills
        values={['Income', 'Expense']}
        value={tx.type === 'income' ? 'Income' : 'Expense'}
        onChange={(label: string) => {
          const v = label.toLowerCase() as 'income' | 'expense';
          setT({
            ...tx,
            type: v,
            // Clear the previous transfer flag when the user switches types
            // — reclassification is a full reset (spec #13).
            is_transfer: false,
            system_category: null,
            groupId: v === 'income' ? (incomeSources[0]?.id || 'w2') : (categories[0]?.id || 'steward'),
            detailId: v === 'income' ? undefined : (categories[0]?.subcategories?.[0]?.id),
            splits: tx.splits,
          });
        }}
        testID="tx-type"
      />
      <Text style={s.label}>Description</Text>
      <TextInput style={s.input} value={tx.name} onChangeText={x => setT({ ...tx, name: x })} testID="tx-name" />
      <Text style={s.label}>Merchant <Text style={{ color: t.dark ? D.textMuted : C.muted, fontWeight: '400' }}>(optional)</Text></Text>
      <TextInput
        style={s.input}
        value={tx.merchant}
        onChangeText={(x) => setT({ ...tx, merchant: x })}
        placeholder="e.g., Costco, Chevron, Whole Foods"
        placeholderTextColor={t.dark ? D.textMuted : C.muted}
        testID="tx-merchant"
      />
      <Text style={[{ fontSize: 9, marginTop: 3 }, t.textMuted]}>
        Merchant is used in Reports to group your spending by retailer.
      </Text>
      <Text style={s.label}>Amount</Text>
      <View style={s.amountInput}>
        <Text style={s.amountPrefix}>$</Text>
        <TextInput style={[s.input, { paddingLeft: 26 }]} value={tx.amount} onChangeText={x => setT({ ...tx, amount: x.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1') })} keyboardType="decimal-pad" testID="tx-amount" />
      </View>

      <Text style={s.label}>Date</Text>
      {Platform.OS === 'web' ? (
        React.createElement('input' as any, {
          type: 'date',
          value: isoDateForInput,
          onChange: (e: any) => {
            const iso = e.target.value;
            if (iso) {
              const [y, m, d] = iso.split('-').map(Number);
              setDateFromValue(new Date(y, m - 1, d));
            }
          },
          style: {
            width: '100%',
            padding: '10px 12px',
            fontSize: 13,
            borderRadius: 10,
            border: '1px solid #d9cfbf',
            background: '#fbf6ec',
            fontFamily: 'inherit',
            color: '#2d2820',
            outline: 'none',
          },
          'data-testid': 'tx-date-web',
        })
      ) : (
        <>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
            testID="tx-date-open"
          >
            <Text style={{ fontSize: 13, color: C.ink }}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={16} color={C.goldEyebrow} />
          </Pressable>
          {showDatePicker && (
            <DateTimePicker
              value={parsedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(event: any, selected?: Date) => {
                if (Platform.OS === 'android') setShowDatePicker(false);
                if (event?.type === 'dismissed') { setShowDatePicker(false); return; }
                if (selected) setDateFromValue(selected);
              }}
            />
          )}
          {Platform.OS === 'ios' && showDatePicker && (
            <Pressable onPress={() => setShowDatePicker(false)} style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 }}>
              <Text style={{ color: C.goldEyebrow, fontSize: 12, fontWeight: '700' }}>Done</Text>
            </Pressable>
          )}
        </>
      )}

      <Text style={s.label}>Month</Text>
      <PeriodPills values={[...MONTHS]} value={tx.period || currentMonth()} onChange={(v: string) => setT({ ...tx, period: v })} testID="tx-month" />

      {/* Transfer callout — shown when the transaction is currently flagged
          as a Transfer (either auto-detected by the Plaid classifier or
          manually assigned via the Transfer chip). Purely informational —
          the actual assignment happens via the "Transfer" chip below. */}
      {isTransfer && (
        <View style={{ padding: 10, marginTop: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#c49450' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
          <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 3, lineHeight: 14 }}>
            This transaction is an internal movement between your own accounts (or a credit-card payment).
            It won&apos;t affect Budget, Reports, Net Income, or Net Worth totals.
          </Text>
        </View>
      )}

      {/* Category / subcategory picker (spec #15). A single tappable row
          opens a searchable bottom sheet with every group + subcategory
          plus Transfer. This replaces the previous 2-3 walls of chips
          and keeps the modal clean on small screens. */}
      {!showSplits && (
        <>
          <Text style={s.label}>{isIncome ? 'Earn source' : 'Category'}</Text>
          <Pressable
            onPress={() => setCategoryPickerOpen(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingVertical: 12, paddingHorizontal: 14,
              borderWidth: 1, borderColor: t.dark ? D.border : '#e2dcd2',
              borderRadius: 13, backgroundColor: t.dark ? D.surfaceAlt : '#fff',
            }}
            testID="tx-category-open"
          >
            <Text style={[{ fontSize: 13 }, t.textInk]}>
              {(() => {
                if (isTransfer) return 'Transfer';
                if (isIncome) {
                  const g = incomeSources.find((s: any) => s.id === tx.groupId);
                  return g ? g.name : 'Tap to select';
                }
                const g = categories.find((c: any) => c.id === tx.groupId);
                const sub = g?.subcategories?.find((sb: any) => sb.id === tx.detailId);
                if (!g) return 'Tap to select';
                return sub ? `${g.name} · ${sub.name}` : g.name;
              })()}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.dark ? D.textMuted : C.goldEyebrow} />
          </Pressable>
        </>
      )}

      {/* Split allocations — only for expense (and income) transactions.
          Each split assigns part of the amount to a different category. */}
      {!isTransfer && (
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Split across categories</Text>
            <Pressable onPress={() => {
              if (!showSplits) {
                addSplit();
              } else {
                setShowSplits(false);
                setT({ ...tx, splits: [] });
              }
            }} testID="tx-split-toggle">
              <Text style={{ color: '#9a6d32', fontWeight: '700', fontSize: 11 }}>{showSplits ? 'Remove split' : '+ Split this'}</Text>
            </Pressable>
          </View>
          {showSplits && (
            <View style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5' }}>
              {(tx.splits || []).map((sp: any, idx: number) => {
                // Simplified split row (latest spec): only "Category" +
                // "Amount". No Income/Expense toggle, no chip wall. Any
                // category (Earn / Give / Steward / Grow / Enjoy / Transfer)
                // is available regardless of sign so refunds, credits, and
                // reimbursements can offset any category cleanly.
                const isSplitTransfer = !!sp.is_transfer;
                const spIncomeGroup = incomeSources.find((c: any) => c.id === sp.groupId);
                const spExpenseGroup = categories.find((c: any) => c.id === sp.groupId);
                const spSub = spExpenseGroup?.subcategories?.find((sb: any) => sb.id === sp.detailId);
                const splitLabel = isSplitTransfer
                  ? 'Transfer'
                  : spIncomeGroup
                    ? spIncomeGroup.name
                    : spExpenseGroup
                      ? (spSub ? `${spExpenseGroup.name} › ${spSub.name}` : spExpenseGroup.name)
                      : 'Select category';
                return (
                  <View key={idx} style={{ paddingVertical: 10, borderBottomWidth: idx < (tx.splits.length - 1) ? 1 : 0, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Pressable
                        onPress={() => setSplitPickerIdx(idx)}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#e2dcd2', backgroundColor: t.dark ? D.surfaceAlt : '#fff' }}
                        testID={`tx-split-${idx}-category-open`}
                      >
                        <Text style={[{ fontSize: 12, flex: 1 }, t.textInk]} numberOfLines={1}>{splitLabel}</Text>
                        <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : C.goldEyebrow} />
                      </Pressable>
                      <View style={{ width: 90 }}>
                        <View style={s.amountInput}>
                          <Text style={s.amountPrefix}>$</Text>
                          <TextInput
                            style={[s.input, { paddingLeft: 22, paddingRight: 6, fontSize: 12 }]}
                            value={String(sp.amount || '')}
                            onChangeText={(x) => updateSplit(idx, { amount: x.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/^(\d*\.\d{0,2}).*/, '$1') })}
                            keyboardType="decimal-pad"
                            placeholder="0.00"
                            testID={`tx-split-${idx}-amount`}
                          />
                        </View>
                      </View>
                      <Pressable onPress={() => removeSplit(idx)} hitSlop={6} testID={`tx-split-${idx}-remove`}>
                        <Ionicons name="close-circle-outline" size={16} color="#b06a5b" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <Pressable onPress={addSplit} style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }} testID="tx-split-add">
                <Ionicons name="add-circle-outline" size={14} color="#9a6d32" />
                <Text style={{ color: '#9a6d32', fontWeight: '700', fontSize: 11 }}>Add split</Text>
              </Pressable>
              <View style={{ marginTop: 10, gap: 4 }}>
                {(() => {
                  const MONEY_C = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
                  return (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>
                          Allocated: {MONEY_C(splitsTotal)} of {MONEY_C(parsedAmountCents / 100)}
                          {splitsValid ? ' ✓' : ''}
                        </Text>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: splitsValid ? '#4c8b56' : '#b06a5b' }}>
                          Remaining: {MONEY_C(Math.max(0, splitsRemaining))}
                          {splitsRemaining < 0 ? ` (over by ${MONEY_C(-splitsRemaining)})` : ''}
                        </Text>
                      </View>
                      {!splitsValid && (tx.splits && tx.splits.length < 2) && (
                        <Text style={{ fontSize: 10, color: '#b06a5b' }}>Add at least 2 rows.</Text>
                      )}
                    </>
                  );
                })()}
              </View>
            </View>
          )}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <GoldButton
          label="Save transaction"
          onPress={() => {
            const merchantClean = (tx.merchant || '').toString().trim();
            // Emit splits with integer-cent precision (spec #14): parse
            // each user-entered string, round to cents, then divide back.
            const splitsClean = showSplits && Array.isArray(tx.splits)
              ? tx.splits.map((sp: any) => ({
                  groupId: sp.groupId,
                  detailId: sp.detailId,
                  amount: dollarsToCents(sp.amount) / 100,
                  type: (sp.type as 'income' | 'expense') || tx.type,
                }))
              : undefined;
            // Preserve or infer the signed direction. For new manual rows
            // (no external_id, no prior sign), infer from the current type
            // toggle: expense → -1 (money out), income → +1. Users can then
            // reassign side without losing their original intent.
            const preservedSign = tx.sign != null
              ? tx.sign
              : (tx.type === 'income' ? 1 : -1);
            save({
              ...tx,
              amount: parsedAmountCents / 100,
              merchant: merchantClean || undefined,
              splits: splitsClean,
              sign: preservedSign,
              // Preserve the true origin: a linked transaction (has external_id)
              // should NEVER be stamped "Manual" on edit — that was the root
              // cause of spec #9 (Chase/Ally showing as Manual). Fall back to
              // "Linked" only if the row is a Plaid overlay whose org name
              // isn't yet known, and to "Manual" only for genuinely new rows.
              origin: tx.origin || (tx.external_id ? 'Linked' : 'Manual'),
              period: tx.period || currentMonth(),
            });
          }}
          disabled={!tx.name || !parsedAmount || !splitsValid}
          testID="tx-save"
        />
        {showSplits && !splitsValid && (
          <Text style={{ fontSize: 10, color: '#b06a5b', marginTop: 6, textAlign: 'center' }}>
            Splits must total exactly ${(parsedAmountCents / 100).toFixed(2)} and have at least 2 rows.
          </Text>
        )}
      </View>
      {remove && <Pressable onPress={() => remove(item.id)} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="tx-delete">
        <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Delete transaction</Text>
      </Pressable>}

      {/* Category picker Sheet (spec #15) — searchable, groups + leaves,
          Transfer at bottom. Rendered inline so it inherits the same state
          scope as the transaction editor. */}
      <Sheet
        visible={categoryPickerOpen}
        close={() => { setCategoryPickerOpen(false); setCategoryQuery(''); }}
        title={isIncome ? 'Select Earn source' : 'Select Category'}
        subtitle="Tap a category to assign this transaction."
      >
        <View>
          <TextInput
            value={categoryQuery}
            onChangeText={setCategoryQuery}
            placeholder="Search..."
            style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 10, fontSize: 13, backgroundColor: '#fff', marginBottom: 10 }, t.inputBg]}
            placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
            testID="tx-category-search"
            autoFocus
          />
          {(() => {
            const q = categoryQuery.trim().toLowerCase();
            const matches = (name: string) => !q || name.toLowerCase().includes(q);
            const opts = isIncome ? incomeSources : categories;
            return (
              <View>
                {opts.map((g: any) => {
                  const groupHit = matches(g.name);
                  const subHits = isIncome
                    ? []
                    : (g.subcategories || []).filter((sub: any) => matches(sub.name) || groupHit);
                  if (!groupHit && subHits.length === 0) return null;
                  return (
                    <View key={g.id} style={{ marginBottom: 12 }}>
                      <Pressable
                        onPress={() => {
                          setT({
                            ...tx,
                            groupId: g.id,
                            detailId: isIncome ? undefined : g.subcategories?.[0]?.id,
                            is_transfer: false,
                            system_category: null,
                          });
                          setCategoryPickerOpen(false);
                          setCategoryQuery('');
                        }}
                        style={{ padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#2a251f' : '#fbf5e9', borderWidth: 1, borderColor: t.dark ? D.border : '#e5decf' }}
                        testID={`tx-category-group-${g.id}`}
                      >
                        <Text style={[{ fontSize: 13, fontWeight: '800', color: '#9a6d32' }]}>{g.name}</Text>
                      </Pressable>
                      {!isIncome && subHits.map((sub: any) => (
                        <Pressable
                          key={sub.id}
                          onPress={() => {
                            setT({
                              ...tx,
                              groupId: g.id,
                              detailId: sub.id,
                              is_transfer: false,
                              system_category: null,
                            });
                            setCategoryPickerOpen(false);
                            setCategoryQuery('');
                          }}
                          style={{ paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f0ebe4' }}
                          testID={`tx-category-sub-${sub.id}`}
                        >
                          <Text style={[{ fontSize: 12 }, t.textInk]}>{sub.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
                {/* Transfer — always at the bottom, single-tap */}
                <Pressable
                  onPress={() => {
                    setT({
                      ...tx,
                      is_transfer: true,
                      system_category: 'transfer',
                      groupId: '',
                      detailId: undefined,
                      splits: undefined,
                    });
                    setCategoryPickerOpen(false);
                    setCategoryQuery('');
                  }}
                  style={{ marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderWidth: 1, borderColor: '#c49450', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  testID="tx-category-transfer"
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#9a6d32" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
                    <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 2 }}>Excluded from Budget, Reports & Net Income</Text>
                  </View>
                </Pressable>
              </View>
            );
          })()}
        </View>
      </Sheet>

      {/* Split-line category picker — same searchable Sheet UX as the main
          picker so users learn one pattern. Full hierarchy (Earn, Give,
          Steward, Grow, Enjoy, Transfer) available for every split line
          regardless of sign. */}
      <Sheet
        visible={splitPickerIdx !== null}
        close={() => { setSplitPickerIdx(null); setSplitPickerQuery(''); }}
        title="Select Category"
        subtitle="Choose any category — refunds and credits can offset any type."
      >
        <View>
          <TextInput
            value={splitPickerQuery}
            onChangeText={setSplitPickerQuery}
            placeholder="Search..."
            style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 10, fontSize: 13, backgroundColor: '#fff', marginBottom: 10 }, t.inputBg]}
            placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
            testID="tx-split-category-search"
            autoFocus
          />
          {(() => {
            const q = splitPickerQuery.trim().toLowerCase();
            const matches = (name: string) => !q || name.toLowerCase().includes(q);
            const applyToSplit = (fields: any) => {
              if (splitPickerIdx == null) return;
              updateSplit(splitPickerIdx, fields);
              setSplitPickerIdx(null);
              setSplitPickerQuery('');
            };
            return (
              <View>
                {/* Earn (income) sources */}
                {incomeSources.map((src: any) => (
                  matches(src.name) && (
                    <Pressable
                      key={`earn-${src.id}`}
                      onPress={() => applyToSplit({ type: 'income', groupId: src.id, detailId: undefined, is_transfer: false })}
                      style={{ padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#2a251f' : '#fbf5e9', borderWidth: 1, borderColor: t.dark ? D.border : '#e5decf', marginBottom: 8 }}
                      testID={`tx-split-earn-${src.id}`}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#a97c39', letterSpacing: 0.6 }}>EARN</Text>
                      <Text style={[{ fontSize: 12, fontWeight: '800', marginTop: 2, color: '#9a6d32' }]}>{src.name}</Text>
                    </Pressable>
                  )
                ))}
                {/* Give / Steward / Grow / Enjoy — expense groups */}
                {categories.map((g: any) => {
                  const groupHit = matches(g.name);
                  const subHits = (g.subcategories || []).filter((sub: any) => matches(sub.name) || groupHit);
                  if (!groupHit && subHits.length === 0) return null;
                  return (
                    <View key={`exp-${g.id}`} style={{ marginBottom: 12 }}>
                      <Text style={[{ fontSize: 10, fontWeight: '800', color: '#9a6d32', letterSpacing: 0.6, marginBottom: 4 }]}>{g.name.toUpperCase()}</Text>
                      {subHits.map((sub: any) => (
                        <Pressable
                          key={sub.id}
                          onPress={() => applyToSplit({ type: 'expense', groupId: g.id, detailId: sub.id, is_transfer: false })}
                          style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f0ebe4' }}
                          testID={`tx-split-sub-${sub.id}`}
                        >
                          <Text style={[{ fontSize: 12 }, t.textInk]}>{g.name} › {sub.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  );
                })}
                {/* Transfer */}
                <Pressable
                  onPress={() => applyToSplit({ is_transfer: true, groupId: '', detailId: undefined, type: 'expense' })}
                  style={{ marginTop: 8, padding: 12, borderRadius: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderWidth: 1, borderColor: '#c49450', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  testID="tx-split-transfer"
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color="#9a6d32" />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#9a6d32' }}>Transfer</Text>
                </Pressable>
              </View>
            );
          })()}
        </View>
      </Sheet>
    </View>
  );
};
