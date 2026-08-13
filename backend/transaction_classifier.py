"""Transaction system-classification for Jaleter.

Identifies "system" transaction kinds — transfers between the user's own
accounts, credit-card payments, and loan payments — so they can be excluded
from Budget actuals / Income totals / Expense totals / AI cash-flow, per
Phase-3 requirements #8, #9, #11.

The classifier layers three signals:
  1. Plaid `personal_finance_category` (primary + detailed) — most reliable.
  2. Plaid `category` (legacy hierarchy) — fallback for older shape.
  3. Keyword hints in the description / merchant name — used for CSV imports
     and SimpleFIN rows that carry no structured category.

Public surface:
    SYSTEM_CATEGORIES = {'transfer', 'credit_card_payment', 'loan_payment'}
    classify_system(txn) -> Optional[str]
    is_transfer(txn) -> bool
    is_credit_card_payment(txn) -> bool
    is_loan_payment(txn) -> bool
    classify_from_text(description, category_hint=None) -> Optional[str]

A *user override* (`system_category_override`) always wins — it's persisted
on the bank_transactions row and takes precedence over any auto-detection so
Plaid resyncs can never overwrite what the user manually set.
"""
from __future__ import annotations

import re
from typing import Any, Optional

SYSTEM_CATEGORIES = {"transfer", "credit_card_payment", "loan_payment"}

# Plaid Personal Finance Categories (see https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv)
# We only care about a subset — anything else falls through to "None" (normal spending/income).
#
# IMPORTANT: Plaid's `TRANSFER_IN` primary is **NOT** a reliable transfer
# signal. Plaid tags a huge variety of incoming money as TRANSFER_IN:
# paychecks, direct deposits, interest, refunds, ACH from external banks,
# savings-account sweeps, etc. Most of these are real income for our users.
# Trusting TRANSFER_IN blindly was systematically understating Earn/Income
# (particularly bad for Ally accounts where ACH inflows land). So we split
# the primary set into OUT (still trusted) and IN (needs corroboration).
_PFC_TRANSFER_OUT_PRIMARY = {"TRANSFER_OUT"}
_PFC_TRANSFER_IN_PRIMARY = {"TRANSFER_IN"}
# Only this detailed subcategory unambiguously means "internal account transfer".
# Other TRANSFER_IN_* detaileds (TRANSFER_IN_DEPOSIT, TRANSFER_IN_CASH_ADVANCES_AND_LOANS,
# TRANSFER_IN_OTHER_TRANSFER_IN, ...) frequently represent real income.
_PFC_TRANSFER_IN_INTERNAL_DETAILED = {"TRANSFER_IN_ACCOUNT_TRANSFER"}
_PFC_CC_PAYMENT_DETAILED = {"LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"}
_PFC_LOAN_PAYMENT_PRIMARY = {"LOAN_PAYMENTS"}  # covers auto, student, mortgage, etc.

# Description hints — used only when structured category is absent (CSV / SimpleFIN).
# Kept tight to avoid over-classification. Case-insensitive.
_KW_TRANSFER = re.compile(
    r"\b(transfer|xfer|to (savings|checking|share)|from (savings|checking|share)|"
    r"internal transfer|zelle to (self|me)|ach transfer|book transfer)\b",
    re.IGNORECASE,
)
_KW_CC_PAYMENT = re.compile(
    r"\b(credit card payment|cc payment|payment to (?:chase|amex|discover|capital one|citi|"
    r"bank of america|barclays|synchrony|us bank|wells fargo)|autopay to|"
    r"card payment|thank you.?- ?payment|payment - ?thank you)\b",
    re.IGNORECASE,
)
_KW_LOAN_PAYMENT = re.compile(
    r"\b(loan payment|mortgage payment|auto loan|student loan|principal & interest|"
    r"mortgage pmt|escrow pmt)\b",
    re.IGNORECASE,
)


def _pfc(txn: dict[str, Any]) -> tuple[str, str]:
    pfc = (txn.get("personal_finance_category") or {}) if isinstance(txn.get("personal_finance_category"), dict) else {}
    primary = str(pfc.get("primary") or "").upper()
    detailed = str(pfc.get("detailed") or "").upper()
    return primary, detailed


def _legacy_category(txn: dict[str, Any]) -> list[str]:
    cat = txn.get("category")
    if isinstance(cat, list):
        return [str(c).lower() for c in cat if c]
    if isinstance(cat, str):
        return [cat.lower()]
    return []


def classify_from_text(description: str, category_hint: Optional[str] = None) -> Optional[str]:
    """Best-effort classification from free-text description + optional hint.

    Used for CSV imports and SimpleFIN rows that don't carry Plaid's PFC.
    Precedence: credit-card-payment > loan-payment > transfer (so a "credit
    card payment" isn't mis-flagged as a generic transfer)."""
    text = " ".join(filter(None, [description or "", category_hint or ""]))
    if not text.strip():
        return None
    if _KW_CC_PAYMENT.search(text):
        return "credit_card_payment"
    if _KW_LOAN_PAYMENT.search(text):
        return "loan_payment"
    if _KW_TRANSFER.search(text):
        return "transfer"
    return None


def classify_system(txn: dict[str, Any]) -> Optional[str]:
    """Return the system category for a transaction dict, or None.

    Order:
      1. Explicit user override (`system_category_override`) always wins.
      2. Plaid PFC (primary + detailed) — most trustworthy.
      3. Plaid legacy `category` list.
      4. Description + merchant + category hint text.
    """
    override = txn.get("system_category_override")
    if isinstance(override, str) and override:
        if override == "none":
            return None  # user explicitly cleared classification
        if override in SYSTEM_CATEGORIES:
            return override

    # 2. Plaid PFC
    primary, detailed = _pfc(txn)
    if detailed in _PFC_CC_PAYMENT_DETAILED:
        return "credit_card_payment"
    if primary in _PFC_LOAN_PAYMENT_PRIMARY:
        # `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT` already caught above; the rest
        # are non-credit-card loans (mortgage, auto, student, personal, etc.).
        return "loan_payment"
    # TRANSFER_OUT: Plaid tags outgoing internal transfers reliably.
    if primary in _PFC_TRANSFER_OUT_PRIMARY:
        return "transfer"
    # TRANSFER_IN: DO NOT auto-classify from PFC alone — Plaid tags most
    # incoming ACH / direct deposits / paychecks / interest as TRANSFER_IN,
    # which caused Earn/Income to be understated (esp. for Ally accounts).
    # Only trust this when combined with corroborating evidence:
    #   • detailed == TRANSFER_IN_ACCOUNT_TRANSFER (Plaid's own "internal"
    #     signal) AND the description contains a transfer keyword, OR
    #   • the description independently matches transfer keywords (handled
    #     by the free-text fallback further below).
    # If neither, we return None here (falls through to legacy / free-text
    # checks) so the txn stays in Earn/Income by default. The nightly
    # `/transactions/match-transfers` job will still promote pairs to
    # transfer when both sides are visible.
    if primary in _PFC_TRANSFER_IN_PRIMARY:
        desc_text = (txn.get("description") or txn.get("name") or "") + " " + (txn.get("merchant_name") or "")
        if detailed in _PFC_TRANSFER_IN_INTERNAL_DETAILED and _KW_TRANSFER.search(desc_text):
            return "transfer"
        # fall through — do NOT return "transfer" from PFC alone.

    # 3. Legacy category hierarchy
    legacy = _legacy_category(txn)
    if any("credit card" in c and "payment" in c for c in legacy):
        return "credit_card_payment"
    if any("loan" in c and "payment" in c for c in legacy):
        return "loan_payment"
    # NOTE: Plaid's legacy `category` puts a huge amount of INCOME under the
    # top-level "Transfer" bucket (e.g. `['Transfer', 'Payroll']` for real
    # paychecks, `['Transfer', 'Deposit']` for check deposits, `['Transfer',
    # 'Credit']` for Zelle/Cash App income). Matching on the top-level
    # "transfer" alone was causing systematic under-count of Earn/Income.
    # Only match when a sub-category unambiguously says "account transfer"
    # or "internal account transfer".
    if any("internal account transfer" in c or "account transfer" in c for c in legacy):
        return "transfer"

    # 4. Free-text
    desc = (txn.get("description") or txn.get("name") or "") + " " + (txn.get("merchant_name") or "")
    return classify_from_text(desc, txn.get("category_hint"))


def is_transfer(txn: dict[str, Any]) -> bool:
    return classify_system(txn) == "transfer"


def is_credit_card_payment(txn: dict[str, Any]) -> bool:
    return classify_system(txn) == "credit_card_payment"


def is_loan_payment(txn: dict[str, Any]) -> bool:
    return classify_system(txn) == "loan_payment"


def is_system_excluded(txn: dict[str, Any]) -> bool:
    """True if this txn should be excluded from Budget/Income/Expense totals.

    All three system categories qualify — transfers don't move net worth
    between accounts owned by the same user, credit-card payments are the
    mirror of the original purchase, and loan-principal is a balance
    reduction rather than spending (spec #8/#9/#11).
    """
    return classify_system(txn) is not None


# ------------- Transfer matching (both sides visible) ------------------------
def transfer_signature(txn: dict[str, Any]) -> tuple:
    """Signature for matching two sides of a transfer / cc-payment.

    Two rows are candidate pairs if their signatures are (equal absolute
    amount, opposite signs, close dates, different accounts, same user).
    We deliberately do NOT include description because the two sides usually
    say different things ("Payment to Chase" vs "Payment thank you").
    """
    amt = abs(float(txn.get("amount") or 0))
    return (round(amt, 2), txn.get("user_id"), txn.get("account_id"))


def is_probable_pair(a: dict[str, Any], b: dict[str, Any], max_day_gap: int = 3) -> bool:
    """Return True if a & b look like the two sides of the same transfer."""
    if a.get("user_id") != b.get("user_id"):
        return False
    if a.get("account_id") == b.get("account_id") and a.get("account_id"):
        return False  # same-account entries can't be transfer counterparties
    amt_a = float(a.get("amount") or 0)
    amt_b = float(b.get("amount") or 0)
    if amt_a == 0 or amt_b == 0:
        return False
    if round(abs(amt_a) - abs(amt_b), 2) != 0:
        return False
    # Opposite signs (one debit, one credit) for a valid transfer.
    if (amt_a > 0) == (amt_b > 0):
        return False
    # Dates: allow up to `max_day_gap` days between posts.
    try:
        from datetime import datetime as _dt
        da = a.get("date") if isinstance(a.get("date"), _dt) else _dt.fromisoformat(str(a.get("date")).replace("Z", "+00:00"))
        db = b.get("date") if isinstance(b.get("date"), _dt) else _dt.fromisoformat(str(b.get("date")).replace("Z", "+00:00"))
        if abs((da - db).days) > max_day_gap:
            return False
    except Exception:
        return False
    return True
