/**
 * App Store / Google Play links + subscription-management deep links.
 *
 * Jaleter Premium is billed ONLY through Apple In-App Purchase (iPhone) and
 * Google Play Billing (Android). Web visitors are sent to the stores.
 * Store listing URLs are environment-configurable so they can be set the
 * moment the listings go live.
 */
import { Platform, Linking } from 'react-native';
import { JALETER_ORIGIN } from '@/src/jaleterLinks';

export const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL || `${JALETER_ORIGIN}/app`;
export const PLAY_STORE_URL = process.env.EXPO_PUBLIC_PLAY_STORE_URL || `${JALETER_ORIGIN}/app`;

/** Where the user manages / cancels the subscription for the current platform. */
export const STORE_SUBSCRIPTIONS_URL = Platform.OS === 'android'
  ? 'https://play.google.com/store/account/subscriptions'
  : 'https://apps.apple.com/account/subscriptions';

export const STORE_NAME = Platform.OS === 'android' ? 'Google Play' : 'App Store';

export async function openStoreSubscriptions(): Promise<void> {
  try { await Linking.openURL(STORE_SUBSCRIPTIONS_URL); } catch { /* silent */ }
}

export async function openStoreListing(store: 'ios' | 'android'): Promise<void> {
  const url = store === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') { (window as any).open(url, '_blank', 'noopener'); return; }
    await Linking.openURL(url);
  } catch { /* silent */ }
}
