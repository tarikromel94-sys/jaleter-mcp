/** Shared legacy/projection math used by Home + Legacy so both screens
 * always show identical numbers. Extracted verbatim from app/index.tsx. */

/* ---------------- Home ---------------- */
// Shared legacy math — kept next to Home so both Home and Legacy show the
// exact same numbers for the checkpoint cards. The rate is user-editable on
// the Legacy screen and hoisted into App state so Home + Legacy always agree.
export const DEFAULT_LEGACY_RATE = 7; // % annual (used until user edits it)
// Applies a hypothetical (one-time / monthly / annual, optional duration) to
// a projection horizon and returns amounts that should be added to cash and
// to the invested principal at year `n`. Kept here so Home and Legacy compute
// hypotheticals identically.
export function hypoContributions(hypoAmount: number, freq: 'onetime' | 'monthly' | 'annual', duration: number | null, n: number) {
  if (!hypoAmount || hypoAmount <= 0) return { addToPrincipal: 0, addToCash: 0, addToMonthlyContrib: 0 };
  const active = duration && duration > 0 ? Math.min(duration, n) : n; // years the hypo is active
  if (freq === 'onetime') return { addToPrincipal: hypoAmount, addToCash: 0, addToMonthlyContrib: 0 };
  if (freq === 'monthly') return { addToPrincipal: 0, addToCash: hypoAmount * 12 * active, addToMonthlyContrib: hypoAmount };
  return { addToPrincipal: 0, addToCash: hypoAmount * active, addToMonthlyContrib: hypoAmount / 12 };
}
// Cash-only growth. Investments are NOT included here — they compound
// separately at the return rate. This fixes the confusing Y1/Y5/Y10 mix.
export function longTermInvestment(investmentTotal: number, hypoPrincipal: number, monthlyContribution: number, year: number, ratePct: number = DEFAULT_LEGACY_RATE): number {
  const totalInvested = investmentTotal + hypoPrincipal;
  const r = ratePct / 100;
  if (r === 0) return Math.round(totalInvested + monthlyContribution * 12 * year);
  return Math.round(totalInvested * Math.pow(1 + r, year) + monthlyContribution * 12 * ((Math.pow(1 + r, year) - 1) / r));
}
