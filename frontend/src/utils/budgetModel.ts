/** Pure budget data model — types, seed data, and month/allocation math.
 * Extracted verbatim from app/index.tsx (L2 modularization pass). */
import { type Asset } from '@/src/utils/appShared';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthIndex = (name: string) => MONTHS.indexOf(name);
export const currentMonth = () => MONTHS[new Date().getMonth()];
/* ---------------- DATA ---------------- */
export const initialCategories = [
  { id: 'give', name: 'Give', tagline: 'Lead with generosity', subcategories: [
    { id: 'tithe', name: 'Tithe', budgeted: 0 }, { id: 'missions', name: 'Missions', budgeted: 0 }, { id: 'extra-giving', name: 'Extra Giving', budgeted: 0 }] },
  { id: 'steward', name: 'Steward', tagline: 'Protect what you have', subcategories: [
    { id: 'housing', name: 'Housing', budgeted: 0 }, { id: 'food', name: 'Food & Dining', budgeted: 0 }, { id: 'transport', name: 'Transportation', budgeted: 0 }, { id: 'utilities', name: 'Utilities', budgeted: 0 }] },
  { id: 'grow', name: 'Grow', tagline: 'Build future wealth', subcategories: [
    { id: 'investments', name: 'Investments', budgeted: 0 }, { id: 'education', name: 'Education', budgeted: 0 }] },
  { id: 'enjoy', name: 'Enjoy', tagline: 'Enjoy life responsibly', subcategories: [
    { id: 'travel', name: 'Travel', budgeted: 0 }, { id: 'shopping', name: 'Shopping', budgeted: 0 }, { id: 'entertainment', name: 'Entertainment', budgeted: 0 }] },
];
export const initialIncome = [{ id: 'w2', name: 'W-2 Income', budgeted: 0 }, { id: 'contract', name: 'Contract Income', budgeted: 0 }, { id: 'business', name: 'Business Income', budgeted: 0 }];
export type Split = { groupId: string; detailId?: string; amount: number; type?: 'income' | 'expense' };
export type Tx = {
  id: string;
  date: string;
  name: string;
  amount: number;
  // Type of transaction. `transfer` is a first-class type: an internal
  // Every transaction is either income (positive-money-in for user) or
  // expense (positive-money-out). "Transfer" is no longer a third type
  // (spec #10); a movement between the user's own accounts still uses
  // income/expense by sign, but `system_category='transfer'` (or the
  // legacy `is_transfer` flag) keeps it excluded from Budget actuals,
  // Reports, and Net Income cash-flow.
  type: 'income' | 'expense';
  groupId: string;
  detailId?: string;
  origin: string;
  period: string;
  // System classification set by the backend Plaid classifier — retained so
  // reclassify sheets can surface the auto-detected value.
  system_category?: string | null;
  is_transfer?: boolean;
  external_id?: string;
  // Signed direction of the ORIGINAL underlying money flow: +1 for money
  // into the user's account (positive Plaid amount, refunds), -1 for money
  // out (negative Plaid amount, spends). Enables spec #16 netting so a
  // +$48.80 Walmart refund manually assigned to Food & Dining REDUCES that
  // subcategory's actual instead of inflating it.
  sign?: 1 | -1;
  // Merchant name — canonical retailer name (e.g. "Costco Wholesale") used
  // for grouping in Reports. Distinct from `name` which is the description.
  merchant?: string;
  // Split allocation — when populated, this transaction contributes to
  // MULTIPLE budget categories. Sum of splits.amount should equal `amount`.
  // If splits is empty/absent, the transaction uses top-level groupId/detailId.
  splits?: Split[];
  // Optional counterparty account references — kept for transfer-category
  // transactions so the reconciliation sheet can match both sides.
  transfer_from_account_id?: string;
  transfer_to_account_id?: string;
};

// A transaction is treated as a "system transfer" (excluded from Budget
// actuals, Reports totals, and Net Income cash-flow) when either:
//   • the backend Plaid classifier tagged it (`system_category` ∈ transfer /
//     credit_card_payment / loan_payment), or
//   • the user manually assigned it to the Transfer category (`is_transfer`
//     flag / `system_category='transfer'`).
// Note: as of spec #10, `type: 'transfer'` is NO LONGER a valid value on
// the frontend — transfers still use income/expense by sign and the
// exclusion flag is what drives filtering.
export const isSystemTransaction = (t: any): boolean => {
  if (t?.is_transfer) return true;
  const sc = (t?.system_category || '').toString().toLowerCase();
  return sc === 'transfer' || sc === 'credit_card_payment' || sc === 'loan_payment';
};
export const initialTx: Tx[] = [];

// ---- Splits-aware budget accounting -----------------------------------------
// A single transaction can be split across multiple budget categories. When
// splits exist, we ignore the top-level groupId/detailId and iterate splits
// instead. When splits are absent, the transaction contributes its full
// amount to the top-level assignment.
export type Alloc = { groupId: string; detailId?: string; amount: number; parentType: Tx['type']; allocType: Tx['type']; parentPeriod: string; parentYear: number; parentTx: Tx };
export const txAllocations = (tx: Tx): Alloc[] => {
  const isoMatch = typeof tx.date === 'string' ? tx.date.match(/^(\d{4})-(\d{2})/) : null;
  const parentYear = isoMatch ? Number(isoMatch[1]) : (tx.date ? new Date(tx.date).getFullYear() : new Date().getFullYear());
  const parentPeriod = tx.period || 'Jan';
  if (Array.isArray(tx.splits) && tx.splits.length > 0) {
    return tx.splits.map((sp) => ({
      groupId: sp.groupId,
      detailId: sp.detailId,
      amount: Number(sp.amount) || 0,
      parentType: tx.type,
      // Per-split type (spec #17). Defaults to the parent tx type.
      allocType: (sp.type as Tx['type']) || tx.type,
      parentPeriod,
      parentYear,
      parentTx: tx,
    }));
  }
  return [{
    groupId: tx.groupId,
    detailId: tx.detailId,
    amount: tx.amount,
    parentType: tx.type,
    allocType: tx.type,
    parentPeriod,
    parentYear,
    parentTx: tx,
  }];
};
// Sum splits-aware actual for a subcategory in a given month (of a specific year).
// Spec #16: a refund/positive txn assigned to Expense OFFSETS spend
// (reduces the actual) rather than adding to it. We use `tx.sign` (+1 for
// money-in, -1 for money-out) to detect refunds: a positive-signed txn
// assigned to Expense contributes NEGATIVELY. Same idea for chargebacks
// against Income.
export const spentForSubInMonth = (transactions: Tx[], subId: string, monthIndex: number, year?: number): number => {
  let sum = 0;
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    const allocs = txAllocations(tx);
    for (const a of allocs) {
      if (a.allocType !== 'expense') continue;
      if (a.detailId !== subId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      // Refund detection: +1-signed txn attributed to Expense reduces spend.
      const sign = (a.parentTx as any).sign;
      const netMultiplier = sign === 1 ? -1 : 1;
      sum += a.amount * netMultiplier;
    }
  }
  return sum;
};
// Same for income (uses groupId — no subcategory).
export const receivedForIncomeInMonth = (transactions: Tx[], srcId: string, monthIndex: number, year?: number): number => {
  let sum = 0;
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    const allocs = txAllocations(tx);
    for (const a of allocs) {
      if (a.allocType !== 'income') continue;
      if (a.groupId !== srcId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      // Chargeback detection: -1-signed txn attributed to Income reduces the source.
      const sign = (a.parentTx as any).sign;
      const netMultiplier = sign === -1 ? -1 : 1;
      sum += a.amount * netMultiplier;
    }
  }
  return sum;
};
// Find every transaction that contributes to a subcategory in a given month.
// Used by the "tap the Actual number" drill-down.
export const transactionsForSubInMonth = (transactions: Tx[], subId: string, monthIndex: number, year?: number): { tx: Tx; contribution: number }[] => {
  const out: { tx: Tx; contribution: number }[] = [];
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    if (tx.type !== 'expense') continue;
    const allocs = txAllocations(tx);
    let contribution = 0;
    for (const a of allocs) {
      if (a.detailId !== subId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      contribution += a.amount;
    }
    if (contribution > 0) out.push({ tx, contribution });
  }
  return out;
};
export const transactionsForIncomeInMonth = (transactions: Tx[], srcId: string, monthIndex: number, year?: number): { tx: Tx; contribution: number }[] => {
  const out: { tx: Tx; contribution: number }[] = [];
  const targetMonth = MONTHS[monthIndex];
  for (const tx of transactions) {
    if (isSystemTransaction(tx)) continue;
    if (tx.type !== 'income') continue;
    const allocs = txAllocations(tx);
    let contribution = 0;
    for (const a of allocs) {
      if (a.groupId !== srcId) continue;
      if (a.parentPeriod !== targetMonth) continue;
      if (year !== undefined && a.parentYear !== year) continue;
      contribution += a.amount;
    }
    if (contribution > 0) out.push({ tx, contribution });
  }
  return out;
};

// Asset type is imported from `@/src/utils/appShared`.
export const initialAssets: Asset[] = [
  { id: 'cash', name: 'Cash', value: 0, source: 'Manual', icon: 'wallet-outline' },
  { id: 'investments', name: 'Investments', value: 0, source: 'Manual', icon: 'trending-up' },
  { id: 'real-estate', name: 'Real Estate', value: 0, source: 'Manual', icon: 'business-outline' },
  { id: 'vehicles', name: 'Vehicles', value: 0, source: 'Manual', icon: 'car-outline' },
];
export const initialLiabilities: Asset[] = [
  { id: 'mortgage', name: 'Mortgage', value: 0, source: 'Manual', icon: 'home-outline' },
  { id: 'auto-loan', name: 'Auto Loan', value: 0, source: 'Manual', icon: 'car-outline' },
  { id: 'credit-cards', name: 'Credit Cards', value: 0, source: 'Manual', icon: 'card-outline' },
  { id: 'student-loans', name: 'Student Loans', value: 0, source: 'Manual', icon: 'cash-outline' },
];

export type Subcategory = { id: string; name: string; budgeted: number; months?: Record<number, number> };
export type Category = { id: string; name: string; tagline: string; subcategories: Subcategory[] };
export const monthlyAmount = (sub: Subcategory, mIdx: number) => sub.months?.[mIdx] ?? sub.budgeted;
export const annualAmount = (sub: Subcategory) => { let sum = 0; for (let i = 0; i < 12; i++) sum += monthlyAmount(sub, i); return sum; };
