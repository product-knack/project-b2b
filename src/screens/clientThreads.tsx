import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, ScrollView, Keyboard, Platform, Animated, PanResponder, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backSwipeLock } from '../gestureLock';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Serif, Body, Mono, Avatar } from '../components/primitives';
import { Page } from './common';
import { chatInitials, avatarColors } from '../lib/chatQueries';
import {
  useClientThreadList, useOpenClientThread, useClientThreadMessages, useClientThreadRealtime,
  useSendClientThreadMessage, useMarkClientThreadRead, useClientThreadTeam, ClientThreadMessage,
} from '../lib/clientThreadQueries';

/* ============ CLIENT THREADS — dedicated internal team chat ============
   One thread per client on its own backend (client_threads tables), fully
   separated from the messenger. Visible ONLY to the client's assigned team
   (trainer_clients, actively_training) + admins — never the client. */

const relTime = (iso: string | null) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
const msgTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const msgDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

export function ClientThreads() {
  const { session, dbRole } = useAuth();
  const meId = session?.user?.id ?? '';
  const { go, back, canGoBack, role, set } = useStore();
  const homeRoute = role === 'crm' ? 'crm-dashboard' : role === 'coach' ? 'coach-dashboard' : role === 'ops' ? 'ops-dashboard' : role === 'admin' ? 'admin-dashboard' : role === 'doctor' ? 'doctor-dashboard' : role === 'marketing' ? 'marketing-dashboard' : 'dashboard';

  const listQ = useClientThreadList(meId, dbRole);
  const openM = useOpenClientThread();
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [sel, setSel] = React.useState<{ threadId: string; clientId: string; name: string } | null>(null);

  // Hide the floating home bar while a thread chat is fullscreen (it would sit
  // on top of the composer). Restored on back and on unmount.
  React.useEffect(() => {
    set({ threadViewOpen: !!sel });
    return () => set({ threadViewOpen: false });
  }, [!!sel]);

  // One-time intro: shown the FIRST time this user ever opens a client thread.
  const [introOpen, setIntroOpen] = React.useState(false);
  React.useEffect(() => {
    if (!sel) return;
    AsyncStorage.getItem('client-threads:intro-seen')
      .then((seen) => { if (!seen) setIntroOpen(true); })
      .catch(() => {});
  }, [!!sel]);
  const dismissIntro = () => {
    setIntroOpen(false);
    AsyncStorage.setItem('client-threads:intro-seen', '1').catch(() => {});
  };

  const open = async (clientId: string, name: string, threadId: string | null) => {
    if (openingId) return;
    if (threadId) { setSel({ threadId, clientId, name }); return; }
    setOpeningId(clientId);
    try {
      const id = await openM.mutateAsync(clientId);
      setSel({ threadId: id, clientId, name });
    } catch { /* list shows nothing; retry on next tap */ } finally {
      setOpeningId(null);
    }
  };

  if (sel) {
    return (
      <>
        <ThreadView meId={meId} meRole={dbRole} threadId={sel.threadId} clientId={sel.clientId} clientName={sel.name} onBack={() => setSel(null)} />
        {/* First-open intro — centralised internal comms, invisible to clients */}
        <Modal visible={introOpen} transparent animationType="fade" onRequestClose={dismissIntro}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
            <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.purple, 0.3), borderRadius: 22, overflow: 'hidden' }}>
              <View style={{ height: 3, backgroundColor: hexA(C.purple, 0.55) }} />
              <View style={{ padding: 22, alignItems: 'center', gap: 12 }}>
                <View style={{ width: 58, height: 58, borderRadius: 20, backgroundColor: hexA(C.purple, 0.12), borderWidth: 1, borderColor: hexA(C.purple, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="shield" size={26} color={C.purple} strokeWidth={1.9} />
                </View>
                <Serif style={{ fontSize: 20, textAlign: 'center' }}>Client Threads</Serif>
                <Body style={{ fontSize: 13, color: C.ink3, textAlign: 'center', lineHeight: 20 }}>
                  This is the centralised communication system for the Odds internal team.
                </Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
                  <Icon name="eye" size={13} color={C.green} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#9ED8B5' }}>Clients are NOT able to see this.</Text>
                </View>
                <Pressable onPress={dismissIntro} style={{ alignSelf: 'stretch', alignItems: 'center', marginTop: 4, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.purple, 0.16), borderWidth: 1, borderColor: hexA(C.purple, 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.purple }}>Got it</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const rows = (listQ.data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));

  return (
    <Page gap={14} pt={6}>
      <Pressable onPress={() => (canGoBack ? back() : go(homeRoute))} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="arrowLeft" size={16} color={C.ink2} strokeWidth={2.2} />
        <Body style={{ fontSize: 13.5, color: C.ink2 }}>Back</Body>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(C.purple, 0.14), borderWidth: 1, borderColor: hexA(C.purple, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="atSign" size={20} color={C.purple} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 24 }}>Client Threads</Serif>
          <Body style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>Internal team notes per client — never visible to the client</Body>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={16} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14.5, color: '#fff', padding: 0 }} />
      </View>

      {listQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <ActivityIndicator color={C.purple} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading clients…</Body>
        </View>
      ) : listQ.isError ? (
        <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center', paddingVertical: 26 }}>{(listQ.error as Error).message}</Body>
      ) : rows.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <Icon name="users" size={26} color="#4C4640" strokeWidth={1.6} />
          <Body style={{ fontSize: 13, color: C.muted3 }}>No active clients{query ? ' match your search' : ''}.</Body>
        </View>
      ) : (
        rows.map((r) => {
          const opening = openingId === r.clientId;
          return (
            <Pressable key={r.clientId} onPress={() => open(r.clientId, r.name, r.threadId)} disabled={!!openingId} style={{ borderRadius: 16, backgroundColor: r.unread ? hexA(C.purple, 0.07) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: r.unread ? hexA(C.purple, 0.3) : 'rgba(255,255,255,0.07)', overflow: 'hidden', opacity: openingId && !opening ? 0.6 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 }}>
                <Avatar initial={chatInitials(r.name)} size={46} colors={avatarColors(r.name)} fontSize={16} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: r.unread ? F.bodyBold : F.bodySemi, color: '#fff' }}>{r.name}</Body>
                    {r.lastMessageAt ? <Mono style={{ fontSize: 9.5, color: r.unread ? C.purple : C.muted3 }}>{relTime(r.lastMessageAt)}</Mono> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: r.unread ? C.ink3 : C.muted2 }}>
                      {opening ? 'Opening thread…' : r.threadId ? (r.lastMessage || 'No messages yet') : 'Start the team thread'}
                    </Body>
                    {r.unread ? (
                      <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }}>{r.unread > 99 ? '99+' : r.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {opening ? <ActivityIndicator size="small" color={C.purple} /> : <Icon name="chevRight" size={16} color={C.muted} strokeWidth={2.2} />}
              </View>
            </Pressable>
          );
        })
      )}
    </Page>
  );
}

/* ---------- Thread view: gradient header, animated bubbles, floating composer ---------- */
const ROLE_COLOR: Record<string, string> = { crm: C.gold, trainer: C.orange, doctor: C.blue, coach: C.green, admin: C.red, super_admin: C.red };
const roleColorOf = (r: string | null) => ROLE_COLOR[r ?? ''] ?? C.purple;

/* ---------- WhatsApp-style swipe-to-reply (same behavior as the messenger) ---------- */
function SwipeReplyRow({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: React.ReactNode }) {
  const tx = React.useRef(new Animated.Value(0)).current;
  const fired = React.useRef(false);
  const enabledRef = React.useRef(enabled); enabledRef.current = enabled;
  const onReplyRef = React.useRef(onReply); onReplyRef.current = onReply;
  const springBack = () => Animated.spring(tx, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 5 }).start();
  const pan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => enabledRef.current && g.dx > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderGrant: () => { backSwipeLock.locked = true; fired.current = false; },
      onPanResponderMove: (_e, g) => {
        const v = Math.max(0, Math.min(g.dx, 76));
        tx.setValue(v);
        if (v > 52 && !fired.current) {
          fired.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      },
      onPanResponderRelease: (_e, g) => {
        backSwipeLock.locked = false;
        if (g.dx > 52) onReplyRef.current();
        springBack();
      },
      onPanResponderTerminate: () => { backSwipeLock.locked = false; springBack(); },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;
  const iconOpacity = tx.interpolate({ inputRange: [0, 24, 60], outputRange: [0, 0.25, 1] });
  const iconScale = tx.interpolate({ inputRange: [0, 60], outputRange: [0.6, 1], extrapolate: 'clamp' });
  return (
    <View {...pan.panHandlers}>
      <Animated.View style={{ position: 'absolute', left: 6, top: 0, bottom: 0, justifyContent: 'center', opacity: iconOpacity, transform: [{ scale: iconScale }] }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.35), alignItems: 'center', justifyContent: 'center' }}>
          <Icon path="M9 17l-5-5 5-5M4 12h10a5 5 0 0 1 5 5v2" size={15} color={C.orange} strokeWidth={2.2} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: tx }] }}>{children}</Animated.View>
    </View>
  );
}

/* ---------- @mention rendering: highlight "@Full Name" (team) or "@word" ---------- */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function MentionText({ text, names, style, highlight }: { text: string; names: string[]; style: any; highlight: string }) {
  const parts = React.useMemo(() => {
    if (!text || !text.includes('@')) return null;
    const namePat = names.length ? names.map(escapeRe).sort((a, b) => b.length - a.length).join('|') : null;
    const re = new RegExp(namePat ? `@(?:${namePat})|@[\\w.]+` : '@[\\w.]+', 'g');
    const out: { t: string; m: boolean }[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (match.index > last) out.push({ t: text.slice(last, match.index), m: false });
      out.push({ t: match[0], m: true });
      last = match.index + match[0].length;
    }
    if (!out.some((p) => p.m)) return null;
    if (last < text.length) out.push({ t: text.slice(last), m: false });
    return out;
  }, [text, names]);
  if (!parts) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {parts.map((p, i) => (p.m ? <Text key={i} style={{ fontFamily: F.bodyBold, color: highlight }}>{p.t}</Text> : p.t))}
    </Text>
  );
}

/* Spring-in wrapper for messages that arrive while the thread is open. */
function MsgIn({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  React.useEffect(() => {
    if (animate) Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 7 }).start();
  }, []);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

function ThreadView({ meId, meRole, threadId, clientId, clientName, onBack }: {
  meId: string; meRole: string | null; threadId: string; clientId: string; clientName: string; onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const msgsQ = useClientThreadMessages(threadId);
  const teamQ = useClientThreadTeam(clientId);
  const sendM = useSendClientThreadMessage(meId, 'You', meRole);
  const markRead = useMarkClientThreadRead();
  useClientThreadRealtime(threadId);
  const [text, setText] = React.useState('');
  const [replyTo, setReplyTo] = React.useState<ClientThreadMessage | null>(null);
  const scrollRef = React.useRef<ScrollView>(null);

  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  // Animate only messages that appear AFTER the initial load.
  const seenIds = React.useRef<Set<string> | null>(null);
  const msgs = msgsQ.data ?? [];
  const isNew = (id: string) => (seenIds.current ? !seenIds.current.has(id) : false);
  React.useEffect(() => {
    if (!msgsQ.data) return;
    if (!seenIds.current) seenIds.current = new Set(msgsQ.data.map((m) => m.id));
    else msgsQ.data.forEach((m) => seenIds.current!.add(m.id));
  }, [msgsQ.data]);

  // Mark read on open and whenever new messages arrive while viewing.
  React.useEffect(() => { if (threadId) markRead.mutate({ threadId }); }, [threadId, msgs.length]);

  const send = () => {
    const body = text.trim();
    if (!body || sendM.isPending) return;
    const quoted = replyTo;
    setText('');
    setReplyTo(null);
    sendM.mutate({ threadId, body, replyToId: quoted?.id ?? null }, { onError: () => { setText(body); setReplyTo(quoted); } });
  };

  const team = teamQ.data ?? [];
  const mentionNames = React.useMemo(() => team.map((m) => m.name), [team]);
  const msgById = React.useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);

  // @mention typing: an "@word" at the end of the draft opens the picker.
  const mentionMatch = /(^|\s)@(\w*)$/.exec(text);
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null;
  const mentionSuggestions = React.useMemo(() => {
    if (mentionQuery == null) return [];
    return team
      .filter((m) => m.userId !== meId)
      .filter((m) => !mentionQuery || m.name.toLowerCase().includes(mentionQuery))
      .slice(0, 4);
  }, [mentionQuery, team, meId]);
  const applyMention = (name: string) => setText((d) => d.replace(/(^|\s)@\w*$/, `$1@${name} `));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 4, paddingBottom: kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : Math.max(insets.bottom, 8) }}>
      {/* ===== Header — gradient hero with team strip ===== */}
      <View style={{ marginHorizontal: 12, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.purple, 0.2) }}>
        <LinearGradient colors={['rgba(48,36,66,0.55)', 'rgba(18,14,20,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ padding: 13, gap: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
            <Pressable onPress={onBack} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="arrowLeft" size={16} color="#fff" strokeWidth={2.2} />
            </Pressable>
            <View style={{ padding: 2, borderRadius: 24, borderWidth: 1.5, borderColor: hexA(C.purple, 0.5) }}>
              <Avatar initial={chatInitials(clientName)} size={40} colors={avatarColors(clientName)} fontSize={15} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }} numberOfLines={1}>{clientName}</Serif>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Icon name="shield" size={10} color={C.purple} strokeWidth={2.2} />
                <Body style={{ fontSize: 10.5, color: hexA(C.purple, 0.95) }}>Internal · client can't see this</Body>
              </View>
            </View>
            {team.length ? (
              <View style={{ alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.purple }}>{team.length}</Text>
                <Mono style={{ fontSize: 6.5, letterSpacing: 0.7, color: C.muted3 }}>TEAM</Mono>
              </View>
            ) : null}
          </View>
          {team.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {team.map((m) => {
                const rc = roleColorOf(m.role);
                return (
                  <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4.5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(rc, 0.08), borderWidth: 1, borderColor: hexA(rc, 0.28) }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: rc }} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: '#EDE7E1' }}>{m.name}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 7.5, color: rc }}>{m.roleLabel.toUpperCase()}</Text>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}
        </LinearGradient>
      </View>

      {/* ===== Messages ===== */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, flexGrow: 1 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {msgsQ.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color={C.purple} />
            <Body style={{ fontSize: 12, color: C.muted3 }}>Loading thread…</Body>
          </View>
        ) : msgs.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 34 }}>
            <View style={{ width: 58, height: 58, borderRadius: 20, backgroundColor: hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, 0.25), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="bubble" size={25} color={C.purple} strokeWidth={1.7} />
            </View>
            <Serif style={{ fontSize: 17, textAlign: 'center' }}>Start the conversation</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', lineHeight: 18 }}>
              Share updates, hand-offs and notes about {clientName.split(' ')[0]} — the whole care team sees them here.
            </Body>
          </View>
        ) : (
          msgs.map((m, i) => (
            <MsgIn key={m.id} animate={isNew(m.id)}>
              <SwipeReplyRow enabled={!m.id.startsWith('temp-')} onReply={() => setReplyTo(m)}>
                <Bubble m={m} mine={m.senderId === meId} prev={msgs[i - 1]} pending={m.id.startsWith('temp-')} quoted={m.replyToId ? msgById.get(m.replyToId) ?? null : null} mentionNames={mentionNames} />
              </SwipeReplyRow>
            </MsgIn>
          ))
        )}
      </ScrollView>

      {/* ===== Composer — floating pill ===== */}
      <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
        {sendM.isError ? (
          <Body style={{ fontSize: 11, color: C.red, paddingHorizontal: 6, paddingBottom: 5 }}>{(sendM.error as Error).message}</Body>
        ) : null}

        {/* @mention suggestions while typing "@name" */}
        {mentionSuggestions.length > 0 ? (
          <View style={{ marginBottom: 7, borderRadius: 16, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.purple, 0.25), overflow: 'hidden' }}>
            {mentionSuggestions.map((m, i) => {
              const rc = roleColorOf(m.role);
              return (
                <Pressable key={m.userId} onPress={() => applyMention(m.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 13, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hexA(rc, 0.14), borderWidth: 1, borderColor: hexA(rc, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: rc }}>{chatInitials(m.name)}</Text>
                  </View>
                  <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>{m.name}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 8, color: rc }}>{m.roleLabel.toUpperCase()}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Reply preview bar */}
        {replyTo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 7, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(C.orange, 0.25) }}>
            <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.orange }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.orange }}>Replying to {replyTo.senderId === meId ? 'yourself' : replyTo.senderName}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12.5, color: C.muted2, marginTop: 1 }}>{replyTo.body ?? 'Message'}</Text>
            </View>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 6, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: text.trim() ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.09)' }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message the team about ${clientName.split(' ')[0]}…`}
            placeholderTextColor={C.muted3}
            multiline
            style={{ flex: 1, maxHeight: 110, paddingVertical: 9, paddingHorizontal: 12, color: '#fff', fontFamily: F.body, fontSize: 14.5, lineHeight: 20 }}
          />
          <Pressable onPress={send} disabled={!text.trim() || sendM.isPending} style={{ borderRadius: 20, overflow: 'hidden' }}>
            {text.trim() ? (
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={16} color="#fff" strokeWidth={2.2} />
              </LinearGradient>
            ) : (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={16} color={C.muted3} strokeWidth={2} />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Bubble({ m, mine, prev, pending, quoted, mentionNames }: {
  m: ClientThreadMessage; mine: boolean; prev?: ClientThreadMessage; pending?: boolean;
  quoted?: ClientThreadMessage | null; mentionNames?: string[];
}) {
  const newDay = !prev || msgDay(prev.createdAt) !== msgDay(m.createdAt);
  const newSender = newDay || !prev || prev.senderId !== m.senderId;
  const rc = roleColorOf(m.senderRole);
  // Quoted block rendered inside the bubble when this message is a reply.
  const quote = m.replyToId ? (
    <View style={{ flexDirection: 'row', borderRadius: 10, overflow: 'hidden', backgroundColor: mine ? 'rgba(0,0,0,0.24)' : 'rgba(255,255,255,0.05)', marginBottom: 6, minWidth: 170 }}>
      <View style={{ width: 3, backgroundColor: mine ? '#FFE9D2' : C.orange }} />
      <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 9 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: mine ? '#FFE9D2' : C.orange }}>{quoted?.senderName ?? 'Message'}</Text>
        <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 11.5, lineHeight: 15, color: mine ? 'rgba(255,255,255,0.85)' : C.muted2, marginTop: 1 }}>{quoted?.body ?? '…'}</Text>
      </View>
    </View>
  ) : null;
  return (
    <View>
      {newDay ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
          <View style={{ paddingVertical: 3.5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted2 }}>{msgDay(m.createdAt).toUpperCase()}</Mono>
          </View>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: newSender ? 10 : 3 }}>
        {/* Sender avatar (others only, first message of a run) */}
        {!mine ? (
          <View style={{ width: 34, marginRight: 8, alignItems: 'center' }}>
            {newSender ? (
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: hexA(rc, 0.14), borderWidth: 1, borderColor: hexA(rc, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: rc }}>{chatInitials(m.senderName)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ maxWidth: '78%' }}>
          {!mine && newSender ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, marginLeft: 3 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: rc }}>{m.senderName}</Text>
              {m.senderRole ? <Text style={{ fontFamily: F.mono, fontSize: 7.5, color: C.muted3 }}>{(m.senderRole === 'super_admin' ? 'admin' : m.senderRole).toUpperCase()}</Text> : null}
            </View>
          ) : null}
          {mine ? (
            <View style={{ borderRadius: 18, borderBottomRightRadius: 6, overflow: 'hidden', opacity: pending ? 0.65 : 1 }}>
              <LinearGradient colors={['rgba(240,120,60,0.28)', 'rgba(200,80,40,0.16)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, borderBottomRightRadius: 6, borderWidth: 1, borderColor: hexA(C.orange, 0.32) }}>
                {quote}
                {m.body ? <MentionText text={m.body} names={mentionNames ?? []} highlight="#FFE9D2" style={{ fontFamily: F.body, fontSize: 14.5, color: '#FFF4EC', lineHeight: 20 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: 3 }}>
                  <Mono style={{ fontSize: 8, color: hexA('#FFD9BF', 0.65) }}>{msgTime(m.createdAt)}</Mono>
                  {pending ? <Icon name="clock" size={9} color={hexA('#FFD9BF', 0.65)} strokeWidth={2.2} /> : <Icon name="checks" size={10} color={hexA('#FFD9BF', 0.8)} strokeWidth={2.2} />}
                </View>
              </LinearGradient>
            </View>
          ) : (
            <View style={{ paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, borderBottomLeftRadius: newSender ? 6 : 18, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              {quote}
              {m.body ? <MentionText text={m.body} names={mentionNames ?? []} highlight={C.orange} style={{ fontFamily: F.body, fontSize: 14.5, color: '#F2EDE8', lineHeight: 20 }} /> : null}
              <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 3, alignSelf: 'flex-end' }}>{msgTime(m.createdAt)}</Mono>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
