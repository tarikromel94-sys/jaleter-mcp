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
    """Fuzzy-map CSV header names to canonical column keys."""
    normalized = [h.strip().lower() for h in header]
    mapping: dict[str, str] = {}
    for idx, name in enumerate(normalized):
        if any(k in name for k in ('date', 'posted', 'transaction date')) and 'date' not in mapping:
            mapping['date'] = header[idx]
        elif any(k in name for k in ('description', 'details', 'name', 'payee', 'merchant', 'memo')) and 'description' not in mapping:
            mapping['description'] = header[idx]
        elif any(k in name for k in ('amount', 'debit', 'credit')) and 'amount' not in mapping:
            mapping['amount'] = header[idx]
        elif 'category' in name and 'category' not in mapping:
            mapping['category'] = header[idx]
    return mapping


def _parse_csv(content: str) -> tuple[dict[str, str], list[dict[str, Any]]]:
    reader = csv.reader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        raise ProviderError('CSV appears to be empty')
    header, *data_rows = rows
    mapping = _detect_columns(header)
    if not mapping.get('date') or not mapping.get('amount'):
        raise ProviderError('Could not identify Date and Amount columns. Please rename your CSV headers.')
    idx = {k: header.index(v) for k, v in mapping.items()}
    parsed: list[dict[str, Any]] = []
    for row in data_rows:
        if not row or all(not (c or '').strip() for c in row):
            continue
        try:
            parsed.append({
                'date': _parse_date(row[idx['date']]),
                'amount': _parse_amount(row[idx['amount']]),
                'description': (row[idx['description']] if 'description' in idx else '').strip(),
                'category_hint': (row[idx['category']] if 'category' in idx else '').strip() or None,
            })
        except IndexError:
            continue
    return mapping, parsed


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
        if is_ofx_like:
            rows = _parse_ofx(raw)
            fmt = 'ofx'
        else:
            try:
                text = raw.decode('utf-8-sig', errors='replace')
            except Exception as e:  # noqa: BLE001
                raise ProviderError(f'Could not read CSV file: {e}')
            detected_columns, rows = _parse_csv(text)
            fmt = 'csv'
        if not rows:
            raise ProviderError('No transactions found in the file.')

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
            doc = {
                'user_id': user_id, 'provider': self.id, 'link_id': link_id,
                'account_id': link_id, 'external_id': ext_id, 'date': r['date'],
                'name': r.get('description') or '', 'amount': amount,
                'type': 'income' if amount > 0 else 'expense',
                'origin': acct_display, 'period': r['date'].strftime('%B'),
                'pending': False, 'category_id': _autocategorize(r.get('description') or ''),
                'category_hint': r.get('category_hint'),
            }
            try:
                result = await self.db.bank_transactions.update_one(
                    {'user_id': user_id, 'account_id': link_id, 'external_id': ext_id},
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
