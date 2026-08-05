/**
 * Centralized jaleter.com URLs + platform-safe opener.
 *
 * Uses `WebBrowser.openBrowserAsync` on native (in-app browser sheet) and
 * `window.open(..., '_blank')` on web to preserve session cookies for the
 * marketing site.  Falls back to `Linking.openURL` if WebBrowser is missing.
 *
 * Add or rename entries here — never hardcode `https://jaleter.com/...`
 * elsewhere in the app.
 */
import { Platform, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export const JALETER_ORIGIN = 'https://jaleter.com';

export const JALETER_LINKS = {
  home: `${JALETER_ORIGIN}/`,
  billing: `${JALETER_ORIGIN}/billing`,
  coaching: `${JALETER_ORIGIN}/coaching`,
  membership: `${JALETER_ORIGIN}/membership`,
  terms: `${JALETER_ORIGIN}/terms`,
  privacy: `${JALETER_ORIGIN}/privacy`,
  support: `${JALETER_ORIGIN}/support`,
  contact: `${JALETER_ORIGIN}/contact`,
  faq: `${JALETER_ORIGIN}/faq`,
};

export type JaleterLinkKey = keyof typeof JALETER_LINKS;

/**
 * Open a jaleter.com URL in the best available browser for the platform.
 * Never throws — logs and swallows errors so UI flows keep working.
 */
export async function openJaleter(target: JaleterLinkKey | string): Promise<void> {
  const url = target in JALETER_LINKS ? JALETER_LINKS[target as JaleterLinkKey] : String(target);
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') (window as any).open(url, '_blank', 'noopener');
      return;
    }
    if (WebBrowser && WebBrowser.openBrowserAsync) {
      await WebBrowser.openBrowserAsync(url, {
        // In-app browser sheet keeps auth cookies + returns to app when closed.
        dismissButtonStyle: 'close',
        readerMode: false,
      });
      return;
    }
    await Linking.openURL(url);
  } catch {
    // Best-effort: last-ditch fallback so the user always gets somewhere.
    try { await Linking.openURL(url); } catch { /* silent */ }
  }
}
