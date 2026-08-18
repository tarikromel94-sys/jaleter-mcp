"""File-import provider. Accepts CSV, XLSX/XLS, OFX, QFX, QBO. Parses to
normalized transactions, upserts into `bank_transactions` with duplicate
detection. Supports two-step preview → commit + explicit column mapping
overrides + per-user saved mappings for reuse across future files.
"""
from __future__ import annotations

import csv
import hashlib
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


def _parse_csv(content: str) -> tuple[list[str], dict[str, str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a CSV into normalized transactions.

    Returns `(header, detected_columns, parsed_rows, skipped_rows)`. Does NOT
    raise on unrecognised columns — the caller can inspect `detected_columns`
    to decide whether to prompt the user for a manual mapping. Valid rows
    are still returned so a partial mapping can preview correctly.
    """
    try:
        reader = csv.reader(io.StringIO(content))
        rows = list(reader)
    except csv.Error as e:
        # Malformed CSV — e.g., binary bytes decoded to text, unterminated
        # quotes, or lone newlines inside unquoted fields. Surface a plain
        # message instead of leaking the raw csv module error.
        raise ProviderError(
            "This doesn't look like a valid CSV file. "
            "Please export it again from your bank or try a different file."
        ) from e
    if not rows:
        raise ProviderError('The file appears to be empty.')
    header, *data_rows = rows
    mapping = _detect_columns(header)
    return header, mapping, *_extract_rows(header, data_rows, mapping)


def _parse_xlsx(raw: bytes) -> tuple[list[str], dict[str, str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse an XLSX / XLS file. Reads the first sheet, first row as headers."""
    try:
        from openpyxl import load_workbook
    except Exception as e:  # noqa: BLE001
        raise ProviderError('Excel support unavailable on this server.') from e
    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        raise ProviderError(f'Could not read the Excel file: {e}') from e
    ws = wb.active
    if ws is None:
        raise ProviderError('Excel workbook has no active sheet.')
    all_rows = [[('' if c is None else c) for c in row] for row in ws.iter_rows(values_only=True)]
    if not all_rows:
        raise ProviderError('The spreadsheet appears to be empty.')
    header = [str(h).strip() for h in all_rows[0]]
    data_rows = all_rows[1:]
    mapping = _detect_columns(header)
    return header, mapping, *_extract_rows(header, data_rows, mapping)


def _extract_rows(header: list[str], data_rows: list[list[Any]], mapping: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Shared row-extraction pass used by both CSV + XLSX parsers.

    If `mapping` doesn't contain the minimum (date + amount OR debit/credit),
    we return an empty parsed list and skip nothing — the caller will surface
    the file's `header` so the client can request a manual mapping.
    """
    parsed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    has_amount = 'amount' in mapping
    has_dc = 'debit' in mapping or 'credit' in mapping
    if not mapping.get('date') or not (has_amount or has_dc):
        return parsed, skipped
    idx: dict[str, int] = {}
    for k, colname in mapping.items():
        try:
            idx[k] = header.index(colname)
        except ValueError:
            continue
    if 'date' not in idx or not ('amount' in idx or 'debit' in idx or 'credit' in idx):
        return parsed, skipped
    for row_num, row in enumerate(data_rows, start=2):
        row = list(row)
        if not row or all((c is None or str(c).strip() == '') for c in row):
            continue
        try:
            date_val = _parse_date(row[idx['date']])
            if 'amount' in idx:
                amount = _parse_amount(row[idx['amount']])
            else:
                d_raw = row[idx['debit']] if 'debit' in idx else ''
                c_raw = row[idx['credit']] if 'credit' in idx else ''
                amount = _combine_debit_credit(d_raw, c_raw)
            if 'type' in idx and idx['type'] < len(row):
                amount = _resolve_direction(amount, str(row[idx['type']]))
            description = str(row[idx['description']]).strip() if 'description' in idx and idx['description'] < len(row) else ''
            category_hint = (str(row[idx['category']]).strip() or None) if 'category' in idx and idx['category'] < len(row) else None
            if amount == 0 and not description:
                skipped.append({'row_num': row_num, 'reason': 'blank / zero amount'})
                continue
            parsed.append({
                'date': date_val,
                'amount': amount,
                'description': description,
                'category_hint': category_hint,
            })
        except (IndexError, ValueError, TypeError) as e:
            skipped.append({'row_num': row_num, 'reason': f'unreadable ({type(e).__name__})'})
            continue
    return parsed, skipped


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


def _fingerprint(header: list[str]) -> str:
    """Stable hash of sorted normalized headers — used to key `saved_mappings`
    so a repeat upload from the same bank format reuses the user's mapping."""
    norm = sorted(h.strip().lower() for h in header if h and str(h).strip())
    return hashlib.sha256('|'.join(norm).encode('utf-8')).hexdigest()[:24]


def _preview_payload(fmt: str, filename: str, header: list[str] | None, mapping: dict[str, str],
                     rows: list[dict[str, Any]], skipped: list[dict[str, Any]],
                     sample_size: int = 8) -> dict[str, Any]:
    dates = sorted(r['date'] for r in rows) if rows else []
    total_debits = sum(-r['amount'] for r in rows if r['amount'] < 0)
    total_credits = sum(r['amount'] for r in rows if r['amount'] > 0)
    needed = ['date']
    if not ('amount' in mapping or 'debit' in mapping or 'credit' in mapping):
        needed.append('amount')
    if not mapping.get('date'):
        needed.append('date')
    needs_mapping = bool(needed) and (
        not mapping.get('date')
        or not ('amount' in mapping or 'debit' in mapping or 'credit' in mapping)
    )
    return {
        'format': fmt,
        'filename': filename,
        'headers': header or [],
        'detected_mapping': mapping,
        'transaction_count': len(rows),
        'date_range': {
            'start': dates[0].strftime('%Y-%m-%d') if dates else None,
            'end': dates[-1].strftime('%Y-%m-%d') if dates else None,
        },
        'total_debits': round(total_debits, 2),
        'total_credits': round(total_credits, 2),
        'sample': [
            {
                'date': r['date'].strftime('%Y-%m-%d'),
                'description': r['description'],
                'amount': round(r['amount'], 2),
                'category_hint': r.get('category_hint'),
            } for r in rows[:sample_size]
        ],
        'skipped_count': len(skipped),
        'skipped_sample': skipped[:5],
        'needs_mapping': needs_mapping,
        'fingerprint': _fingerprint(header) if header else None,
    }


class FileProvider(Provider):
    id = 'file'
    label = 'CSV / XLSX / OFX / QFX / QBO upload'

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self.db = db

    def is_configured(self) -> bool:
        return True  # Always available.

    async def _parse(self, user_id: str, filename: str, mime: str | None, raw: bytes,
                     override_mapping: dict[str, str] | None) -> tuple[str, list[str] | None, dict[str, str], list[dict[str, Any]], list[dict[str, Any]]]:
        """Sniff format and parse. Returns (fmt, header, mapping, rows, skipped).

        For CSV/XLSX, if `override_mapping` is provided it takes precedence over
        auto-detection AND over any saved mapping. Otherwise: try auto-detect;
        if that misses, try to look up a previously-saved mapping keyed by the
        file's header fingerprint.
        """
        lower = (filename or '').lower()
        is_ofx = any(lower.endswith(x) for x in ('.ofx', '.qfx', '.qbo')) or (mime or '').lower().startswith('application/x-ofx')
        is_xlsx = lower.endswith('.xlsx') or lower.endswith('.xls') or (mime or '') in (
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
        )
        if is_ofx:
            rows = _parse_ofx(raw)
            if not rows:
                raise ProviderError('The OFX file contained no transactions.')
            return 'ofx', None, {}, rows, []
        if is_xlsx:
            header, mapping, rows, skipped = _parse_xlsx(raw)
            fmt = 'xlsx'
        else:
            try:
                text = raw.decode('utf-8-sig', errors='replace')
            except Exception as e:  # noqa: BLE001
                raise ProviderError('Unsupported file type or corrupt CSV.') from e
            header, mapping, rows, skipped = _parse_csv(text)
            fmt = 'csv'
        # Apply override or saved mapping when auto-detect isn't sufficient.
        if override_mapping:
            mapping = {k: v for k, v in override_mapping.items() if v and v in header}
            rows, skipped = _extract_rows(header, [r for r in (self._load_data_rows(fmt, raw))], mapping)
        elif not (mapping.get('date') and ('amount' in mapping or 'debit' in mapping or 'credit' in mapping)):
            saved = await self.db.saved_mappings.find_one({
                'user_id': user_id, 'fingerprint': _fingerprint(header),
            })
            if saved and isinstance(saved.get('mapping'), dict):
                clean = {k: v for k, v in saved['mapping'].items() if v in header}
                if clean.get('date') and ('amount' in clean or 'debit' in clean or 'credit' in clean):
                    mapping = clean
                    rows, skipped = _extract_rows(header, list(self._load_data_rows(fmt, raw)), mapping)
        return fmt, header, mapping, rows, skipped

    def _load_data_rows(self, fmt: str, raw: bytes) -> list[list[Any]]:
        """Re-read raw file into an in-memory rows-of-cells list. Used when we
        need to re-run `_extract_rows` with a different mapping."""
        if fmt == 'xlsx':
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            ws = wb.active
            rows = [[('' if c is None else c) for c in r] for r in ws.iter_rows(values_only=True)]
            return rows[1:] if rows else []
        try:
            text = raw.decode('utf-8-sig', errors='replace')
        except Exception:  # noqa: BLE001
            return []
        rr = list(csv.reader(io.StringIO(text)))
        return rr[1:] if rr else []

    async def preview(self, user_id: str, filename: str, mime: str | None, raw: bytes,
                      override_mapping: dict[str, str] | None = None) -> dict[str, Any]:
        """Parse-only endpoint: returns detected mapping + first N rows +
        totals + date range without writing anything to the database."""
        fmt, header, mapping, rows, skipped = await self._parse(user_id, filename, mime, raw, override_mapping)
        return _preview_payload(fmt, filename, header, mapping, rows, skipped)

    async def import_file(
        self, user_id: str, filename: str, mime: str | None, raw: bytes, account_name: str | None,
        override_mapping: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        fmt, header, detected_columns, rows, skipped = await self._parse(user_id, filename, mime, raw, override_mapping)
        if not rows:
            if header and (not detected_columns.get('date') or not ('amount' in detected_columns or 'debit' in detected_columns or 'credit' in detected_columns)):
                raise ProviderError(
                    'Could not identify a Date column and an Amount (or Debit + Credit) column. '
                    'Preview the file first and choose the correct columns to complete the import.'
                )
            raise ProviderError('No transactions were found in the file.')
        # Persist the mapping so the next file with the same header fingerprint
        # imports without prompting.
        if header and detected_columns and fmt in ('csv', 'xlsx'):
            try:
                fp = _fingerprint(header)
                await self.db.saved_mappings.update_one(
                    {'user_id': user_id, 'fingerprint': fp},
                    {'$set': {
                        'user_id': user_id, 'fingerprint': fp, 'format': fmt,
                        'header_sample': header, 'mapping': detected_columns,
                        'updated_at': datetime.now(timezone.utc),
                    }},
                    upsert=True,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning('saved_mappings upsert failed: %s', e)

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
