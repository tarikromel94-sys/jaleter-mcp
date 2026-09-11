/**
 * ReclassifySheet — lets the user rename a linked account and change its
 * Jaleter category (Cash / Investments / Credit Cards / Mortgage / …).
 *
 * Guardrails (backend-enforced but mirrored here for good UX):
 *   - Switching between an asset and a liability requires an explicit
 *     confirmation modal. Without it, the backend returns HTTP 409 with a
 *     structured `side_switch_requires_confirmation` payload; we detect that
 *     and re-submit with `allow_side_switch: true` after user confirms.
 *   - "Revert to default" clears both overrides (name + category) so the
 *     Plaid-provided classification takes effect again.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, ScrollView, Alert } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { apiCall } from '@/src/AuthContext';

type CategoryOption = { slug: string; label: string; is_asset: boolean };
type CategoryList = { assets: CategoryOption[]; liabilities: CategoryOption[] };

export type LinkedAccountRow = {
  account_id: string;
  name: string;
  auto_name?: string;
  category: string;
  auto_category?: string;
  category_label?: string;
  category_overridden?: boolean;
  name_overridden?: boolean;
  balance?: number;
  org_name?: string;
  last_sync_at?: string;
  plaid_type?: string;
  plaid_subtype?: string;
};

export function ReclassifySheet({
  account,
  token,
  onDone,
  onClose,
  isDark = false,
}: {
  account: LinkedAccountRow | null;
  token: string | null;
  onDone: (updated: any) => void;
  onClose: () => void;
  isDark?: boolean;
}) {
  const [categories, setCategories] = useState<CategoryList | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [pickedSlug, setPickedSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setNameInput(account.name || '');
    setPickedSlug(account.category || '');
    setError(null);
  }, [account]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiCall('/api/accounts/categories', { method: 'GET' }, token)
      .then((data: any) => { if (alive) setCategories(data as CategoryList); })
      .catch(() => { if (alive) setError('Could not load categories.'); });
    return () => { alive = false; };
  }, [token]);

  const currentIsAsset = useMemo(() => {
    if (!account || !categories) return true;
    const all = [...categories.assets, ...categories.liabilities];
    return all.find((c) => c.slug === account.category)?.is_asset ?? true;
  }, [account, categories]);
  const pickedIsAsset = useMemo(() => {
    if (!categories) return currentIsAsset;
    const all = [...categories.assets, ...categories.liabilities];
    return all.find((c) => c.slug === pickedSlug)?.is_asset ?? currentIsAsset;
  }, [pickedSlug, categories, currentIsAsset]);
  const sideSwitching = pickedIsAsset !== currentIsAsset && pickedSlug !== '';

  const submit = async (allowSideSwitch = false) => {
    if (!account) return;
    setBusy(true); setError(null);
    const nameOverride = (nameInput || '').trim();
    const nameToSend = nameOverride && nameOverride !== (account.auto_name || '') ? nameOverride : '';
    const catToSend = pickedSlug && pickedSlug !== account.auto_category ? pickedSlug : '';
    try {
      const data = await apiCall(`/api/accounts/${encodeURIComponent(account.account_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          override_category: catToSend,
          override_name: nameToSend,
          allow_side_switch: allowSideSwitch,
        }),
      }, token);
      onDone(data.account);
    } catch (e: any) {
      // Side-switch confirmation — retry after Alert.
      const detail = e?.detail || e?.data?.detail;
      const errorKey = detail?.error || e?.errorKey;
      if (e?.status === 409 || errorKey === 'side_switch_requires_confirmation') {
        Alert.alert(
          'Change asset ↔ liability?',
          `You're changing this account from ${currentIsAsset ? 'an asset' : 'a liability'} to ${pickedIsAsset ? 'an asset' : 'a liability'}. This changes how the balance affects your Net Worth. Continue?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
            { text: 'Yes, change it', style: 'destructive', onPress: () => submit(true) },
          ],
        );
        return;
      }
      setError(e?.message || 'Could not save.');
    } finally {
      if (!sideSwitching || allowSideSwitch) setBusy(false);
    }
  };

  const revert = async () => {
    if (!account) return;
    setBusy(true); setError(null);
    try {
      const data = await apiCall(`/api/accounts/${encodeURIComponent(account.account_id)}/override`, { method: 'DELETE' }, token);
      onDone(data.account);
    } catch (e: any) {
      setError(e?.message || 'Could not revert.');
    } finally { setBusy(false); }
  };

  if (!account) return null;

  const border = isDark ? '#3a3428' : '#ece3d1';
  const ink = isDark ? '#f2ead8' : '#171611';
  const muted = isDark ? '#a49b87' : '#8a8172';
  const accent = '#c49450';

  const renderPickerRow = (opt: CategoryOption) => {
    const picked = opt.slug === pickedSlug;
    return (
      <Pressable
        key={opt.slug}
        onPress={() => setPickedSlug(opt.slug)}
        style={{
          paddingHorizontal: 12, paddingVertical: 10,
          borderRadius: 10, borderWidth: 1,
          borderColor: picked ? accent : border,
          backgroundColor: picked ? accent + '18' : 'transparent',
          marginBottom: 6,
          flexDirection: 'row', alignItems: 'center', gap: 8,
        }}
        testID={`cat-opt-${opt.slug}`}
      >
        <View style={{
          width: 16, height: 16, borderRadius: 8,
          borderWidth: 2, borderColor: picked ? accent : border,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {picked ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} /> : null}
        </View>
        <Text style={{ fontSize: 13, fontWeight: '600', color: ink }}>{opt.label}</Text>
        {opt.slug === account.auto_category ? (
          <Text style={{ fontSize: 9, color: muted, marginLeft: 'auto' }}>Default</Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View>
      <Text style={{ fontSize: 10, letterSpacing: 1.4, color: muted, fontWeight: '700' }}>
        {account.org_name?.toUpperCase() || 'LINKED ACCOUNT'} · SYNCED
      </Text>
      <Text style={{ fontSize: 10, color: muted, marginTop: 2 }}>
        Plaid: {account.plaid_type || '—'}/{account.plaid_subtype || '—'} · Current: {account.category_label || account.category}
      </Text>

      <View style={{ marginTop: 14 }}>
        <Text style={{ fontSize: 11, color: muted, marginBottom: 4, fontWeight: '700' }}>Display name</Text>
        <TextInput
          value={nameInput}
          onChangeText={setNameInput}
          placeholder={account.auto_name || 'Account name'}
          placeholderTextColor={muted}
          style={{
            borderWidth: 1, borderColor: border, borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 9, color: ink, fontSize: 14,
            backgroundColor: isDark ? '#20180c' : '#fff',
          }}
          testID="reclassify-name"
        />
      </View>

      {!categories ? (
        <View style={{ padding: 20, alignItems: 'center' }}><ActivityIndicator color={accent} /></View>
      ) : (
        <ScrollView style={{ maxHeight: 320, marginTop: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 10, letterSpacing: 1.4, color: muted, fontWeight: '700', marginBottom: 6 }}>ASSET CATEGORIES</Text>
          {categories.assets.map(renderPickerRow)}
          <Text style={{ fontSize: 10, letterSpacing: 1.4, color: muted, fontWeight: '700', marginBottom: 6, marginTop: 8 }}>LIABILITY CATEGORIES</Text>
          {categories.liabilities.map(renderPickerRow)}
        </ScrollView>
      )}

      {sideSwitching ? (
        <View style={{
          marginTop: 10, padding: 10, borderRadius: 10,
          backgroundColor: '#fbeeec', borderWidth: 1, borderColor: '#f0d0c7',
          flexDirection: 'row', gap: 6, alignItems: 'flex-start',
        }}>
          <Ionicons name="warning-outline" size={14} color="#b0453d" style={{ marginTop: 1 }} />
          <Text style={{ fontSize: 10, color: '#b0453d', flex: 1, lineHeight: 14 }}>
            You&apos;re switching this account between an asset and a liability. We&apos;ll ask you to confirm before saving.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={{ marginTop: 8, fontSize: 11, color: '#b0453d' }}>{error}</Text> : null}

      <View style={{ marginTop: 14, gap: 8 }}>
        <Pressable
          onPress={() => submit(false)}
          disabled={busy}
          style={{
            paddingVertical: 12, borderRadius: 12,
            backgroundColor: accent,
            alignItems: 'center', opacity: busy ? 0.6 : 1,
          }}
          testID="reclassify-save"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Save changes</Text>}
        </Pressable>
        {(account.category_overridden || account.name_overridden) ? (
          <Pressable onPress={revert} disabled={busy} style={{ paddingVertical: 10, alignItems: 'center' }} testID="reclassify-revert">
            <Text style={{ color: accent, fontSize: 12, fontWeight: '600' }}>Revert to bank default</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={{ paddingVertical: 8, alignItems: 'center' }}>
          <Text style={{ color: muted, fontSize: 12 }}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
