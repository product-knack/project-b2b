import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Keyboard, Platform, Animated, Easing, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useAiCacheStatus, ensureAiCacheFresh, syncAiCache, askOddsAi, AiTurn } from '../lib/aiCache';

/* ============ Odds AI — CRM chat over the on-device client cache ============ */

const CHAT_KEY = 'crm-ai:last-chat:v1';
const SUGGESTIONS = [
  'Which clients are overdue for a QHP refresh?',
  'Who has fewer than 3 sessions left?',
  'Which clients have not trained in the last 2 weeks?',
  'Any clients currently paused?',
];

type Msg = AiTurn & { error?: boolean };

function TypingDots() {
  const dots = [React.useRef(new Animated.Value(0)).current, React.useRef(new Animated.Value(0)).current, React.useRef(new Animated.Value(0)).current];
  React.useEffect(() => {
    const anims = dots.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay((2 - i) * 160),
      ])));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, paddingVertical: 4 }}>
      {dots.map((v, i) => (
        <Animated.View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }} />
      ))}
    </View>
  );
}

const agoLabel = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

export function CrmAi() {
  const insets = useSafeAreaInsets();
  const { back, canGoBack, go } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const cache = useAiCacheStatus(crmId);

  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [kbH, setKbH] = React.useState(0);
  const scrollRef = React.useRef<ScrollView>(null);
  const loadedRef = React.useRef(false);

  // Restore the last conversation; keep the cache fresh in the background.
  React.useEffect(() => {
    AsyncStorage.getItem(CHAT_KEY).then((raw) => {
      if (raw && !loadedRef.current) { try { setMessages(JSON.parse(raw)); } catch {} }
      loadedRef.current = true;
    }).catch(() => { loadedRef.current = true; });
    if (crmId) ensureAiCacheFresh(crmId).catch(() => {});
  }, [crmId]);
  React.useEffect(() => {
    if (loadedRef.current) AsyncStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40))).catch(() => {});
  }, [messages]);

  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  const scrollEnd = () => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80); };
  React.useEffect(scrollEnd, [messages.length, sending]);

  const ask = async (raw?: string) => {
    const q = (raw ?? input).trim();
    if (!q || sending || !crmId) return;
    setInput('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const history = messages.filter((m) => !m.error);
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setSending(true);
    try {
      // Cold start: no cache yet → sync first so answers are grounded.
      if (cache.clientCount === 0 && !cache.syncing) await syncAiCache(crmId);
      const answer = await askOddsAi(crmId, q, history);
      setMessages((prev) => [...prev, { role: 'model', text: answer }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'model', text: String(e?.message ?? 'Something went wrong. Try again.'), error: true }]);
    } finally {
      setSending(false);
    }
  };

  const refresh = () => { if (crmId && !cache.syncing) syncAiCache(crmId).catch(() => {}); };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Pressable onPress={() => (canGoBack ? back() : go('crm-dashboard'))} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevLeft" size={16} color="#fff" strokeWidth={2.4} />
        </Pressable>
        <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={18} color={C.orange} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 20 }}>Odds AI</Serif>
          <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>
            {cache.syncing ? 'Updating client data…' : `${cache.clientCount} clients · synced ${agoLabel(cache.lastSyncAt)}`}
          </Body>
        </View>
        <Pressable onPress={refresh} hitSlop={10} disabled={cache.syncing} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', opacity: cache.syncing ? 0.5 : 1 }}>
          {cache.syncing ? <ActivityIndicator size="small" color={C.orange} /> : <Icon name="swap" size={15} color={C.muted} strokeWidth={2.2} />}
        </Pressable>
      </View>

      {/* Messages */}
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
        {messages.length === 0 ? (
          <View style={{ paddingTop: 30, gap: 14 }}>
            <Body style={{ fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 20 }}>
              Ask anything about your assigned clients: their QHP reports, blood work, sessions, packages, medical history or follow-ups. Answers come from your synced client data.
            </Body>
            <View style={{ gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => ask(s)} style={{ paddingVertical: 11, paddingHorizontal: 14, borderRadius: 13, backgroundColor: hexA(C.orange, 0.07), borderWidth: 1, borderColor: hexA(C.orange, 0.22) }}>
                  <Body style={{ fontSize: 12.5, color: '#fff' }}>{s}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m, i) => (
            <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <View style={{
                padding: 12, borderRadius: 15,
                borderTopRightRadius: m.role === 'user' ? 4 : 15, borderTopLeftRadius: m.role === 'user' ? 15 : 4,
                backgroundColor: m.role === 'user' ? hexA(C.orange, 0.14) : m.error ? hexA(C.red, 0.1) : 'rgba(24,17,14,0.72)',
                borderWidth: 1, borderColor: m.role === 'user' ? hexA(C.orange, 0.3) : m.error ? hexA(C.red, 0.32) : 'rgba(255,255,255,0.08)',
              }}>
                <Text selectable style={{ fontFamily: F.body, fontSize: 13.5, lineHeight: 20, color: m.error ? '#E8A79A' : '#fff' }}>{m.text}</Text>
              </View>
              {m.error ? (
                <Pressable onPress={() => { const lastQ = [...messages].reverse().find((x) => x.role === 'user'); if (lastQ) { setMessages((prev) => prev.filter((x) => x !== m)); ask(lastQ.text); } }} style={{ alignSelf: 'flex-start', marginTop: 5, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.red }}>Retry</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
        {sending ? (
          <View style={{ alignSelf: 'flex-start', padding: 12, borderRadius: 15, borderTopLeftRadius: 4, backgroundColor: 'rgba(24,17,14,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <TypingDots />
          </View>
        ) : null}
      </ScrollView>

      {/* Input bar */}
      {/* Android edge-to-edge defeats adjustResize, so the input bar lifts itself by the
          measured keyboard height on BOTH platforms (Android adds its nav inset back). */}
      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: (kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : insets.bottom) + 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(10,7,6,0.92)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
          <View style={{ flex: 1, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.11)', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 13, paddingVertical: Platform.OS === 'ios' ? 11 : 3 }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your clients…"
              placeholderTextColor={C.muted3}
              multiline
              style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', maxHeight: 110, paddingTop: 0, paddingBottom: 0 }}
            />
          </View>
          <Pressable
            onPress={() => ask()}
            disabled={!input.trim() || sending}
            style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: input.trim() && !sending ? C.orange : 'rgba(255,255,255,0.07)' }}
          >
            <Icon name="send" size={16} color={input.trim() && !sending ? '#1A0F08' : C.muted3} strokeWidth={2.4} />
          </Pressable>
        </View>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textAlign: 'center', marginTop: 7 }}>ANSWERS COME FROM YOUR SYNCED CLIENT DATA. VERIFY BEFORE ACTING.</Mono>
      </View>
    </View>
  );
}
