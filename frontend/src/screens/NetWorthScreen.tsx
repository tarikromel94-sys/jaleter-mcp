/**
 * NetWorthScreen (Wealth tab).
 *
 * Extracted from the monolithic `/app/frontend/app/index.tsx` on
 * 2026-06-10 as part of the Phase 1 modularization pass. Behaviour and
 * markup are UNCHANGED — every dependency previously reached from
 * closure is now imported from `@/src/utils/appShared` or directly.
 *
 * Public surface: `<NetWorthScreen ... />` — the prop shape is exactly
 * what App.tsx passes today.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Platform, Alert } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { MONEY } from '@/src/quoteLibrary';
import { useAuth, apiCall } from '@/src/AuthContext';
import { C, D } from '@/src/jaleterTheme';
import ProjectionLineChart from '@/src/components/ProjectionLineChart';
import { ReclassifySheet } from '@/src/components/ReclassifySheet';
import {
  s,
  useThemed,
  PageHeader,
  PeriodPills,
  Sheet,
  CircleBtn,
  GoldButton,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  isInvestmentAccount,
  timeAgo,
  type Asset,
} from '@/src/utils/appShared';

// Re-declared here (screen-local) so the extracted body can reference
// `Asset` without needing to touch every declaration site.
// Note: the canonical `Asset` type lives in `@/src/utils/appShared`.

// Loose name-match used by the manual-account merge-hint (spec #2). Case-
// insensitive, punctuation-stripped substring test — good enough to catch
// "Chase Checking" vs "Chase Checking · 1234" without needing a full
// Levenshtein implementation. Never matches empty strings.
function _nameMatch(a?: string, b?: string): boolean {
  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return A.includes(B) || B.includes(A);
}

export const NetWorthScreen = ({ assets, setAssets, liabilities, setLiabilities, transactions, restrictedBuckets, setRestrictedBuckets, linkedRowsByCategory, linkedByCategory, onRefreshAccounts, canonicalTotalAssets, canonicalTotalLiabilities, canonicalNetWorth, financialsReady }: any) => {
  const t = useThemed();
  const { token } = useAuth();
  const [linkedRows, setLinkedRows] = useState<any[]>([]);
  // linkedLoaded flips true once the first successful fetch has completed
  // (local flag). Use `financialsReady` (App-level) for the STRICT gate on
  // rendering financial numbers — that gate also requires Net Worth
  // reconciliation to succeed before publishing.
  const [linkedLoaded, setLinkedLoaded] = useState(false);
  const readyForNumbers = !!financialsReady && linkedLoaded;
  const [linkedSyncing, setLinkedSyncing] = useState(false);
  const [restrictedOpen, setRestrictedOpen] = useState(false);
  // Category-collapse state — persisted in-memory only. Default collapsed
  // (categories expand on tap) so the Wealth screen stays scannable.
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const toggleCat = (slug: string) => setExpandedCats((prev) => ({ ...prev, [slug]: !prev[slug] }));
  const [syncingAll, setSyncingAll] = useState(false);
  // Legacy "adding" sheet — kept for backwards-compat with existing tests but
  // the new redesign uses an inline editing card (setEditingBucket).
  const [addingRestricted, setAddingRestricted] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [newBucketAmt, setNewBucketAmt] = useState('');
  const [newBucketTarget, setNewBucketTarget] = useState('');
  const [newBucketTargetDate, setNewBucketTargetDate] = useState('');
  const [newBucketRecurring, setNewBucketRecurring] = useState('');
  const [editingBucket, setEditingBucket] = useState<any>(null);
  // "Add" or "Use" mini-flow for a bucket (increment / decrement).
  const [txBucket, setTxBucket] = useState<{ bucket: any; action: 'add' | 'use' } | null>(null);
  const [txAmt, setTxAmt] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editRow, setEditRow] = useState<{ side: 'assets' | 'liabilities'; row: Asset } | null>(null);
  const [rowDraftName, setRowDraftName] = useState('');
  const [rowDraftAmt, setRowDraftAmt] = useState('');
  const [addingRowSide, setAddingRowSide] = useState<'assets' | 'liabilities' | null>(null);
  // Reclassify sheet — opened when the user taps a linked (Synced) account
  // in either the Assets or Liabilities card. Manual rows still use editRow.
  const [reclassifyAccount, setReclassifyAccount] = useState<any | null>(null);
  // Manual-account editor (spec #2). One editor for add + edit; the sheet
  // is opened by tapping "+ Add Manual Account" inside any category (add
  // mode) or an existing manual row (edit mode). Category is pre-filled
  // from context so the user never has to pick it manually.
  const [manualEditor, setManualEditor] = useState<null | {
    mode: 'add' | 'edit';
    category: string;
    row?: any;
  }>(null);
  const [manDraftName, setManDraftName] = useState('');
  const [manDraftBal, setManDraftBal] = useState('');
  const [manDraftInst, setManDraftInst] = useState('');
  const [manSaving, setManSaving] = useState(false);
  const openManualAdd = (slug: string) => {
    setManualEditor({ mode: 'add', category: slug });
    setManDraftName('');
    setManDraftBal('');
    setManDraftInst('');
  };
  const openManualEdit = (slug: string, row: any) => {
    setManualEditor({ mode: 'edit', category: slug, row });
    setManDraftName(row.name || '');
    setManDraftBal(row.balance != null ? String(row.balance) : '');
    setManDraftInst(row.org_name && row.org_name !== 'Manual' ? row.org_name : '');
  };
  const closeManualEditor = () => setManualEditor(null);
  const saveManual = async () => {
    if (!manualEditor || !token || manSaving) return;
    const name = manDraftName.trim() || 'Manual account';
    const balanceNum = Number((manDraftBal || '').replace(/[^0-9.\-]/g, '')) || 0;
    const institution = manDraftInst.trim() || undefined;
    setManSaving(true);
    try {
      if (manualEditor.mode === 'add') {
        await apiCall('/api/accounts/manual', {
          method: 'POST',
          body: JSON.stringify({ category: manualEditor.category, name, balance: balanceNum, institution }),
        }, token);
      } else if (manualEditor.mode === 'edit' && manualEditor.row?.id) {
        await apiCall(`/api/accounts/manual/${manualEditor.row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, balance: balanceNum, institution }),
        }, token);
      }
      refreshLinked();
      if (typeof onRefreshAccounts === 'function') onRefreshAccounts();
      closeManualEditor();
    } catch (e) {
      // Keep the sheet open on error so the user can retry.
      // eslint-disable-next-line no-console
      console.warn('manual account save failed', e);
    } finally {
      setManSaving(false);
    }
  };
  const deleteManual = async () => {
    if (!manualEditor || manualEditor.mode !== 'edit' || !manualEditor.row?.id || !token) return;
    setManSaving(true);
    try {
      await apiCall(`/api/accounts/manual/${manualEditor.row.id}`, { method: 'DELETE' }, token);
      refreshLinked();
      if (typeof onRefreshAccounts === 'function') onRefreshAccounts();
      closeManualEditor();
    } finally {
      setManSaving(false);
    }
  };
  const refreshLinked = () => {
    if (!token) return;
    setLinkedSyncing(true);
    apiCall('/api/accounts/all', { method: 'GET' }, token)
      .then((data: any) => {
        // Only replace linkedRows if the fetch actually returned an array
        // — keep the last-good snapshot if the response is malformed to
        // avoid flashing $0 balances.
        if (Array.isArray(data?.accounts)) setLinkedRows(data.accounts);
        setLinkedLoaded(true);
      })
      .catch(() => { /* keep last-known rows on failure */ setLinkedLoaded(true); })
      .finally(() => setLinkedSyncing(false));
  };
  // Initial fetch when the screen mounts (or when the token changes). Runs
  // exactly once per token so we never double-fire and cause re-renders.
  useEffect(() => {
    if (!token) { setLinkedRows([]); setLinkedLoaded(true); return; }
    refreshLinked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const [period, setPeriod] = useState<'Month' | 'Quarter' | 'Year'>('Quarter');
  const [visible, setVisible] = useState(true);
  // Net Worth history — pulled from the server. Refreshes whenever the
  // selected range changes or the underlying account totals mutate.
  const [nwHistory, setNwHistory] = useState<any[]>([]);
  const [nwHistoryLoading, setNwHistoryLoading] = useState(false);
  const rangeKey = period === 'Month' ? 'month' : period === 'Year' ? 'year' : 'quarter';
  useEffect(() => {
    if (!token) { setNwHistory([]); return; }
    let alive = true;
    setNwHistoryLoading(true);
    apiCall(`/api/networth/history?range=${rangeKey}`, { method: 'GET' }, token)
      .then((data: any) => {
        if (!alive) return;
        if (Array.isArray(data?.points)) setNwHistory(data.points);
        else setNwHistory([]);
      })
      .catch(() => { if (alive) setNwHistory([]); })
      .finally(() => { if (alive) setNwHistoryLoading(false); });
    return () => { alive = false; };
    // canonicalNetWorth changes → new snapshot may have been persisted, so refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, rangeKey, canonicalNetWorth]);

  // ---- Aggregate live-linked balances by Jaleter category ----
  // De-dupe by unique (link_id, account_id) to prevent double-counting when
  // the same account appears via multiple items or holdings pulls. Skip
  // zero-value insurance policies (term-life, disability, whole life w/
  // zero cash value) so they never inflate the Investments category.
  const validLinks = React.useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of linkedRows.filter((x: any) => !x.error)) {
      const key = `${r.link_id || ''}::${r.account_id || r.name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hay = `${r.name || ''} ${r.subtype || ''} ${r.type || ''}`.toLowerCase();
      const looksInsurance = /(term life|term-life|disability insurance|whole life|umbrella|renters insurance|auto insurance|life insurance)/.test(hay);
      const bal = Number(r.balance || 0);
      if (looksInsurance && bal === 0) continue;
      out.push(r);
    }
    return out;
  }, [linkedRows]);
  const linkedByCat: Record<string, any[]> = {};
  for (const r of validLinks) {
    const cat = (r.category as string) || (isInvestmentAccount(r) ? 'investments' : 'cash');
    (linkedByCat[cat] = linkedByCat[cat] || []).push(r);
  }
  const sumCat = (slug: string) =>
    (linkedByCat[slug] || []).reduce((sum, r: any) => sum + Number(r.balance || 0), 0);
  const linkedCash = sumCat('cash');
  const linkedInvest = sumCat('investments');
  const linkedRealEstate = sumCat('real_estate');
  const linkedVehicles = sumCat('vehicles');
  const linkedOtherAssets = sumCat('other_assets');
  const cashSources = linkedByCat['cash'] || [];
  const investSources = linkedByCat['investments'] || [];
  // ---- Category groups (collapsible) ---------------------------------------
  // Each category row shows the group name + total; expanding reveals every
  // underlying account. Category totals MUST equal the sum of the rows so
  // the UI never lies (spec fix). Manual seeds for Cash/Investments are
  // included in the totals via `manualCash` / `manualInvest` — they render
  // as a "Manual (edit)" row so users can still adjust them by tapping.
  // NOTE: manualCash/manualInvest are hoisted here (before buildCategoryGroups
  // is invoked) to avoid a temporal-dead-zone crash on the Wealth tab.
  const manualCash = assets.find((x: Asset) => x.id === 'cash')?.value || 0;
  const manualInvest = assets.find((x: Asset) => x.id === 'investments')?.value || 0;
  const buildCategoryGroups = (side: 'assets' | 'liabilities') => {
    const slugs: string[] = side === 'assets'
      ? ['cash', 'investments', 'real_estate', 'vehicles', 'other_assets']
      : ['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities'];
    return slugs.map((slug) => {
      const linkedRows = linkedByCat[slug] || [];
      const linkedTotal = linkedRows.reduce((sum, r: any) => sum + Number(r.balance || 0), 0);
      // For assets, we also fold in the manual seeds (Cash + Investments).
      const manualSeedValue = slug === 'cash' ? manualCash : slug === 'investments' ? manualInvest : 0;
      // Manual "other" rows (Real Estate / Vehicles / Other assets, or
      // manual liabilities) — matched by icon lookup for the wealth slug.
      const manualExtras = side === 'assets'
        ? assets.filter((x: Asset) => {
            if (slug === 'cash' || slug === 'investments') return false;
            if (slug === 'real_estate') return x.id === 'real-estate';
            if (slug === 'vehicles') return x.id === 'vehicles';
            return x.id !== 'cash' && x.id !== 'investments' && x.id !== 'real-estate' && x.id !== 'vehicles';
          })
        : liabilities.filter((x: Asset) => {
            if (slug === 'mortgage') return x.id === 'mortgage';
            if (slug === 'auto_loans') return x.id === 'auto-loan';
            if (slug === 'credit_cards') return x.id === 'credit-cards' || x.id === 'credit-card';
            if (slug === 'student_loans') return x.id === 'student-loan' || x.id === 'student-loans';
            return !['mortgage', 'auto-loan', 'credit-cards', 'credit-card', 'student-loan', 'student-loans'].includes(x.id);
          });
      const manualExtrasTotal = manualExtras.reduce((sum: number, r: any) => sum + Number(r.value || 0), 0);
      const total = linkedTotal + manualSeedValue + manualExtrasTotal;
      return { slug, label: CATEGORY_LABELS[slug], icon: CATEGORY_ICONS[slug], linkedRows, manualExtras, manualSeedValue, total };
    });
  };
  const assetGroups = buildCategoryGroups('assets');
  const liabilityGroups = buildCategoryGroups('liabilities');
  const assetsCategoriesTotal = assetGroups.reduce((s, g) => s + g.total, 0);
  const liabilitiesCategoriesTotal = liabilityGroups.reduce((s, g) => s + g.total, 0);
  // Last-sync timestamp across all valid linked accounts — surfaced right
  // above the categories so users know how fresh the data is.
  const allSyncTimes = validLinks
    .map((r: any) => r.last_sync_at)
    .filter(Boolean)
    .map((v: string) => new Date(v).getTime())
    .filter((n: number) => !Number.isNaN(n));
  const lastSyncMs = allSyncTimes.length ? Math.max(...allSyncTimes) : 0;
  const lastSyncLabel = lastSyncMs
    ? `Last synced ${new Date(lastSyncMs).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : 'No sync yet';
  const doSyncAll = async () => {
    if (!token || syncingAll) return;
    setSyncingAll(true);
    try {
      await Promise.allSettled([
        apiCall('/api/plaid/sync', { method: 'POST' }, token),
        apiCall('/api/accounts/sync', { method: 'POST' }, token),
      ]);
      refreshLinked();
      onRefreshAccounts && onRefreshAccounts();
    } finally { setSyncingAll(false); }
  };

  const sourceLabel = (rows: any[], fallback: string) => {
    if (rows.length === 0) return fallback;
    const providers = Array.from(new Set(rows.map((r: any) => r.provider)));
    const orgs = Array.from(new Set(rows.map((r: any) => r.org_name).filter(Boolean)));
    const providerName = providers.length === 1
      ? (providers[0] === 'file' ? 'Imported' : providers[0] === 'snaptrade' ? 'SnapTrade' : 'Linked')
      : 'Linked';
    if (orgs.length === 1) return `${providerName} · ${orgs[0]}`;
    return `${providerName} · ${rows.length} account${rows.length > 1 ? 's' : ''}`;
  };

  // ---- Build the display asset list: Cash & Investments are auto-computed. Real estate / vehicles stay manual. ----
  // manualCash and manualInvest were hoisted above (before buildCategoryGroups).
  const manualOther = assets.filter((x: Asset) => x.id !== 'cash' && x.id !== 'investments');
  const displayAssets: (Asset & { linked?: boolean; account?: any })[] = [
    // Cash & Investments show a category header + one row per linked account
    // so users can see each checking/savings/brokerage separately (spec fix).
    { id: 'cash', name: 'Cash', value: manualCash + linkedCash, source: cashSources.length > 0 ? `Total across ${cashSources.length} account${cashSources.length > 1 ? 's' : ''}` : 'Manual', icon: 'wallet-outline', linked: cashSources.length > 0 },
    ...cashSources.map((r: any) => ({
      id: `linked-cash-${r.account_id}`,
      name: r.name,
      value: Number(r.balance || 0),
      source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
      icon: 'wallet-outline',
      linked: true,
      account: r,
    })),
    { id: 'investments', name: 'Investments', value: manualInvest + linkedInvest, source: investSources.length > 0 ? `Total across ${investSources.length} account${investSources.length > 1 ? 's' : ''}` : 'Manual', icon: 'trending-up', linked: investSources.length > 0 },
    ...investSources.map((r: any) => ({
      id: `linked-invest-${r.account_id}`,
      name: r.name,
      value: Number(r.balance || 0),
      source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
      icon: 'trending-up',
      linked: true,
      account: r,
    })),
    ...manualOther,
  ];
  // Linked non-cash / non-investment assets (Real Estate / Vehicles / Other Assets)
  // are treated as additional read-only rows. Manual rows for the same category
  // are still shown separately so the user can distinguish sources.
  const extraLinkedAssetRows: (Asset & { linked?: boolean; account?: any })[] = [];
  for (const slug of ['real_estate', 'vehicles', 'other_assets']) {
    for (const r of (linkedByCat[slug] || [])) {
      extraLinkedAssetRows.push({
        id: `linked-${r.account_id}`,
        name: r.name || CATEGORY_LABELS[slug],
        value: Number(r.balance || 0),
        source: `${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
        icon: CATEGORY_ICONS[slug],
        linked: true,
        account: r,
      });
    }
  }

  // Liabilities: manual + all linked liability accounts, each shown as its own row.
  const linkedLiabilityRows: (Asset & { linked?: boolean; account?: any })[] = [];
  for (const slug of ['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities']) {
    for (const r of (linkedByCat[slug] || [])) {
      linkedLiabilityRows.push({
        id: `linked-${r.account_id}`,
        name: r.name || CATEGORY_LABELS[slug],
        value: Number(r.balance || 0),
        source: `${CATEGORY_LABELS[slug]} · ${r.org_name || 'Linked'} · Synced${r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}`,
        icon: CATEGORY_ICONS[slug],
        linked: true,
        account: r,
      });
    }
  }
  const combinedLiabilities: (Asset & { linked?: boolean; account?: any })[] = [
    ...linkedLiabilityRows,
    ...liabilities.map((x: Asset) => ({ ...x, source: x.source || 'Manual', linked: false })),
  ];

  // Single source of truth — Home + Wealth show the exact same number.
  // Local displayAssets/extraLinkedAssetRows/combinedLiabilities are kept
  // only for rendering (per-row display), NOT for totals — totals come from
  // the App-level canonical computation via props (spec: Net Worth centralized).
  const ta = Number(canonicalTotalAssets) || 0;
  const tl = Number(canonicalTotalLiabilities) || 0;
  const nw = Number(canonicalNetWorth) || (ta - tl);
  const cash = displayAssets.find((x: any) => x.id === 'cash')?.value || 0;
  // Only ACTIVE (non-archived) buckets count toward Set Aside.
  const activeBuckets = restrictedBuckets.filter((b: any) => !b.archived);
  const archivedBuckets = restrictedBuckets.filter((b: any) => b.archived);
  const totalRestricted = activeBuckets.reduce((sum: number, b: any) => sum + (b.amount || 0), 0);
  const available = cash - totalRestricted; // may be negative; we now render red instead of clamping to 0
  const BUCKET_PRESETS = [
    { name: 'Emergency Fund', icon: 'shield-checkmark-outline' },
    { name: 'Taxes', icon: 'document-text-outline' },
    { name: 'Vacation / Travel', icon: 'airplane-outline' },
    { name: 'Home', icon: 'home-outline' },
    { name: 'Auto', icon: 'car-outline' },
    { name: 'Medical', icon: 'medkit-outline' },
    { name: 'Education', icon: 'school-outline' },
    { name: 'Gifts / Holidays', icon: 'gift-outline' },
    { name: 'Business', icon: 'briefcase-outline' },
    { name: 'Other', icon: 'ellipsis-horizontal-outline' },
  ];
  const resetBucketDraft = () => {
    setNewBucketName(''); setNewBucketAmt(''); setNewBucketTarget(''); setNewBucketTargetDate(''); setNewBucketRecurring('');
  };
  const openNewBucket = (presetName?: string) => {
    resetBucketDraft();
    if (presetName) setNewBucketName(presetName);
    setEditingBucket(null);
    setAddingRestricted(true);
  };
  const openEditBucket = (b: any) => {
    setEditingBucket(b);
    setNewBucketName(b.name);
    setNewBucketAmt(String(b.amount || 0));
    setNewBucketTarget(b.target ? String(b.target) : '');
    setNewBucketTargetDate(b.targetDate || '');
    setNewBucketRecurring(b.recurring ? String(b.recurring) : '');
    setAddingRestricted(true);
  };
  const saveBucket = () => {
    const cleanAmt = Math.max(0, Math.round(Number((newBucketAmt || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanTarget = Math.max(0, Math.round(Number((newBucketTarget || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanRecurring = Math.max(0, Math.round(Number((newBucketRecurring || '').replace(/[^0-9.]/g, '')) || 0));
    const cleanName = newBucketName.trim();
    if (!cleanName) return;
    if (editingBucket) {
      setRestrictedBuckets((prev: any[]) => prev.map((x: any) => x.id === editingBucket.id ? {
        ...x,
        name: cleanName,
        amount: cleanAmt,
        target: cleanTarget > 0 ? cleanTarget : undefined,
        targetDate: newBucketTargetDate ? newBucketTargetDate.trim() : undefined,
        recurring: cleanRecurring > 0 ? cleanRecurring : undefined,
      } : x));
    } else {
      // Cap at 20 active buckets to keep UI usable and prevent runaway lists.
      if (activeBuckets.length >= 20) return;
      setRestrictedBuckets((prev: any[]) => [...prev, {
        id: `bucket-${Date.now().toString(36)}`,
        name: cleanName,
        amount: cleanAmt,
        target: cleanTarget > 0 ? cleanTarget : undefined,
        targetDate: newBucketTargetDate ? newBucketTargetDate.trim() : undefined,
        recurring: cleanRecurring > 0 ? cleanRecurring : undefined,
        createdAt: new Date().toISOString(),
      }]);
    }
    setAddingRestricted(false); setEditingBucket(null);
    resetBucketDraft();
  };
  const archiveBucket = (id: string) => {
    setRestrictedBuckets((prev: any[]) => prev.map((x: any) => x.id === id ? { ...x, archived: !x.archived } : x));
  };
  const deleteBucket = (id: string) => {
    const b = restrictedBuckets.find((x: any) => x.id === id);
    const name = b?.name || 'this bucket';
    const doIt = () => setRestrictedBuckets((prev: any[]) => prev.filter((x: any) => x.id !== id));
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}"?\n\nThe money returns to Available Cash. This cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'The money returns to Available Cash. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const commitBucketTx = () => {
    if (!txBucket) return;
    const raw = Math.max(0, Math.round(Number((txAmt || '').replace(/[^0-9.]/g, '')) || 0));
    if (raw <= 0) { setTxBucket(null); setTxAmt(''); return; }
    setRestrictedBuckets((prev: any[]) => prev.map((x: any) => {
      if (x.id !== txBucket.bucket.id) return x;
      const nextAmt = txBucket.action === 'add' ? (x.amount || 0) + raw : Math.max(0, (x.amount || 0) - raw);
      return { ...x, amount: nextAmt };
    }));
    setTxBucket(null); setTxAmt('');
  };
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Net Worth" subtitle="Your full financial picture, in one place." action={
        <CircleBtn onPress={() => setVisible(!visible)} testID="nw-eye"><Ionicons name={visible ? 'eye-outline' : 'eye-off-outline'} size={18} color={C.ink3} /></CircleBtn>
      } />
      {/* Sync banner — mounted at the very top so users know when data is
          fresh vs still being pulled. Only shows detailed timestamp once we
          have any linked accounts. Tapping either the row or the Sync icon
          triggers a manual Plaid + SimpleFIN refresh. */}
      <Pressable
        onPress={doSyncAll}
        disabled={syncingAll || linkedSyncing}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginTop: 8, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', backgroundColor: t.dark ? D.surface : '#fbf6ec' }}
        testID="wealth-sync-strip"
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dark ? '#3a342b' : '#f0e7d1' }}>
          <Ionicons name={(syncingAll || linkedSyncing || !readyForNumbers) ? 'sync-outline' : 'refresh-outline'} size={14} color="#9a6d32" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[{ fontSize: 11, fontWeight: '800' }, t.textInk]}>
            {syncingAll ? 'Syncing…' : !readyForNumbers ? 'Updating your accounts…' : linkedSyncing ? 'Refreshing…' : validLinks.length === 0 ? 'No accounts linked' : 'Accounts synced'}
          </Text>
          <Text style={[{ fontSize: 9, marginTop: 1 }, t.textMuted]}>
            {(syncingAll || linkedSyncing || !readyForNumbers)
              ? 'Balances refresh once your bank data returns.'
              : validLinks.length === 0
                ? 'Link a bank in Settings to pull balances automatically.'
                : `${lastSyncLabel} · Tap to refresh`}
          </Text>
        </View>
      </Pressable>
      <View style={s.nwHero}>
        <Text style={{ color: '#c3bbb0', fontSize: 9, letterSpacing: 1.3 }}>TOTAL NET WORTH</Text>
        {readyForNumbers ? (
          <Text style={s.nwHeroStrong}>{visible ? MONEY(nw) : '••••••'}</Text>
        ) : (
          // Skeleton bar — same height as the strong hero number so the
          // layout doesn't shift when the real number lands.
          <View style={{ height: 40, marginTop: 4, width: 200, borderRadius: 8, backgroundColor: t.dark ? '#3a342b' : '#e6dcc5', opacity: 0.6 }} />
        )}
        <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <Ionicons name="trending-up" size={13} color="#7fac8d" />
          <Text style={{ color: '#7fac8d', fontSize: 10 }}>{!readyForNumbers ? 'Fetching your latest balances…' : validLinks.length > 0 ? `Live from ${validLinks.length} linked account${validLinks.length > 1 ? 's' : ''}` : 'Updates with your linked accounts'}</Text>
        </View>
        {readyForNumbers && (
          // Real Net Worth history chart, driven by daily snapshots.
          // We always append a live "today" marker so the last point on
          // the trend line matches the headline Net Worth number (single
          // source of truth). The line only renders when there are 2+
          // data points; otherwise we show a clean empty state.
          <View style={{ marginTop: 10, paddingHorizontal: 6 }}>
            {(() => {
              const hist = Array.isArray(nwHistory) ? nwHistory : [];
              const todayKey = new Date().toISOString().slice(0, 10);
              const points: { label: string; value: number; ts: number }[] = [];
              // Count how many *historical* points we have (excluding today's
              // auto-backfill) — used to pick the correct empty-state copy.
              let historicalCount = 0;
              for (const p of hist) {
                const ts = p?.taken_at ? new Date(p.taken_at).getTime() : 0;
                if (!ts || Number.isNaN(ts)) continue;
                const dk = p?.date_key;
                // Skip today's persisted snapshot — we'll overlay the live
                // canonical Net Worth as the trailing point.
                if (dk === todayKey) continue;
                historicalCount += 1;
                points.push({
                  label: new Date(ts).toLocaleDateString('en-US', period === 'Year' ? { month: 'short' } : { month: 'short', day: 'numeric' }),
                  value: Number(p?.net_worth || 0),
                  ts,
                });
              }
              // Always show "today" as the trailing anchor equal to the
              // headline number (canonical Net Worth). This makes the chart
              // reconcile visually with the number above it.
              points.push({ label: 'Today', value: Number(nw || 0), ts: Date.now() });
              // Cap displayed points so labels don't overlap.
              const MAX = period === 'Year' ? 12 : period === 'Quarter' ? 12 : 8;
              const displayPoints = points.length > MAX
                ? points.filter((_, i, arr) => i === arr.length - 1 || i % Math.ceil(arr.length / MAX) === 0)
                : points;
              return (
                <ProjectionLineChart
                  points={displayPoints.map(p => ({ label: p.label, value: p.value }))}
                  ready={!nwHistoryLoading}
                  height={130}
                  strokeColor="#e8c98f"
                  gradientTop="rgba(232,201,143,0.35)"
                  gradientBottom="rgba(232,201,143,0)"
                  labelColor="#e8c98f"
                  labelValueColor="#c3bbb0"
                  emptyColor="#aaa39a"
                  skeletonBg="#2a251f"
                  currency={MONEY as any}
                  emptyLabel={historicalCount === 0
                    ? 'Not enough history yet. Your Net Worth trend will build over the coming days.'
                    : 'Building your trend line…'}
                />
              );
            })()}
          </View>
        )}
      </View>
      {/* Month / Quarter / Year period pills — real controls that drive
          the history chart above. */}
      {readyForNumbers && (
        <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
          <PeriodPills
            values={['Month', 'Quarter', 'Year']}
            value={period}
            onChange={(v: string) => setPeriod(v as any)}
            testID="wealth-period"
          />
        </View>
      )}
      {readyForNumbers ? (
        <View style={[s.cashProtection, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
          <View style={{ flex: 1 }}><Text style={[s.cpSmall, t.textMuted]}>TOTAL CASH</Text><Text style={[s.cpStrong, t.textInk]}>{MONEY(cash)}</Text></View>
          <Text style={{ color: '#b99a6c' }}>−</Text>
        <Pressable onPress={() => setRestrictedOpen(true)} style={{ flex: 1 }} testID="nw-restricted">
          <Text style={[s.cpSmall, t.textMuted]}>SET ASIDE</Text>
          <Text style={[s.cpStrong, t.textInk]}>{MONEY(totalRestricted)}</Text>
          <Text style={{ color: '#c9a56c', fontSize: 8, marginTop: 2 }}>{activeBuckets.length > 0 ? `${activeBuckets.length} bucket${activeBuckets.length > 1 ? 's' : ''} · tap to manage` : 'tap to add'}</Text>
        </Pressable>
        <Text style={{ color: '#b99a6c' }}>=</Text>
        <View style={[{ flex: 1.2 }, s.cpAvailable]}>
          <Text style={[s.cpSmall, { color: '#c8b494' }]}>AVAILABLE</Text>
          <Text style={[s.cpStrong, { color: available < 0 ? '#f2b1a8' : '#f3dfbd' }]}>{MONEY(available)}</Text>
          {available < 0 && (
            <Text style={{ color: '#f2b1a8', fontSize: 8, marginTop: 2, fontWeight: '700' }}>Over-allocated</Text>
          )}
        </View>
      </View>
      ) : (
        // Skeleton for the Cash / Set Aside / Available strip — same height
        // as the live strip so scroll position stays stable when the real
        // data lands.
        <View style={[s.cashProtection, { justifyContent: 'center', opacity: 0.5 }, t.dark && { backgroundColor: D.surface, borderColor: D.border }]}>
          <Text style={[{ fontSize: 10 }, t.textMuted]}>Updating your accounts…</Text>
        </View>
      )}
      <Sheet visible={restrictedOpen} close={() => { setRestrictedOpen(false); setAddingRestricted(false); setEditingBucket(null); resetBucketDraft(); }} title="Set Aside Cash" subtitle="Named buckets for money set aside — taxes, gifts, goals. Each bucket is subtracted from Available Cash but stays part of your Total Cash and Net Worth.">
        <View>
          {/* Preset chips — always visible so users can quickly add common
              buckets. Tapping a chip pre-fills the name in the add form. */}
          {!addingRestricted && activeBuckets.length < 20 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={[{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', marginBottom: 6 }]}>QUICK ADD</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {BUCKET_PRESETS.map((p) => (
                  <Pressable key={p.name} onPress={() => openNewBucket(p.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#e6dcc5', backgroundColor: t.dark ? '#2a251f' : '#fbf6ec' }} testID={`bucket-preset-${p.name.replace(/\W+/g, '-').toLowerCase()}`}>
                    <Ionicons name={p.icon as any} size={12} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '700' }}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {activeBuckets.length === 0 && !addingRestricted && (
            <Text style={{ fontSize: 11, color: C.muted2, marginBottom: 12 }}>No active buckets yet. Tap a preset above or the button below to create your first.</Text>
          )}

          {/* Active buckets list — each with Add/Use quick actions and progress bar */}
          {activeBuckets.map((b: any) => {
            const target = Number(b.target || 0);
            const amt = Number(b.amount || 0);
            const pct = target > 0 ? Math.min(100, (amt / target) * 100) : 0;
            return (
              <View key={b.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable onPress={() => openEditBucket(b)} style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[{ fontSize: 13, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{b.name}</Text>
                        {target > 0 && (
                          <Text style={{ fontSize: 9, color: C.muted2 }}>
                            {MONEY(amt)} of {MONEY(target)}{b.targetDate ? ` · by ${b.targetDate}` : ''}
                          </Text>
                        )}
                        {target === 0 && (
                          <Text style={{ fontSize: 9, color: C.muted2 }}>Tap to set a target or details</Text>
                        )}
                      </View>
                      <Text style={[{ fontSize: 14, fontWeight: '800', color: '#9a6d32' }]}>{MONEY(amt)}</Text>
                    </View>
                    {target > 0 && (
                      <View style={{ height: 5, borderRadius: 4, backgroundColor: t.dark ? '#3a342b' : '#f0e7d1', marginTop: 6, overflow: 'hidden' }}>
                        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: pct >= 100 ? '#4c8b56' : '#c49450' }} />
                      </View>
                    )}
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                  <Pressable onPress={() => { setTxBucket({ bucket: b, action: 'add' }); setTxAmt(''); }} style={{ flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#c49450', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} testID={`bucket-add-${b.id}`}>
                    <Ionicons name="add-circle-outline" size={13} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '800' }}>Add</Text>
                  </Pressable>
                  <Pressable onPress={() => { setTxBucket({ bucket: b, action: 'use' }); setTxAmt(''); }} style={{ flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#c49450', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }} testID={`bucket-use-${b.id}`}>
                    <Ionicons name="remove-circle-outline" size={13} color="#9a6d32" />
                    <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '800' }}>Use</Text>
                  </Pressable>
                  <Pressable onPress={() => archiveBucket(b.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e6dcc5', alignItems: 'center', justifyContent: 'center' }} testID={`bucket-archive-${b.id}`}>
                    <Ionicons name="archive-outline" size={14} color="#9a6d32" />
                  </Pressable>
                  <Pressable onPress={() => deleteBucket(b.id)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#e6dcc5', alignItems: 'center', justifyContent: 'center' }} testID={`bucket-del-${b.id}`}>
                    <Ionicons name="trash-outline" size={14} color="#b06a5b" />
                  </Pressable>
                </View>
              </View>
            );
          })}

          {addingRestricted ? (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>Bucket name</Text>
              <TextInput style={s.input} value={newBucketName} onChangeText={setNewBucketName} placeholder="e.g., Q3 Taxes, Christmas Gifts" autoFocus testID="bucket-name" />
              <Text style={[s.label, { marginTop: 10 }]}>Current amount</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketAmt} onChangeText={setNewBucketAmt} keyboardType="numeric" placeholder="0" testID="bucket-amount" />
              </View>
              <Text style={[s.label, { marginTop: 10 }]}>Target amount (optional)</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketTarget} onChangeText={setNewBucketTarget} keyboardType="numeric" placeholder="0" testID="bucket-target" />
              </View>
              <Text style={[s.label, { marginTop: 10 }]}>Target date (optional)</Text>
              <TextInput style={s.input} value={newBucketTargetDate} onChangeText={setNewBucketTargetDate} placeholder="e.g., Dec 2026" testID="bucket-target-date" />
              <Text style={[s.label, { marginTop: 10 }]}>Recurring contribution / mo (optional)</Text>
              <View style={s.amountInput}>
                <Text style={s.amountPrefix}>$</Text>
                <TextInput style={[s.input, { paddingLeft: 26 }]} value={newBucketRecurring} onChangeText={setNewBucketRecurring} keyboardType="numeric" placeholder="0" testID="bucket-recurring" />
              </View>
              <Text style={[{ fontSize: 9, marginTop: 4 }, t.textMuted]}>
                Recurring is informational for now — a reminder of your plan. It never auto-moves money.
              </Text>
              <View style={{ marginTop: 14 }}>
                <GoldButton label={editingBucket ? 'Save bucket' : 'Add bucket'} onPress={saveBucket} disabled={!newBucketName.trim()} testID="bucket-save" />
              </View>
              <Pressable onPress={() => { setAddingRestricted(false); setEditingBucket(null); resetBucketDraft(); }} style={{ marginTop: 10, alignItems: 'center' }}>
                <Text style={{ color: C.muted2, fontSize: 11 }}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            activeBuckets.length < 20 && (
              <Pressable onPress={() => openNewBucket()} style={[s.subcategoryRow, { justifyContent: 'center', marginTop: 12 }]} testID="bucket-add">
                <Ionicons name="add-circle-outline" size={16} color="#9a6d32" />
                <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>Add custom bucket</Text>
              </Pressable>
            )
          )}

          {activeBuckets.length >= 20 && !addingRestricted && (
            <Text style={{ fontSize: 10, color: C.muted2, marginTop: 8, textAlign: 'center' }}>
              You&apos;ve reached the 20-bucket limit. Archive or delete one to add more.
            </Text>
          )}

          {archivedBuckets.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Pressable onPress={() => setShowArchived(!showArchived)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }} testID="bucket-archived-toggle">
                <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39' }]}>ARCHIVED ({archivedBuckets.length})</Text>
                <Ionicons name={showArchived ? 'chevron-down' : 'chevron-forward'} size={13} color="#a97c39" />
              </Pressable>
              {showArchived && archivedBuckets.map((b: any) => (
                <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, opacity: 0.6 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{b.name}</Text>
                    <Text style={{ fontSize: 9, color: C.muted2 }}>{MONEY(b.amount)} · archived (not counted)</Text>
                  </View>
                  <Pressable onPress={() => archiveBucket(b.id)} style={{ paddingHorizontal: 8, paddingVertical: 6 }} testID={`bucket-unarchive-${b.id}`}>
                    <Ionicons name="arrow-undo-outline" size={14} color="#9a6d32" />
                  </Pressable>
                  <Pressable onPress={() => deleteBucket(b.id)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                    <Ionicons name="trash-outline" size={14} color="#b06a5b" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </Sheet>

      {/* Add / Use money sheet — quick +/- flow. Never lets a bucket go below $0. */}
      <Sheet visible={!!txBucket} close={() => { setTxBucket(null); setTxAmt(''); }} title={txBucket ? `${txBucket.action === 'add' ? 'Add to' : 'Use from'} ${txBucket.bucket.name}` : ''} subtitle={txBucket?.action === 'add' ? 'Allocate money from Available Cash to this bucket.' : 'Return money from this bucket to Available Cash. Bucket stays at $0 minimum.'}>
        {txBucket && (
          <View>
            <Text style={s.label}>Amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={txAmt} onChangeText={setTxAmt} keyboardType="numeric" placeholder="0" autoFocus testID="bucket-tx-amt" />
            </View>
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Current: {MONEY(txBucket.bucket.amount)}{txBucket.action === 'use' ? ` · Max you can use: ${MONEY(txBucket.bucket.amount)}` : ''}
            </Text>
            <View style={{ marginTop: 14 }}>
              <GoldButton label={`${txBucket.action === 'add' ? 'Add' : 'Use'} money`} onPress={commitBucketTx} testID="bucket-tx-save" />
            </View>
          </View>
        )}
      </Sheet>
      <Sheet visible={!!editRow} close={() => setEditRow(null)} title={editRow ? `Edit · ${editRow.row.name}` : ''} subtitle={editRow?.row.id === 'cash' || editRow?.row.id === 'investments' ? 'This value is added on top of any linked account balances.' : 'Update the name or amount at any time.'}>
        {editRow && (
          <View>
            {(editRow.row.id !== 'cash' && editRow.row.id !== 'investments') && (
              <>
                <Text style={s.label}>Name</Text>
                <TextInput style={s.input} value={rowDraftName} onChangeText={setRowDraftName} testID="row-name" />
              </>
            )}
            <Text style={s.label}>Amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={rowDraftAmt} onChangeText={setRowDraftAmt} keyboardType="numeric" placeholder="0" testID="row-amount" />
            </View>
            <View style={{ marginTop: 12 }}>
              <GoldButton label="Save" onPress={() => {
                const cleanAmt = Math.max(0, Math.round(Number((rowDraftAmt || '').replace(/[^0-9.]/g, '')) || 0));
                const cleanName = rowDraftName.trim() || editRow.row.name;
                if (editRow.side === 'assets') {
                  const isBuiltin = editRow.row.id === 'cash' || editRow.row.id === 'investments';
                  if (isBuiltin) setAssets((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, value: cleanAmt } : x));
                  else setAssets((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, name: cleanName, value: cleanAmt } : x));
                } else {
                  setLiabilities((prev: Asset[]) => prev.map((x) => x.id === editRow.row.id ? { ...x, name: cleanName, value: cleanAmt } : x));
                }
                setEditRow(null); setRowDraftName(''); setRowDraftAmt('');
              }} testID="row-save" />
            </View>
            {(editRow.row.id !== 'cash' && editRow.row.id !== 'investments') && (
              <Pressable onPress={() => {
                const doIt = () => {
                  if (editRow.side === 'assets') setAssets((prev: Asset[]) => prev.filter((x) => x.id !== editRow.row.id));
                  else setLiabilities((prev: Asset[]) => prev.filter((x) => x.id !== editRow.row.id));
                  setEditRow(null);
                };
                if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`Remove "${editRow.row.name}"?`)) doIt(); }
                else { Alert.alert(`Remove "${editRow.row.name}"?`, 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: doIt }]); }
              }} style={{ marginTop: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }} testID="row-delete">
                <Ionicons name="trash-outline" size={14} color={C.danger} /><Text style={{ color: C.danger, fontSize: 11 }}>Remove</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>
      <Sheet visible={!!addingRowSide} close={() => { setAddingRowSide(null); setRowDraftName(''); setRowDraftAmt(''); }} title={addingRowSide === 'assets' ? 'Add asset' : 'Add liability'} subtitle="Anything you own (asset) or owe (liability).">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={rowDraftName} onChangeText={setRowDraftName} placeholder={addingRowSide === 'assets' ? 'e.g., Rental property, Jewelry' : 'e.g., Personal loan, Medical debt'} autoFocus testID="row-add-name" />
          <Text style={s.label}>Amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={rowDraftAmt} onChangeText={setRowDraftAmt} keyboardType="numeric" placeholder="0" testID="row-add-amount" />
          </View>
          <View style={{ marginTop: 12 }}>
            <GoldButton label={`Add ${addingRowSide === 'assets' ? 'asset' : 'liability'}`} onPress={() => {
              const cleanAmt = Math.max(0, Math.round(Number((rowDraftAmt || '').replace(/[^0-9.]/g, '')) || 0));
              const cleanName = rowDraftName.trim();
              if (!cleanName || !addingRowSide) return;
              const id = `${addingRowSide}-${Date.now()}`;
              const icon = addingRowSide === 'assets' ? 'cube-outline' : 'card-outline';
              const row: Asset = { id, name: cleanName, value: cleanAmt, source: 'Manual', icon };
              if (addingRowSide === 'assets') setAssets((prev: Asset[]) => [...prev, row]);
              else setLiabilities((prev: Asset[]) => [...prev, row]);
              setAddingRowSide(null); setRowDraftName(''); setRowDraftAmt('');
            }} disabled={!rowDraftName.trim()} testID="row-add-save" />
          </View>
        </View>
      </Sheet>

      {/* Wealth by category — single primary Assets/Liabilities tree with
          collapsible per-category rows. Category totals equal the sum of the
          accounts underneath. The old duplicate WorthCard/List above this was
          removed (spec: "Keep one primary Wealth structure only"). */}
      <View style={[s.assumptionsCard, t.cardBg, { marginTop: 12 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={[{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4 }, t.textInk]}>ASSETS & LIABILITIES</Text>
          <Pressable onPress={doSyncAll} disabled={syncingAll} testID="wealth-sync-all" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name={syncingAll ? 'sync-outline' : 'refresh-outline'} size={12} color="#9a6d32" />
            <Text style={{ fontSize: 10, color: '#9a6d32', fontWeight: '700' }}>{syncingAll ? 'Syncing…' : 'Sync'}</Text>
          </Pressable>
        </View>
        <Text style={[{ fontSize: 9, marginBottom: 8 }, t.textMuted]} testID="wealth-last-sync">
          {lastSyncLabel}
        </Text>
        {(['assets', 'liabilities'] as const).map((side) => {
          const groups = side === 'assets' ? assetGroups : liabilityGroups;
          const sideTotal = side === 'assets' ? assetsCategoriesTotal : liabilitiesCategoriesTotal;
          return (
            <View key={side} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}>
                <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }, t.textInk]}>{side === 'assets' ? 'ASSETS' : 'LIABILITIES'}</Text>
                <Text style={[{ fontSize: 11, fontWeight: '800' }, t.textInk]}>{visible ? MONEY(sideTotal) : '••••'}</Text>
              </View>
              {groups.map((g) => {
                const isOpen = !!expandedCats[g.slug];
                const rowCount = g.linkedRows.length + g.manualExtras.length + (g.manualSeedValue > 0 ? 1 : 0);
                // Always render the 10 standard categories — even at $0 with
                // zero rows — so first-time users can tap "+ Add Manual
                // Account" inside any category (spec #2).
                return (
                  <View key={g.slug}>
                    <Pressable onPress={() => toggleCat(g.slug)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f5f0e6' }} testID={`wealth-cat-${g.slug}`}>
                      <Ionicons name={g.icon} size={14} color="#9a6d32" style={{ marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{g.label}</Text>
                        <Text style={[{ fontSize: 8 }, t.textMuted]}>{rowCount} account{rowCount === 1 ? '' : 's'}</Text>
                      </View>
                      <Text style={[{ fontSize: 12, fontWeight: '800', marginRight: 6 }, t.textInk]}>{visible ? MONEY(g.total) : '••••'}</Text>
                      <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={t.dark ? D.textMuted : '#aaa39a'} />
                    </Pressable>
                    {isOpen && (
                      <View style={{ paddingLeft: 20, paddingVertical: 4 }}>
                        {g.manualSeedValue > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>{g.slug === 'cash' ? 'Manual cash' : 'Manual investments'}</Text>
                              <Text style={[{ fontSize: 8 }, t.textMuted]}>Manual · edit in Wealth</Text>
                            </View>
                            <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(g.manualSeedValue) : '••••'}</Text>
                          </View>
                        )}
                        {g.linkedRows.map((r: any) => {
                          const isManualBacked = r.provider === 'manual';
                          // Spec #2: merge-hint — surface a lightweight prompt
                          // when a manual account looks like a linked Plaid
                          // row already present in the same category. Fuzzy:
                          // case-insensitive substring match on the trimmed
                          // display name. Users decide whether to merge
                          // (delete the manual) or keep both.
                          const mergeHint = isManualBacked
                            ? g.linkedRows.find((other: any) => other.provider === 'plaid' && _nameMatch(other.name, r.name))
                            : null;
                          if (isManualBacked) {
                            return (
                              <View key={`m-${r.account_id}`}>
                                <Pressable
                                  onPress={() => openManualEdit(g.slug, r)}
                                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                                  testID={`wealth-manual-row-${r.account_id}`}
                                >
                                  <View style={{ flex: 1 }}>
                                    <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]} numberOfLines={1}>{r.name}</Text>
                                    <Text style={[{ fontSize: 8 }, t.textMuted]}>
                                      {r.org_name && r.org_name !== 'Manual' ? `${r.org_name} · ` : ''}Manual · tap to edit
                                    </Text>
                                  </View>
                                  <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(Number(r.balance || 0)) : '••••'}</Text>
                                </Pressable>
                                {mergeHint && (
                                  <View style={{ marginTop: 4, marginBottom: 8, padding: 8, borderRadius: 8, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderLeftWidth: 3, borderLeftColor: '#c49450' }}>
                                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#9a6d32' }}>
                                      Matches your linked {mergeHint.name}
                                    </Text>
                                    <Text style={{ fontSize: 9, color: t.dark ? D.textMuted : '#8d806e', marginTop: 3, lineHeight: 13 }}>
                                      Both accounts count toward Net Worth. Merge to delete this manual entry (linked one stays).
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                                      <Pressable
                                        onPress={async () => {
                                          if (!token) return;
                                          await apiCall(`/api/accounts/manual/${r.account_id}`, { method: 'DELETE' }, token);
                                          refreshLinked();
                                          if (typeof onRefreshAccounts === 'function') onRefreshAccounts();
                                        }}
                                        style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#b28a4c' }}
                                        testID={`wealth-manual-merge-${r.account_id}`}
                                      >
                                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>Merge & delete manual</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                )}
                              </View>
                            );
                          }
                          return (
                            <Pressable key={`${r.link_id}-${r.account_id}`} onPress={() => setReclassifyAccount(r)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }} testID={`wealth-cat-acc-${r.account_id}`}>
                              <View style={{ flex: 1 }}>
                                <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]} numberOfLines={1}>{r.name}</Text>
                                <Text style={[{ fontSize: 8 }, t.textMuted]}>{r.org_name || 'Linked'} · Synced{r.last_sync_at ? ' · ' + timeAgo(r.last_sync_at) : ''}</Text>
                              </View>
                              <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(Number(r.balance || 0)) : '••••'}</Text>
                            </Pressable>
                          );
                        })}
                        {g.manualExtras.map((r: Asset) => (
                          <Pressable key={`m-${r.id}`} onPress={() => { setEditRow({ side, row: r }); setRowDraftName(r.name); setRowDraftAmt(r.value ? String(r.value) : ''); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[{ fontSize: 11, fontWeight: '600' }, t.textInk]}>{r.name}</Text>
                              <Text style={[{ fontSize: 8 }, t.textMuted]}>Manual (legacy)</Text>
                            </View>
                            <Text style={[{ fontSize: 11 }, t.textInk]}>{visible ? MONEY(r.value) : '••••'}</Text>
                          </Pressable>
                        ))}
                        {/* + Add Manual Account (spec #2) — pre-fills category from context */}
                        <Pressable
                          onPress={() => openManualAdd(g.slug)}
                          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: t.dark ? '#3a342b' : '#f0ebe4' }}
                          testID={`wealth-add-manual-${g.slug}`}
                        >
                          <Ionicons name="add-circle-outline" size={16} color="#9a6d32" style={{ marginRight: 6 }} />
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#9a6d32' }}>Add Manual Account</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      <Sheet
        visible={!!reclassifyAccount}
        close={() => setReclassifyAccount(null)}
        title="Rename or reclassify"
        subtitle="Fix how this account contributes to your Net Worth."
      >
        {reclassifyAccount ? (
          <ReclassifySheet
            account={reclassifyAccount}
            token={token}
            isDark={t.dark}
            onDone={(_updated) => { setReclassifyAccount(null); refreshLinked(); }}
            onClose={() => setReclassifyAccount(null)}
          />
        ) : null}
      </Sheet>
      {/* Manual account editor (spec #2) — used for both Add and Edit. Category
          is derived from the tap context so users never have to pick it. */}
      <Sheet
        visible={!!manualEditor}
        close={closeManualEditor}
        title={manualEditor?.mode === 'edit' ? 'Edit manual account' : 'Add manual account'}
        subtitle={manualEditor ? `${CATEGORY_LABELS[manualEditor.category] || manualEditor.category} · counts toward ${['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities'].includes(manualEditor.category) ? 'Total Liabilities' : 'Total Assets'}` : ''}
      >
        {manualEditor ? (
          <View>
            <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.textMuted : '#7a6d55', marginBottom: 6 }}>ACCOUNT NAME</Text>
            <TextInput
              value={manDraftName}
              onChangeText={setManDraftName}
              placeholder="e.g. Emergency fund, Backyard remodel"
              style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 12, fontSize: 14, backgroundColor: '#fff' }, t.inputBg]}
              placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
              testID="wealth-manual-name"
            />
            <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.textMuted : '#7a6d55', marginTop: 14, marginBottom: 6 }}>
              {['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities'].includes(manualEditor.category) ? 'AMOUNT OWED' : 'CURRENT BALANCE'}
            </Text>
            <TextInput
              value={manDraftBal}
              onChangeText={setManDraftBal}
              placeholder="0.00"
              keyboardType="decimal-pad"
              style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 12, fontSize: 14, backgroundColor: '#fff' }, t.inputBg]}
              placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
              testID="wealth-manual-balance"
            />
            <Text style={{ fontSize: 10, fontWeight: '700', color: t.dark ? D.textMuted : '#7a6d55', marginTop: 14, marginBottom: 6 }}>INSTITUTION (OPTIONAL)</Text>
            <TextInput
              value={manDraftInst}
              onChangeText={setManDraftInst}
              placeholder="e.g. Local Credit Union, Vanguard, Zillow"
              style={[{ borderWidth: 1, borderColor: '#eae3d5', borderRadius: 12, padding: 12, fontSize: 14, backgroundColor: '#fff' }, t.inputBg]}
              placeholderTextColor={t.dark ? '#5a5148' : '#b0a89c'}
              testID="wealth-manual-institution"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
              <Pressable
                onPress={saveManual}
                disabled={manSaving || !manDraftName.trim()}
                style={{ flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: '#b28a4c', alignItems: 'center', justifyContent: 'center', opacity: manSaving || !manDraftName.trim() ? 0.5 : 1 }}
                testID="wealth-manual-save"
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                  {manualEditor.mode === 'edit' ? 'Save changes' : 'Add account'}
                </Text>
              </Pressable>
              {manualEditor.mode === 'edit' && (
                <Pressable
                  onPress={deleteManual}
                  disabled={manSaving}
                  style={{ paddingHorizontal: 18, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#e3c9c4', alignItems: 'center', justifyContent: 'center' }}
                  testID="wealth-manual-delete"
                >
                  <Ionicons name="trash-outline" size={16} color="#b0453d" />
                </Pressable>
              )}
            </View>
            <Text style={{ fontSize: 10, color: t.dark ? D.textMuted : '#8d806e', marginTop: 12, textAlign: 'center', lineHeight: 14 }}>
              Manual accounts flow into Total {['credit_cards', 'mortgage', 'auto_loans', 'student_loans', 'other_liabilities'].includes(manualEditor.category) ? 'Liabilities' : 'Assets'}, Net Worth, and Legacy BUILD/GROW immediately.
            </Text>
          </View>
        ) : null}
      </Sheet>
    </ScrollView>
  );
};
