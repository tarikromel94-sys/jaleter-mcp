/**
 * Statement Import — two-step flow.
 * 1. Pick file → POST /api/statements/preview → show detected mapping,
 *    counts, totals, date range, sample rows, unparseable rows.
 * 2. If `needs_mapping`, show 3 dropdowns (Date / Description / Amount OR
 *    Debit + Credit) and let the user pick columns manually. Save mapping
 *    for reuse on the next file with the same headers.
 * 3. Confirm → POST /api/accounts/import (commit) with override_mapping.
 *
 * Kept in its own module so /app/index.tsx stays under bundle-time.
 */
import React, { useState } from "react";
import {
  Modal, View, Text, Pressable, ScrollView, ActivityIndicator, Platform, StyleSheet, Alert,
} from "react-native";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Preview = {
  format: string;
  filename: string;
  headers: string[];
  detected_mapping: Record<string, string>;
  transaction_count: number;
  date_range: { start: string | null; end: string | null };
  total_debits: number;
  total_credits: number;
  sample: { date: string; description: string; amount: number }[];
  skipped_count: number;
  skipped_sample: any[];
  needs_mapping: boolean;
  fingerprint: string | null;
};

const HUMAN_ERRORS: [RegExp, string][] = [
  [/empty/i, "The file appears to be empty."],
  [/unsupported/i, "This file type isn't supported. Try CSV, XLSX, OFX, or QFX."],
  [/could not identify/i, "We couldn't detect the Date and Amount columns. Pick them manually below."],
  [/corrupt|could not read/i, "The file couldn't be read. Try re-exporting from your bank."],
  [/larger than/i, "That file is too large. Please split it before importing."],
  [/no transactions/i, "No transactions were found in this file."],
];
function humanize(err: string): string {
  for (const [rx, msg] of HUMAN_ERRORS) if (rx.test(err)) return msg;
  return err || "Something went wrong while importing.";
}

const money = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatementImportSheet({
  visible, token, dark, onClose, onDone,
}: {
  visible: boolean;
  token: string | null;
  dark: boolean;
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [asset, setAsset] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, string>>({});
  const [useDC, setUseDC] = useState(false);

  const t = getStyles(dark);

  const reset = () => {
    setPreview(null); setAsset(null); setError(null); setOverride({}); setUseDC(false); setBusy(false);
  };

  const attach = (form: FormData, a: any) => {
    if (Platform.OS === "web") {
      // Blob will be resolved by caller — here we accept pre-built form.
      return;
    }
    // @ts-ignore RN FormData
    form.append("file", { uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream" });
  };

  const buildForm = async (a: any, om?: Record<string, string>) => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(a.uri)).blob();
      form.append("file", new (window as any).File([blob], a.name, { type: a.mimeType || "text/csv" }));
    } else {
      attach(form, a);
    }
    if (om && Object.keys(om).length) form.append("override_mapping", JSON.stringify(om));
    return form;
  };

  const pick = async () => {
    setBusy(true); setError(null); setPreview(null);
    try {
      const DocumentPicker = await import("expo-document-picker");
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/x-ofx", "application/x-qfx", "application/vnd.intu.qbo",
          "application/octet-stream", "*/*",
        ],
        multiple: false, copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) { setBusy(false); return; }
      const a = res.assets[0];
      setAsset(a);
      const form = await buildForm(a);
      const httpRes = await fetch(`${BACKEND}/api/statements/preview`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form as any,
      });
      const body = await httpRes.json();
      if (!httpRes.ok) throw new Error(body?.detail || "Preview failed");
      setPreview(body);
      setUseDC(!body.detected_mapping?.amount && !!(body.detected_mapping?.debit || body.detected_mapping?.credit));
      setOverride({ ...body.detected_mapping });
    } catch (e: any) {
      setError(humanize(e?.message || ""));
    } finally { setBusy(false); }
  };

  const rerunPreview = async () => {
    if (!asset) return;
    setBusy(true); setError(null);
    try {
      const form = await buildForm(asset, override);
      const httpRes = await fetch(`${BACKEND}/api/statements/preview`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form as any,
      });
      const body = await httpRes.json();
      if (!httpRes.ok) throw new Error(body?.detail || "Preview failed");
      setPreview(body);
    } catch (e: any) { setError(humanize(e?.message || "")); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!asset || !preview) return;
    setBusy(true); setError(null);
    try {
      const form = await buildForm(asset, preview.needs_mapping ? override : undefined);
      const httpRes = await fetch(`${BACKEND}/api/accounts/import`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form as any,
      });
      const body = await httpRes.json();
      if (!httpRes.ok) throw new Error(body?.detail || "Import failed");
      onDone(`Imported ${body.inserted} transactions${body.duplicates ? ` (${body.duplicates} duplicates skipped)` : ""}.`);
      reset(); onClose();
    } catch (e: any) { setError(humanize(e?.message || "")); }
    finally { setBusy(false); }
  };

  const setMap = (k: string, v: string) => setOverride((prev) => ({ ...prev, [k]: v }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { reset(); onClose(); }}>
      <View style={t.backdrop}>
        <View style={t.sheet}>
          <View style={t.header}>
            <Text style={t.title}>Import statement</Text>
            <Pressable onPress={() => { reset(); onClose(); }} hitSlop={10}><Text style={t.close}>✕</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {!preview && !busy && (
              <>
                <Text style={t.body}>
                  Upload a statement export from your bank. Jaleter accepts:
                </Text>
                <Text style={t.bullet}>• CSV (any bank — Chase, BofA, Wells Fargo, etc.)</Text>
                <Text style={t.bullet}>• Excel (.xlsx, .xls)</Text>
                <Text style={t.bullet}>• OFX / QFX / QBO</Text>
                <Text style={[t.body, { marginTop: 12 }]}>
                  We auto-detect column names like Date/Transaction Date/Posting Date, Description/Merchant/Payee,
                  Amount, or Debit + Credit. If we can&apos;t guess, you can map columns manually on the next screen.
                </Text>
                <Pressable style={t.primary} onPress={pick}>
                  <Text style={t.primaryText}>Choose file</Text>
                </Pressable>
              </>
            )}

            {busy && <View style={{ alignItems: "center", padding: 40 }}><ActivityIndicator /></View>}

            {error && (
              <View style={t.errorBox}>
                <Text style={t.errorText}>{error}</Text>
              </View>
            )}

            {preview && (
              <>
                <Text style={t.section}>File</Text>
                <Text style={t.body}>{preview.filename} · {preview.format.toUpperCase()}</Text>

                {preview.needs_mapping && (
                  <View style={t.mapBox}>
                    <Text style={t.section}>We need help mapping columns</Text>
                    <Text style={t.body}>Pick which column in your file contains each field.</Text>
                    <MapPicker label="Date column" value={override.date || ""} options={preview.headers} onChange={(v) => setMap("date", v)} dark={dark} />
                    <MapPicker label="Description column" value={override.description || ""} options={preview.headers} onChange={(v) => setMap("description", v)} dark={dark} />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <Pressable style={[t.tab, !useDC && t.tabOn]} onPress={() => setUseDC(false)}>
                        <Text style={[t.tabText, !useDC && t.tabTextOn]}>Amount column</Text>
                      </Pressable>
                      <Pressable style={[t.tab, useDC && t.tabOn]} onPress={() => setUseDC(true)}>
                        <Text style={[t.tabText, useDC && t.tabTextOn]}>Debit + Credit</Text>
                      </Pressable>
                    </View>
                    {!useDC ? (
                      <MapPicker label="Amount column" value={override.amount || ""} options={preview.headers} onChange={(v) => setMap("amount", v)} dark={dark} />
                    ) : (
                      <>
                        <MapPicker label="Debit / Money Out column" value={override.debit || ""} options={preview.headers} onChange={(v) => setMap("debit", v)} dark={dark} />
                        <MapPicker label="Credit / Money In column" value={override.credit || ""} options={preview.headers} onChange={(v) => setMap("credit", v)} dark={dark} />
                      </>
                    )}
                    <Pressable style={[t.secondary, { marginTop: 8 }]} onPress={rerunPreview}>
                      <Text style={t.secondaryText}>Re-parse with these columns</Text>
                    </Pressable>
                  </View>
                )}

                {!preview.needs_mapping && (
                  <>
                    <Text style={t.section}>Detected columns</Text>
                    {Object.entries(preview.detected_mapping).map(([k, v]) => (
                      <Text key={k} style={t.body}>• {k}: <Text style={{ fontWeight: "600" }}>{v}</Text></Text>
                    ))}
                    <Text style={[t.section, { marginTop: 12 }]}>Summary</Text>
                    <Text style={t.body}>{preview.transaction_count} transactions detected</Text>
                    {preview.date_range.start && (
                      <Text style={t.body}>{preview.date_range.start} → {preview.date_range.end}</Text>
                    )}
                    <Text style={t.body}>Debits: {money(-preview.total_debits)}</Text>
                    <Text style={t.body}>Credits: {money(preview.total_credits)}</Text>
                    {preview.skipped_count > 0 && (
                      <Text style={[t.body, { color: "#c49450" }]}>
                        {preview.skipped_count} row{preview.skipped_count === 1 ? "" : "s"} couldn&apos;t be interpreted and will be skipped.
                      </Text>
                    )}
                    <Text style={[t.section, { marginTop: 12 }]}>Sample</Text>
                    {preview.sample.slice(0, 5).map((r, i) => (
                      <View key={i} style={t.row}>
                        <Text style={t.rowDate}>{r.date}</Text>
                        <Text style={t.rowDesc} numberOfLines={1}>{r.description || "—"}</Text>
                        <Text style={[t.rowAmt, r.amount < 0 ? { color: "#c76b6b" } : { color: "#4a8f5a" }]}>{money(r.amount)}</Text>
                      </View>
                    ))}
                    <Pressable style={[t.primary, { marginTop: 16 }]} onPress={commit}>
                      <Text style={t.primaryText}>Import {preview.transaction_count} transactions</Text>
                    </Pressable>
                    <Pressable style={t.secondary} onPress={() => { reset(); }}>
                      <Text style={t.secondaryText}>Choose a different file</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MapPicker({ label, value, options, onChange, dark }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; dark: boolean;
}) {
  const t = getStyles(dark);
  const open = () => {
    const buttons = options.map((o) => ({ text: o, onPress: () => onChange(o) }));
    if (Platform.OS === "web") {
      const idx = window.prompt(`${label}\nType the exact column name:\n\n${options.join(", ")}`, value || options[0] || "");
      if (idx && options.includes(idx)) onChange(idx);
      return;
    }
    Alert.alert(label, "Choose the column:", [
      ...buttons,
      { text: "Cancel", style: "cancel" },
    ]);
  };
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={t.label}>{label}</Text>
      <Pressable style={t.select} onPress={open}>
        <Text style={value ? t.selectVal : t.selectPlaceholder}>{value || "Tap to choose…"}</Text>
      </Pressable>
    </View>
  );
}

const getStyles = (dark: boolean) => {
  const bg = dark ? "#1a1a1a" : "#f7f2e6";
  const surface = dark ? "#232323" : "#ffffff";
  const border = dark ? "#333" : "#e6dcc0";
  const ink = dark ? "#f0e6cf" : "#2a2a2a";
  const muted = dark ? "#9c957f" : "#7d7460";
  const accent = "#c49450";
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: { backgroundColor: bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
    header: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: border },
    title: { flex: 1, fontSize: 18, fontWeight: "700", color: ink },
    close: { fontSize: 22, color: muted, paddingHorizontal: 8 },
    section: { fontSize: 13, fontWeight: "700", color: ink, marginTop: 8, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
    body: { fontSize: 14, color: ink, lineHeight: 20 },
    bullet: { fontSize: 14, color: ink, lineHeight: 22, marginLeft: 4 },
    primary: { backgroundColor: accent, paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 16 },
    primaryText: { color: "#1a1a1a", fontWeight: "700", fontSize: 15 },
    secondary: { paddingVertical: 12, alignItems: "center", marginTop: 8 },
    secondaryText: { color: muted, fontSize: 14, fontWeight: "600" },
    errorBox: { backgroundColor: "rgba(199,107,107,0.15)", borderColor: "#c76b6b", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
    errorText: { color: "#c76b6b", fontSize: 14 },
    mapBox: { backgroundColor: surface, borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: border },
    label: { fontSize: 12, color: muted, marginBottom: 4 },
    select: { borderWidth: 1, borderColor: border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: bg },
    selectVal: { color: ink, fontSize: 14, fontWeight: "600" },
    selectPlaceholder: { color: muted, fontSize: 14 },
    tab: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: surface, borderWidth: 1, borderColor: border, alignItems: "center" },
    tabOn: { backgroundColor: accent, borderColor: accent },
    tabText: { color: ink, fontSize: 13 },
    tabTextOn: { color: "#1a1a1a", fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: border, gap: 8 },
    rowDate: { color: muted, fontSize: 12, width: 84 },
    rowDesc: { flex: 1, color: ink, fontSize: 13 },
    rowAmt: { fontSize: 13, fontWeight: "600", minWidth: 72, textAlign: "right" },
  });
};
