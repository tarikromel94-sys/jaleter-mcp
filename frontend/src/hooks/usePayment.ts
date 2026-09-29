import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { useAuth, apiCall } from '@/src/AuthContext';

/* ---------------- Payments & Scheduling ---------------- */
// Generates upcoming coaching slots: next N business days at 10am, 2pm, 4pm (local time).
export function formatBookingDate(iso: string): string {
  try {
    const d = new Date(iso);
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeLabel = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${dateLabel} at ${timeLabel}`;
  } catch { return iso; }
}

type CheckoutResult = { ok: boolean; paid?: boolean; canceled?: boolean; error?: string; sessionId?: string };

// Stripe Checkout runner for COACHING sessions only (Premium is an Apple /
// Google in-app subscription — see lib/revenuecat + PaywallScreen). Opens
// hosted Checkout, waits for redirect, then polls /api/payments/status.
export function usePayment() {
  const { token } = useAuth();
  const start = useCallback(async (product: 'coaching_session', extras?: { scheduled_at?: string }): Promise<CheckoutResult> => {
    if (!token) return { ok: false, error: 'You must be signed in to purchase.' };
    const platform = Platform.OS === 'web' ? 'web' : 'mobile';
    let body: any = { product, platform };
    if (extras?.scheduled_at) body.scheduled_at = extras.scheduled_at;
    let created: any;
    try {
      created = await apiCall('/api/payments/checkout', { method: 'POST', body: JSON.stringify(body) }, token);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not start checkout.' };
    }
    const { url, session_id } = created;
    if (!url) return { ok: false, error: 'Payment provider did not return a URL.' };

    if (Platform.OS === 'web') {
      // On web, browser will navigate away; we return here — the app will poll on return via the
      // web-return handler (checkout=success in URL) which lives in MainApp.
      if (typeof window !== 'undefined') window.location.href = url;
      return { ok: true, sessionId: session_id };
    }

    // Native: open Stripe Checkout in an auth session; wait for the jaleter://checkout redirect.
    const redirectScheme = ExpoLinking.createURL('checkout');
    let redirectResult: any;
    try {
      redirectResult = await WebBrowser.openAuthSessionAsync(url, redirectScheme);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not open Stripe Checkout.' };
    }
    if (redirectResult?.type !== 'success') {
      // Poll once anyway in case user completed but browser was dismissed
      try {
        const status = await apiCall(`/api/payments/status/${session_id}`, { method: 'GET' }, token);
        if (status?.payment_status === 'paid') return { ok: true, paid: true, sessionId: session_id };
      } catch {}
      return { ok: true, canceled: true, sessionId: session_id };
    }

    // Poll status (Stripe may lag a moment)
    for (let i = 0; i < 8; i += 1) {
      try {
        const status = await apiCall(`/api/payments/status/${session_id}`, { method: 'GET' }, token);
        if (status?.payment_status === 'paid') return { ok: true, paid: true, sessionId: session_id };
        if (status?.status === 'expired') return { ok: true, canceled: true, sessionId: session_id };
      } catch {}
      await new Promise((r) => setTimeout(r, 1200));
    }
    return { ok: true, sessionId: session_id, error: 'Payment is still processing.' };
  }, [token]);
  return { start };
}
