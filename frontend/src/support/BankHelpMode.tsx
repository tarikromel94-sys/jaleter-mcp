/**
 * Bank Help Center — two-way onboarding tips + per-bank export guides.
 * Ends with a "still stuck?" CTA that opens the general ticket form.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/src/jaleterTheme';
import { BANK_IMPORT_GUIDES } from '@/src/bankGuides';
import { styles } from './styles';

export function BankHelpMode({ onOpenTicket, back }: { token?: string | null; onOpenTicket: () => void; back: () => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Pressable onPress={back} testID="support-back" style={{ alignSelf: 'flex-start' }}><Text style={styles.backLink}>← Back</Text></Pressable>
      <View style={styles.hero}>
        <Ionicons name="card-outline" size={22} color={C.goldEyebrow} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Bank Help Center</Text>
          <Text style={styles.heroSub}>Two ways to add accounts, plus per-bank export guides.</Text>
        </View>
      </View>

      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>1) Real-time via Plaid</Text>
        <Text style={styles.tipBody}>
          The fastest way: Settings → Linked Accounts → &quot;Connect a bank (Plaid)&quot;. Uses bank-grade encryption; 11,000+ US institutions supported. Balances and transactions sync automatically.
        </Text>
      </View>
      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>2) Manual CSV/OFX import</Text>
        <Text style={styles.tipBody}>
          If your bank isn&apos;t supported or you prefer not to link: download a statement from your bank and upload it in Settings → Linked Accounts → &quot;Import statement&quot;. CSV, OFX, QFX and QBO all work.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>PER-BANK EXPORT GUIDES</Text>
      {BANK_IMPORT_GUIDES.map((g) => (
        <View key={g.name} style={styles.guideCard}>
          <Text style={styles.guideTitle}>{g.name}</Text>
          {g.steps.map((step, i) => (<Text key={i} style={styles.guideStep}>{i + 1}. {step}</Text>))}
          <Text style={styles.guideFmt}>Format: {g.format}</Text>
        </View>
      ))}

      <Pressable onPress={onOpenTicket} style={styles.action} testID="bankhelp-open-ticket">
        <View style={styles.actionIcon}><Ionicons name="create-outline" size={20} color={C.goldEyebrow} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>Still stuck? Open a support ticket</Text>
          <Text style={styles.actionSub}>Tell us which bank + what you tried; we&apos;ll help.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#aaa39a" />
      </Pressable>
    </View>
  );
}
