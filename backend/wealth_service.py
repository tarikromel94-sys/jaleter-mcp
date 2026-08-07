"""Wealth service — canonical account classification for Jaleter.

Determines a Jaleter category (Cash / Investments / Credit Cards / Mortgage /
Auto Loans / Student Loans / Other Assets / Other Liabilities / …) from a
Plaid account's `type` and `subtype`, and merges any per-user override.

Categories map to a fixed Asset-vs-Liability side so downstream math never
guesses from balance sign. If a Plaid account is unknown or cannot be
classified precisely, we still know whether it is an asset or a liability
from Plaid's coarse `type` (`credit`/`loan` = liability; everything else
defaults to asset), and route it into the "Other" bucket on that side.

Public surface:
    * CATEGORY_LABELS         : slug -> display name mapping
    * ASSET_CATEGORIES        : set of asset-side slugs
    * LIABILITY_CATEGORIES    : set of liability-side slugs
    * ALL_CATEGORIES          : union of the two
    * is_asset(slug)          : bool
    * is_liability(slug)      : bool
    * classify_plaid(type_, subtype)                       -> slug
    * merge_override(auto_cat, auto_name, override_doc)    -> (cat, name)
    * ensure_valid_category(slug)                          : raises ValueError
"""
from __future__ import annotations

from typing import Optional


# Public-facing display labels. Keep the wording user-friendly — the frontend
# shows these directly on the Wealth screen.
CATEGORY_LABELS: dict[str, str] = {
    # Assets
    "cash": "Cash",
    "investments": "Investments",
    "real_estate": "Real Estate",
    "vehicles": "Vehicles",
    "other_assets": "Other Assets",
    # Liabilities
    "credit_cards": "Credit Cards",
    "mortgage": "Mortgage",
    "auto_loans": "Auto Loans",
    "student_loans": "Student Loans",
    "other_liabilities": "Other Liabilities",
}

ASSET_CATEGORIES: set[str] = {
    "cash", "investments", "real_estate", "vehicles", "other_assets",
}
LIABILITY_CATEGORIES: set[str] = {
    "credit_cards", "mortgage", "auto_loans", "student_loans", "other_liabilities",
}
ALL_CATEGORIES: set[str] = ASSET_CATEGORIES | LIABILITY_CATEGORIES


def is_asset(slug: str) -> bool:
    return slug in ASSET_CATEGORIES


def is_liability(slug: str) -> bool:
    return slug in LIABILITY_CATEGORIES


def ensure_valid_category(slug: str) -> None:
    """Raise ValueError if `slug` is not a supported Jaleter category."""
    if slug not in ALL_CATEGORIES:
        raise ValueError(f"Unknown Jaleter category: {slug!r}")


# ---------------- Plaid classification -----------------------------------------
# Plaid docs: https://plaid.com/docs/api/accounts/#accounts-get-response-accounts
# `type` is one of: depository | credit | loan | investment | brokerage | other
# `subtype` is a finer breakdown (checking, savings, credit card, mortgage, etc.)

_CASH_SUBTYPES = {
    "checking", "savings", "money market", "money_market", "cd",
    "cash management", "cash_management", "ebt", "paypal", "prepaid",
    "hsa",  # HSAs are cash-like even though sometimes typed as depository
}
_INVEST_SUBTYPES = {
    "brokerage", "ira", "roth", "roth ira", "roth_ira",
    "401k", "401(k)", "403b", "403(b)", "457b", "457(b)", "529",
    "sep ira", "sep_ira", "simple ira", "simple_ira",
    "keogh", "pension", "trust", "profit sharing plan", "profit_sharing_plan",
    "retirement", "mutual fund", "mutual_fund", "annuity", "stock plan", "stock_plan",
    "sarsep", "thrift savings plan", "thrift_savings_plan", "tsp",
    "utma", "ugma", "cash isa", "isa", "gic", "rrsp", "rrif", "lira", "lif", "rlif",
    "resp", "tfsa", "non-taxable brokerage account", "life insurance", "variable annuity",
}
_MORTGAGE_HINTS = ("mortgage", "home", "heloc", "home equity", "home_equity")
_AUTO_HINTS = ("auto", "car ", "car_loan", "carloan")
_STUDENT_HINTS = ("student", "education", "sallie", "sallie_mae")


def classify_plaid(plaid_type: Optional[str], plaid_subtype: Optional[str]) -> str:
    """Return the Jaleter category slug for a Plaid account.

    We prefer specific subtype matches (checking → cash, mortgage → mortgage),
    then coarse type routing (investment → investments, credit → credit_cards),
    and finally fall back to the "Other" bucket on the correct side.
    """
    t = (plaid_type or "").strip().lower()
    s = (plaid_subtype or "").strip().lower()

    # 1. Depository (asset — cash-like) --------------------------------------
    if t == "depository":
        if s in _CASH_SUBTYPES or not s:
            return "cash"
        # Unknown depository subtype — still asset, still cash-like
        return "cash"

    # 2. Investment / brokerage (asset — investments) ------------------------
    if t in ("investment", "brokerage"):
        return "investments"
    if s in _INVEST_SUBTYPES:
        return "investments"

    # 3. Credit (liability — credit cards / lines of credit) -----------------
    if t == "credit":
        if s in ("credit card", "credit_card", "credit-card", ""):
            return "credit_cards"
        if any(h in s for h in _MORTGAGE_HINTS):
            return "mortgage"
        # Line-of-credit / paypal credit / other credit lines → credit cards bucket
        return "credit_cards"

    # 4. Loan (liability — depends on subtype) -------------------------------
    if t == "loan":
        if any(h in s for h in _MORTGAGE_HINTS):
            return "mortgage"
        if any(h in s for h in _AUTO_HINTS):
            return "auto_loans"
        if any(h in s for h in _STUDENT_HINTS):
            return "student_loans"
        # Personal / commercial / other loans → other_liabilities
        return "other_liabilities"

    # 5. Fallback via subtype-only hints (type = "other" or missing) ---------
    if any(h in s for h in _MORTGAGE_HINTS):
        return "mortgage"
    if any(h in s for h in _AUTO_HINTS):
        return "auto_loans"
    if any(h in s for h in _STUDENT_HINTS):
        return "student_loans"
    if s in ("credit card", "credit_card", "credit-card"):
        return "credit_cards"

    # 6. Truly unknown: use type to decide side, then send to "Other". Note
    # that "brokerage" already handled above; anything left is treated as an
    # asset by default. Balances alone are never used to determine the side.
    return "other_assets"


def merge_override(
    auto_category: str,
    auto_name: str,
    override_doc: Optional[dict],
) -> tuple[str, str, bool, bool]:
    """Apply the user's override (name + category) on top of the automatic
    classification. Returns (effective_category, effective_name,
    is_category_overridden, is_name_overridden).

    Guardrail: silently ignore an override_category that isn't a known slug
    (defense in depth — the API layer validates this too).
    """
    cat = auto_category
    name = auto_name
    cat_overridden = False
    name_overridden = False
    if override_doc:
        oc = (override_doc.get("override_category") or "").strip().lower()
        on = (override_doc.get("override_name") or "").strip()
        if oc and oc in ALL_CATEGORIES:
            cat = oc
            cat_overridden = True
        if on:
            name = on
            name_overridden = True
    return cat, name, cat_overridden, name_overridden


def switching_sides(from_cat: str, to_cat: str) -> bool:
    """True if reclassifying `from_cat` → `to_cat` crosses the asset/liability
    boundary. Callers use this to require explicit confirmation."""
    return is_asset(from_cat) != is_asset(to_cat)
