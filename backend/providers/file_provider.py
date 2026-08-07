"""File-import provider. Accepts CSV, OFX, QFX, QBO. Parses to normalized
transactions, upserts into `bank_transactions` with duplicate detection.
"""
from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from providers.base import Provider, ProviderError

logger = logging.getLogger(__name__)

# Category heuristics — lightweight keyword matcher.
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ('give-tithe', ['tithe', 'church', 'offering']),
    ('steward-housing', ['mortgage', 'rent', 'lease']),
    ('steward-food', ['grocery', 'groceries', 'restaurant', 'coffee', 'starbucks', 'chipotle', 'trader joe', 'whole foods', 'safeway', 'kroger', 'aldi']),
    ('steward-transport', ['uber', 'lyft', 'gas ', 'shell', 'chevron', 'exxon', 'parking', 'transit', 'metro']),
    ('steward-utilities', ['electric', 'utility', 'water', 'gas bill', 'sewer', 'internet', 'comcast', 'verizon', 'at&t']),
    ('grow-investments', ['vanguard', 'fidelity', 'schwab', 'brokerage', 'invest']),
    ('grow-emergency', ['savings', 'transfer to savings']),
    ('enjoy-travel', ['airbnb', 'hotel', 'airline', 'delta', 'united', 'southwest', 'expedia']),
    ('enjoy-shopping', ['amazon', 'target', 'walmart', 'costco']),
    ('enjoy-entertainment', ['netflix', 'spotify', 'hulu', 'disney+', 'movie', 'concert']),
]


def _autocategorize(description: str) -> str | None:
    d = (description or '').lower()
    for cat, keywords in CATEGORY_RULES:
        if any(k in d for k in keywords):
            return cat
    return None


def _parse_amount(raw: Any) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw or '').strip().replace('$', '').replace(',', '')
    if not s:
        return 0.0
    negative = s.startswith('(') and s.endswith(')')
    if negative:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return -abs(v) if negative else v


def _parse_date(raw: Any) -> datetime:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%d/%m/%Y', '%Y/%m/%d', '%b %d, %Y', '%b %d'):
        try:
            return datetime.strptime(str(raw).strip(), fmt).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return datetime.now(timezone.utc)


def _detect_columns(header: list[str]) -> dict[str, str]:
    """Fuzzy-map CSV header names to canonical column keys.

    Supports the wildly varying formats used by Chase, Bank of America, Wells
    Fargo, Capital One, Discover, Amex, Citi, most credit unions, and Mint
    exports. Preference order: exact-match tokens > substring hints. When a
    bank uses SEPARATE `Debit` + `Credit` columns (Chase business,
    Wells Fargo credit-card, several credit unions), we return both under
    `debit` and `credit` keys so the parser knows to combine them.

    Recognised inputs:
      * Date columns: Date, Transaction Date, Post Date, Posting Date, Trans Date
      * Description columns: Description, Merchant, Payee, Details, Memo, Name
      * Amount columns: Amount (single column) OR Debit + Credit (two columns)
      * Category (optional)
      * Type / Transaction Type (optional — used to disambiguate direction)
    """
    normalized = [h.strip().lower() for h in header]
    mapping: dict[str, str] = {}
    # Priority-ordered exact-match names. For each key we list the *most
    # preferred* label first — this matters when a CSV includes both e.g.
    # "Description" and "Details" (Chase does): we want the true description
    # column, not the details/type column.
    priority = {
        'date':        ['date', 'transaction date', 'trans date', 'post date', 'posting date', 'posted date', 'settlement date'],
        'description': ['description', 'transaction description', 'merchant', 'payee', 'name', 'memo', 'details'],
        'amount':      ['amount', 'transaction amount', 'trans amount'],
        'debit':       ['debit', 'debit amount', 'withdrawal', 'withdrawals', 'money out', 'outflow'],
        'credit':      ['credit', 'credit amount', 'deposit', 'deposits', 'money in', 'inflow'],
        'category':    ['category', 'transaction category'],
        'type':        ['type', 'transaction type', 'trans type'],
        'account':     ['account', 'account name', 'account number'],
    }
    # Round 1 — walk preferred names, take the first header that matches.
    for key, names in priority.items():
        for wanted in names:
            for idx, name in enumerate(normalized):
                if name == wanted:
                    mapping[key] = header[idx]
                    break
            if key in mapping:
                break
    # Round 2 — fuzzy substring for anything still missing.
    for idx, name in enumerate(normalized):
        if header[idx] in mapping.values():
            continue  # already claimed
        if 'date' in name and 'date' not in mapping:
            mapping['date'] = header[idx]
        elif any(k in name for k in ('description', 'details', 'memo', 'payee', 'merchant', 'name')) and 'description' not in mapping:
            mapping['description'] = header[idx]
        elif 'amount' in name and 'amount' not in mapping and 'debit' not in mapping and 'credit' not in mapping:
            mapping['amount'] = header[idx]
        elif ('debit' in name or 'withdraw' in name or 'outflow' in name or 'money out' in name) and 'debit' not in mapping:
            mapping['debit'] = header[idx]
        elif ('credit' in name or 'deposit' in name or 'inflow' in name or 'money in' in name) and 'credit' not in mapping:
            mapping['credit'] = header[idx]
        elif 'category' in name and 'category' not in mapping:
            mapping['category'] = header[idx]
        elif ('type' in name or 'transaction type' in name) and 'type' not in mapping:
            mapping['type'] = header[idx]
    return mapping


def _combine_debit_credit(debit_raw: Any, credit_raw: Any) -> float:
    """Combine separate Debit + Credit columns into a signed amount.

    Convention: debit reduces balance (negative), credit increases (positive).
    Both fields being blank returns 0.0."""
    d = _parse_amount(debit_raw)
    c = _parse_amount(credit_raw)
    # Some banks quote debit as a positive number even in the debit column;
    # normalise to a magnitude and let sign come from column identity.
    return abs(c) - abs(d)


def _resolve_direction(amount: float, type_hint: str) -> float:
    """If a `Type` / `Transaction Type` column suggests direction that
    disagrees with the sign of `amount`, correct it. E.g. Chase gives all
    values positive with Type="DEBIT" or Type="CREDIT" and expects consumers
    to flip. If no hint, return `amount` untouched.
    """
    if not type_hint:
        return amount
    t = type_hint.strip().upper()
    if t in ('DEBIT', 'WITHDRAWAL', 'PURCHASE', 'PAYMENT', 'FEE', 'CHARGE') and amount > 0:
        return -amount
    if t in ('CREDIT', 'DEPOSIT', 'REFUND', 'RETURN', 'REVERSAL') and amount < 0:
        return -amount
    return amount


def _parse_csv(content: str) -> tuple[dict[str, str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a CSV into normalized transactions.

    Returns `(detected_columns, parsed_rows, skipped_rows)`. Skipped rows
    include the reason and the original row so the caller can surface them
    to the user (spec #12 — "Do not reject the entire file"). Valid rows are
    imported even when a subset is malformed.
    """
    reader = csv.reader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        raise ProviderError('CSV appears to be empty')
    header, *data_rows = rows
    mapping = _detect_columns(header)
    # A parseable file needs a date column AND either an Amount OR a
    # (Debit + Credit) pair. Anything else → surface a clear error so the UI
    # can offer the manual column-mapping flow.
    has_amount = 'amount' in mapping
    has_debit_credit = 'debit' in mapping or 'credit' in mapping
    if not mapping.get('date') or not (has_amount or has_debit_credit):
        raise ProviderError(
            'Could not identify the Date and Amount (or Debit + Credit) columns. '
            'You can either rename your CSV headers to include "Date" and "Amount", '
            'or export in a different format. Detected headers: ' + ', '.join(header)
        )
    idx = {k: header.index(v) for k, v in mapping.items()}
    parsed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for row_num, row in enumerate(data_rows, start=2):  # start=2 → header is row 1
        if not row or all(not (c or '').strip() for c in row):
            continue
        try:
            date_val = _parse_date(row[idx['date']])
            # Amount handling — single column OR debit/credit pair. If we have
            # BOTH (rare), the single Amount column wins; the parser is
            # generous but never sums the same value twice.
            if 'amount' in idx:
                amount = _parse_amount(row[idx['amount']])
            else:
                debit_raw = row[idx['debit']] if 'debit' in idx else ''
                credit_raw = row[idx['credit']] if 'credit' in idx else ''
                amount = _combine_debit_credit(debit_raw, credit_raw)
            if 'type' in idx:
                amount = _resolve_direction(amount, row[idx['type']])
            description = (row[idx['description']] if 'description' in idx else '').strip()
            category_hint = (row[idx['category']] if 'category' in idx else '').strip() or None
            if amount == 0 and not description:
                skipped.append({'row_num': row_num, 'reason': 'blank / zero amount', 'raw': row})
                continue
            parsed.append({
                'date': date_val,
                'amount': amount,
                'description': description,
                'category_hint': category_hint,
            })
        except (IndexError, ValueError, TypeError) as e:
            skipped.append({'row_num': row_num, 'reason': f'unreadable ({type(e).__name__})', 'raw': row})
            continue
    return mapping, parsed, skipped


def _parse_ofx(content: bytes) -> list[dict[str, Any]]:
    from ofxparse import OfxParser
    try:
        ofx = OfxParser.parse(io.BytesIO(content))
    except Exception as e:  # noqa: BLE001
        raise ProviderError(f'Could not parse OFX/QFX/QBO file: {e}')
    txns: list[dict[str, Any]] = []
    for account in ofx.accounts:
        stmt = getattr(account, 'statement', None)
        if not stmt:
            continue
        for t in stmt.transactions:
            txns.append({
                'date': t.date.replace(tzinfo=timezone.utc) if t.date and t.date.tzinfo is None else (t.date or datetime.now(timezone.utc)),
                'amount': float(t.amount),
                'description': (t.payee or t.memo or '').strip(),
                'category_hint': None,
                'external_id': t.id or None,
            })
    return txns


class FileProvider(Provider):
    id = 'file'
    label = 'CSV / OFX / QFX / QBO upload'

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self.db = db

    def is_configured(self) -> bool:
        return True  # Always available.

    async def import_file(
        self, user_id: str, filename: str, mime: str | None, raw: bytes, account_name: str | None,
    ) -> dict[str, Any]:
        lower_name = (filename or '').lower()
        is_ofx_like = any(lower_name.endswith(ext) for ext in ('.ofx', '.qfx', '.qbo')) or (mime or '').lower().startswith('application/x-ofx')
        rows: list[dict[str, Any]]
        detected_columns: dict[str, str] | None = None
        skipped: list[dict[str, Any]] = []
        if is_ofx_like:
            rows = _parse_ofx(raw)
            fmt = 'ofx'
        else:
            try:
                text = raw.decode('utf-8-sig', errors='replace')
            except Exception as e:  # noqa: BLE001
                raise ProviderError(f'Could not read CSV file: {e}')
            detected_columns, rows, skipped = _parse_csv(text)
            fmt = 'csv'
        if not rows:
            raise ProviderError('No transactions found in the file.')

        # Lazy import to avoid a hard dep during module boot.
        from transaction_classifier import classify_from_text

        link_id = f'file-{uuid.uuid4().hex[:12]}'
        acct_display = account_name or filename or 'Imported account'
        await self.db.linked_accounts.insert_one({
            'user_id': user_id, 'provider': self.id, 'link_id': link_id,
            'account_name': acct_display, 'source_file': filename, 'format': fmt,
            'balance': 0.0, 'currency': 'USD',
            'created_at': datetime.now(timezone.utc), 'last_sync_at': datetime.now(timezone.utc),
        })

        inserted = 0
        duplicates = 0
        running_balance = 0.0
        for r in rows:
            ext_id = r.get('external_id') or f"{r['date'].isoformat()}|{r['amount']:.2f}|{(r.get('description') or '').strip().lower()}"
            amount = r['amount']
            running_balance += amount
            desc = r.get('description') or ''
            system_cat = classify_from_text(desc, r.get('category_hint'))
            doc = {
                'user_id': user_id, 'provider': self.id, 'link_id': link_id,
                'account_id': link_id, 'external_id': ext_id, 'date': r['date'],
                'name': desc, 'description': desc, 'amount': amount,
                'type': 'income' if amount > 0 else 'expense',
                'origin': acct_display, 'period': r['date'].strftime('%B'),
                'pending': False, 'category_id': _autocategorize(desc),
                'category_hint': r.get('category_hint'),
                # Phase-3 classification (transfer / cc-payment / loan-payment).
                'system_category': system_cat,
                'system_category_auto': system_cat,
                'is_transfer': system_cat == 'transfer',
            }
            try:
                result = await self.db.bank_transactions.update_one(
                    {'user_id': user_id, 'provider': self.id, 'external_id': ext_id},
                    {'$setOnInsert': doc}, upsert=True,
                )
                if result.upserted_id:
                    inserted += 1
                else:
                    duplicates += 1
            except Exception as e:  # noqa: BLE001
                logger.warning('bank_transactions upsert failed: %s', e)
        await self.db.linked_accounts.update_one({'link_id': link_id}, {'$set': {'balance': running_balance}})
        return {
            'link_id': link_id, 'account_name': acct_display, 'format': fmt,
            'detected_columns': detected_columns or {}, 'inserted': inserted, 'duplicates': duplicates,
            'skipped_rows': skipped, 'skipped_count': len(skipped),
            'balance': running_balance,
        }

    async def link(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        raise ProviderError('File provider uses /accounts/import instead of /accounts/link.')

    async def list_accounts(self, user_id: str) -> list[dict[str, Any]]:
        cursor = self.db.linked_accounts.find({'user_id': user_id, 'provider': self.id}, {'_id': 0})
        return await cursor.to_list(length=200)

    async def sync(self, user_id: str) -> dict[str, Any]:
        return {'synced': 0, 'errors': [], 'note': 'File-import accounts are static; upload another file to add transactions.'}

    async def unlink(self, user_id: str, link_id: str) -> None:
        await self.db.linked_accounts.delete_one({'user_id': user_id, 'link_id': link_id, 'provider': self.id})
        await self.db.bank_transactions.delete_many({'user_id': user_id, 'link_id': link_id})
