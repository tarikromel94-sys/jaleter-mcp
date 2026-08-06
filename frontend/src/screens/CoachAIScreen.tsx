/**
 * Coach AI Screen — chat with Jaleter's GPT-5.6-Terra-powered financial coach.
 *
 * The client is the source of truth for the user's financial data (budget,
 * transactions, net worth, legacy). We include a compact snapshot of that
 * state with every message so the coach can ground answers in real numbers.
 *
 * Multi-turn conversation history is persisted server-side and rehydrated on
 * screen open. A "New chat" button resets the current thread.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiCall, useAuth } from '@/src/AuthContext';
import { C, D } from '@/src/jaleterTheme';

export type CoachContext = {
  budgetYear?: number;
  categories?: any[];
  incomeSources?: any[];
  transactions?: any[];
  netWorth?: number;
  totalCash?: number;
  investmentTotal?: number;
  monthlyNet?: number;
  linkedAccountsCount?: number;
  experience?: string;
  legacy?: {
    timeframe?: string;
    contribution?: number;
    hypothetical?: string;
    cumulative?: boolean;
  };
};

type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
  pending?: boolean;
};

const SUGGESTED_PROMPTS = [
  'How am I doing this month?',
  'Where can I save $200?',
  'Am I on track for retirement?',
  'Break down my biggest spending category.',
  'What should I focus on next?',
];

export function CoachAIScreen({ context, isDark = false }: { context: CoachContext; isDark?: boolean }) {
  const { token, user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  // Rehydrate the user's most recent chat on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) { setHydrating(false); return; }
      try {
        const data = await apiCall('/api/coach/history', { method: 'GET' }, token);
        if (!alive) return;
        sessionIdRef.current = data?.session_id || null;
        const hist: ChatMsg[] = (data?.messages || []).map((m: any) => ({
          role: m.role, content: m.content, created_at: m.created_at,
        }));
        setMessages(hist);
      } catch {
        // silent — start fresh
      } finally {
        if (alive) { setHydrating(false); scrollToEnd(); }
      }
    })();
    return () => { alive = false; };
  }, [token, scrollToEnd]);

  const send = useCallback(async (text?: string) => {
    const trimmed = (text ?? input).trim();
    if (!trimmed || busy) return;
    setError(null);
    setInput('');
    // Optimistic: user message + pending assistant placeholder.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '', pending: true },
    ]);
    setBusy(true);
    scrollToEnd();
    try {
      const data = await apiCall(
        '/api/coach/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            message: trimmed,
            context,
            session_id: sessionIdRef.current || undefined,
          }),
        },
        token,
      );
      sessionIdRef.current = data?.session_id || sessionIdRef.current;
      setMessages((prev) => {
        const copy = prev.slice();
        // Replace the trailing pending assistant with the real answer.
        for (let i = copy.length - 1; i >= 0; i -= 1) {
          if (copy[i].pending && copy[i].role === 'assistant') {
            copy[i] = { role: 'assistant', content: data?.answer || '(no reply)' };
            break;
          }
        }
        return copy;
      });
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => !m.pending));
      setError(e?.message || 'Coach is unavailable right now.');
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }, [busy, input, context, token, scrollToEnd]);

  const newChat = useCallback(async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      await apiCall('/api/coach/reset', { method: 'POST' }, token);
    } catch {}
    setMessages([]);
    setError(null);
    setBusy(false);
  }, [token, busy]);

  const bg = isDark ? D.bg : C.cream;
  const surface = isDark ? D.surface : C.creamAlt;
  const border = isDark ? D.border : C.border;
  const text = isDark ? D.text : C.ink;
  const muted = isDark ? D.textMuted : C.muted;

  const showEmpty = !hydrating && messages.length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      // 79px = height of the absolute-positioned BottomNav overlay in MainApp.
      // Reserving this space keeps the composer + disclaimer visible above the tabs.
      style={{ flex: 1, backgroundColor: bg, paddingBottom: 79 }}
    >
      {/* Header */}
      <View style={[styles.header, { borderColor: border, backgroundColor: surface }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatar, { backgroundColor: C.gold + '22', borderColor: C.gold }]}>
            <Ionicons name="sparkles" size={16} color={C.gold} />
          </View>
          <View>
            <Text style={[styles.title, { color: text }]}>Jaleter Coach</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {user?.name ? `Hi ${user.name.split(' ')[0]} · ` : ''}Powered by GPT 5.6 Terra
            </Text>
          </View>
        </View>
        <Pressable onPress={newChat} disabled={busy} style={[styles.newBtn, busy && { opacity: 0.5 }]} testID="coach-new-chat">
          <Ionicons name="refresh-outline" size={16} color={C.gold} />
          <Text style={[styles.newBtnText, { color: C.gold }]}>New</Text>
        </Pressable>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToEnd}
      >
        {hydrating ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <ActivityIndicator color={C.gold} />
          </View>
        ) : null}

        {showEmpty ? (
          <View style={{ gap: 12 }}>
            <View style={[styles.introCard, { backgroundColor: surface, borderColor: border }]}>
              <Ionicons name="sparkles-outline" size={22} color={C.gold} />
              <Text style={[styles.introTitle, { color: text }]}>Ask me anything about your money</Text>
              <Text style={[styles.introBody, { color: muted }]}>
                I use your live Jaleter data — budget, transactions, net worth, and Legacy plan — to answer
                grounded questions. Try one of these to get started:
              </Text>
            </View>
            {SUGGESTED_PROMPTS.map((p) => (
              <Pressable
                key={p}
                onPress={() => send(p)}
                style={[styles.suggestion, { backgroundColor: surface, borderColor: border }]}
                testID={`coach-suggest-${p.slice(0, 12)}`}
              >
                <Text style={[styles.suggestionText, { color: text }]}>{p}</Text>
                <Ionicons name="arrow-forward" size={14} color={muted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} isDark={isDark} />
        ))}

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={14} color={C.red} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Disclaimer */}
      <View style={[styles.disclaimer, { backgroundColor: bg, borderColor: border }]}>
        <Ionicons name="information-circle-outline" size={12} color={muted} />
        <Text style={[styles.disclaimerText, { color: muted }]}>
          Coach may make mistakes. This is not financial advice.
        </Text>
      </View>

      {/* Composer */}
      <View style={[styles.composer, { backgroundColor: surface, borderTopColor: border }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your budget, spending, or plan…"
          placeholderTextColor={muted}
          style={[styles.input, { color: text, borderColor: border, backgroundColor: bg }]}
          multiline
          maxLength={2000}
          editable={!busy}
          testID="coach-input"
          onSubmitEditing={() => send()}
          returnKeyType="send"
          blurOnSubmit
        />
        <Pressable
          onPress={() => send()}
          disabled={!input.trim() || busy}
          style={[styles.sendBtn, (!input.trim() || busy) && { opacity: 0.4 }]}
          testID="coach-send"
        >
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="arrow-up" size={18} color="#fff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ msg, isDark }: { msg: ChatMsg; isDark?: boolean }) {
  const isUser = msg.role === 'user';
  const bg = isUser
    ? (isDark ? '#3a2f1c' : '#f5e6c8')
    : (isDark ? D.surface : C.creamAlt);
  const border = isUser
    ? (isDark ? '#5c4b30' : '#e6d3aa')
    : (isDark ? D.border : C.border);
  const text = isDark ? D.text : C.ink;
  const align = isUser ? 'flex-end' : 'flex-start';

  return (
    <View style={{ alignItems: align, marginBottom: 10 }}>
      {!isUser && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4, marginBottom: 4 }}>
          <Ionicons name="sparkles" size={11} color={C.gold} />
          <Text style={{ fontSize: 10, color: C.gold, letterSpacing: 1.2, fontWeight: '700' }}>COACH</Text>
        </View>
      )}
      <View style={[styles.bubble, { backgroundColor: bg, borderColor: border, maxWidth: '85%' }]}>
        {msg.pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
            <ActivityIndicator size="small" color={C.gold} />
            <Text style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>thinking…</Text>
          </View>
        ) : (
          <Text selectable style={{ fontSize: 14, lineHeight: 20, color: text }}>{msg.content}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  title: { fontSize: 15, fontWeight: '800' },
  subtitle: { fontSize: 10, marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, backgroundColor: C.gold + '15',
  },
  newBtnText: { fontSize: 11, fontWeight: '700' },

  introCard: {
    padding: 16, borderRadius: 14, borderWidth: 1,
    gap: 8, alignItems: 'flex-start',
  },
  introTitle: { fontSize: 15, fontWeight: '800' },
  introBody: { fontSize: 12, lineHeight: 17 },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 12, borderWidth: 1,
  },
  suggestionText: { fontSize: 13, fontWeight: '600', flex: 1, paddingRight: 8 },

  bubble: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1,
  },

  disclaimer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 6, paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  disclaimerText: { fontSize: 10 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 10, borderTopWidth: 1,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center',
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    padding: 10, marginTop: 8,
    borderRadius: 10, backgroundColor: '#fbeeec', borderWidth: 1, borderColor: '#f0d0c7',
  },
  errorText: { fontSize: 11, color: C.red },
});
