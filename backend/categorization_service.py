"""
Smart Transaction Categorization — rules + memory, no paid AI.

Signals, in priority order:
  1. "Always" merchant rules the user explicitly created          (conf 0.98)
  2. Merchant memory — how the user categorized this merchant before (0.90)
  3. Plaid personal_finance_category (detailed → primary) matched to the
     user's EXISTING budget subcategories by name / synonyms           (0.75)
  4. Description keywords (CSV imports have no Plaid category)         (0.60)

Safety rails:
  * Transfers / credit-card payments / loan payments (system_category) are
    never suggested into a spending category.
  * Refunds (money IN at a merchant we know as an expense) are suggested
    back into that EXPENSE category — the row keeps sign=+1 so the budget
    nets it against spending instead of counting it as income.
  * Mixed-use merchants (Amazon, Walmart, Target, Costco, PayPal, …) are
    capped at low confidence and flagged so "Always" is discouraged.
  * New categories are only PROPOSED (never created) when Plaid knows the
    category but the user's budget has nothing matching.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

MIXED_USE_MERCHANTS = {
    'amazon', 'amzn', 'walmart', 'wal-mart', 'target', 'costco', 'sams club', "sam's club",
    'paypal', 'venmo', 'cash app', 'zelle', 'apple', 'apple.com', 'google', 'square', 'sq *',
    'ebay', 'etsy', 'dollar general', 'dollar tree', 'cvs', 'walgreens',
}

# Plaid PFC primary → (friendly new-category name, default group guess)
PRIMARY_DEFAULTS: dict[str, tuple[str, str]] = {
    'FOOD_AND_DRINK': ('Food & Dining', 'enjoy'),
    'GENERAL_MERCHANDISE': ('Shopping', 'enjoy'),
    'ENTERTAINMENT': ('Entertainment', 'enjoy'),
    'TRAVEL': ('Travel', 'enjoy'),
    'PERSONAL_CARE': ('Personal Care', 'enjoy'),
    'TRANSPORTATION': ('Transportation', 'steward'),
    'RENT_AND_UTILITIES': ('Utilities', 'steward'),
    'HOME_IMPROVEMENT': ('Home', 'steward'),
    'MEDICAL': ('Health & Medical', 'steward'),
    'GENERAL_SERVICES': ('Services', 'steward'),
    'BANK_FEES': ('Bank Fees', 'steward'),
    'LOAN_PAYMENTS': ('Debt Payments', 'steward'),
    'GOVERNMENT_AND_NON_PROFIT': ('Giving', 'give'),
    'INCOME': ('Income', 'income'),
    'TRANSFER_IN': ('Transfer', 'transfer'),
    'TRANSFER_OUT': ('Transfer', 'transfer'),
}

# Plaid PFC detailed → (friendly name, synonyms that match user subcategory names)
DETAILED: dict[str, tuple[str, tuple[str, ...]]] = {
    'FOOD_AND_DRINK_GROCERIES': ('Groceries', ('grocer', 'food', 'supermarket', 'market')),
    'FOOD_AND_DRINK_RESTAURANT': ('Dining Out', ('dining', 'restaurant', 'eating out', 'food')),
    'FOOD_AND_DRINK_FAST_FOOD': ('Dining Out', ('dining', 'fast food', 'restaurant', 'food')),
    'FOOD_AND_DRINK_COFFEE': ('Coffee', ('coffee', 'dining', 'cafe', 'food')),
    'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR': ('Dining Out', ('dining', 'alcohol', 'drinks', 'food')),
    'FOOD_AND_DRINK_VENDING_MACHINES': ('Dining Out', ('dining', 'snacks', 'food')),
    'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK': ('Food & Dining', ('food', 'dining')),
    'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES': ('Clothing', ('cloth', 'apparel', 'shopping')),
    'GENERAL_MERCHANDISE_DEPARTMENT_STORES': ('Shopping', ('shopping', 'household')),
    'GENERAL_MERCHANDISE_DISCOUNT_STORES': ('Shopping', ('shopping', 'household')),
    'GENERAL_MERCHANDISE_ELECTRONICS': ('Electronics', ('electronic', 'tech', 'shopping')),
    'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES': ('Gifts', ('gift', 'shopping')),
    'GENERAL_MERCHANDISE_OFFICE_SUPPLIES': ('Office Supplies', ('office', 'supplies', 'shopping')),
    'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES': ('Shopping', ('shopping', 'online')),
    'GENERAL_MERCHANDISE_PET_SUPPLIES': ('Pets', ('pet', 'dog', 'cat')),
    'GENERAL_MERCHANDISE_SPORTING_GOODS': ('Sporting Goods', ('sport', 'fitness', 'shopping')),
    'GENERAL_MERCHANDISE_SUPERSTORES': ('Shopping', ('shopping', 'household', 'grocer')),
    'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE': ('Shopping', ('shopping',)),
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE': ('Shopping', ('shopping',)),
    'ENTERTAINMENT_CASINOS_AND_GAMBLING': ('Entertainment', ('entertain', 'fun')),
    'ENTERTAINMENT_MUSIC_AND_AUDIO': ('Entertainment', ('entertain', 'music', 'subscription', 'streaming')),
    'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS': ('Entertainment', ('entertain', 'fun', 'events')),
    'ENTERTAINMENT_TV_AND_MOVIES': ('Streaming', ('stream', 'entertain', 'subscription', 'tv', 'movies')),
    'ENTERTAINMENT_VIDEO_GAMES': ('Entertainment', ('game', 'entertain')),
    'ENTERTAINMENT_OTHER_ENTERTAINMENT': ('Entertainment', ('entertain', 'fun')),
    'TRAVEL_FLIGHTS': ('Travel', ('travel', 'flight', 'vacation')),
    'TRAVEL_LODGING': ('Travel', ('travel', 'hotel', 'lodging', 'vacation')),
    'TRAVEL_RENTAL_CARS': ('Travel', ('travel', 'rental', 'vacation')),
    'TRAVEL_OTHER_TRAVEL': ('Travel', ('travel', 'vacation')),
    'TRANSPORTATION_GAS': ('Gas & Fuel', ('gas', 'fuel', 'auto', 'car', 'transport')),
    'TRANSPORTATION_PARKING': ('Parking', ('parking', 'auto', 'car', 'transport')),
    'TRANSPORTATION_PUBLIC_TRANSIT': ('Transit', ('transit', 'transport', 'commute')),
    'TRANSPORTATION_TAXIS_AND_RIDE_SHARES': ('Rideshare', ('ride', 'uber', 'lyft', 'taxi', 'transport')),
    'TRANSPORTATION_TOLLS': ('Tolls', ('toll', 'auto', 'car', 'transport')),
    'TRANSPORTATION_BIKES_AND_SCOOTERS': ('Transportation', ('transport', 'bike')),
    'TRANSPORTATION_OTHER_TRANSPORTATION': ('Transportation', ('transport', 'auto', 'car')),
    'RENT_AND_UTILITIES_RENT': ('Rent', ('rent', 'housing', 'home', 'mortgage')),
    'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY': ('Electric & Gas', ('electric', 'utilit', 'power', 'energy', 'gas bill')),
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE': ('Internet & Cable', ('internet', 'cable', 'utilit', 'wifi')),
    'RENT_AND_UTILITIES_TELEPHONE': ('Phone', ('phone', 'mobile', 'cell', 'utilit')),
    'RENT_AND_UTILITIES_WATER': ('Water', ('water', 'utilit')),
    'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT': ('Utilities', ('utilit', 'trash', 'waste', 'sewer')),
    'RENT_AND_UTILITIES_OTHER_UTILITIES': ('Utilities', ('utilit',)),
    'HOME_IMPROVEMENT_FURNITURE': ('Home', ('furnitur', 'home', 'household')),
    'HOME_IMPROVEMENT_HARDWARE': ('Home Improvement', ('hardware', 'home', 'repair', 'maintenance')),
    'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE': ('Home Maintenance', ('repair', 'maintenance', 'home')),
    'HOME_IMPROVEMENT_SECURITY': ('Home', ('security', 'home')),
    'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT': ('Home Improvement', ('home',)),
    'MEDICAL_DENTAL_CARE': ('Dental', ('dental', 'medical', 'health')),
    'MEDICAL_EYE_CARE': ('Medical', ('eye', 'vision', 'medical', 'health')),
    'MEDICAL_NURSING_CARE': ('Medical', ('medical', 'health', 'care')),
    'MEDICAL_PHARMACIES_AND_SUPPLEMENTS': ('Pharmacy', ('pharmac', 'medical', 'health', 'prescription')),
    'MEDICAL_PRIMARY_CARE': ('Medical', ('doctor', 'medical', 'health')),
    'MEDICAL_VETERINARY_SERVICES': ('Pets', ('vet', 'pet')),
    'MEDICAL_OTHER_MEDICAL': ('Medical', ('medical', 'health')),
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS': ('Fitness', ('gym', 'fitness', 'health', 'personal')),
    'PERSONAL_CARE_HAIR_AND_BEAUTY': ('Hair & Beauty', ('hair', 'beauty', 'salon', 'personal')),
    'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING': ('Personal Care', ('laundry', 'personal')),
    'PERSONAL_CARE_OTHER_PERSONAL_CARE': ('Personal Care', ('personal',)),
    'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING': ('Professional Services', ('account', 'financial', 'professional', 'services')),
    'GENERAL_SERVICES_AUTOMOTIVE': ('Auto Maintenance', ('auto', 'car', 'vehicle', 'maintenance')),
    'GENERAL_SERVICES_CHILDCARE': ('Childcare', ('child', 'daycare', 'kids')),
    'GENERAL_SERVICES_CONSULTING_AND_LEGAL': ('Professional Services', ('legal', 'professional', 'services')),
    'GENERAL_SERVICES_EDUCATION': ('Education', ('educat', 'school', 'tuition', 'learning')),
    'GENERAL_SERVICES_INSURANCE': ('Insurance', ('insur',)),
    'GENERAL_SERVICES_POSTAGE_AND_SHIPPING': ('Services', ('shipping', 'postage', 'services')),
    'GENERAL_SERVICES_STORAGE': ('Services', ('storage', 'services')),
    'GENERAL_SERVICES_OTHER_GENERAL_SERVICES': ('Services', ('services',)),
    'GOVERNMENT_AND_NON_PROFIT_DONATIONS': ('Giving', ('giv', 'tithe', 'donat', 'charity', 'church', 'offering')),
    'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES': ('Government Fees', ('government', 'fees', 'dmv', 'tax')),
    'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT': ('Taxes', ('tax',)),
    'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT': ('Giving', ('giv', 'donat')),
    'BANK_FEES_ATM_FEES': ('Bank Fees', ('fee', 'bank')),
    'BANK_FEES_FOREIGN_TRANSACTION_FEES': ('Bank Fees', ('fee', 'bank')),
    'BANK_FEES_INSUFFICIENT_FUNDS': ('Bank Fees', ('fee', 'bank')),
    'BANK_FEES_INTEREST_CHARGE': ('Interest', ('interest', 'fee', 'bank')),
    'BANK_FEES_OVERDRAFT_FEES': ('Bank Fees', ('fee', 'bank')),
    'BANK_FEES_OTHER_BANK_FEES': ('Bank Fees', ('fee', 'bank')),
    'LOAN_PAYMENTS_MORTGAGE_PAYMENT': ('Mortgage', ('mortgage', 'housing', 'home', 'rent')),
    'LOAN_PAYMENTS_CAR_PAYMENT': ('Car Payment', ('car payment', 'auto loan', 'car', 'auto', 'vehicle')),
    'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT': ('Student Loan', ('student', 'loan', 'education')),
    'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT': ('Loan Payment', ('loan', 'debt')),
    'LOAN_PAYMENTS_OTHER_PAYMENT': ('Loan Payment', ('loan', 'debt')),
    'INCOME_WAGES': ('Income', ('w-2', 'w2', 'salary', 'wage', 'paycheck', 'payroll', 'income')),
    'INCOME_DIVIDENDS': ('Income', ('dividend', 'invest', 'income')),
    'INCOME_INTEREST_EARNED': ('Income', ('interest', 'income')),
    'INCOME_RETIREMENT_PENSION': ('Income', ('retire', 'pension', 'income')),
    'INCOME_TAX_REFUND': ('Income', ('tax', 'refund', 'income')),
    'INCOME_UNEMPLOYMENT': ('Income', ('unemploy', 'income')),
    'INCOME_OTHER_INCOME': ('Income', ('income', 'contract', 'business', 'side')),
}

# Description keywords for CSV imports (no Plaid category available).
KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (('walmart', 'kroger', 'aldi', 'whole foods', 'trader joe', 'safeway', 'publix', 'heb', 'wegmans', 'food lion', 'grocery'), 'FOOD_AND_DRINK_GROCERIES'),
    (('starbucks', 'dunkin', 'coffee', 'cafe'), 'FOOD_AND_DRINK_COFFEE'),
    (('mcdonald', 'chick-fil-a', 'chipotle', 'taco bell', 'wendy', 'burger', 'pizza', 'doordash', 'uber eats', 'grubhub', 'restaurant', 'grill', 'diner', 'sushi'), 'FOOD_AND_DRINK_RESTAURANT'),
    (('shell', 'exxon', 'chevron', 'bp ', 'speedway', 'wawa', 'racetrac', 'marathon', 'fuel', 'gas station', 'circle k', '7-eleven'), 'TRANSPORTATION_GAS'),
    (('uber', 'lyft'), 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES'),
    (('netflix', 'hulu', 'disney', 'hbo', 'max.com', 'paramount', 'peacock'), 'ENTERTAINMENT_TV_AND_MOVIES'),
    (('spotify', 'apple music', 'pandora', 'audible'), 'ENTERTAINMENT_MUSIC_AND_AUDIO'),
    (('comcast', 'xfinity', 'spectrum', 'at&t internet', 'verizon fios', 'cox ', 'frontier'), 'RENT_AND_UTILITIES_INTERNET_AND_CABLE'),
    (('verizon', 't-mobile', 'at&t', 'sprint', 'mint mobile', 'cricket'), 'RENT_AND_UTILITIES_TELEPHONE'),
    (('electric', 'power co', 'energy', 'duke energy', 'pg&e', 'con edison', 'utility'), 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'),
    (('water', 'sewer'), 'RENT_AND_UTILITIES_WATER'),
    (('rent', 'apartment', 'property mgmt', 'leasing'), 'RENT_AND_UTILITIES_RENT'),
    (('mortgage', 'rocket mtg', 'wells fargo home', 'mr cooper'), 'LOAN_PAYMENTS_MORTGAGE_PAYMENT'),
    (('geico', 'progressive', 'state farm', 'allstate', 'insurance', 'liberty mutual'), 'GENERAL_SERVICES_INSURANCE'),
    (('cvs', 'walgreens', 'rite aid', 'pharmacy'), 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS'),
    (('planet fitness', 'la fitness', 'gym', 'crossfit', 'ymca', 'peloton'), 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS'),
    (('salon', 'barber', 'nails', 'spa '), 'PERSONAL_CARE_HAIR_AND_BEAUTY'),
    (('petco', 'petsmart', 'chewy', 'vet '), 'GENERAL_MERCHANDISE_PET_SUPPLIES'),
    (('home depot', "lowe's", 'lowes', 'ace hardware', 'menards'), 'HOME_IMPROVEMENT_HARDWARE'),
    (('church', 'tithe', 'offering', 'ministry', 'donation', 'charity', 'red cross', 'compassion'), 'GOVERNMENT_AND_NON_PROFIT_DONATIONS'),
    (('amazon', 'amzn', 'target', 'costco', 'ebay', 'etsy', 'best buy', 'macy', 'nordstrom', 'old navy', 'gap ', 'tj maxx', 'marshalls'), 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'),
    (('airline', 'delta', 'united', 'american air', 'southwest', 'jetblue', 'spirit air', 'frontier air'), 'TRAVEL_FLIGHTS'),
    (('marriott', 'hilton', 'hyatt', 'airbnb', 'hotel', 'motel', 'vrbo'), 'TRAVEL_LODGING'),
    (('tuition', 'university', 'college', 'school'), 'GENERAL_SERVICES_EDUCATION'),
    (('daycare', 'childcare', 'preschool'), 'GENERAL_SERVICES_CHILDCARE'),
    (('payroll', 'direct dep', 'salary', 'paycheck', 'adp ', 'gusto', 'paychex'), 'INCOME_WAGES'),
    (('parking',), 'TRANSPORTATION_PARKING'),
    (('toll', 'ezpass', 'e-zpass', 'sunpass'), 'TRANSPORTATION_TOLLS'),
    (('overdraft', 'monthly fee', 'service fee', 'atm fee', 'nsf fee'), 'BANK_FEES_OTHER_BANK_FEES'),
)


def merchant_key(merchant: Optional[str], description: Optional[str]) -> str:
    """Stable key for merchant memory: lowercase, strip store numbers/dates/noise."""
    base = (merchant or '').strip() or (description or '').strip()
    k = base.lower()
    k = re.sub(r'(pos|debit|credit|purchase|card|chk|ach|web|online|recurring)\b', ' ', k)
    k = re.sub(r'[#*]\s*\d+', ' ', k)
    k = re.sub(r'\b\d{2,}\b', ' ', k)            # store numbers / dates / ids
    k = re.sub(r'[^a-z&\' ]+', ' ', k)
    k = re.sub(r'\s+', ' ', k).strip()
    return k[:60]


def is_mixed_use(key: str) -> bool:
    return any(m in key for m in MIXED_USE_MERCHANTS)


def pfc_detailed(txn: dict) -> tuple[str, str]:
    raw = txn.get('raw') or {}
    pfc = raw.get('personal_finance_category') or {}
    detailed = (pfc.get('detailed') or '').upper() if isinstance(pfc, dict) else ''
    primary = (pfc.get('primary') or '').upper() if isinstance(pfc, dict) else ''
    if not primary:
        primary = (txn.get('category') or '').upper()
    return detailed, primary


def keyword_detailed(text: str) -> Optional[str]:
    t = f' {text.lower()} '
    for words, detailed in KEYWORDS:
        if any(w in t for w in words):
            return detailed
    return None


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9 ]+', ' ', (s or '').lower()).strip()


def _tokens(s: str) -> list[str]:
    return [w for w in _norm(s).split() if w]


def _name_matches(name: str, want: str) -> Optional[int]:
    """0 = exact, 1 = word/phrase match, None = no match. Word-boundary aware:
    'cat' must NOT match 'edu[cat]ion'. Stems (e.g. 'grocer', 'utilit') match
    only the START of a word and only when 4+ chars long."""
    n = _norm(name)
    w = _norm(want)
    if not n or not w:
        return None
    if n == w:
        return 0
    if ' ' in w:
        return 1 if f' {w} ' in f' {n} ' or f' {n} ' in f' {w} ' else None
    name_tokens = _tokens(name)
    if w in name_tokens:
        return 1
    if len(w) >= 4 and any(tok.startswith(w) for tok in name_tokens):
        return 1
    # single-word user category that is a stem of the synonym ("Pet" vs "pets")
    if len(name_tokens) == 1 and len(name_tokens[0]) >= 3 and w.startswith(name_tokens[0]) and len(w) - len(name_tokens[0]) <= 2:
        return 1
    return None


def match_subcategory(synonyms: tuple[str, ...], friendly: str, categories: list[dict]) -> Optional[tuple[str, str, str]]:
    """Find (group_id, sub_id, sub_name) in the user's budget whose name matches
    the friendly name or any synonym. Exact name first, then word matches."""
    candidates: list[tuple[int, str, str, str]] = []
    want = [friendly] + list(synonyms)
    for g in categories or []:
        for sub in g.get('subcategories') or []:
            name = sub.get('name') or ''
            for rank, w in enumerate(want):
                m = _name_matches(name, w)
                if m is not None:
                    candidates.append((rank * 10 + m * 5, g['id'], sub['id'], name))
                    break
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    return candidates[0][1], candidates[0][2], candidates[0][3]


def match_income_source(synonyms: tuple[str, ...], sources: list[dict]) -> Optional[tuple[str, str]]:
    for src in sources or []:
        name = src.get('name') or ''
        if any(_name_matches(name, w) is not None for w in synonyms):
            return src['id'], name
    if sources:
        return sources[0]['id'], sources[0].get('name') or ''
    return None


def suggest(
    txns: list[dict],
    categories: list[dict],
    income_sources: list[dict],
    rules: dict[str, dict],
) -> dict[str, Any]:
    """Build suggestions + new-category proposals for uncategorized rows."""
    suggestions: list[dict] = []
    proposals: dict[str, dict] = {}
    group_ids = [g.get('id') for g in categories or []]
    default_group = 'steward' if 'steward' in group_ids else (group_ids[0] if group_ids else '')

    for txn in txns:
        sys_cat = txn.get('system_category')
        if sys_cat in ('transfer', 'credit_card_payment', 'loan_payment') or txn.get('is_transfer'):
            continue  # never push system rows into spending categories
        amt = float(txn.get('amount') or 0)
        money_in = amt > 0
        key = merchant_key(txn.get('merchant'), txn.get('description'))
        mixed = is_mixed_use(key)
        label = (txn.get('merchant') or txn.get('description') or 'Transaction').strip()
        detailed, primary = pfc_detailed(txn)
        if not detailed and not primary:
            kd = keyword_detailed(f"{txn.get('description') or ''} {txn.get('merchant') or ''}")
            if kd:
                detailed = kd
                primary = next((p for p in PRIMARY_DEFAULTS if kd.startswith(p)), '')
        base = {
            'external_id': txn.get('external_id'),
            'merchant_key': key,
            'label': label,
            'mixed_use': mixed,
            'plaid_detailed': detailed or None,
            'plaid_primary': primary or None,
        }

        rule = rules.get(key)
        # 1-2. Merchant rule / memory
        if rule and (rule.get('always') or rule.get('uses', 0) >= 1):
            conf = 0.98 if rule.get('always') else 0.9
            is_refund = money_in and rule.get('tx_type') == 'expense'
            suggestions.append({
                **base,
                'type': rule.get('tx_type') or ('income' if money_in else 'expense'),
                'group_id': rule.get('group_id'),
                'detail_id': rule.get('detail_id'),
                'category_name': rule.get('category_name') or '',
                'confidence': conf if not mixed or rule.get('always') else min(conf, 0.6),
                'source': 'rule' if rule.get('always') else 'history',
                'reason': ('Always rule for this merchant' if rule.get('always') else 'You categorized this merchant this way before')
                          + (' · refund — nets against spending' if is_refund else ''),
                'refund': is_refund,
            })
            continue

        # 3-4. Plaid category / keywords → user's existing categories
        if primary == 'INCOME' or (money_in and primary in ('', 'INCOME')):
            friendly, syn = DETAILED.get(detailed, ('Income', ('income',)))
            m = match_income_source(syn, income_sources)
            if m:
                suggestions.append({
                    **base, 'type': 'income', 'group_id': m[0], 'detail_id': None,
                    'category_name': m[1], 'confidence': 0.7 if detailed else 0.55,
                    'source': 'plaid' if detailed and not detailed.startswith('KW') else 'keywords',
                    'reason': f'Plaid: {friendly}' if detailed else 'Deposit — looks like income', 'refund': False,
                })
            continue
        if primary in ('TRANSFER_IN', 'TRANSFER_OUT'):
            continue
        if detailed in DETAILED or primary in PRIMARY_DEFAULTS:
            friendly, syn = DETAILED.get(detailed, (PRIMARY_DEFAULTS.get(primary, ('', ''))[0], ()))
            m = match_subcategory(syn, friendly, categories)
            if m:
                conf = 0.75 if txn.get('raw') else 0.6
                if mixed:
                    conf = min(conf, 0.55)
                suggestions.append({
                    **base, 'type': 'expense', 'group_id': m[0], 'detail_id': m[1],
                    'category_name': m[2], 'confidence': conf,
                    'source': 'plaid' if txn.get('raw') else 'keywords',
                    'reason': f"{'Plaid' if txn.get('raw') else 'Description'}: {friendly}" + (' · mixed-use merchant — please review' if mixed else '')
                              + (' · refund — nets against spending' if money_in else ''),
                    'refund': money_in,
                })
                continue
            # No matching budget category → PROPOSE one (never auto-create)
            if friendly and friendly not in ('Income', 'Transfer'):
                guess = PRIMARY_DEFAULTS.get(primary, ('', default_group))[1]
                if guess not in group_ids:
                    guess = default_group
                p = proposals.setdefault(friendly, {
                    'key': friendly, 'name': friendly, 'suggested_group_id': guess,
                    'count': 0, 'total': 0.0, 'sample_merchants': [], 'external_ids': [],
                    'plaid_detailed': detailed or primary,
                })
                p['count'] += 1
                p['total'] += abs(amt)
                p['external_ids'].append(txn.get('external_id'))
                if label not in p['sample_merchants'] and len(p['sample_merchants']) < 4:
                    p['sample_merchants'].append(label)
    for p in proposals.values():
        p['total'] = round(p['total'], 2)
    return {
        'suggestions': suggestions,
        'new_category_proposals': sorted(proposals.values(), key=lambda p: -p['count']),
        'generated_at': datetime.now(timezone.utc).isoformat(),
    }
