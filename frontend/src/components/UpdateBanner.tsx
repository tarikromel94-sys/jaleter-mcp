/**
 * UpdateBanner — informs users on an older production version that a new
 * release is on the stores.
 *
 * - Polls PUBLIC `GET /api/app/version` on mount + whenever the app
 *   foregrounds, and compares against the installed version
 *   (Constants.expoConfig.version, set from app.json at build time).
 * - Newer version → slim dismissible banner. Dismissal is per-version
 *   (persisted), so the banner returns only for the NEXT release.
 * - `critical: true` releases → full-screen blocking overlay instead
 *   (reserved for must-update situations; normal releases are informational).
 * - "Update" opens the right store link (ios_url / android_url) when the
 *   release provides one; otherwise the banner is message-only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, Platform, Linking, AppState, StyleSheet } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import { apiCall } from '@/src/AuthContext';
import { storage } from '@/src/utils/storage';

const DISMISS_KEY = 'jaleter_update_dismissed_version';

type ReleaseInfo = {
  version: string | null;
  critical?: boolean;
  notes?: string;
  ios_url?: string | null;
  android_url?: string | null;
};

/** Numeric compare of dotted versions: 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function UpdateBanner({ isDark = false }: { isDark?: boolean }) {
  const [latest, setLatest] = useState<ReleaseInfo | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const installed = Constants.expoConfig?.version || '0.0.0';

  const load = useCallback(async () => {
    try {
      const res = await apiCall('/api/app/version', { method: 'GET' });
      if (res?.version) setLatest(res);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    storage.getItem(DISMISS_KEY, '' as string).then((v: string) => setDismissedVersion(v || null)).catch(() => {});
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  if (!latest?.version) return null;
  if (compareVersions(latest.version, installed) <= 0) return null;

  const storeUrl = Platform.OS === 'ios' ? latest.ios_url : Platform.OS === 'android' ? latest.android_url : (latest.ios_url || latest.android_url);
  const openStore = () => { if (storeUrl) Linking.openURL(storeUrl).catch(() => {}); };

  // Critical release → blocking overlay. Reserved for truly critical fixes.
  if (latest.critical) {
    return (
      <Modal visible transparent animationType="fade">
        <View style={st.criticalWrap}>
          <View style={[st.criticalCard, isDark && { backgroundColor: '#1d1a14' }]}>
            <Ionicons name="cloud-download-outline" size={34} color="#c49450" />
            <Text style={[st.criticalTitle, isDark && { color: '#f0ead9' }]}>Update required</Text>
            <Text style={[st.criticalBody, isDark && { color: '#b7b0a4' }]}>
              This version of Jaleter is no longer supported. Please update through the
              {Platform.OS === 'android' ? ' Google Play Store' : ' App Store'} to continue.
            </Text>
            {storeUrl ? (
              <Pressable onPress={openStore} style={st.criticalBtn} testID="update-critical-open">
                <Text style={st.criticalBtnText}>Update now</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    );
  }

  if (dismissedVersion === latest.version) return null;

  return (
    <View style={[st.banner, isDark && { backgroundColor: '#2a2214', borderColor: '#4a3c22' }]} testID="update-banner">
      <Ionicons name="sparkles-outline" size={14} color="#c49450" />
      <Text style={[st.bannerText, isDark && { color: '#e8dfc9' }]} numberOfLines={2}>
        A new version of Jaleter is available{latest.notes ? ` — ${latest.notes}` : ''}
      </Text>
      {storeUrl ? (
        <Pressable onPress={openStore} hitSlop={8} testID="update-banner-open">
          <Text style={st.bannerLink}>Update</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => { setDismissedVersion(latest.version); storage.setItem(DISMISS_KEY, latest.version!).catch(() => {}); }}
        hitSlop={8}
        testID="update-banner-dismiss"
      >
        <Ionicons name="close" size={14} color={isDark ? '#8f887c' : '#a89d8b'} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8f1e2', borderColor: '#e5d7bb', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    marginHorizontal: 16, marginTop: 8,
  },
  bannerText: { flex: 1, fontSize: 11, color: '#57503f', fontWeight: '600' },
  bannerLink: { fontSize: 11, fontWeight: '800', color: '#b18245' },
  criticalWrap: { flex: 1, backgroundColor: '#17130ee6', alignItems: 'center', justifyContent: 'center', padding: 28 },
  criticalCard: { backgroundColor: '#fbf9f4', borderRadius: 18, padding: 26, alignItems: 'center', maxWidth: 340 },
  criticalTitle: { fontSize: 17, fontWeight: '800', color: '#2a2419', marginTop: 10 },
  criticalBody: { fontSize: 12, color: '#6e675a', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  criticalBtn: { marginTop: 16, backgroundColor: '#c49450', borderRadius: 12, paddingHorizontal: 26, paddingVertical: 11 },
  criticalBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
