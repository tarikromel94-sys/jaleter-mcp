/**
 * Shared types + constants for the Customer Support feature.
 */
export type Attachment = {
  filename: string;
  mime_type: string;
  data_base64: string;
  size_bytes?: number;
};

export type Ticket = {
  ticket_id: string;
  ticket_number: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  description?: string;
  attachments?: any[];
  replies?: any[];
  reply_count: number;
  attachment_count: number;
  user_email?: string;
  user_name?: string;
};

export type SupportMode =
  | 'hub'
  | 'new'
  | 'list'
  | 'detail'
  | 'admin'
  | 'bug'
  | 'privacy'
  | 'delete'
  | 'billing'
  | 'bank_help';

export const CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Anything else' },
  { id: 'bug', label: 'Bug', hint: "Something isn't working" },
  { id: 'billing', label: 'Billing', hint: 'Payments, plans, invoices' },
  { id: 'bank_help', label: 'Bank Help', hint: 'Linking / import / sync' },
  { id: 'privacy', label: 'Privacy', hint: 'Data / access requests' },
  { id: 'delete_account', label: 'Delete account', hint: 'Close your account' },
];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const STATUS_COLORS: Record<string, string> = {
  open: '#c48a2b',
  in_progress: '#3d6ea0',
  waiting_on_user: '#8a7f70',
  resolved: '#4c8b56',
  closed: '#666',
};

export const FAQS: { q: string; a: string }[] = [
  { q: 'How do I link a bank account?', a: 'Settings → Linked Accounts → tap "Connect a bank (Plaid)" for real-time sync, or "Import statement" to upload a CSV/OFX.' },
  { q: 'Where is billing managed?', a: 'All payments and subscriptions are handled at jaleter.com to keep prices honest and avoid App Store fees.' },
  { q: 'How do I export my budget?', a: 'Budget screen → tap Export → choose Excel (.xlsx). You get a 4-tab workbook: Summary, Monthly, Annual Grid, and Transactions.' },
  { q: 'Is my bank data safe?', a: 'Yes. Access tokens are Fernet-encrypted at rest and never returned to the app. Only short-lived link tokens ever reach the frontend.' },
  { q: 'How do I delete my account?', a: 'Open a support ticket with category "Delete account". Our team confirms your identity, then wipes your data within 30 days.' },
];

export const HELP_ACTIONS: { id: string; label: string; sub: string; icon: any }[] = [
  { id: 'bank_help', label: 'Bank Help Center', sub: 'Connect a bank + import guides', icon: 'card-outline' },
  { id: 'bug', label: 'Report a Bug', sub: "Something isn't working", icon: 'bug-outline' },
  { id: 'billing', label: 'Billing Help', sub: 'Payments and subscriptions', icon: 'wallet-outline' },
  { id: 'privacy', label: 'Privacy Request', sub: 'Export / correct / delete data', icon: 'shield-checkmark-outline' },
  { id: 'delete', label: 'Delete Account', sub: 'Close your Jaleter account', icon: 'trash-outline' },
];

export const PRIVACY_ACTIONS = [
  { id: 'export', label: 'Export my data', hint: 'Get a copy of the data we hold about you.' },
  { id: 'correct', label: 'Correct my data', hint: 'Ask us to fix incorrect information.' },
  { id: 'restrict', label: 'Restrict processing', hint: 'Pause certain uses of your data.' },
  { id: 'delete', label: 'Delete my data', hint: 'Request full deletion of your account data.' },
];

export const BILLING_ISSUE_TYPES = [
  { id: 'refund', label: 'Request a refund' },
  { id: 'invoice', label: 'Need an invoice / receipt' },
  { id: 'renewal', label: 'Cancel renewal' },
  { id: 'plan_change', label: 'Change my plan' },
  { id: 'other', label: 'Something else' },
];
