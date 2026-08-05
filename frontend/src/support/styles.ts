/**
 * Shared StyleSheet for every Support Sheet subcomponent.
 * Grouped by role for easier navigation.
 */
import { StyleSheet } from 'react-native';
import { C } from '@/src/jaleterTheme';

export const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 32 },
  closeBtn: { position: 'absolute', top: 14, right: 14, padding: 6, zIndex: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 14, fontFamily: undefined },

  hero: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#e8dcc4' },
  heroTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  heroSub: { fontSize: 10, color: '#8a7f70', marginTop: 2 },

  action: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fff',
  },
  actionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f2e6c9', alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 12, fontWeight: '800', color: '#2a2620' },
  actionSub: { fontSize: 9, color: '#8a7f70', marginTop: 2 },

  sectionLabel: { fontSize: 9, fontWeight: '700', color: '#a97c39', letterSpacing: 1.2, marginTop: 8 },

  faq: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#f0e7d1' },
  faqQ: { fontSize: 11, fontWeight: '700', color: C.ink, marginBottom: 4 },
  faqA: { fontSize: 10, color: '#615b52', lineHeight: 15 },

  formLabel: { fontSize: 10, fontWeight: '700', color: '#615b52', letterSpacing: 0.5, marginTop: 2 },
  input: {
    borderWidth: 1, borderColor: '#e5decf', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 12, color: C.ink, backgroundColor: '#fff',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  selectPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fff' },
  selectPillActive: { backgroundColor: '#b28a4c', borderColor: '#b28a4c' },
  selectPillText: { fontSize: 10, fontWeight: '700', color: '#615b52', textTransform: 'capitalize' },
  selectPillTextActive: { color: '#fff' },

  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: '#e5decf', backgroundColor: '#fbf6ec', alignSelf: 'flex-start' },
  attachBtnText: { fontSize: 10, color: '#8a7f70' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, padding: 6, borderRadius: 8, backgroundColor: '#f8f2e6' },

  primary: { backgroundColor: '#b28a4c', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  secondary: { backgroundColor: '#fbf6ec', borderWidth: 1, borderColor: '#e8dcc4', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  secondaryText: { color: '#8a7f70', fontSize: 11, fontWeight: '700' },
  error: { fontSize: 10, color: '#b0453d' },
  empty: { fontSize: 11, color: '#8a7f70', textAlign: 'center', paddingVertical: 14 },
  backLink: { fontSize: 11, color: '#b28a4c', fontWeight: '700' },

  ticketRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fff',
  },
  ticketNumber: { fontSize: 10, fontWeight: '800', color: C.goldEyebrow },
  ticketSubject: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 4 },
  ticketMeta: { fontSize: 9, color: '#8a7f70', marginTop: 2 },
  detailSubject: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 4 },

  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },

  bubbleUser: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fbf6ec' },
  bubbleAdmin: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#c9dbe8', backgroundColor: '#eef4fa' },
  bubblePrivate: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e3caca', backgroundColor: '#f8ecec' },
  bubbleAuthor: { fontSize: 10, fontWeight: '800', color: '#615b52', marginBottom: 4 },
  bubbleBody: { fontSize: 11, color: C.ink, lineHeight: 16 },
  bubbleTime: { fontSize: 8, color: '#8a7f70', marginTop: 4 },

  adminBox: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#b28a4c', backgroundColor: '#f7edd5' },

  /* Phase 2/3/4 additions */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridBtn: {
    width: '48%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#efe6d3',
    backgroundColor: '#fbf6ec',
    gap: 6,
  },
  gridIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#f2e6c9', alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 12, fontWeight: '800', color: '#2a2620', marginTop: 4 },
  gridSub: { fontSize: 9, color: '#8a7f70' },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fff' },
  radioRowActive: { borderColor: '#b28a4c', backgroundColor: '#fbf6ec' },
  radioDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#c9c1b0' },
  radioDotActive: { borderColor: '#b28a4c', backgroundColor: '#b28a4c' },
  radioLabel: { fontSize: 11, fontWeight: '700', color: C.ink },
  radioHint: { fontSize: 9, color: '#8a7f70', marginTop: 2 },

  metaBox: { padding: 8, borderRadius: 10, backgroundColor: '#f8f2e6', borderWidth: 1, borderColor: '#efe6d3' },
  metaLabel: { fontSize: 8, fontWeight: '800', color: '#a97c39', letterSpacing: 1 },
  metaValue: { fontSize: 10, color: '#615b52', marginTop: 3 },

  danger: { backgroundColor: '#b0453d', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  dangerText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  linkBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#e8dcc4', backgroundColor: '#fbf6ec',
  },
  linkBannerText: { flex: 1, fontSize: 11, color: C.ink, fontWeight: '700' },

  tipCard: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#efe6d3', backgroundColor: '#fbf6ec' },
  tipTitle: { fontSize: 11, fontWeight: '800', color: C.ink, marginBottom: 4 },
  tipBody: { fontSize: 10, color: '#615b52', lineHeight: 15 },

  guideCard: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e8dcc4', backgroundColor: '#fff' },
  guideTitle: { fontSize: 12, fontWeight: '800', color: C.ink, marginBottom: 4 },
  guideStep: { fontSize: 10, color: '#615b52', marginBottom: 2, lineHeight: 14 },
  guideFmt: { fontSize: 9, color: '#a97c39', fontStyle: 'italic', marginTop: 4 },
});
