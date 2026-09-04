import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, D } from '@/src/jaleterTheme';
import { MONEY } from '@/src/quoteLibrary';
import { s, useThemed, PeriodPills, PageHeader, Sheet, Toast as SharedToast, GoldButton } from '@/src/utils/appShared';
import {
  MONTHS, monthIndex, currentMonth, monthlyAmount, annualAmount,
  isSystemTransaction, spentForSubInMonth, receivedForIncomeInMonth,
  transactionsForSubInMonth, transactionsForIncomeInMonth,
  type Tx, type Category, type Subcategory,
} from '@/src/utils/budgetModel';
import { TxForm } from '@/src/screens/TransactionsScreen';

/* ---------------- Budget ---------------- */
/* ---------------- Budget helpers ---------------- */
function toCsv(rows: (string | number)[][]): string {
  const esc = (v: any) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\n');
}
async function exportBudgetXlsx(categories: Category[], incomeSources: any[], transactions: any[], onToast: (m: string) => void) {
  const XLSX = await import('xlsx');
  const yearLabel = new Date().getFullYear();
  const dollarFmt = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';

  // Helpers to compute the same totals used across the app
  const incomeActualForMonth = (srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0);
  const expenseActualForMonth = (subId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === subId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0);
  const incomeAnnualActual = (srcId: string) => MONTHS.reduce((sum: number, _: string, i: number) => sum + incomeActualForMonth(srcId, i), 0);
  const expenseAnnualActual = (subId: string) => MONTHS.reduce((sum: number, _: string, i: number) => sum + expenseActualForMonth(subId, i), 0);
  const incomePlannedAnnual = (src: any) => (src.budgeted || 0) * 12;

  const wb = XLSX.utils.book_new();

  // ---------- Sheet 1: Budget Summary ----------
  const summaryRows: any[][] = [];
  summaryRows.push(['Jaleter — Budget Summary'], [`Year ${yearLabel}`], []);
  summaryRows.push(['Section', 'Category', 'Planned', 'Actual', 'Remaining']);

  let grandPlannedIncome = 0, grandActualIncome = 0;
  let grandPlannedExpense = 0, grandActualExpense = 0;

  // Earn section
  summaryRows.push(['EARN']);
  incomeSources.forEach((src: any) => {
    const p = incomePlannedAnnual(src);
    const a = incomeAnnualActual(src.id);
    grandPlannedIncome += p; grandActualIncome += a;
    summaryRows.push(['Earn', src.name, p, a, a - p]);
  });
  summaryRows.push(['', 'Earn Total', grandPlannedIncome, grandActualIncome, grandActualIncome - grandPlannedIncome]);
  summaryRows.push([]);

  // Expense sections (Give / Steward / Grow / Enjoy — plus any custom)
  categories.forEach((c: Category) => {
    summaryRows.push([c.name.toUpperCase()]);
    let secPlanned = 0, secActual = 0;
    c.subcategories.forEach((sub: Subcategory) => {
      const p = annualAmount(sub);
      const a = expenseAnnualActual(sub.id);
      secPlanned += p; secActual += a;
      grandPlannedExpense += p; grandActualExpense += a;
      summaryRows.push([c.name, sub.name, p, a, p - a]);
    });
    summaryRows.push(['', `${c.name} Total`, secPlanned, secActual, secPlanned - secActual]);
    summaryRows.push([]);
  });

  summaryRows.push(['OVERALL']);
  summaryRows.push(['', 'Total Income', grandPlannedIncome, grandActualIncome, grandActualIncome - grandPlannedIncome]);
  summaryRows.push(['', 'Total Planned Expenses', grandPlannedExpense, '', '']);
  summaryRows.push(['', 'Total Actual Expenses', '', grandActualExpense, '']);
  summaryRows.push(['', 'Planned Net (Income − Planned Exp)', grandPlannedIncome, grandPlannedExpense, grandPlannedIncome - grandPlannedExpense]);
  summaryRows.push(['', 'Actual Net (Income − Actual Exp)', '', '', grandActualIncome - grandActualExpense]);

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  // Apply $ format to numeric columns C-E (0-indexed 2, 3, 4)
  const rangeS = XLSX.utils.decode_range(ws1['!ref'] || 'A1');
  for (let R = 4; R <= rangeS.e.r; ++R) {
    for (const col of [2, 3, 4]) {
      const cell = ws1[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, 'Budget Summary');

  // ---------- Sheet 2: Monthly Budget (one sheet, all 12 months stacked) ----------
  const monthlyRows: any[][] = [];
  monthlyRows.push(['Jaleter — Monthly Budget'], [`Year ${yearLabel}`], []);
  MONTHS.forEach((m: string, mi: number) => {
    monthlyRows.push([m.toUpperCase()]);
    monthlyRows.push(['Section', 'Category', 'Planned', 'Actual', 'Remaining']);
    let monthPlannedIncome = 0, monthActualIncome = 0;
    let monthPlannedExpense = 0, monthActualExpense = 0;
    // Earn
    incomeSources.forEach((src: any) => {
      const p = src.budgeted || 0;
      const a = incomeActualForMonth(src.id, mi);
      monthPlannedIncome += p; monthActualIncome += a;
      monthlyRows.push(['Earn', src.name, p, a, a - p]);
    });
    // Expense categories
    categories.forEach((c: Category) => {
      c.subcategories.forEach((sub: Subcategory) => {
        const p = monthlyAmount(sub, mi);
        const a = expenseActualForMonth(sub.id, mi);
        monthPlannedExpense += p; monthActualExpense += a;
        monthlyRows.push([c.name, sub.name, p, a, p - a]);
      });
    });
    monthlyRows.push(['', 'Income Total', monthPlannedIncome, monthActualIncome, monthActualIncome - monthPlannedIncome]);
    monthlyRows.push(['', 'Expense Total', monthPlannedExpense, monthActualExpense, monthPlannedExpense - monthActualExpense]);
    monthlyRows.push(['', 'Net (Actual)', '', '', monthActualIncome - monthActualExpense]);
    monthlyRows.push([]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(monthlyRows);
  ws2['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const rangeM = XLSX.utils.decode_range(ws2['!ref'] || 'A1');
  for (let R = 3; R <= rangeM.e.r; ++R) {
    for (const col of [2, 3, 4]) {
      const cell = ws2[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Budget');

  // ---------- Sheet 3: Annual Grid ----------
  const gridRows: any[][] = [];
  gridRows.push(['Jaleter — Annual Grid'], [`Year ${yearLabel}`], []);
  gridRows.push(['Category', ...MONTHS, 'Annual Total']);
  // Earn
  gridRows.push(['EARN']);
  incomeSources.forEach((src: any) => {
    const monthly = src.budgeted || 0;
    const months = MONTHS.map(() => monthly);
    gridRows.push([`Earn · ${src.name}`, ...months, monthly * 12]);
  });
  // Expenses grouped by category
  categories.forEach((c: Category) => {
    gridRows.push([c.name.toUpperCase()]);
    c.subcategories.forEach((sub: Subcategory) => {
      const monthsArr = MONTHS.map((_: string, i: number) => monthlyAmount(sub, i));
      const total = monthsArr.reduce((s: number, x: number) => s + x, 0);
      gridRows.push([`${c.name} · ${sub.name}`, ...monthsArr, total]);
    });
  });
  const ws3 = XLSX.utils.aoa_to_sheet(gridRows);
  ws3['!cols'] = [{ wch: 28 }, ...MONTHS.map(() => ({ wch: 11 })), { wch: 14 }];
  const rangeG = XLSX.utils.decode_range(ws3['!ref'] || 'A1');
  for (let R = 4; R <= rangeG.e.r; ++R) {
    for (let col = 1; col <= 13; col++) {
      const cell = ws3[XLSX.utils.encode_cell({ r: R, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
    }
  }
  XLSX.utils.book_append_sheet(wb, ws3, 'Annual Grid');

  // ---------- Sheet 4: Transactions ----------
  const catNameById: Record<string, string> = {};
  const sectionByDetail: Record<string, string> = {};
  categories.forEach((c: Category) => {
    c.subcategories.forEach((sub: Subcategory) => {
      catNameById[sub.id] = sub.name;
      sectionByDetail[sub.id] = c.name;
    });
  });
  const incNameById: Record<string, string> = {};
  incomeSources.forEach((src: any) => { incNameById[src.id] = src.name; });
  const txRows: any[][] = [['Date', 'Merchant / Description', 'Category', 'Jaleter Section', 'Amount', 'Account']];
  const sorted = [...transactions].sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  sorted.forEach((tx: any) => {
    let categoryName = ''; let sectionName = '';
    if (tx.type === 'income') { categoryName = incNameById[tx.groupId] || 'Income'; sectionName = 'Earn'; }
    else { categoryName = catNameById[tx.detailId] || (tx.detailId || ''); sectionName = sectionByDetail[tx.detailId] || ''; }
    const dateStr = tx.date ? (typeof tx.date === 'string' ? tx.date.slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10)) : '';
    txRows.push([dateStr, tx.name || '', categoryName, sectionName, tx.amount || 0, tx.origin || 'Manual']);
  });
  const ws4 = XLSX.utils.aoa_to_sheet(txRows);
  ws4['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }];
  const rangeT = XLSX.utils.decode_range(ws4['!ref'] || 'A1');
  for (let R = 1; R <= rangeT.e.r; ++R) {
    const cell = ws4[XLSX.utils.encode_cell({ r: R, c: 4 })];
    if (cell && typeof cell.v === 'number') cell.z = dollarFmt;
  }
  XLSX.utils.book_append_sheet(wb, ws4, 'Transactions');

  // Emit and share/download
  const filename = `Jaleter_Budget_${yearLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (Platform.OS === 'web') {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      onToast('Downloaded Excel workbook.');
    } else {
      const FileSystem = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, wbout, { encoding: FileSystem.EncodingType.Base64 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) { await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Export Budget Workbook' }); onToast('Ready to share.'); }
      else { onToast('Saved to app cache.'); }
    }
  } catch (e: any) { onToast(e?.message || 'Export failed.'); }
}

async function exportTransactionsCsv(categories: Category[], incomeSources: any[], transactions: any[], onToast: (m: string) => void) {
  const catNameById: Record<string, string> = {};
  const sectionByDetail: Record<string, string> = {};
  categories.forEach((c: Category) => {
    c.subcategories.forEach((sub: Subcategory) => { catNameById[sub.id] = sub.name; sectionByDetail[sub.id] = c.name; });
  });
  const incNameById: Record<string, string> = {};
  incomeSources.forEach((src: any) => { incNameById[src.id] = src.name; });
  const rows: (string | number)[][] = [['Date', 'Merchant', 'Category', 'Jaleter Section', 'Type', 'Amount', 'Account', 'Month']];
  const sorted = [...transactions].sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
  sorted.forEach((tx: any) => {
    let categoryName = ''; let sectionName = '';
    if (tx.type === 'income') { categoryName = incNameById[tx.groupId] || 'Income'; sectionName = 'Earn'; }
    else { categoryName = catNameById[tx.detailId] || (tx.detailId || ''); sectionName = sectionByDetail[tx.detailId] || ''; }
    const dateStr = tx.date ? (typeof tx.date === 'string' ? tx.date.slice(0, 10) : new Date(tx.date).toISOString().slice(0, 10)) : '';
    rows.push([dateStr, tx.name || '', categoryName, sectionName, tx.type || '', tx.amount || 0, tx.origin || 'Manual', tx.period || '']);
  });
  const csv = toCsv(rows);
  const filename = `Jaleter_Transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  try {
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      onToast('Downloaded transactions CSV.');
    } else {
      const FileSystem = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) { await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export Transactions' }); onToast('Ready to share.'); }
      else { onToast('Saved to app cache.'); }
    }
  } catch (e: any) { onToast(e?.message || 'Export failed.'); }
}

/* ---------------- Budget Screen ---------------- */
// Small picker row used inside the Reset-Budget confirmation sheet. Lets
// the user switch between months (0–11) or years (currentYear-2 .. +5)
// without leaving the sheet. Purely presentational — parent owns state.
function YearMonthPickerRow({ kind, target, onChange, currentYear }: {
  kind: 'month' | 'year';
  target: { kind: 'month' | 'year'; year: number; monthIdx?: number };
  onChange: (t: { kind: 'month' | 'year'; year: number; monthIdx?: number }) => void;
  currentYear: number;
}) {
  const t = useThemed();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4, currentYear + 5];
  return (
    <View style={{ marginTop: 4 }}>
      {kind === 'month' && (
        <View style={{ marginBottom: 10 }}>
          <Text style={[{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: '#a97c39', marginBottom: 6 }]}>MONTH</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {MONTHS.map((m, idx) => {
              const selected = target.monthIdx === idx;
              return (
                <Pressable
                  key={m}
                  onPress={() => onChange({ ...target, monthIdx: idx })}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
                    borderWidth: 1, borderColor: selected ? '#b28a4c' : '#e6dcc5',
                    backgroundColor: selected ? '#fbf6ec' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: selected ? '800' : '600', color: selected ? '#8b6437' : '#7a6a4d' }}>{m}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <Text style={[{ fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: '#a97c39', marginBottom: 6 }]}>YEAR</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {years.map((y) => {
          const selected = target.year === y;
          return (
            <Pressable
              key={y}
              onPress={() => onChange({ ...target, year: y })}
              style={{
                paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
                borderWidth: 1, borderColor: selected ? '#b28a4c' : '#e6dcc5',
                backgroundColor: selected ? '#fbf6ec' : 'transparent',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: selected ? '800' : '600', color: selected ? '#8b6437' : t.dark ? '#d9cfb6' : '#7a6a4d' }}>{y}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const BudgetScreen = ({ categories, setCategories, categoriesByYear, setCategoriesByYear, incomeSources, setIncomeSources, transactions, setTransactions, focusCategory, clearFocus, alerts, budgetYear, finalizedBudgetMonths, setFinalizedBudgetMonths, onSwitchYear, onCopyLastYear }: any) => {
  const t = useThemed();
  const [period, setPeriod] = useState<string>(currentMonth());
  const [view, setView] = useState<'cards' | 'grid'>('cards');
  const [expanded, setExpanded] = useState<string[]>(['give']);
  const [earnExpanded, setEarnExpanded] = useState(true);
  const [editing, setEditing] = useState<{ groupId: string; sub: Subcategory } | null>(null);
  const [editingEarn, setEditingEarn] = useState<any>(null);
  const [addingEarn, setAddingEarn] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Budget-options menu + reset-confirmation state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ kind: 'month' | 'year'; year: number; monthIdx?: number } | null>(null);
  const [newEarnName, setNewEarnName] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatTagline, setNewCatTagline] = useState('');
  const [addingSubTo, setAddingSubTo] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');
  // Reassign-before-delete state (spec #1). When a user tries to delete a
  // subcategory that has transactions, we open this sheet to require them to
  // move the affected transactions to another subcategory. Financial history
  // is never lost — only the label changes.
  const [reassignFrom, setReassignFrom] = useState<{ groupId: string; sub: Subcategory; affected: Tx[] } | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>(''); // sub id OR '__new__'
  const [reassignNewName, setReassignNewName] = useState<string>('');
  const annual = period === 'Year';
  const mIdx = annual ? -1 : monthIndex(period);
  useEffect(() => { if (focusCategory) { setExpanded(x => x.includes(focusCategory) ? x : [...x, focusCategory]); clearFocus(); } }, [focusCategory]);

  // Splits-aware, year-aware budget accounting. For a given month, we count
  // each transaction's contribution to a subcategory/income source — split
  // transactions are attributed to each of their splits proportionally.
  const yr = Number(budgetYear) || new Date().getFullYear();
  const spentInSub = React.useCallback((subId: string) => {
    if (annual) return MONTHS.reduce((s, _m, i) => s + spentForSubInMonth(transactions, subId, i, yr), 0);
    return spentForSubInMonth(transactions, subId, mIdx, yr);
  }, [transactions, annual, mIdx, yr]);
  const receivedInIncome = React.useCallback((srcId: string) => {
    if (annual) return MONTHS.reduce((s, _m, i) => s + receivedForIncomeInMonth(transactions, srcId, i, yr), 0);
    return receivedForIncomeInMonth(transactions, srcId, mIdx, yr);
  }, [transactions, annual, mIdx, yr]);
  const actualIncome = incomeSources.reduce((sum: number, x: any) => sum + receivedInIncome(x.id), 0);
  const actualExpenses = categories.reduce((sum: number, c: Category) => sum + c.subcategories.reduce((cs: number, sub: Subcategory) => cs + spentInSub(sub.id), 0), 0);
  const spentInGroup = (gId: string) => {
    const c = categories.find((cc: Category) => cc.id === gId);
    if (!c) return 0;
    return c.subcategories.reduce((s: number, sc: Subcategory) => s + spentInSub(sc.id), 0);
  };
  // (`relevant` was removed — all callers now use the splits-aware helpers.)
  const plannedIncome = incomeSources.reduce((sum: number, x: any) => sum + x.budgeted, 0) * (annual ? 12 : 1);
  // Total planned expenses across every category / subcategory for the
  // currently-selected month (or the whole year when in Year view). This is
  // the "Budgeted Expenses" number surfaced on the summary card (spec #14).
  const plannedExpenses = categories.reduce((sum: number, c: Category) => {
    return sum + c.subcategories.reduce((cs: number, sub: Subcategory) => cs + (annual ? annualAmount(sub) : monthlyAmount(sub, mIdx)), 0);
  }, 0);
  const budgetedRemaining = plannedIncome - plannedExpenses;
  const actualRemaining = actualIncome - actualExpenses;
  const budgetFor = (sub: Subcategory) => annual ? annualAmount(sub) : monthlyAmount(sub, mIdx);
  const groupTotal = (c: Category) => c.subcategories.reduce((s: number, x: Subcategory) => s + budgetFor(x), 0);

  // Drill-down: tapping any Actual number opens a sheet listing the
  // transactions that make up that total, so users can edit / reclassify /
  // delete them (spec: "Make each Actual amount clickable").
  const [drillDown, setDrillDown] = useState<{ kind: 'expense'; subId: string; subName: string; groupName: string } | { kind: 'income'; srcId: string; srcName: string } | null>(null);
  const drillTransactions = React.useMemo(() => {
    if (!drillDown) return [];
    if (drillDown.kind === 'expense') {
      if (annual) {
        const acc: { tx: Tx; contribution: number }[] = [];
        for (let i = 0; i < MONTHS.length; i++) acc.push(...transactionsForSubInMonth(transactions, drillDown.subId, i, yr));
        return acc;
      }
      return transactionsForSubInMonth(transactions, drillDown.subId, mIdx, yr);
    }
    if (annual) {
      const acc: { tx: Tx; contribution: number }[] = [];
      for (let i = 0; i < MONTHS.length; i++) acc.push(...transactionsForIncomeInMonth(transactions, drillDown.srcId, i, yr));
      return acc;
    }
    return transactionsForIncomeInMonth(transactions, drillDown.srcId, mIdx, yr);
  }, [drillDown, transactions, annual, mIdx, yr]);
  const [drillEditTx, setDrillEditTx] = useState<Tx | null>(null);

  const startEdit = (groupId: string, sub: Subcategory) => { setEditing({ groupId, sub }); setDraft(String(budgetFor(sub) || '')); };
  const commitEdit = () => {
    if (!editing) return;
    const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
    setCategories((prev: Category[]) => prev.map((c) => c.id !== editing.groupId ? c : {
      ...c,
      subcategories: c.subcategories.map((sc: Subcategory) => {
        if (sc.id !== editing.sub.id) return sc;
        if (annual) {
          // Annual set: divide evenly and ONLY apply to months that don't already have a manual override.
          // Existing month overrides are preserved so users don't lose their custom edits.
          const perMonth = Math.round(clean / 12);
          const existing = sc.months || {};
          const nextMonths: Record<number, number> = { ...existing };
          for (let i = 0; i < 12; i++) {
            if (nextMonths[i] === undefined) nextMonths[i] = perMonth;
          }
          return { ...sc, budgeted: perMonth, months: nextMonths };
        }
        // Setting for a specific month → override that month only. The
        // month becomes editable in the monthly view, but stays a DRAFT
        // until the user explicitly taps "Finalize" — only finalized
        // months feed BUILD.
        const months = { ...(sc.months || {}), [mIdx]: clean };
        return { ...sc, months };
      }),
    }));
    setEditing(null);
    setDraft('');
  };
  const resetOverride = () => {
    if (!editing || annual) return;
    setCategories((prev: Category[]) => prev.map((c) => c.id !== editing.groupId ? c : {
      ...c,
      subcategories: c.subcategories.map((sc: Subcategory) => {
        if (sc.id !== editing.sub.id) return sc;
        const nextMonths = { ...(sc.months || {}) };
        delete nextMonths[mIdx];
        return { ...sc, months: Object.keys(nextMonths).length ? nextMonths : undefined };
      }),
    }));
    setEditing(null); setDraft('');
  };

  const addCategory = () => {
    const name = (newCatName || '').trim();
    if (!name) return;
    const id = `cat-${Date.now().toString(36)}`;
    setCategories((prev: Category[]) => [...prev, { id, name, tagline: (newCatTagline || '').trim(), subcategories: [] }]);
    setExpanded((xs: string[]) => xs.includes(id) ? xs : [...xs, id]);
    setAddingCategory(false); setNewCatName(''); setNewCatTagline('');
    setToast(`Added "${name}".`);
  };
  const addSubcategory = (groupId: string) => {
    const name = (newSubName || '').trim();
    if (!name) return;
    const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
    const sid = `sub-${Date.now().toString(36)}`;
    setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: [...c.subcategories, { id: sid, name, budgeted: clean }] }));
    setAddingSubTo(null); setNewSubName(''); setDraft('');
    setToast(`Added "${name}".`);
  };
  const removeCategory = (id: string) => {
    const cat = categories.find((c: Category) => c.id === id);
    const name = cat?.name || 'this category';
    const doIt = () => {
      setCategories((prev: Category[]) => prev.filter((c) => c.id !== id));
      setToast('Category removed.');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}" and all its subcategories?\n\nThis cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'This removes the category and all its subcategories. This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const removeSubcategory = (groupId: string, subId: string) => {
    const cat = categories.find((c: Category) => c.id === groupId);
    const sub = cat?.subcategories.find((x: Subcategory) => x.id === subId);
    const name = sub?.name || 'this subcategory';
    // Count affected transactions across ALL time (not just current period),
    // because deleting the subcategory affects historical rows too.
    const affected = (transactions || []).filter((tx: Tx) => tx.detailId === subId);
    if (affected.length > 0 && sub) {
      // Open the reassign sheet — user must pick a destination before we
      // delete the subcategory. This keeps every dollar & transaction intact.
      setReassignFrom({ groupId, sub, affected });
      // Default target: the first other sub in the same category, else the
      // first sub anywhere. If there is truly no other sub the user can
      // create a new one via '__new__'.
      const otherInSame = cat?.subcategories.filter((x: Subcategory) => x.id !== subId) || [];
      const anyOther: Subcategory[] = otherInSame.length
        ? otherInSame
        : categories.flatMap((c: Category) => c.subcategories).filter((x: Subcategory) => x.id !== subId);
      setReassignTargetId(anyOther[0]?.id || '__new__');
      setReassignNewName(`${sub.name} (moved)`);
      return;
    }
    // No affected transactions → simple confirm+delete.
    const doIt = () => {
      setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: c.subcategories.filter((x) => x.id !== subId) }));
      setToast('Subcategory removed.');
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) doIt();
    } else {
      Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doIt },
      ]);
    }
  };
  const commitReassign = () => {
    if (!reassignFrom) return;
    const { groupId, sub, affected } = reassignFrom;
    let destGroupId = groupId;
    let destSubId = reassignTargetId;
    // Create-new branch: append a new subcategory to the same group and
    // move all affected transactions to it.
    if (destSubId === '__new__') {
      const name = (reassignNewName || `${sub.name} (moved)`).trim();
      if (!name) return;
      const newId = `sub-${Date.now().toString(36)}`;
      setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : {
        ...c,
        subcategories: [...c.subcategories, { id: newId, name, budgeted: 0 }],
      }));
      destSubId = newId;
    } else {
      // Find which group the target sub belongs to so we can update
      // transactions' groupId too when moving cross-group.
      for (const c of categories as Category[]) {
        if (c.subcategories.some((x: Subcategory) => x.id === destSubId)) { destGroupId = c.id; break; }
      }
    }
    // Reassign every affected transaction, preserving all financial data.
    const affectedIds = new Set(affected.map((tx) => tx.id));
    setTransactions((prev: Tx[]) => prev.map((tx: Tx) => affectedIds.has(tx.id) ? { ...tx, detailId: destSubId, groupId: destGroupId } : tx));
    // Finally delete the source subcategory.
    setCategories((prev: Category[]) => prev.map((c) => c.id !== groupId ? c : { ...c, subcategories: c.subcategories.filter((x) => x.id !== sub.id) }));
    setToast(`Moved ${affected.length} transaction${affected.length === 1 ? '' : 's'} · deleted "${sub.name}".`);
    setReassignFrom(null); setReassignTargetId(''); setReassignNewName('');
  };

  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Budget" subtitle="Give first. Steward wisely. Grow intentionally." action={
        <View style={s.viewToggle}>
          <Pressable onPress={() => setView('cards')} style={[s.viewTogglePill, view === 'cards' && s.viewTogglePillActive]} testID="budget-view-cards"><Ionicons name="albums-outline" size={13} color={view === 'cards' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
          <Pressable onPress={() => setView('grid')} style={[s.viewTogglePill, view === 'grid' && s.viewTogglePillActive]} testID="budget-view-grid"><Ionicons name="grid-outline" size={13} color={view === 'grid' ? C.goldEyebrow : (t.dark ? D.textMuted : C.muted2)} /></Pressable>
        </View>
      } />
      {/* Year selector — dynamic. Includes: (a) current year, (b) every year
          that already has stored data, (c) three near-future years, and
          (d) any prior years with saved data. New calendar years appear
          automatically without needing a code change (spec #13). */}
      {onSwitchYear && (
        <View style={s.yearSelectorRow}>
          <Text style={s.yearSelectorLabel}>YEAR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(() => {
              const nowY = new Date().getFullYear();
              const dataYears: number[] = Object.keys(categoriesByYear || {})
                .map((y) => Number(y))
                .filter((y) => Number.isFinite(y));
              const set = new Set<number>();
              // Always show the current year + 3 future years + years with data.
              set.add(nowY);
              for (let i = 1; i <= 3; i += 1) set.add(nowY + i);
              dataYears.forEach((y) => set.add(y));
              if (budgetYear) set.add(budgetYear); // always visible even if outside range
              const sorted = Array.from(set).sort((a, b) => a - b);
              return sorted.map((y) => (
                <Pressable
                  key={y}
                  onPress={() => onSwitchYear(y)}
                  style={[s.yearPill, budgetYear === y && s.yearPillActive]}
                  testID={`budget-year-${y}`}
                >
                  <Text style={[s.yearPillText, budgetYear === y && s.yearPillTextActive]}>{y}</Text>
                </Pressable>
              ));
            })()}
          </ScrollView>
          {onCopyLastYear && (() => {
            // Show "Copy last year" only when the previous year has stored
            // categories AND the current year is still at the seeded default
            // (i.e. hasn't been customized yet). This prevents accidental
            // overwrites — user must intentionally opt in each January.
            const prevYear = budgetYear - 1;
            const hasPrev = Boolean(categoriesByYear && categoriesByYear[String(prevYear)]);
            if (!hasPrev) return null;
            return (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    `Copy ${prevYear} budget?`,
                    `We'll copy your ${prevYear} categories and planned amounts into ${budgetYear}. Actual transactions are never copied. This replaces the current ${budgetYear} categories — you can undo by switching back.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: `Copy from ${prevYear}`, onPress: () => onCopyLastYear(prevYear) },
                    ],
                  );
                }}
                style={{
                  paddingHorizontal: 10, paddingVertical: 6,
                  borderRadius: 10, borderWidth: 1, borderColor: '#c49450',
                  marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
                }}
                testID="budget-copy-last-year"
              >
                <Ionicons name="copy-outline" size={12} color="#9a6d32" />
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#9a6d32' }}>Copy {prevYear}</Text>
              </Pressable>
            );
          })()}
        </View>
      )}
      <PeriodPills values={[...MONTHS, 'Year']} value={period} onChange={setPeriod} testID="budget-period" />
      {annual && (
        <View style={s.yearTotalTop}>
          <Text style={s.yearTotalEyebrow}>TOTAL INCOME · {budgetYear || new Date().getFullYear()}</Text>
          <Text style={s.yearTotalStrong}>{MONEY(actualIncome)}</Text>
          <Text style={s.yearTotalSub}>Expected {MONEY(plannedIncome)} · {plannedIncome > 0 ? Math.round((actualIncome / plannedIncome) * 100) : 0}% received</Text>
        </View>
      )}
      {!annual && (
        <View style={s.budgetSummary}>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Income</Text>
            <Text style={s.bsStrong}>{MONEY(actualIncome)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(plannedIncome)}</Text>
          </View>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Expenses</Text>
            <Text style={s.bsStrong}>{MONEY(actualExpenses)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(plannedExpenses)}</Text>
          </View>
          <View style={s.budgetSumCell}>
            <Text style={s.bsSmall}>Remaining</Text>
            <Text style={[s.bsStrong, actualRemaining < 0 && { color: '#b0453d' }]}>{MONEY(actualRemaining)}</Text>
            <Text style={s.bsSmall}>Actual · budgeted {MONEY(budgetedRemaining)}</Text>
          </View>
        </View>
      )}
      <View style={s.budgetActions}>
        <Pressable style={s.budgetActionBtn} onPress={() => { setNewCatName(''); setNewCatTagline(''); setAddingCategory(true); }} testID="budget-add-category">
          <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Add Category</Text>
        </Pressable>
        <Pressable style={s.budgetActionBtn} onPress={() => setExportMenuOpen(true)} testID="budget-export">
          <Ionicons name="download-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Export</Text>
        </Pressable>
        <Pressable style={s.budgetActionBtn} onPress={() => setSettingsOpen(true)} testID="budget-settings">
          <Ionicons name="settings-outline" size={15} color="#9a6d32" />
          <Text style={s.budgetActionText}>Options</Text>
        </Pressable>
      </View>

      {/* Draft / Finalized banner — monthly view only. Only Finalized months
          feed BUILD's projection. Users toggle explicitly so nothing
          slips into BUILD before they're ready. */}
      {!annual && (() => {
        const key = `${yr}-${mIdx}`;
        const isFinalized = Array.isArray(finalizedBudgetMonths) && finalizedBudgetMonths.includes(key);
        return (
          <View style={{
            marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1,
            borderColor: isFinalized ? '#c9d9c1' : '#e6dcc5',
            backgroundColor: isFinalized ? (t.dark ? '#1f2620' : '#f4f9ee') : (t.dark ? '#26221c' : '#fbf6ec'),
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{
                  paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                  backgroundColor: isFinalized ? '#4c8b56' : '#8b6437',
                }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.6 }}>
                    {isFinalized ? 'FINALIZED' : 'DRAFT'}
                  </Text>
                </View>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>{period} {yr}</Text>
              </View>
              <Text style={[{ fontSize: 10, marginTop: 4, lineHeight: 14 }, t.textMuted]}>
                {isFinalized
                  ? 'Feeding BUILD projections. Edits keep this month finalized until you switch back to Draft.'
                  : 'Draft budgets do not feed BUILD. Finalize when you\u2019re done to include this month in the BUILD run rate.'}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (!setFinalizedBudgetMonths) return;
                if (isFinalized) {
                  setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => k !== key));
                  setToast(`${period} ${yr} moved to Draft. BUILD updated.`);
                } else {
                  setFinalizedBudgetMonths((prev: string[]) => ((prev || []).includes(key) ? prev : [...(prev || []), key]));
                  setToast(`${period} ${yr} finalized. BUILD updated.`);
                }
              }}
              style={{
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
                backgroundColor: isFinalized ? 'transparent' : '#9a6d32',
                borderWidth: isFinalized ? 1 : 0,
                borderColor: '#c9b98f',
              }}
              testID={isFinalized ? 'budget-set-draft' : 'budget-finalize'}
            >
              <Text style={{
                fontSize: 11, fontWeight: '800',
                color: isFinalized ? '#7a6a4d' : '#fff',
              }}>
                {isFinalized ? 'Return to Draft' : 'Finalize Budget'}
              </Text>
            </Pressable>
          </View>
        );
      })()}
      {/* Budget settings / options menu — houses destructive actions like
          Reset Budget behind a menu (per user spec: keep it out of the
          primary Budget screen surface). */}
      <Sheet visible={settingsOpen} close={() => setSettingsOpen(false)} title="Budget Options" subtitle="Manage your budget data. Destructive actions require a second confirm.">
        <View>
          <Pressable
            style={s.moreGridBtn}
            onPress={() => {
              setSettingsOpen(false);
              setResetTarget({ kind: 'month', year: yr, monthIdx: annual ? new Date().getMonth() : mIdx });
            }}
            testID="budget-reset-month"
          >
            <View style={s.moreGridIcon}><Ionicons name="refresh-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Reset a Month</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Clears budgeted income, expenses, and category amounts for one month. Transactions are preserved.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
          <Pressable
            style={s.moreGridBtn}
            onPress={() => {
              setSettingsOpen(false);
              setResetTarget({ kind: 'year', year: yr });
            }}
            testID="budget-reset-year"
          >
            <View style={s.moreGridIcon}><Ionicons name="calendar-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Reset a Full Year</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Clears all budget data for a full calendar year. Transactions, accounts, and other years are preserved.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
        </View>
      </Sheet>

      {/* Reset confirmation sheet — one sheet handles both month and year
          resets with slightly different copy. */}
      <Sheet visible={!!resetTarget} close={() => setResetTarget(null)} title={
        resetTarget?.kind === 'year'
          ? 'Reset Year Budget?'
          : (resetTarget ? `Reset ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year} Budget?` : '')
      } subtitle={undefined}>
        {resetTarget && (
          <View>
            <YearMonthPickerRow
              kind={resetTarget.kind}
              target={resetTarget}
              onChange={setResetTarget}
              currentYear={yr}
            />
            <Text style={[{ fontSize: 12, marginTop: 10, lineHeight: 17 }, t.textInk]}>
              {resetTarget.kind === 'year'
                ? `This will remove all budget data for January–December ${resetTarget.year}.`
                : `This will remove the budgeted income, expenses, categories/amounts, and other budget entries for ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year}.`}
            </Text>
            <Text style={[{ fontSize: 10, marginTop: 8, lineHeight: 14 }, t.textMuted]}>
              Preserved: transactions, accounts, wealth balances{resetTarget.kind === 'year' ? ', other years' : ", other months' budgets"}, and BUILD projections (which will automatically recompute from your remaining budget months).
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                style={{ flex: 1, borderWidth: 1, borderColor: '#d9cfb6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => setResetTarget(null)}
                testID="budget-reset-cancel"
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#7a6a4d' }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={{ flex: 1, backgroundColor: '#b0453d', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
                onPress={() => {
                  if (!resetTarget) return;
                  if (resetTarget.kind === 'month') {
                    const targetY = resetTarget.year;
                    const targetM = resetTarget.monthIdx ?? 0;
                    // Clear per-month overrides on expenses for the CURRENT
                    // budget year (this is what the user sees in `categories`).
                    if (targetY === yr) {
                      setCategories((prev: Category[]) => prev.map((c) => ({
                        ...c,
                        subcategories: c.subcategories.map((sub: any) => {
                          if (!sub?.months || sub.months[targetM] === undefined) return sub;
                          const next = { ...sub.months };
                          delete next[targetM];
                          return { ...sub, months: Object.keys(next).length ? next : undefined };
                        }),
                      })));
                    }
                    // Also clear any snapshot for that year (if the year
                    // isn't the current budget year, e.g., 2027 while
                    // budgeting 2026).
                    if (setCategoriesByYear) {
                      setCategoriesByYear((prev: any) => {
                        const key = String(targetY);
                        if (!prev || !prev[key]) return prev;
                        return {
                          ...prev,
                          [key]: prev[key].map((c: any) => ({
                            ...c,
                            subcategories: (c.subcategories || []).map((sub: any) => {
                              if (!sub?.months || sub.months[targetM] === undefined) return sub;
                              const next = { ...sub.months };
                              delete next[targetM];
                              return { ...sub, months: Object.keys(next).length ? next : undefined };
                            }),
                          })),
                        };
                      });
                    }
                    // Clear income sources' per-month override for that month.
                    setIncomeSources((prev: any[]) => prev.map((x: any) => {
                      if (!x?.months || x.months[targetM] === undefined) return x;
                      const next = { ...x.months };
                      delete next[targetM];
                      return { ...x, months: Object.keys(next).length ? next : undefined };
                    }));
                    // Drop the month from finalizedBudgetMonths.
                    if (setFinalizedBudgetMonths) {
                      const dropKey = `${targetY}-${targetM}`;
                      setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => k !== dropKey));
                    }
                    setToast(`${MONTHS[targetM]} ${targetY} budget reset.`);
                  } else {
                    // Reset a full year.
                    const targetY = resetTarget.year;
                    if (targetY === yr) {
                      // Clear amounts on the current-year categories in place
                      // (keeps user-defined structure intact).
                      setCategories((prev: Category[]) => prev.map((c) => ({
                        ...c,
                        subcategories: c.subcategories.map((sub: any) => ({ ...sub, budgeted: 0, months: undefined })),
                      })));
                      // Clear income-source month overrides (base `budgeted`
                      // is left alone because income sources are shared
                      // across years today — clearing base would affect
                      // other years too).
                      setIncomeSources((prev: any[]) => prev.map((x: any) => ({ ...x, months: undefined })));
                    }
                    // Delete any per-year snapshot for that year.
                    if (setCategoriesByYear) {
                      setCategoriesByYear((prev: any) => {
                        if (!prev || !prev[String(targetY)]) return prev;
                        const next = { ...prev };
                        delete next[String(targetY)];
                        return next;
                      });
                    }
                    // Drop every "targetY-*" from finalizedBudgetMonths.
                    if (setFinalizedBudgetMonths) {
                      setFinalizedBudgetMonths((prev: string[]) => (prev || []).filter((k: string) => {
                        const [ky] = String(k).split('-');
                        return Number(ky) !== targetY;
                      }));
                    }
                    setToast(`${targetY} budget reset.`);
                  }
                  setResetTarget(null);
                }}
                testID="budget-reset-confirm"
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>
                  {resetTarget.kind === 'year' ? `Reset ${resetTarget.year}` : `Reset ${MONTHS[resetTarget.monthIdx ?? 0]} ${resetTarget.year}`}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </Sheet>
      <Sheet visible={exportMenuOpen} close={() => setExportMenuOpen(false)} title="Export" subtitle="Choose a format. All numbers come from your current Budget + Transactions.">
        <View>
          <Pressable style={s.moreGridBtn} onPress={async () => { setExportMenuOpen(false); await exportBudgetXlsx(categories, incomeSources, transactions, setToast); }} testID="export-workbook">
            <View style={s.moreGridIcon}><Ionicons name="grid-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Export Budget Workbook (.xlsx)</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Formatted workbook · Budget Summary, Monthly Budget, Annual Grid, Transactions.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
          <Pressable style={s.moreGridBtn} onPress={async () => { setExportMenuOpen(false); await exportTransactionsCsv(categories, incomeSources, transactions, setToast); }} testID="export-transactions-csv">
            <View style={s.moreGridIcon}><Ionicons name="document-text-outline" size={20} color={C.goldEyebrow} /></View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>Export Transactions (.csv)</Text>
              <Text style={{ fontSize: 9, color: C.muted2 }}>Raw transaction rows only — for spreadsheets or accounting software.</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
          </Pressable>
        </View>
      </Sheet>

      {view === 'cards' ? (
        <>
          <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Earn</Text><Text style={[s.sectionCap, t.textMuted]}>All the ways you make money</Text></View>
          <View style={[s.budgetCategory, t.cardBg]}>
            <Pressable style={s.categorySummary} onPress={() => setEarnExpanded((x: boolean) => !x)} testID="budget-earn">
              <View style={[s.purposeIcon, { backgroundColor: '#dfead0' }]}><Text style={[s.purposeIconText, { color: '#4e765c' }]}>E</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]}>Earn</Text>
                <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]}>What comes in each month</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{MONEY(actualIncome)}</Text>
                <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>of {MONEY(plannedIncome)}</Text>
              </View>
              <Ionicons name={earnExpanded ? 'chevron-down' : 'chevron-forward'} size={17} color={t.dark ? D.textMuted : C.muted} />
            </Pressable>
            {earnExpanded && (
              <View style={s.subcategoryList}>
                {/* Column headers — matching expense subcategory rows */}
                <View style={s.subHeaderRow}>
                  <Text style={s.subHeaderName}>Earn source</Text>
                  <Text style={s.subHeaderCol}>Actual</Text>
                  <Text style={s.subHeaderCol}>Budget</Text>
                  <Text style={s.subHeaderCol}>Left</Text>
                  <View style={{ width: 24 }} />
                </View>
                {incomeSources.map((src: any) => {
                  const rec = receivedInIncome(src.id);
                  const target = src.budgeted * (annual ? 12 : 1);
                  const left = target - rec;
                  const leftColor = target > 0 ? (left < 0 ? '#5a7f60' : left > 0 ? C.amber : '#5a7f60') : '#c1b9ac';
                  const clickable = rec > 0;
                  return (
                    <View key={src.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable
                        onPress={() => { setEditingEarn(src); setDraft(src.budgeted ? String(src.budgeted) : ''); }}
                        style={[s.subcategoryRow, { flex: 1 }]}
                        testID={`budget-earn-${src.id}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{src.name}</Text>
                          {src.budgeted <= 0 && <Text style={{ fontSize: 8, color: '#c9a56c' }}>tap to set</Text>}
                        </View>
                        <Pressable
                          onPress={clickable ? () => setDrillDown({ kind: 'income', srcId: src.id, srcName: src.name }) : undefined}
                          style={[s.subCol, clickable && { backgroundColor: '#c4945010', borderRadius: 4 }]}
                          hitSlop={4}
                          testID={`budget-earn-actual-${src.id}`}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: clickable ? '#9a6d32' : (t.dark ? D.text : C.ink) }} numberOfLines={1}>{MONEY(rec)}</Text>
                          {clickable && <Text style={{ fontSize: 7, color: '#c1a06a', letterSpacing: 0.4 }}>view</Text>}
                        </Pressable>
                        <View style={s.subCol}>
                          <Text style={{ fontSize: 11, color: t.dark ? D.text : C.ink }} numberOfLines={1}>{MONEY(target)}</Text>
                        </View>
                        <View style={s.subCol}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: leftColor }} numberOfLines={1}>
                            {target > 0 ? (left >= 0 ? MONEY(left) : `+${MONEY(-left)}`) : '—'}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={t.dark ? D.textMuted : '#c1b9ac'} />
                      </Pressable>
                    </View>
                  );
                })}
                <Pressable onPress={() => { setNewEarnName(''); setDraft(''); setAddingEarn(true); }} style={[s.subcategoryRow, { justifyContent: 'center' }]} testID="budget-earn-add">
                  <Ionicons name="add-circle-outline" size={16} color="#9a6d32" />
                  <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700', marginLeft: 6 }}>Add Earn source</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={[s.sectionTitle]}><Text style={[s.sectionH3, t.textInk]}>Plan by Purpose</Text><Text style={[s.sectionCap, t.textMuted]}>{annual ? 'Year total per category — tap to set' : `${period} · tap to set an amount`}</Text></View>
          <View style={{ gap: 11 }}>
            {categories.map((c: Category) => {
              const total = groupTotal(c);
              const actual = spentInGroup(c.id);
              const pct = total ? actual / total * 100 : 0;
              const open = expanded.includes(c.id);
              const barColor = pct >= 100 ? C.red : pct >= 80 ? C.amber : C.green;
              return (
                <View key={c.id} style={[s.budgetCategory, t.cardBg, open && { borderColor: '#ddc7a6' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable style={[s.categorySummary, { flex: 1 }]} onPress={() => setExpanded(xs => xs.includes(c.id) ? xs.filter(x => x !== c.id) : [...xs, c.id])} onLongPress={() => removeCategory(c.id)} testID={`budget-cat-${c.id}`}>
                      <View style={s.purposeIcon}><Text style={s.purposeIconText}>{c.name[0]}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[{ fontSize: 12, fontWeight: '700', color: C.ink }, t.textInk]}>{c.name}</Text>
                        <Text style={[{ fontSize: 9, color: C.muted2 }, t.textMuted]} numberOfLines={1}>{c.tagline}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[{ fontSize: 11, fontWeight: '700', color: C.ink }, t.textInk]}>{MONEY(actual)} <Text style={{ color: '#c1b9ac', fontWeight: '400' }}>/ {MONEY(total)}</Text></Text>
                        <Text style={[{ fontSize: 8, color: C.muted2 }, t.textMuted]}>{Math.round(pct)}% used</Text>
                      </View>
                      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={17} color={t.dark ? D.textMuted : C.muted} />
                    </Pressable>
                    <Pressable onPress={() => removeCategory(c.id)} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 6 }} testID={`budget-cat-del-${c.id}`}>
                      <Ionicons name="trash-outline" size={15} color="#b06a5b" />
                    </Pressable>
                  </View>
                  <View style={s.categoryProgress}><View style={[s.categoryProgressBar, { width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }]} /></View>
                  {open && (
                    <View style={s.subcategoryList}>
                      {/* Column headers */}
                      <View style={s.subHeaderRow}>
                        <Text style={s.subHeaderName}>Subcategory</Text>
                        <Text style={s.subHeaderCol}>Actual</Text>
                        <Text style={s.subHeaderCol}>Budget</Text>
                        <Text style={s.subHeaderCol}>Left</Text>
                        <View style={{ width: 24 }} />
                      </View>
                      {c.subcategories.map((sub: Subcategory) => {
                        const b = budgetFor(sub);
                        const a = spentInSub(sub.id);
                        const remaining = b - a;
                        const spct = b > 0 ? a / b * 100 : 0;
                        const conf = (alerts?.perCategory && alerts.perCategory[sub.id]) || { p50: false, p80: true, exceeded: true };
                        let alertLevel: 'p50' | 'p80' | 'exceeded' | null = null;
                        if (alerts?.enabled) {
                          if (conf.exceeded && spct >= 100) alertLevel = 'exceeded';
                          else if (conf.p80 && spct >= 80) alertLevel = 'p80';
                          else if (conf.p50 && spct >= 50) alertLevel = 'p50';
                        }
                        const alertColor = alertLevel === 'exceeded' ? C.red : alertLevel === 'p80' ? C.amber : alertLevel === 'p50' ? '#c9a56c' : null;
                        const leftColor = b > 0 ? (remaining < 0 ? C.red : remaining < b * 0.2 ? C.amber : '#5a7f60') : '#c1b9ac';
                        return (
                          <View key={sub.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Pressable
                              onPress={() => startEdit(c.id, sub)}
                              onLongPress={() => removeSubcategory(c.id, sub.id)}
                              style={[s.subcategoryRow, { flex: 1 }]}
                              testID={`budget-sub-${sub.id}`}
                            >
                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{sub.name}</Text>
                                </View>
                                {alertColor && (
                                  <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, backgroundColor: alertColor + '22', borderWidth: 1, borderColor: alertColor }}>
                                    <Text style={{ color: alertColor, fontSize: 8, fontWeight: '800' }}>{alertLevel === 'exceeded' ? 'OVER' : alertLevel === 'p80' ? '80%' : '50%'}</Text>
                                  </View>
                                )}
                              </View>
                              <Pressable
                                onPress={a > 0 ? () => setDrillDown({ kind: 'expense', subId: sub.id, subName: sub.name, groupName: c.name }) : () => startEdit(c.id, sub)}
                                hitSlop={4}
                                style={[s.subCol, a > 0 && { backgroundColor: '#c4945010', borderRadius: 4 }]}
                                testID={`budget-actual-${sub.id}`}
                              >
                                <Text style={{ fontSize: 11, color: a > 0 ? '#9a6d32' : (t.dark ? D.text : C.ink), fontWeight: a > 0 ? '700' : '400' }} numberOfLines={1}>{MONEY(a)}</Text>
                                {a > 0 && <Text style={{ fontSize: 7, color: '#c1a06a', letterSpacing: 0.4 }}>view</Text>}
                              </Pressable>
                              <Text style={[s.subCol, { color: b > 0 ? (t.dark ? D.textInk : C.ink) : '#c9a56c' }]}>{b > 0 ? MONEY(b) : '—'}</Text>
                              <Text style={[s.subCol, { color: leftColor, fontWeight: '800' }]}>{b > 0 ? MONEY(remaining) : '—'}</Text>
                            </Pressable>
                            <Pressable onPress={() => removeSubcategory(c.id, sub.id)} hitSlop={6} style={{ paddingHorizontal: 6, paddingVertical: 8 }} testID={`budget-sub-del-${sub.id}`}>
                              <Ionicons name="close-circle-outline" size={14} color="#b06a5b" />
                            </Pressable>
                          </View>
                        );
                      })}
                      <Pressable onPress={() => { setAddingSubTo(c.id); setNewSubName(''); setDraft(''); }} style={[s.subcategoryRow, { justifyContent: 'center' }]} testID={`budget-sub-add-${c.id}`}>
                        <Ionicons name="add-circle-outline" size={15} color="#9a6d32" />
                        <Text style={{ color: '#9a6d32', fontSize: 10, fontWeight: '700', marginLeft: 6 }}>Add subcategory</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          {annual && (
            <View style={s.yearTotalBottom}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                <Text style={s.yearTotalEyebrow}>TOTAL EXPENSES · {new Date().getFullYear()}</Text>
                <Text style={{ fontSize: 9, color: C.muted2 }}>{plannedIncome > 0 ? `${Math.round((actualExpenses / plannedIncome) * 100)}% of income` : ''}</Text>
              </View>
              <Text style={[s.yearTotalStrong, { color: C.ink }]}>{MONEY(actualExpenses)}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e8dcc4' }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.muted2, letterSpacing: 0.6 }}>NET REMAINING</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: actualIncome - actualExpenses >= 0 ? '#5a7f60' : C.red }}>{MONEY(actualIncome - actualExpenses)}</Text>
              </View>
            </View>
          )}
        </>
      ) : (
        <BudgetGrid
          categories={categories}
          incomeSources={incomeSources}
          incomeReceivedForMonth={(srcId: string, mi: number) => transactions.filter((t: Tx) => t.type === 'income' && t.groupId === srcId && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0)}
          spentInSub={(id: string, mi: number) => transactions.filter((t: Tx) => t.type === 'expense' && t.detailId === id && t.period === MONTHS[mi] && !isSystemTransaction(t)).reduce((s: number, t: Tx) => s + t.amount, 0)}
          onEdit={startEdit}
          onEditIncome={(src: any) => { setEditingEarn(src); setDraft(src.budgeted ? String(src.budgeted) : ''); }}
          tDark={t.dark}
        />
      )}

      <Sheet visible={!!editing} close={() => { setEditing(null); setDraft(''); }} title={editing ? `${annual ? 'Set annual' : `Set ${period}`} · ${editing.sub.name}` : ''} subtitle={annual ? 'Annual amount auto-splits evenly across 12 months — but any months you\'ve already customized will stay unchanged.' : `Amount is for ${period} only. Other months are not affected.`}>
        {editing && (
          <View>
            <Text style={s.label}>{annual ? 'Annual amount' : 'Monthly amount'}</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" autoFocus testID="budget-edit-amount" />
            </View>
            <View style={{ marginTop: 14 }}>
              <GoldButton label="Save amount" onPress={commitEdit} testID="budget-edit-save" />
            </View>
            {!annual && editing.sub.months && editing.sub.months[mIdx] !== undefined && (
              <Pressable onPress={resetOverride} style={{ marginTop: 12, alignItems: 'center' }} testID="budget-edit-reset">
                <Text style={{ color: '#9a6d32', fontSize: 11, fontWeight: '700' }}>Reset {period} to auto-split</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>

      <Sheet visible={!!editingEarn} close={() => { setEditingEarn(null); setDraft(''); }} title={editingEarn ? `Set expected · ${editingEarn.name}` : ''} subtitle="Amount is what you expect to earn per month.">
        {editingEarn && (
          <View>
            <Text style={s.label}>Monthly amount</Text>
            <View style={s.amountInput}>
              <Text style={s.amountPrefix}>$</Text>
              <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" autoFocus testID="earn-edit-amount" />
            </View>
            <View style={{ marginTop: 14 }}>
              <GoldButton label="Save amount" onPress={() => {
                const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
                setIncomeSources((prev: any[]) => prev.map((x) => x.id === editingEarn.id ? { ...x, budgeted: clean } : x));
                setEditingEarn(null); setDraft('');
              }} testID="earn-edit-save" />
            </View>
            <Pressable onPress={() => {
              setIncomeSources((prev: any[]) => prev.filter((x) => x.id !== editingEarn.id));
              setEditingEarn(null); setDraft('');
            }} style={{ marginTop: 12, alignItems: 'center' }} testID="earn-edit-delete">
              <Text style={{ color: C.danger, fontSize: 11, fontWeight: '700' }}>Delete this source</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      <Sheet visible={addingEarn} close={() => { setAddingEarn(false); setNewEarnName(''); setDraft(''); }} title="Add Earn source" subtitle="Name it and set the monthly amount you expect.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newEarnName} onChangeText={setNewEarnName} placeholder="e.g., Freelance" testID="earn-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Monthly amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" testID="earn-add-amount" />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Add source" onPress={() => {
              const name = (newEarnName || '').trim();
              if (!name) return;
              const clean = Math.max(0, Math.round(Number((draft || '').replace(/[^0-9.]/g, '')) || 0));
              const id = `earn-${Date.now().toString(36)}`;
              setIncomeSources((prev: any[]) => [...prev, { id, name, budgeted: clean }]);
              setAddingEarn(false); setNewEarnName(''); setDraft('');
            }} testID="earn-add-save" />
          </View>
        </View>
      </Sheet>

      <Sheet visible={addingCategory} close={() => { setAddingCategory(false); setNewCatName(''); setNewCatTagline(''); }} title="Add Category" subtitle="Create a new spending purpose. You can add subcategories after.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newCatName} onChangeText={setNewCatName} placeholder="e.g., Health" testID="cat-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Short tagline (optional)</Text>
          <TextInput style={s.input} value={newCatTagline} onChangeText={setNewCatTagline} placeholder="e.g., Care for the body you're given" testID="cat-add-tagline" />
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Create Category" onPress={addCategory} testID="cat-add-save" />
          </View>
        </View>
      </Sheet>

      <Sheet visible={!!addingSubTo} close={() => { setAddingSubTo(null); setNewSubName(''); setDraft(''); }} title="Add Subcategory" subtitle="Name it and (optionally) set the monthly amount.">
        <View>
          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={newSubName} onChangeText={setNewSubName} placeholder="e.g., Gym" testID="sub-add-name" />
          <Text style={[s.label, { marginTop: 12 }]}>Monthly amount</Text>
          <View style={s.amountInput}>
            <Text style={s.amountPrefix}>$</Text>
            <TextInput style={[s.input, { paddingLeft: 26 }]} value={draft} onChangeText={setDraft} keyboardType="numeric" placeholder="0" testID="sub-add-amount" />
          </View>
          <View style={{ marginTop: 14 }}>
            <GoldButton label="Add" onPress={() => addingSubTo && addSubcategory(addingSubTo)} testID="sub-add-save" />
          </View>
        </View>
      </Sheet>

      {/* Drill-down: transactions that make up an Actual number. Tap any
          row to open the standard TxForm sheet — edit / reclassify / delete
          all works from here. Budget totals refresh instantly on save. */}
      <Sheet
        visible={!!drillDown}
        close={() => { setDrillDown(null); setDrillEditTx(null); }}
        title={drillDown ? (drillDown.kind === 'expense' ? drillDown.subName : drillDown.srcName) : ''}
        subtitle={drillDown ? `${drillTransactions.length} transaction${drillTransactions.length === 1 ? '' : 's'} · ${period === 'Year' ? String(budgetYear) : `${period} ${budgetYear}`}` : ''}
      >
        {drillDown && (
          <View>
            {drillTransactions.length === 0 ? (
              <Text style={{ fontSize: 11, color: C.muted2 }}>No transactions yet for this period.</Text>
            ) : drillTransactions.map(({ tx, contribution }) => (
              <Pressable
                key={tx.id}
                onPress={() => setDrillEditTx(tx)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}
                testID={`budget-drill-${tx.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 12, fontWeight: '700' }, t.textInk]} numberOfLines={1}>{tx.name}</Text>
                  <Text style={[{ fontSize: 9 }, t.textMuted]} numberOfLines={1}>
                    {(tx.date || '').slice(0, 10)} · {tx.origin}{tx.merchant && tx.merchant !== tx.name ? ` · ${tx.merchant}` : ''}{tx.splits && tx.splits.length > 0 ? ` · Split contribution` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[{ fontSize: 12, fontWeight: '800' }, t.textInk]}>{MONEY(contribution)}</Text>
                  {tx.splits && tx.splits.length > 0 && Math.abs(tx.amount - contribution) > 0.01 && (
                    <Text style={[{ fontSize: 8 }, t.textMuted]}>of {MONEY(tx.amount)}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={13} color={t.dark ? D.textMuted : '#c1b9ac'} style={{ marginLeft: 4 }} />
              </Pressable>
            ))}
          </View>
        )}
      </Sheet>
      <Sheet visible={!!drillEditTx} close={() => setDrillEditTx(null)} title={drillEditTx?.id ? 'Edit Transaction' : 'Add Transaction'} subtitle="Update the amount, category, or delete the transaction. Budget totals refresh instantly.">
        {drillEditTx && (
          <TxForm
            item={drillEditTx}
            categories={categories}
            incomeSources={incomeSources}
            save={(next: any) => {
              // Preserve the tx id from the original — TxForm may include a
              // spread that could omit it. Then update transactions state.
              const merged = { ...drillEditTx, ...next };
              setTransactions((prev: Tx[]) => prev.map((x: Tx) => x.id === merged.id ? merged : x));
              setDrillEditTx(null);
            }}
            remove={(id: string) => {
              setTransactions((prev: Tx[]) => prev.filter((x: Tx) => x.id !== id));
              setDrillEditTx(null);
            }}
          />
        )}
      </Sheet>

      {/* Reassign-before-delete sheet — required whenever the target
          subcategory has transactions attached to it. Financial history is
          preserved by moving each transaction's `detailId` (and groupId if
          the destination lives under a different category). */}
      <Sheet
        visible={!!reassignFrom}
        close={() => { setReassignFrom(null); setReassignTargetId(''); setReassignNewName(''); }}
        title={reassignFrom ? `Reassign "${reassignFrom.sub.name}"` : ''}
        subtitle="This subcategory has transactions. Choose where to move them before deleting. Your transaction totals stay unchanged — only the label moves."
      >
        {reassignFrom && (
          <View>
            <View style={{ padding: 10, backgroundColor: t.dark ? '#3a2f22' : '#fbf1de', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: '#c49450', marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#9a6d32' }}>
                {reassignFrom.affected.length} transaction{reassignFrom.affected.length === 1 ? '' : 's'} affected
              </Text>
              <Text style={{ fontSize: 10, color: '#8d806e', marginTop: 2 }}>
                All existing spend & history moves with them. Nothing is deleted.
              </Text>
            </View>

            <Text style={[s.label, { marginBottom: 6 }]}>Move to</Text>
            <View style={{ borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5', borderRadius: 10 }}>
              {/* List of other subcategories, grouped by category */}
              {categories.map((c: Category) => {
                const eligible = c.subcategories.filter((x: Subcategory) => x.id !== reassignFrom.sub.id);
                if (eligible.length === 0) return null;
                return (
                  <View key={c.id}>
                    <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', paddingHorizontal: 10, paddingTop: 8 }}>
                      {c.name.toUpperCase()}
                    </Text>
                    {eligible.map((sc: Subcategory) => (
                      <Pressable
                        key={sc.id}
                        onPress={() => setReassignTargetId(sc.id)}
                        style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: t.dark ? '#3a342b' : '#f1ede6' }}
                        testID={`reassign-target-${sc.id}`}
                      >
                        <Ionicons
                          name={reassignTargetId === sc.id ? 'radio-button-on' : 'radio-button-off'}
                          size={16}
                          color={reassignTargetId === sc.id ? '#9a6d32' : (t.dark ? D.textMuted : C.muted)}
                        />
                        <Text style={[{ fontSize: 12, marginLeft: 10, flex: 1 }, t.textInk]}>{sc.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
              {/* Create-new option */}
              <View>
                <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#a97c39', paddingHorizontal: 10, paddingTop: 8 }}>OR CREATE NEW</Text>
                <Pressable
                  onPress={() => setReassignTargetId('__new__')}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}
                  testID="reassign-target-new"
                >
                  <Ionicons
                    name={reassignTargetId === '__new__' ? 'radio-button-on' : 'radio-button-off'}
                    size={16}
                    color={reassignTargetId === '__new__' ? '#9a6d32' : (t.dark ? D.textMuted : C.muted)}
                  />
                  <Text style={[{ fontSize: 12, marginLeft: 10 }, t.textInk]}>
                    Create a new subcategory in {reassignFrom ? (categories.find((c: Category) => c.id === reassignFrom.groupId)?.name || 'this category') : 'this category'}
                  </Text>
                </Pressable>
                {reassignTargetId === '__new__' && (
                  <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
                    <TextInput
                      style={s.input}
                      value={reassignNewName}
                      onChangeText={setReassignNewName}
                      placeholder="Name for the new subcategory"
                      testID="reassign-new-name"
                    />
                  </View>
                )}
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              <GoldButton
                label={`Move & delete "${reassignFrom.sub.name}"`}
                onPress={commitReassign}
                disabled={!reassignTargetId || (reassignTargetId === '__new__' && !reassignNewName.trim())}
                testID="reassign-confirm"
              />
            </View>
            <Pressable onPress={() => { setReassignFrom(null); setReassignTargetId(''); setReassignNewName(''); }} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: C.muted2, fontSize: 11 }}>Cancel — keep subcategory</Text>
            </Pressable>
          </View>
        )}
      </Sheet>

      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Budget Grid (annual spreadsheet view) ---------------- */
const BudgetGrid = ({ categories, incomeSources, incomeReceivedForMonth, spentInSub, onEdit, onEditIncome, tDark }: any) => {
  const cellW = 60;
  const nameW = 130;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={[s.gridHeader, tDark && { backgroundColor: D.surface, borderColor: D.border }]}>
        <View style={{ width: nameW }}><Text style={[s.gridHeaderText, tDark && { color: D.text }]}>Category</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MONTHS.map((m: string) => (
            <View key={m} style={{ width: cellW, alignItems: 'center' }}>
              <Text style={[s.gridHeaderText, tDark && { color: D.text }]}>{m}</Text>
            </View>
          ))}
          <View style={{ width: cellW + 10, alignItems: 'center' }}><Text style={[s.gridHeaderText, tDark && { color: D.text }]}>Year</Text></View>
        </ScrollView>
      </View>
      {/* Income section — matches monthly breakdown for Earn sources */}
      {Array.isArray(incomeSources) && incomeSources.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <View style={[s.gridGroupRow, tDark && { backgroundColor: D.surfaceAlt }, { backgroundColor: '#eef4e6' }]}>
            <Text style={[s.gridGroupText, tDark && { color: D.text }, { color: '#4e765c' }]}>Income · Earn</Text>
          </View>
          {incomeSources.map((src: any) => {
            const annualPlanned = (src.budgeted || 0) * 12;
            return (
              <View key={src.id} style={[s.gridRow, tDark && { borderColor: D.border }]}>
                <View style={{ width: nameW, paddingRight: 6 }}><Text style={[s.gridSubText, tDark && { color: D.text }]} numberOfLines={1}>{src.name}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {MONTHS.map((_: string, i: number) => {
                    const planned = src.budgeted || 0;
                    const received = incomeReceivedForMonth ? incomeReceivedForMonth(src.id, i) : 0;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onEditIncome?.(src)}
                        style={{ width: cellW, alignItems: 'center', paddingVertical: 6 }}
                        testID={`grid-inc-${src.id}-${i}`}
                      >
                        <Text style={[{ fontSize: 10, fontWeight: '700', color: '#4e765c' }, tDark && { color: '#a4c9a5' }]}>{planned > 0 ? `$${Math.round(planned)}` : '—'}</Text>
                        {received > 0 && <Text style={{ fontSize: 8, color: '#7a9b7a' }}>${Math.round(received)}</Text>}
                      </Pressable>
                    );
                  })}
                  <View style={{ width: cellW + 10, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#4e765c' }}>${Math.round(annualPlanned)}</Text>
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      )}
      {categories.map((c: Category) => (
        <View key={c.id} style={{ marginBottom: 6 }}>
          <View style={[s.gridGroupRow, tDark && { backgroundColor: D.surfaceAlt }]}><Text style={[s.gridGroupText, tDark && { color: D.text }]}>{c.name}</Text></View>
          {c.subcategories.map((sub: Subcategory) => {
            const annualTotal = annualAmount(sub);
            return (
              <View key={sub.id} style={[s.gridRow, tDark && { borderColor: D.border }]}>
                <View style={{ width: nameW, paddingRight: 6 }}><Text style={[s.gridSubText, tDark && { color: D.text }]} numberOfLines={1}>{sub.name}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {MONTHS.map((_: string, i: number) => {
                    const b = monthlyAmount(sub, i);
                    const a = spentInSub(sub.id, i);
                    const over = a > b && b > 0;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => onEdit(c.id, sub)}
                        style={{ width: cellW, alignItems: 'center', paddingVertical: 6, backgroundColor: over ? '#fbecd8' : 'transparent' }}
                        testID={`grid-cell-${sub.id}-${i}`}
                      >
                        <Text style={[{ fontSize: 10, fontWeight: '700' }, tDark && { color: D.text }]}>{b > 0 ? `$${Math.round(b)}` : '—'}</Text>
                        {a > 0 && <Text style={{ fontSize: 8, color: over ? '#b46b41' : '#8b9a80' }}>${Math.round(a)}</Text>}
                      </Pressable>
                    );
                  })}
                  <View style={{ width: cellW + 10, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={[{ fontSize: 10, fontWeight: '800', color: '#9a6d32' }]}>${Math.round(annualTotal)}</Text>
                  </View>
                </ScrollView>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
};
