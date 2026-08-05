/**
 * Plaid Link client — platform-aware wrapper.
 *
 * - On web (Expo Web preview): uses `react-plaid-link`'s `usePlaidLink` hook.
 * - On native (iOS/Android in a development build): uses
 *   `react-native-plaid-link-sdk`'s session API. **This will NOT work in
 *   Expo Go**; only in a compiled development/production build.
 *
 * All the sensitive tokens live on the server. The frontend only sees:
 *   1. a short-lived `link_token` (fetched from /api/plaid/link-token)
 *   2. a one-time `public_token` returned from Plaid Link on success
 *
 * On success we call /api/plaid/exchange-public-token so the server can
 * swap the `public_token` for a long-lived `access_token` and store it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiCall } from '@/src/AuthContext';
import { C } from '@/src/jaleterTheme';

// Load the native SDK lazily so the Expo Web bundle never touches it.
let PlaidNativeSDK: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PlaidNativeSDK = require('react-native-plaid-link-sdk');
  } catch {
    // Missing native module in Expo Go — we handle this gracefully at click time.
  }
}

// Load the web SDK lazily so react-native native builds don't need it.
let usePlaidLinkHook: any = null;
if (Platform.OS === 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    usePlaidLinkHook = require('react-plaid-link').usePlaidLink;
  } catch {
    // ignore
  }
}

export type PlaidSuccessMeta = {
  institution_name?: string | null;
  institution_id?: string | null;
};

type Props = {
  token: string | null;
  onLinked: (institutionName: string) => void;
  compact?: boolean;
  testID?: string;
};

/**
 * Web-only sub-component. Rendered only when a `link_token` is available.
 * Using a dedicated child ensures `usePlaidLink` (which requires a real
 * link_token) is never called with a null token.
 */
function WebPlaidLauncher({ linkToken, onSuccess, onExit }: {
  linkToken: string;
  onSuccess: (publicToken: string, metadata: any) => void;
  onExit: (error: any) => void;
}) {
  const { open, ready, error } = usePlaidLinkHook({
    token: linkToken,
    onSuccess,
    onExit,
    onEvent: () => {},
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  if (error) return <Text style={styles.error}>Unable to load Plaid Link. Please try again.</Text>;
  return <Text style={styles.hint}>Opening Plaid…</Text>;
}

export function ConnectPlaidButton({ token, onLinked, compact, testID }: Props) {
  const [busy, setBusy] = useState(false);
  const [webToken, setWebToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [env, setEnv] = useState<string>('');
  const linkedOnce = useRef(false);

  // Fetch the current Plaid environment on mount so we can warn the user
  // that real phone numbers won't work in sandbox mode.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await apiCall('/api/plaid/status', { method: 'GET' }, token);
        if (!cancelled) setEnv(status?.env || '');
      } catch { /* silent — button still works if status fails */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const isSandbox = env === 'sandbox';

  const exchange = useCallback(async (publicToken: string, metadata: any) => {
    try {
      const inst = metadata?.institution || {};
      const data = await apiCall('/api/plaid/exchange-public-token', {
        method: 'POST',
        body: JSON.stringify({
          public_token: publicToken,
          institution_name: inst?.name || null,
          institution_id: inst?.institution_id || null,
        }),
      }, token);
      const name = data?.institution_name || inst?.name || 'Bank';
      linkedOnce.current = true;
      onLinked(name);
    } catch (e: any) {
      setError(e?.message || 'Failed to link bank.');
    } finally {
      setBusy(false);
      setWebToken(null);
    }
  }, [token, onLinked]);

  const onPress = useCallback(async () => {
    if (!token) { setError('Please sign in first.'); return; }
    setError(''); setBusy(true);
    try {
      const data = await apiCall('/api/plaid/link-token', { method: 'POST' }, token);
      const linkToken: string = data?.link_token;
      if (!linkToken) throw new Error('No link_token returned');
      if (Platform.OS === 'web') {
        // Kick off web flow — WebPlaidLauncher will render + open.
        setWebToken(linkToken);
      } else {
        if (!PlaidNativeSDK) {
          setError('Plaid requires a native build. In Expo Go, use "Import statement" instead. This button will work in your published app.');
          setBusy(false);
          return;
        }
        // react-native-plaid-link-sdk v13 API: create() then open().
        try {
          if (typeof PlaidNativeSDK.create === 'function') {
            PlaidNativeSDK.create({ token: linkToken });
          }
          PlaidNativeSDK.open({
            onSuccess: (success: any) => {
              const publicToken = success?.publicToken || success?.public_token;
              const metadata = { institution: success?.metadata?.institution || success?.institution };
              exchange(publicToken, metadata);
            },
            onExit: (exit: any) => {
              setBusy(false);
              if (exit?.error) setError(exit.error?.errorMessage || 'Plaid Link cancelled.');
            },
          });
        } catch (e: any) {
          setError(e?.message || 'Could not open Plaid Link.');
          setBusy(false);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Could not start Plaid Link.');
      setBusy(false);
    }
  }, [token, exchange]);

  return (
    <View style={{ gap: 8 }}>
      {isSandbox ? (
        <View style={styles.sandboxBanner} testID="plaid-sandbox-banner">
          <Ionicons name="flask-outline" size={14} color="#a97c39" />
          <View style={{ flex: 1 }}>
            <Text style={styles.sandboxTitle}>Plaid is in sandbox (test) mode</Text>
            <Text style={styles.sandboxBody}>
              Real bank credentials and phone numbers will be rejected. To test, use{' '}
              <Text style={{ fontWeight: '800' }}>user_good</Text> /{' '}
              <Text style={{ fontWeight: '800' }}>pass_good</Text>, phone{' '}
              <Text style={{ fontWeight: '800' }}>+14155550000</Text>, SMS code{' '}
              <Text style={{ fontWeight: '800' }}>1234</Text>. Switch to production keys to accept real banks.
            </Text>
          </View>
        </View>
      ) : null}
      <Pressable
        testID={testID || 'plaid-connect-btn'}
        onPress={onPress}
        disabled={busy}
        style={[compact ? styles.rowBtn : styles.blockBtn, busy && { opacity: 0.6 }]}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="business-outline" size={compact ? 20 : 22} color={C.goldEyebrow} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{busy ? 'Connecting…' : 'Connect a bank (Plaid)'}</Text>
          <Text style={styles.sub}>
            {isSandbox
              ? 'Sandbox mode — use test credentials only.'
              : Platform.OS === 'web'
                ? 'Secure, encrypted bank link with 11,000+ institutions.'
                : 'Secure bank link — works in your published/native build.'}
          </Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={C.goldEyebrow} /> : <Ionicons name="chevron-forward" size={16} color="#aaa39a" />}
      </Pressable>
      {webToken && Platform.OS === 'web' && usePlaidLinkHook ? (
        <WebPlaidLauncher
          linkToken={webToken}
          onSuccess={(pt: string, meta: any) => exchange(pt, meta)}
          onExit={(err: any) => { setBusy(false); setWebToken(null); if (err) setError(err?.error_message || 'Plaid Link cancelled.'); }}
        />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8dcc4',
    backgroundColor: '#fbf6ec',
    gap: 10,
  },
  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#efe6d3',
    backgroundColor: '#fff',
    gap: 10,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#f2e6c9', alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 12, fontWeight: '800', color: '#2a2620' },
  sub: { fontSize: 9, color: '#8a7f70', marginTop: 2 },
  hint: { fontSize: 10, color: '#8a7f70', marginTop: 4, textAlign: 'center' },
  error: { fontSize: 10, color: '#b0453d', marginTop: 4 },
  sandboxBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8d5a4',
    backgroundColor: '#fdf6e1',
  },
  sandboxTitle: { fontSize: 11, fontWeight: '800', color: '#8a6a1e' },
  sandboxBody: { fontSize: 9, color: '#7a6a4a', marginTop: 2, lineHeight: 13 },
});
