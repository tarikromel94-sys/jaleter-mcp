/**
 * Thin client for /api/notifications/*.
 *
 * All methods soft-fail: they log a warning and return null/[] on any
 * network error so the UI never blocks on push/alert side effects.
 */
import { apiCall } from '@/src/AuthContext';

export type AlertPrefs = {
  enabled: boolean;
  perCategory: Record<string, { p50: boolean; p80: boolean; exceeded: boolean }>;
  singleExpense: { enabled: boolean; threshold: number };
  weeklyDigest?: boolean;
  emailFrequency?: 'instant' | 'daily' | 'weekly';
};

export type NotificationItem = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  category_id: string | null;
  transaction_id: string | null;
  budget_period: string | null;
  delivery_status: string;
  provider_message_id?: string | null;
  created_at: string;
  sent_at?: string | null;
  read_at: string | null;
  metadata?: Record<string, any>;
};

export type CategoryTotal = {
  sub_id: string;
  name: string;
  parent_name?: string | null;
  spent: number;
  budget: number;
};

const warn = (label: string, e: any) => {
  console.warn(`[notifications] ${label} failed:`, e?.message || e);
};

export async function getPrefs(token: string): Promise<AlertPrefs | null> {
  try {
    return await apiCall('/api/notifications/prefs', { method: 'GET' }, token);
  } catch (e) { warn('getPrefs', e); return null; }
}

export async function putPrefs(token: string, prefs: AlertPrefs & { timezone?: string }): Promise<AlertPrefs | null> {
  try {
    return await apiCall('/api/notifications/prefs', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }, token);
  } catch (e) { warn('putPrefs', e); return null; }
}

export async function runWeeklyDigestNow(token: string): Promise<{ notification_id?: string; skipped?: string; push_status?: string; title?: string; body?: string } | null> {
  try {
    return await apiCall('/api/notifications/weekly-digest/run-now', { method: 'POST' }, token);
  } catch (e) { warn('runWeeklyDigestNow', e); return null; }
}

export async function evaluateBudget(
  token: string,
  period: string,
  categories: CategoryTotal[],
): Promise<NotificationItem[]> {
  try {
    const res = await apiCall('/api/notifications/evaluate-budget', {
      method: 'POST',
      body: JSON.stringify({ period, categories }),
    }, token);
    return (res?.created as NotificationItem[]) || [];
  } catch (e) { warn('evaluateBudget', e); return []; }
}

export async function evaluateTransaction(
  token: string,
  tx: {
    id?: string;
    transaction_id?: string;
    amount: number;
    name?: string;
    description?: string;
    merchant_name?: string;
    account_name?: string;
  },
): Promise<NotificationItem | null> {
  try {
    const res = await apiCall('/api/notifications/evaluate-transaction', {
      method: 'POST',
      body: JSON.stringify(tx),
    }, token);
    return (res?.created as NotificationItem) || null;
  } catch (e) { warn('evaluateTransaction', e); return null; }
}

export async function listNotifications(
  token: string,
  opts: { limit?: number; unread_only?: boolean } = {},
): Promise<NotificationItem[]> {
  try {
    const qp = new URLSearchParams();
    if (opts.limit) qp.set('limit', String(opts.limit));
    if (opts.unread_only) qp.set('unread_only', '1');
    const q = qp.toString();
    const res = await apiCall(`/api/notifications${q ? `?${q}` : ''}`, { method: 'GET' }, token);
    return (res?.notifications as NotificationItem[]) || [];
  } catch (e) { warn('listNotifications', e); return []; }
}

export async function unreadCount(token: string): Promise<number> {
  try {
    const res = await apiCall('/api/notifications/unread-count', { method: 'GET' }, token);
    return Number(res?.unread || 0);
  } catch (e) { warn('unreadCount', e); return 0; }
}

export async function markRead(token: string, id: string): Promise<void> {
  try {
    await apiCall(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }, token);
  } catch (e) { warn('markRead', e); }
}

export async function markAllRead(token: string): Promise<void> {
  try {
    await apiCall('/api/notifications/mark-all-read', { method: 'POST' }, token);
  } catch (e) { warn('markAllRead', e); }
}

/** Convenience: current period key (calendar month, UTC). */
export function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
