import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Platform } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useAuth, apiCall } from '@/src/AuthContext';
import { C, D, F } from '@/src/jaleterTheme';
import { MONEY } from '@/src/quoteLibrary';
import { ConnectPlaidButton } from '@/src/PlaidLink';
import { SupportSheet } from '@/src/SupportSheet';
import { DeleteAccountMode } from '@/src/support/DeleteMode';
import { BANK_IMPORT_GUIDES } from '@/src/bankGuides';
import { openJaleter } from '@/src/jaleterLinks';
import { s, useThemed, PeriodPills, PageHeader, Sheet, Toast as SharedToast, GoldButton } from '@/src/utils/appShared';
import { AppLockConfigure, loadAppLock } from '@/src/screens/AppLockScreens';
import { BillingWebsiteNotice } from '@/src/components/BillingWebsiteNotice';

/* ---------------- File import helper (shared) ---------------- */
async function pickAndImport(token: string | null, onDone: (msg: string) => void, onError: (err: string) => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  try {
    const DocumentPicker = await import('expo-document-picker');
    const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'application/x-ofx', 'application/vnd.intu.qbo', 'application/x-qfx', 'application/octet-stream', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) { setBusy(false); return; }
    const asset = res.assets[0];
    const form = new FormData();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(asset.uri)).blob();
      form.append('file', new File([blob], asset.name, { type: asset.mimeType || 'text/csv' }));
    } else {
      // @ts-ignore RN FormData
      form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' });
    }
    const headers: any = { 'Authorization': `Bearer ${token}` };
    const url = `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/accounts/import`;
    const httpRes = await fetch(url, { method: 'POST', headers, body: form as any });
    const body = await httpRes.json();
    if (!httpRes.ok) throw new Error(body?.detail || 'Import failed');
    onDone(`Imported ${body.inserted} tx (${body.duplicates} duplicates skipped).`);
  } catch (e: any) { onError(e?.message || 'Import failed.'); }
  finally { setBusy(false); }
}

/**
 * ResetAppDataModal — strong two-step confirmation for the destructive reset.
 *
 * Spec #18 requirements addressed:
 *  - Clearly explains what is REMOVED (imported transactions, manual entries,
 *    budgets, income plans, manual assets/liabilities, custom reclassifications,
 *    alerts, cached reports) vs what STAYS (login, profile, subscription,
 *    Plaid connections — synced data resyncs on next refresh).
 *  - Requires the user to type "RESET" verbatim before the final button
 *    activates. No one-tap deletion.
 *  - Final button is labeled "Permanently Reset App Data" so intent is
 *    unambiguous.
 */
function ResetAppDataModal({ visible, isDark, onCancel, onConfirm }: { visible: boolean; isDark: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const needed = 'RESET';
  const canProceed = confirmText.trim() === needed && !busy;

  React.useEffect(() => { if (!visible) { setConfirmText(''); setBusy(false); } }, [visible]);

  const cardBg = isDark ? D.surface : '#fff';
  const border = isDark ? D.border : '#e5decf';
  const ink = isDark ? D.text : C.ink;
  const muted = isDark ? D.textMuted : C.muted;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 }}>
        <View style={[{ borderRadius: 22, padding: 22, backgroundColor: cardBg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="warning-outline" size={20} color="#b0453d" />
            <Text style={[{ fontSize: 18, fontFamily: F.serif, fontWeight: '600', color: ink, flex: 1 }]}>Reset app data?</Text>
          </View>
          <Text style={[{ fontSize: 11, marginTop: 12, lineHeight: 16, color: muted }]}>
            <Text style={{ fontWeight: '800', color: ink }}>What gets removed:</Text>{'\n'}
            • Every imported and manually entered transaction{'\n'}
            • Your budget categories, planned amounts, and income sources{'\n'}
            • Manual assets, liabilities, Set Aside Cash buckets{'\n'}
            • Custom account renames + reclassifications{'\n'}
            • Legacy assumptions (hypotheticals, retirement age){'\n'}
            • Budget alerts + notification preferences{'\n'}
            • Cached reports and category-mapping overrides
          </Text>
          <Text style={[{ fontSize: 11, marginTop: 12, lineHeight: 16, color: muted }]}>
            <Text style={{ fontWeight: '800', color: ink }}>What stays:</Text>{'\n'}
            • Your login and profile{'\n'}
            • Membership + coaching bookings{'\n'}
            • Your Plaid bank connections{'\n'}
            <Text style={{ fontStyle: 'italic' }}>Plaid accounts remain connected. Their live balances and transactions will resync automatically on your next open.</Text>
          </Text>
          <Text style={[{ fontSize: 11, marginTop: 14, color: ink, fontWeight: '600' }]}>
            Type <Text style={{ fontWeight: '900', color: '#b0453d' }}>{needed}</Text> to confirm:
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={needed}
            placeholderTextColor={muted}
            style={{
              marginTop: 6, borderWidth: 1, borderColor: border, borderRadius: 10,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: ink,
              backgroundColor: isDark ? '#20180c' : '#fbf6ec',
            }}
            testID="reset-confirm-input"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable onPress={onCancel} disabled={busy} style={{ flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: border, alignItems: 'center' }} testID="reset-cancel">
              <Text style={[{ fontWeight: '700', fontSize: 12, color: ink }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={async () => { if (!canProceed) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}
              disabled={!canProceed}
              style={{ flex: 1.4, padding: 14, borderRadius: 14, backgroundColor: canProceed ? '#b0453d' : (isDark ? '#3a2a26' : '#eecfcb'), alignItems: 'center' }}
              testID="reset-confirm"
            >
              <Text style={{ color: canProceed ? '#fff' : (isDark ? '#8f6862' : '#b0453d'), fontWeight: '800', fontSize: 12 }}>
                {busy ? 'Resetting…' : 'Permanently Reset App Data'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const SettingsScreen = ({ experience, setExperience, appearance, setAppearance, alerts, setAlerts, onLogout, back, linkedAccounts, linkedAccountCount, addLinked, onResetAppData, initials, categories, appLock, setAppLock }: any) => {
  const t = useThemed();
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  // UI-only expanded state per category for the collapsible Budget Alerts list.
  const [settingsAlertExpanded, setSettingsAlertExpanded] = useState<Record<string, boolean>>({});
  // Prefer the derived-from-live-API count when provided; fall back to the
  // Plaid-items length (# of institutions) so we degrade gracefully during
  // the first render pass before /accounts/all returns.
  const effectiveCount = typeof linkedAccountCount === 'number' ? linkedAccountCount : linkedAccounts.length;
  const rows: [string, string, string, any][] = [
    ['accounts', 'Linked Accounts', `${effectiveCount} connected`, 'link-outline'],
    ['support', 'Help & Support', 'Contact us, FAQs, ticket history', 'help-buoy-outline'],
    ['notifications', 'Notification Details', 'Manage every reminder', 'notifications-outline'],
    ['terms', 'Terms of Use', 'Opens jaleter.com/terms', 'document-text-outline'],
    ['privacy', 'Privacy Policy', 'Opens jaleter.com/privacy', 'lock-closed-outline'],
  ];
  return (
    <ScrollView style={[s.page, t.pageBg]} contentContainerStyle={{ paddingBottom: 130 }}>
      <PageHeader title="Settings" subtitle="Make Jaleter work your way." back={back} action={<View style={s.avatar}><Text style={{ color: C.goldText, fontSize: 11, fontWeight: '700' }}>{initials || '—'}</Text></View>} />
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Your Experience</Text>
        <Text style={[s.settingsSub, t.textMuted]}>100 approved messages. No generated scripture.</Text>
        <PeriodPills values={['Faith','Both','Motivation']} value={experience} onChange={setExperience} testID="settings-exp" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Appearance</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Choose a look or follow your device.</Text>
        <PeriodPills values={['Light','System','Dark']} value={appearance} onChange={setAppearance} testID="settings-appear" />
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Budget Alerts</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Choose which thresholds trigger a warning per category.</Text>
        <Pressable onPress={() => setAlerts({ ...alerts, enabled: !alerts.enabled })} style={s.settingToggleRow} testID="settings-alerts">
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>Enable alerts</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>Master switch</Text></View>
          <View style={[s.toggle, alerts.enabled && s.toggleOn]}><View style={[s.toggleKnob, alerts.enabled && { transform: [{ translateX: 14 }] }]} /></View>
        </Pressable>
        {alerts.enabled && (categories || []).map((c: any) => {
          // Category-level alert section — collapsible per spec #15 to keep
          // the interface clean. Expanded state is UI-only (not persisted).
          const expanded = (settingsAlertExpanded || {})[c.id];
          return (
            <View key={c.id} style={{ marginTop: 10 }}>
              <Pressable
                onPress={() => setSettingsAlertExpanded({ ...(settingsAlertExpanded || {}), [c.id]: !expanded })}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
                testID={`alert-cat-toggle-${c.id}`}
              >
                <Text style={[{ flex: 1, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: '#a97c39' }]}>{c.name.toUpperCase()}</Text>
                <Text style={[{ fontSize: 9, color: C.muted3, marginRight: 6 }, t.textMuted]}>
                  {c.subcategories.length} item{c.subcategories.length === 1 ? '' : 's'}
                </Text>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.dark ? D.textMuted : '#9a938a'} />
              </Pressable>
              {expanded && c.subcategories.map((sub: any) => {
                // New-user defaults per spec #15: 50% OFF, 80% ON, 100%+ ON.
                // Existing per-sub prefs are preserved because the presence of
                // a record in `alerts.perCategory[sub.id]` short-circuits the
                // defaults.
                const conf = (alerts.perCategory && alerts.perCategory[sub.id]) || { p50: false, p80: true, exceeded: true };
                const toggle = (key: 'p50' | 'p80' | 'exceeded') => {
                  const next = { ...conf, [key]: !conf[key] };
                  setAlerts({ ...alerts, perCategory: { ...(alerts.perCategory || {}), [sub.id]: next } });
                };
                return (
                  <View key={sub.id} style={s.alertRow}>
                    <Text style={[{ flex: 1, fontSize: 10, fontWeight: '600' }, t.textInk]}>{sub.name}</Text>
                    {(['p50','p80','exceeded'] as const).map((k) => {
                      const label = k === 'p50' ? '50%' : k === 'p80' ? '80%' : '100%+';
                      return (
                        <Pressable key={k} onPress={() => toggle(k)} style={[s.alertPill, conf[k] && s.alertPillOn]} testID={`alert-${sub.id}-${k}`}>
                          <Text style={[s.alertPillText, conf[k] && { color: '#fff' }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          );
        })}
        {/* Single-expense alert (spec #16) — triggers when one transaction
            exceeds the configured amount. Refunds, transfers, credit-card
            payments, income deposits and matched moves are all excluded
            server-side before this compares against the threshold. */}
        {alerts.enabled && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.dark ? D.border : '#ece5d5' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="alert-circle-outline" size={14} color="#c49450" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '700' }, t.textInk]}>Alert on large single expense</Text>
              <Pressable
                onPress={() => setAlerts({ ...alerts, singleExpense: { ...(alerts.singleExpense || { threshold: 200 }), enabled: !(alerts.singleExpense?.enabled) } })}
                style={[s.toggle, alerts.singleExpense?.enabled && s.toggleOn]}
                testID="alert-single-toggle"
              >
                <View style={[s.toggleKnob, alerts.singleExpense?.enabled && { transform: [{ translateX: 14 }] }]} />
              </Pressable>
            </View>
            {alerts.singleExpense?.enabled && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <Text style={[{ fontSize: 10, fontWeight: '600' }, t.textMuted]}>Notify me when one expense exceeds</Text>
                <TextInput
                  keyboardType="numeric"
                  value={String(alerts.singleExpense?.threshold ?? 200)}
                  onChangeText={(v) => {
                    const cleaned = Math.max(0, Math.round(Number((v || '').replace(/[^0-9.]/g, '')) || 0));
                    setAlerts({ ...alerts, singleExpense: { ...(alerts.singleExpense || {}), enabled: true, threshold: cleaned } });
                  }}
                  style={{
                    borderWidth: 1, borderColor: t.dark ? D.border : '#ece5d5',
                    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
                    fontSize: 12, minWidth: 70, textAlign: 'right',
                    color: t.dark ? D.text : C.ink,
                  }}
                  placeholder="200"
                  placeholderTextColor={t.dark ? D.textMuted : C.muted}
                  testID="alert-single-threshold"
                />
                <Text style={[{ fontSize: 10 }, t.textMuted]}>USD</Text>
              </View>
            )}
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Transfers, refunds, credit-card payments, and income deposits never trigger this alert.
            </Text>
          </View>
        )}
        {/* Weekly Summary (Premium) — Sunday 6PM local. On-by-default; toggle
            hides only the Sunday recap push. Individual budget & large-txn
            alerts continue firing regardless. */}
        {alerts.enabled && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.dark ? D.border : '#ece5d5' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="calendar-outline" size={14} color="#c49450" />
              <Text style={[{ flex: 1, fontSize: 11, fontWeight: '700' }, t.textInk]}>Weekly summary (Sun 6PM)</Text>
              <Pressable
                onPress={() => setAlerts({ ...(alerts as any), weeklyDigest: !((alerts as any).weeklyDigest !== false) })}
                style={[s.toggle, (alerts as any).weeklyDigest !== false && s.toggleOn]}
                testID="alert-weekly-digest-toggle"
              >
                <View style={[s.toggleKnob, (alerts as any).weeklyDigest !== false && { transform: [{ translateX: 14 }] }]} />
              </Pressable>
            </View>
            <Text style={[{ fontSize: 9, marginTop: 6 }, t.textMuted]}>
              Premium subscribers get a Sunday 6PM local recap: total spent this week vs last, top merchant, budget hits, and large-transaction count.
            </Text>
          </View>
        )}
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>App Lock</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Require a PIN{appLock?.biometricsAvailable ? ' or Face ID' : ''} on app launch.</Text>
        <Pressable onPress={() => setAppLock?.({ ...(appLock || {}), openConfigure: true })} style={s.settingToggleRow} testID="settings-applock">
          <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{appLock?.enabled ? 'Enabled' : 'Not set'}</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>{appLock?.enabled ? (appLock?.biometricsEnabled ? 'Face ID + PIN' : 'PIN only') : 'Tap to set a PIN'}</Text></View>
          <Ionicons name={appLock?.enabled ? 'lock-closed' : 'lock-open-outline'} size={18} color={appLock?.enabled ? '#8fa88f' : (t.dark ? D.textMuted : '#9a938a')} />
        </Pressable>
      </View>
      <View style={[s.settingsSection, t.cardBg]}>
        <Text style={[s.settingsH3, t.textInk]}>Billing</Text>
        <Text style={[s.settingsSub, t.textMuted]}>Payments and subscriptions are managed on our website.</Text>
        <BillingWebsiteNotice compact />
      </View>
      <View style={[s.settingsMenu, t.cardBg]}>
        {rows.map(([id, label, detail, icon]) => (
          <Pressable
            key={id}
            onPress={() => {
              // Terms and Privacy live on jaleter.com — open directly.
              if (id === 'terms') { openJaleter('terms'); return; }
              if (id === 'privacy') { openJaleter('privacy'); return; }
              setSheet(id);
            }}
            style={[s.settingsMenuBtn, t.dividerBorder]}
            testID={`settings-${id}`}
          >
            <View style={[s.settingsRowIcon, t.dark && { backgroundColor: D.surfaceAlt }]}><Ionicons name={icon} size={17} color={t.dark ? D.textMuted : '#8a7b65'} /></View>
            <View style={{ flex: 1 }}><Text style={[{ fontSize: 11, fontWeight: '700' }, t.textInk]}>{label}</Text><Text style={[{ fontSize: 9, color: C.muted3 }, t.textMuted]}>{detail}</Text></View>
            <Ionicons name={id === 'terms' || id === 'privacy' ? 'open-outline' : 'chevron-forward'} size={16} color={t.dark ? D.textMuted : '#b0aaa0'} />
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: 20, paddingHorizontal: 6 }}>
        <Text style={[{ fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: C.danger }, t.textMuted && { color: '#c07a6f' }]}>DANGER ZONE</Text>
        <Text style={[{ fontSize: 10, color: C.muted3, marginTop: 4, lineHeight: 14 }, t.textMuted]}>Reset your budgets, transactions, categories, and goals. Your Jaleter account, membership, and connected banks stay linked.</Text>
      </View>
      <Pressable onPress={() => setConfirmReset(true)} style={[s.logoutBtn, { marginTop: 10, borderColor: '#b28a4c' }]} testID="settings-reset">
        <Ionicons name="refresh-outline" size={17} color="#b28a4c" />
        <Text style={{ color: '#b28a4c', fontSize: 12, fontWeight: '700' }}>Reset App Data</Text>
      </Pressable>
      <Pressable onPress={onLogout} style={s.logoutBtn} testID="settings-logout">
        <Ionicons name="log-out-outline" size={17} color={C.danger} />
        <Text style={{ color: C.danger, fontSize: 12, fontWeight: '700' }}>Log Out</Text>
      </Pressable>
      <Pressable onPress={() => setSheet('delete-account')} style={[s.logoutBtn, { borderColor: '#b0453d' }]} testID="settings-delete-account">
        <Ionicons name="trash-outline" size={17} color="#b0453d" />
        <Text style={{ color: '#b0453d', fontSize: 12, fontWeight: '700' }}>Delete Account</Text>
      </Pressable>
      <Sheet visible={!!appLock?.openConfigure} close={() => setAppLock?.({ openConfigure: false })} title={appLock?.enabled ? 'Change App Lock' : 'Set up App Lock'} subtitle="Your PIN is stored securely on this device only.">
        <AppLockConfigure
          currentPin={appLock?.pin || ''}
          biometricsAvailable={!!appLock?.biometricsAvailable}
          biometricsEnabled={!!appLock?.biometricsEnabled}
          onSaved={async (next: any) => {
            const fresh = await loadAppLock();
            setAppLock?.({
              enabled: !!fresh.pin,
              pin: fresh.pin,
              biometricsEnabled: fresh.biometricsEnabled,
              biometricsAvailable: next.biometricsAvailable,
              openConfigure: false,
              locked: false,
            });
          }}
          close={() => setAppLock?.({ openConfigure: false })}
        />
      </Sheet>
      <ResetAppDataModal
        visible={confirmReset}
        isDark={t.dark}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          try {
            await onResetAppData?.();
            setConfirmReset(false);
            setToast('App data reset. Fresh start.');
          } catch (e: any) {
            // Modal stays open so the user sees the error. ResetAppDataModal
            // owns its own busy state; we just re-throw so it clears.
            setToast(e?.message || 'Reset failed. Nothing was changed.');
            throw e;
          }
        }}
      />
      <LegalSheet visible={sheet === 'terms'} close={() => setSheet(null)} type="Terms of Use" />
      <LegalSheet visible={sheet === 'privacy'} close={() => setSheet(null)} type="Privacy Policy" />
      <NotificationsSheet visible={sheet === 'notifications'} close={() => setSheet(null)} onSave={(m: string) => { setSheet(null); setToast(m); }} />
      <AccountLinkSheet visible={sheet === 'accounts'} close={() => setSheet(null)} onConfirm={(accs: any[]) => { addLinked(accs); setSheet(null); setToast('Accounts connected and syncing.'); }} />
      <SupportSheet visible={sheet === 'support'} close={() => setSheet(null)} />
      <Sheet visible={sheet === 'delete-account'} close={() => setSheet(null)} title="Delete Account" subtitle="Permanently close your Jaleter account.">
        <DeleteAccountMode back={() => setSheet(null)} onDeleted={() => setSheet(null)} />
      </Sheet>
      {toast ? <SharedToast message={toast} onHide={() => setToast('')} /> : null}
    </ScrollView>
  );
};

/* ---------------- Extra Sheets ---------------- */
const LegalSheet = ({ visible, close, type }: any) => (
  <Sheet visible={visible} close={close} title={type} subtitle="Last updated July 15, 2026">
    {type === 'Privacy Policy' ? (
      <View>
        <Text style={s.privacyPara}>Jaleter never touches your bank credentials. You download statements from your bank and upload them into Jaleter — your login stays only with your bank.</Text>
        <Text style={s.privacyPara}>We do not sell financial data. You control linked accounts and can disconnect them at any time.</Text>
        <Text style={s.privacyPara}>Manual entries and preferences are used only to provide requested features.</Text>
      </View>
    ) : (
      <View>
        <Text style={s.privacyPara}>Jaleter provides budgeting and planning tools for educational purposes. It does not provide investment, tax, or legal advice.</Text>
        <Text style={s.privacyPara}>Premium membership is $90 per year. Coaching is a separate $75 per session service. Renewal and cancellation details are shown before checkout.</Text>
        <Text style={s.privacyPara}>Projections are estimates and are not guarantees of future performance.</Text>
      </View>
    )}
    <View style={{ marginTop: 14 }}><GoldButton label="Close" onPress={close} testID="legal-close" /></View>
  </Sheet>
);
const NotificationsSheet = ({ visible, close, onSave }: any) => {
  // Coaching Alerts removed intentionally — the setting was surfaced in the
  // Notifications sheet but never wired to actual delivery, so it was confusing.
  const labels: Record<string, string> = { daily: 'Daily check-in', weekly: 'Weekly summary', streak: 'Streak reminders', transactions: 'Large transactions' };
  const [n, setN] = useState({ daily: true, weekly: true, streak: true, transactions: true });
  return (
    <Sheet visible={visible} close={close} title="Notification Details" subtitle="Choose exactly what reaches you.">
      {Object.entries(n).map(([id, v]) => (
        <Pressable key={id} testID={`notif-${id}`} onPress={() => setN(x => ({ ...x, [id]: !x[id as keyof typeof x] }))} style={s.settingToggleRow}>
          <Text style={{ fontSize: 12, fontWeight: '700', flex: 1 }}>{labels[id]}</Text>
          <View style={[s.toggle, v && s.toggleOn]}><View style={[s.toggleKnob, v && { transform: [{ translateX: 14 }] }]} /></View>
        </Pressable>
      ))}
      <View style={{ marginTop: 14 }}><GoldButton label="Save preferences" onPress={() => onSave('Notification preferences saved.')} testID="notif-save" /></View>
    </Sheet>
  );
};


const AccountLinkSheet = ({ visible, close, onConfirm }: any) => {
  const { token } = useAuth();
  const [mode, setMode] = useState<'menu' | 'file' | 'request' | 'guides'>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [institution, setInstitution] = useState('');
  const [notes, setNotes] = useState('');
  const [existing, setExisting] = useState<any[] | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const refresh = async () => {
    if (!token) return;
    try {
      const data = await apiCall('/api/accounts/all', { method: 'GET' }, token);
      setExisting(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch { setExisting([]); }
  };
  useEffect(() => { if (visible) { setMode('menu'); setError(''); setMessage(''); setInstitution(''); setNotes(''); setBusy(false); refresh(); } }, [visible]);
  const syncOne = async (link_id: string, provider?: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const path = provider === 'plaid'
        ? `/api/plaid/sync?item_id=${encodeURIComponent(link_id)}`
        : `/api/accounts/link/${link_id}/sync`;
      const data = await apiCall(path, { method: 'POST' }, token);
      setMessage(`Refreshed. ${data?.synced ?? 0} new transactions.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'Sync failed.'); }
    finally { setSyncingId(null); }
  };
  const unlink = async (link_id: string, provider: string) => {
    if (!link_id) return;
    setSyncingId(link_id); setError('');
    try {
      const path = provider === 'plaid'
        ? `/api/plaid/item/${encodeURIComponent(link_id)}`
        : `/api/accounts/link/${link_id}`;
      await apiCall(path, { method: 'DELETE' }, token);
      setMessage('Account removed.');
      await refresh();
      onConfirm([]);
    } catch (e: any) { setError(e?.message || 'Unlink failed.'); }
    finally { setSyncingId(null); }
  };
  const submitFile = async () => pickAndImport(token, async (msg) => { setMessage(msg); await refresh(); onConfirm([]); setMode('menu'); }, (err) => setError(err), setBusy);
  const submitRequest = async () => {
    if (!institution.trim()) { setError('Enter an institution name.'); return; }
    setError(''); setBusy(true);
    try {
      await apiCall('/api/support/requests', { method: 'POST', body: JSON.stringify({ institution: institution.trim(), notes: notes.trim() }) }, token);
      setMessage(`Thanks — we've logged your request for ${institution.trim()}.`);
      setInstitution(''); setNotes('');
    } catch (e: any) { setError(e?.message || 'Could not send request.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} close={close} title={mode === 'menu' ? 'Linked accounts' : mode === 'file' ? 'Import statement' : mode === 'guides' ? 'How to download from your bank' : 'Request an institution'} subtitle={mode === 'menu' ? 'Refresh, remove, or add a new account.' : ''}>
      {mode === 'menu' && (
        <View style={{ gap: 10 }}>
          {existing && existing.length > 0 && (
            <View style={{ marginBottom: 6 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: C.muted, letterSpacing: 1.2, marginBottom: 6 }}>YOUR ACCOUNTS ({existing.length})</Text>
              {existing.map((row: any, i: number) => {
                const key = row.link_id || `${row.provider}-${i}`;
                const isSyncing = syncingId === row.link_id;
                const canSync = (row.provider === 'simplefin' || row.provider === 'plaid') && !!row.link_id;
                return (
                  <View key={key} style={s.linkedRow}>
                    <View style={s.linkedIcon}><Ionicons name={row.provider === 'file' ? 'document-attach-outline' : row.provider === 'snaptrade' ? 'trending-up' : row.provider === 'plaid' ? 'business-outline' : 'card-outline'} size={16} color={C.goldEyebrow} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: C.ink }}>{row.name || row.account_name || 'Account'}</Text>
                      <Text style={{ fontSize: 8, color: C.muted2 }}>{row.org_name || (row.provider === 'file' ? 'Imported' : row.provider === 'snaptrade' ? 'SnapTrade' : row.provider === 'plaid' ? 'Plaid' : 'Linked')}{row.balance !== undefined ? ` · ${MONEY(row.balance)}` : ''}</Text>
                      {row.error ? <Text style={{ fontSize: 8, color: C.danger }}>{row.error}</Text> : null}
                    </View>
                    {canSync && (
                      <Pressable testID={`link-sync-${row.link_id}`} onPress={() => syncOne(row.link_id, row.provider)} disabled={isSyncing} style={s.linkedBtn}>
                        <Ionicons name={isSyncing ? 'hourglass-outline' : 'refresh-outline'} size={16} color={C.ink3} />
                      </Pressable>
                    )}
                    {row.link_id && (
                      <Pressable testID={`link-remove-${row.link_id}`} onPress={() => unlink(row.link_id, row.provider)} disabled={isSyncing} style={s.linkedBtn}>
                        <Ionicons name="trash-outline" size={16} color={C.danger} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {message ? <Text testID="link-message" style={{ color: C.green, fontSize: 11, marginTop: 6 }}>{message}</Text> : null}
              {error ? <Text testID="link-error" style={s.formError}>{error}</Text> : null}
            </View>
          )}
          <Text style={{ fontSize: 9, fontWeight: '700', color: C.muted, letterSpacing: 1.2, marginTop: 4 }}>ADD AN ACCOUNT</Text>
          <ConnectPlaidButton
            token={token}
            testID="plaid-connect"
            onLinked={async (name: string) => {
              setMessage(`Connected ${name}. Refreshing…`);
              // Kick off a sync so transactions land in bank_transactions immediately.
              try { await apiCall('/api/plaid/sync', { method: 'POST' }, token); } catch { /* silent */ }
              await refresh();
              onConfirm([]);
            }}
          />
          {[
            { id: 'file', icon: 'cloud-upload-outline' as const, label: 'Import statement (recommended)', sub: 'Upload CSV, OFX, QFX, or QBO from any bank.' },
            { id: 'guides', icon: 'library-outline' as const, label: 'How to download from your bank', sub: 'Step-by-step guides for 10+ major banks.' },
            { id: 'request', icon: 'help-circle-outline' as const, label: 'Request an unsupported institution', sub: 'Tell us who to add next.' },
          ].map((row) => (
            <Pressable key={row.id} testID={`link-mode-${row.id}`} onPress={() => setMode(row.id as any)} style={s.moreGridBtn}>
              <View style={s.moreGridIcon}><Ionicons name={row.icon} size={20} color={C.goldEyebrow} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700' }}>{row.label}</Text>
                <Text style={{ fontSize: 9, color: C.muted2 }}>{row.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
            </Pressable>
          ))}
        </View>
      )}
      {mode === 'file' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 12, lineHeight: 16 }}>
            Download a statement from your bank (CSV, OFX, QFX, or QBO), then upload it here. Jaleter detects columns, dedupes transactions, and updates your budget automatically. Need help? Tap {'"How to download from your bank"'} for step-by-step guides.
          </Text>
          {error ? <Text testID="import-error" style={s.formError}>{error}</Text> : null}
          {message ? <Text style={{ color: C.green, fontSize: 11 }}>{message}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Uploading…' : 'Choose file'} onPress={submitFile} disabled={busy} testID="import-choose" />
          </View>
        </View>
      )}
      {mode === 'guides' && (
        <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 14, lineHeight: 16 }}>
            Each bank offers a way to export transactions to CSV or OFX. Log in on any browser, follow the steps, then come back to Jaleter and tap {'"Import statement"'}.
          </Text>
          {BANK_IMPORT_GUIDES.map((g) => (
            <View key={g.name} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e8dcc4', marginBottom: 8, backgroundColor: '#fbf6ec' }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.ink, marginBottom: 6 }}>{g.name}</Text>
              {g.steps.map((step, i) => (
                <Text key={i} style={{ fontSize: 10, color: '#615b52', marginBottom: 3, lineHeight: 15 }}>
                  {i + 1}.  {step}
                </Text>
              ))}
              <Text style={{ fontSize: 9, color: C.muted3, marginTop: 6, fontStyle: 'italic' }}>Format: {g.format}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 10, color: C.muted3, marginTop: 6, lineHeight: 15 }}>
            Don&apos;t see your bank?  Almost every US bank offers a {'"Download / Export"'} option under Transactions or Statements. If you can&apos;t find it, use the {'"Request an institution"'} option and we&apos;ll help.
          </Text>
        </ScrollView>
      )}
      {mode === 'request' && (
        <View>
          <Text style={{ color: '#817b72', fontSize: 11, marginBottom: 8 }}>Tell us which bank / credit union / brokerage you&apos;d like Jaleter to support.</Text>
          <TextInput testID="request-institution" style={s.input} value={institution} onChangeText={setInstitution} placeholder="e.g. Chime, PenFed, Robinhood" />
          <TextInput testID="request-notes" style={[s.input, { minHeight: 80, marginTop: 8 }]} value={notes} onChangeText={setNotes} multiline placeholder="Anything else we should know? (optional)" />
          {error ? <Text testID="request-error" style={s.formError}>{error}</Text> : null}
          {message ? <Text style={{ color: C.green, fontSize: 11, marginTop: 8 }}>{message}</Text> : null}
          <View style={{ marginTop: 14 }}>
            <GoldButton label={busy ? 'Sending…' : 'Send request'} onPress={submitRequest} disabled={busy || !institution.trim()} testID="request-submit" />
          </View>
        </View>
      )}
      {mode !== 'menu' && (
        <Pressable testID="link-back-to-menu" onPress={() => { setMode('menu'); setError(''); setMessage(''); }} style={{ alignItems: 'center', marginTop: 14 }}>
          <Text style={{ fontSize: 11, color: C.goldEyebrow, fontWeight: '600' }}>← Back to add-account menu</Text>
        </Pressable>
      )}
    </Sheet>
  );
};
