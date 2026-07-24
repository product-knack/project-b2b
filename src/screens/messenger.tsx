import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, FlatList, ScrollView, Alert, Keyboard, Platform, Animated, Image, Linking, Vibration, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Audio, Video, ResizeMode } from 'expo-av';
import { WebView } from 'react-native-webview';

/* Short recording cues (WhatsApp-style blips) — tiny bundled WAVs. Resolves when
   the blip finishes so the START cue can complete BEFORE the recorder claims the
   audio route (an active Android recording session silences playback — the
   original cause of "no tone"). */
const REC_CUES = {
  start: require('../../assets/sounds/rec-start.wav'),
  end: require('../../assets/sounds/rec-end.wav'),
} as const;
async function playCue(kind: keyof typeof REC_CUES): Promise<void> {
  try {
    // Ensure PLAYBACK mode — if the last action was a recording, the mode may
    // still be capture-oriented and the blip would be inaudible.
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(REC_CUES[kind], { shouldPlay: true, volume: 1.0 });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 700); // never hang on a missed callback
      sound.setOnPlaybackStatusUpdate((st: any) => {
        if (st?.didJustFinish || st?.error) { clearTimeout(t); sound.unloadAsync().catch(() => {}); resolve(); }
      });
    });
  } catch { /* cue is cosmetic — never block recording */ }
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { Serif, Body, Mono, Avatar } from '../components/primitives';
import { Page } from './common';
import { SheetShell } from './reportDetail';
import { supabase } from '../lib/supabase';
import { istTimeParts } from '../lib/trainerQueries';
import { PanResponder } from 'react-native';
import { backSwipeLock, backOverride } from '../gestureLock';
import { useQueryClient } from '@tanstack/react-query';
import {
  useChatOverview, useMessageThread, useChatProfiles, useMarkConversationRead, useTeamRoster,
  useSendMessage, useSendMedia, useOpenOrCreateDm, useThreadMembers,
  useCrmMessengerClients, useClientGroups, useConversationReads,
  ChatConversation, ChatMessage, MessengerClient, TeamMember, ConversationRead, ClientGroup, chatInitials, avatarColors, displayGroupName,
} from '../lib/chatQueries';

/* ============ MESSENGER (Phase 2 — read path) ============
   List via get_conversation_overview (unread badges), thread via a keyset
   infinite query on get_messages_page in an inverted FlashList. Read-only:
   sends/realtime/ticks land in Phase 3. Obsidian surfaces, ember as the single
   accent (own bubble + unread pill). */

const relTime = (iso: string | null) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const y = new Date(today.getTime() - 864e5);
  const isYest = d.toDateString() === y.toDateString();
  if (isToday) return 'Today';
  if (isYest) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
};

/* ---------- WhatsApp-style swipe-to-reply row ----------
   Swipe a bubble right: a reply icon fades in behind it; past the threshold a
   light haptic fires and releasing starts a reply. Vertical scrolling and taps
   on the bubble are untouched (the pan only claims clear horizontal drags). */
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

/* ---------- @mention rendering: highlight "@Full Name" (known members) or "@word" ---------- */
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

/* ---------- Thread ---------- */
function MessageThread({ meId, conv, onBack, subtabs }: { meId: string; conv: ChatConversation; onBack: () => void; subtabs?: { view: 'direct' | 'group'; hasDirect: boolean; onChange: (v: 'direct' | 'group') => void } }) {
  const insets = useSafeAreaInsets();
  const thread = useMessageThread(conv.conversationId);
  const markRead = useMarkConversationRead();
  const sendM = useSendMessage(conv.conversationId, meId);
  const mediaM = useSendMedia(conv.conversationId, meId);
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState('');
  const isGroup = conv.type !== 'direct';
  const isReadOnly = conv.isAnnouncements; // non-admins can't post to announcements
  // Member-backed conversations (staff client thread + client care-team group):
  // show the roster in the header + power @mentions + enable "seen by".
  const showMembers = conv.type === 'group' && !conv.isAnnouncements;
  // Members power the header AND @mentions (any group chat).
  const membersQ = useThreadMembers(conv.conversationId, isGroup);
  const [membersOpen, setMembersOpen] = React.useState(false);
  // Read receipts — who has seen a given message (long-press a bubble).
  const readsQ = useConversationReads(conv.conversationId, showMembers);
  const [seenMsg, setSeenMsg] = React.useState<(ChatMessage & { _pending?: boolean }) | null>(null);
  React.useEffect(() => { setSeenMsg(null); }, [conv.conversationId]);
  // In-app media viewer (image / video / document) — never leaves the app.
  const [viewer, setViewer] = React.useState<{ kind: string; url: string } | null>(null);
  const memberNames = React.useMemo(() => (membersQ.data ?? []).map((m) => m.name.split(' ')[0]).join(', '), [membersQ.data]);
  const mentionNames = React.useMemo(() => (membersQ.data ?? []).map((m) => m.name), [membersQ.data]);

  // @mention typing: an "@word" being typed at the end of the draft opens the picker.
  const mentionMatch = isGroup && !isReadOnly ? /(^|\s)@(\w*)$/.exec(draft) : null;
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null;
  const mentionSuggestions = React.useMemo(() => {
    if (mentionQuery == null) return [];
    return (membersQ.data ?? [])
      .filter((m) => m.userId !== meId)
      .filter((m) => !mentionQuery || m.name.toLowerCase().includes(mentionQuery))
      .slice(0, 5);
  }, [mentionQuery, membersQ.data, meId]);
  const applyMention = (name: string) => setDraft((d) => d.replace(/(^|\s)@\w*$/, `$1@${name} `));

  // Manual keyboard height — reliable on Android edge-to-edge where KeyboardAvoidingView isn't.
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  // Comfortable gap above the keyboard; safe-area inset when closed.
  // Android edge-to-edge under-reports keyboard height by the bottom system-bar
  // inset (the window extends beneath the nav bar) — add it back.
  const kbLift = kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : 0;
  const composerPadBottom = kbLift > 0 ? kbLift + 14 : insets.bottom + 12;

  const messages = React.useMemo(() => (thread.data?.pages.flat() ?? []) as (ChatMessage & { _pending?: boolean })[], [thread.data]);
  const senderIds = React.useMemo(() => [...new Set(messages.map((m) => m.sender_id))], [messages]);
  const profiles = useChatProfiles(isGroup ? senderIds : []);
  // Swipe-to-reply: the message being replied to (WhatsApp-style).
  const [replyTo, setReplyTo] = React.useState<(ChatMessage & { _pending?: boolean }) | null>(null);
  React.useEffect(() => { setReplyTo(null); }, [conv.conversationId]);
  const msgById = React.useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const quoteName = React.useCallback((senderId: string) =>
    senderId === meId ? 'You' : (profiles.data?.[senderId]?.name ?? (conv.type === 'direct' ? conv.title : 'Member')), [meId, profiles.data, conv]);
  const quoteText = (m: ChatMessage | undefined) => !m
    ? 'Original message unavailable'
    : m.message_type !== 'text'
      ? ({ image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', document: '📄 Document' }[m.message_type] ?? m.message)
      : m.message;

  // Clear unread on open (own participant row only).
  React.useEffect(() => {
    if (conv.unreadCount) markRead.mutate({ conversationId: conv.conversationId, meId });
  }, [conv.conversationId]);

  // Realtime: append new messages straight from the payload (no refetch → instant,
  // zero network). Server-filtered by conversation_id, RLS-scoped. Deduped by id,
  // so my own optimistic bubble isn't duplicated when its INSERT echoes back.
  React.useEffect(() => {
    const ch = supabase
      .channel(`thread-${conv.conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conv.conversationId}` }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!m || m.is_deleted) return;
        qc.setQueryData(['chat-thread', conv.conversationId], (old: any) => {
          if (!old) return old;
          if (old.pages.some((pg: ChatMessage[]) => pg.some((x) => x.id === m.id))) return old;
          const pages = [...old.pages];
          pages[0] = [m, ...pages[0]];
          return { ...old, pages };
        });
        if (m.sender_id !== meId) markRead.mutate({ conversationId: conv.conversationId, meId });
        qc.invalidateQueries({ queryKey: ['chat-overview', meId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conv.conversationId, meId]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    sendM.mutate({ text: t, replyToId: replyTo?.id ?? null });
    setReplyTo(null);
  };

  /* ---- Voice notes (B2C interop): WhatsApp-style hold-to-record. Hold the mic →
     start cue + the button swells; slide LEFT past the threshold → cancel; release
     → end cue + send through the same chat-media pipeline the client app uses
     (<conv>/<msgId>-voice-<ts>.m4a, message_type='voice', 1-year signed URL). */
  const recRef = React.useRef<Audio.Recording | null>(null);
  const [recording, setRecording] = React.useState(false);
  const recordingRef = React.useRef(false);
  const [recMs, setRecMs] = React.useState(0);
  const recMsRef = React.useRef(0);
  const recTimer = React.useRef<any>(null);
  const micScale = React.useRef(new Animated.Value(1)).current;
  const micDrag = React.useRef(new Animated.Value(0)).current;
  const CANCEL_PX = 90;
  // Cancel feedback: a transient "Recording deleted" flash (trash icon drops in,
  // fades out) where the recording strip was — WhatsApp-style confirmation.
  const [showDeleted, setShowDeleted] = React.useState(false);
  const delAnim = React.useRef(new Animated.Value(0)).current;
  const flashDeleted = () => {
    setShowDeleted(true);
    delAnim.setValue(0);
    Animated.timing(delAnim, { toValue: 1, duration: 900, useNativeDriver: true }).start(() => setShowDeleted(false));
  };
  React.useEffect(() => () => { clearTimeout(recTimer.current); recRef.current?.stopAndUnloadAsync().catch(() => {}); }, []);
  const tickRec = (startedAt: number) => {
    recMsRef.current = Date.now() - startedAt;
    setRecMs(recMsRef.current);
    recTimer.current = setTimeout(() => tickRec(startedAt), 250);
  };
  const micRest = () => {
    Animated.parallel([
      Animated.spring(micScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
      Animated.timing(micDrag, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start();
  };
  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { recordingRef.current = false; micRest(); Alert.alert('Microphone needed', 'Allow microphone access to record voice messages.'); return; }
      // START blip plays FIRST and fully — recording only begins after, so the
      // tone is audible (and never captured into the note). WhatsApp order.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await playCue('start');
      if (!recordingRef.current) return; // finger lifted during the blip
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      if (!recordingRef.current) { rec.stopAndUnloadAsync().catch(() => {}); Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => {}); return; }
      recRef.current = rec;
      setRecording(true);
      tickRec(Date.now());
    } catch (e: any) { recordingRef.current = false; micRest(); Alert.alert('Could not start recording', e?.message ?? 'Unknown error'); }
  };
  const stopRecording = async (sendIt: boolean) => {
    const rec = recRef.current;
    recRef.current = null;
    clearTimeout(recTimer.current);
    setRecording(false);
    const elapsed = recMsRef.current;
    recMsRef.current = 0;
    setRecMs(0);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const uri = rec.getURI();
      if (!sendIt || !uri) return;
      if (elapsed < 800) { Alert.alert('Too short', 'Hold the mic a moment longer to record a voice message.'); return; }
      playCue('end');
      mediaM.mutate(
        { uri, name: `voice-${Date.now()}.m4a`, mime: 'audio/m4a', size: null },
        { onError: (e: any) => Alert.alert('Send failed', e?.message || 'Please try again.') }
      );
    } catch (e: any) { if (sendIt) Alert.alert('Recording failed', e?.message ?? 'Unknown error'); }
  };
  // Hold gesture — the PanResponder is created once; latest handlers via refs.
  const beginHoldRef = React.useRef(() => {});
  const moveHoldRef = React.useRef((_dx: number) => {});
  const endHoldRef = React.useRef(() => {});
  beginHoldRef.current = () => {
    if (recordingRef.current || draft.trim()) return;
    recordingRef.current = true;
    Animated.spring(micScale, { toValue: 1.45, useNativeDriver: true, speed: 24, bounciness: 8 }).start();
    startRecording();
  };
  moveHoldRef.current = (dx: number) => {
    if (!recordingRef.current) return;
    const x = Math.min(0, dx);
    micDrag.setValue(x);
    if (x < -CANCEL_PX) {
      // Slid past the threshold → cancel (WhatsApp behaviour) + deleted flash.
      recordingRef.current = false;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      stopRecording(false);
      flashDeleted();
      micRest();
    }
  };
  endHoldRef.current = () => {
    if (!recordingRef.current) { micRest(); return; }
    recordingRef.current = false;
    stopRecording(true);
    micRest();
  };
  const micPan = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => beginHoldRef.current(),
    onPanResponderMove: (_e, g) => moveHoldRef.current(g.dx),
    onPanResponderRelease: () => endHoldRef.current(),
    onPanResponderTerminate: () => endHoldRef.current(),
  })).current;

  const pickImageVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to send photos and videos.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    const mime = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const name = a.fileName || (mime.startsWith('video') ? 'video.mp4' : 'photo.jpg');
    mediaM.mutate({ uri: a.uri, name, mime, size: (a as any).fileSize ?? null }, { onError: (e: any) => Alert.alert('Upload failed', e?.message || 'Please try again.') });
  };
  const pickDocument = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    mediaM.mutate({ uri: a.uri, name: a.name || 'document.pdf', mime: a.mimeType || 'application/pdf', size: a.size ?? null }, { onError: (e: any) => Alert.alert('Upload failed', e?.message || 'Please try again.') });
  };
  const attach = () => {
    Alert.alert('Send attachment', undefined, [
      { text: 'Photo or Video', onPress: pickImageVideo },
      { text: 'Document (PDF)', onPress: pickDocument },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderItem = React.useCallback(({ item, index }: { item: ChatMessage & { _pending?: boolean }; index: number }) => {
    const mine = item.sender_id === meId;
    // messages are newest-first; in an inverted list, the visually-previous row is index+1.
    const prev = messages[index + 1];
    const showDay = !prev || dayLabel(prev.created_at) !== dayLabel(item.created_at);
    const tp = istTimeParts(item.created_at);
    const senderName = isGroup && !mine ? (profiles.data?.[item.sender_id]?.name ?? '') : '';
    const preview = item.message_type !== 'text'
      ? ({ image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice message', document: '📄 Document' }[item.message_type] ?? item.message)
      : item.message;
    const isMedia = item.message_type !== 'text' && !!item.attachment_url;
    const openMedia = () => { if (item.attachment_url && !item._pending) setViewer({ kind: item.message_type ?? 'document', url: item.attachment_url }); };
    const timeText = item._pending ? (isMedia ? 'uploading…' : 'sending…') : `${tp.time} ${tp.ampm}`;
    // Long-press a bubble in a group → "seen by" sheet.
    const onBubbleLongPress = () => { if (showMembers && !item._pending) setSeenMsg(item); };
    // Quoted message block (rendered inside the bubble when this message is a reply).
    const quote = item.reply_to_id ? (() => {
      const orig = msgById.get(item.reply_to_id!);
      return (
        // minWidth keeps the quote readable even when the reply text is short
        // (otherwise the bubble shrinks to fit "ok" and crushes the quote).
        <View style={{ flexDirection: 'row', borderRadius: 10, overflow: 'hidden', backgroundColor: mine ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.05)', marginBottom: 6, minWidth: 180 }}>
          <View style={{ width: 3, backgroundColor: mine ? '#FFE9D2' : C.orange }} />
          <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 9 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: mine ? '#FFE9D2' : C.orange }}>{orig ? quoteName(orig.sender_id) : 'Message'}</Text>
            <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 11.5, lineHeight: 15, color: mine ? 'rgba(255,255,255,0.85)' : C.muted2, marginTop: 1 }}>{quoteText(orig)}</Text>
          </View>
        </View>
      );
    })() : null;
    return (
      <View>
        {showDay ? (
          <View style={{ alignItems: 'center', marginVertical: 10 }}>
            <View style={{ paddingVertical: 3, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.muted3 }}>{dayLabel(item.created_at).toUpperCase()}</Mono>
            </View>
          </View>
        ) : null}
        <SwipeReplyRow enabled={!item._pending} onReply={() => setReplyTo(item)}>
        <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 2, paddingHorizontal: 2 }}>
          {senderName ? <Mono style={{ fontSize: 9, color: C.muted3, marginBottom: 2, marginLeft: 6 }}>{senderName}</Mono> : null}
          {isMedia && item.message_type === 'voice' ? (
            <VoiceBubble url={item.attachment_url!} mine={mine} pending={item._pending} timeText={timeText} onLongPress={onBubbleLongPress} />
          ) : isMedia ? (
            <Pressable onPress={openMedia} onLongPress={onBubbleLongPress} delayLongPress={300} style={{ maxWidth: '80%' }}>
              {item.message_type === 'image' ? (
                <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: mine ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.08)' }}>
                  <Image source={{ uri: item.attachment_url! }} style={{ width: 220, height: 220, backgroundColor: 'rgba(255,255,255,0.05)' }} resizeMode="cover" />
                  {item._pending ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}><ActivityIndicator color="#fff" /></View> : null}
                </View>
              ) : item.message_type === 'video' ? (
                <View style={{ width: 220, height: 140, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: mine ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: hexA(C.orange, 0.92), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon path="M8 5v14l11-7z" size={20} color="#fff" strokeWidth={0} fill="#fff" />
                  </View>
                  <Text style={{ position: 'absolute', bottom: 8, left: 10, fontFamily: F.bodySemi, fontSize: 11, color: '#fff' }}>{item._pending ? 'Uploading…' : 'Video'}</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, minWidth: 190, backgroundColor: mine ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: mine ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: hexA(C.red, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="file" size={17} color={C.red} strokeWidth={1.9} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>PDF Document</Body>
                    <Body style={{ fontSize: 11, color: mine ? 'rgba(255,255,255,0.8)' : C.muted3, marginTop: 1 }}>{item._pending ? 'Uploading…' : 'Tap to open'}</Body>
                  </View>
                </View>
              )}
              <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: C.muted3, alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 3 }}>{timeText}</Text>
            </Pressable>
          ) : mine ? (
            <Pressable onLongPress={onBubbleLongPress} delayLongPress={300} style={{ maxWidth: '82%' }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 16, borderBottomRightRadius: 5, paddingVertical: 9, paddingHorizontal: 13, opacity: item._pending ? 0.65 : 1 }}>
                {quote}
                <MentionText text={preview} names={mentionNames} highlight="#FFE9D2" style={{ fontFamily: F.body, fontSize: 14.5, color: '#fff', lineHeight: 20 }} />
                <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: 'rgba(255,255,255,0.75)', alignSelf: 'flex-end', marginTop: 3 }}>{timeText}</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable onLongPress={onBubbleLongPress} delayLongPress={300} style={{ maxWidth: '82%', borderRadius: 16, borderBottomLeftRadius: 5, paddingVertical: 9, paddingHorizontal: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
              {quote}
              <MentionText text={preview} names={mentionNames} highlight={C.orange} style={{ fontFamily: F.body, fontSize: 14.5, color: C.ink, lineHeight: 20 }} />
              <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: C.muted3, alignSelf: 'flex-end', marginTop: 3 }}>{tp.time} {tp.ampm}</Text>
            </Pressable>
          )}
        </View>
        </SwipeReplyRow>
      </View>
    );
  }, [meId, messages, isGroup, showMembers, profiles.data, mentionNames, msgById, quoteName]);

  return (
    <View style={{ flex: 1 }}>
      {/* Header — sits directly under the global app bar (which already owns the
          safe-area inset), so NO insets.top here: that double inset was rendering
          as a tall black band above the chat. */}
      <LinearGradient colors={['#241812', '#120E0D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 10, paddingBottom: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: hexA(C.orange, 0.18), borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.08)' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
          <Icon name="arrowLeft" size={17} color={C.ink2} strokeWidth={2.2} />
        </Pressable>
        {conv.type === 'direct' ? (
          <View style={{ padding: 2, borderRadius: 999, borderWidth: 1.5, borderColor: hexA(avatarColors(conv.title)[0], 0.5) }}>
            <Avatar initial={chatInitials(conv.title)} size={36} colors={avatarColors(conv.title)} fontSize={13} />
          </View>
        ) : (
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(conv.isAnnouncements ? C.gold : C.purple, 0.14), borderWidth: 1.5, borderColor: hexA(conv.isAnnouncements ? C.gold : C.purple, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="users" size={17} color={conv.isAnnouncements ? C.gold : C.purple} strokeWidth={2} />
          </View>
        )}
        <Pressable onPress={() => showMembers && setMembersOpen((o) => !o)} disabled={!showMembers} style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 15.5, fontFamily: F.bodySemi, color: '#fff' }}>{conv.title}</Body>
          {showMembers ? (
            <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>
              {membersQ.isLoading ? 'Loading team…' : memberNames || 'Team thread'}
            </Body>
          ) : conv.subtitle ? (
            <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>{conv.subtitle}</Body>
          ) : null}
        </Pressable>
        {showMembers ? (
          <Pressable onPress={() => setMembersOpen((o) => !o)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: membersOpen ? hexA(C.purple, 0.18) : hexA(C.purple, 0.1), borderWidth: 1, borderColor: hexA(C.purple, membersOpen ? 0.5 : 0.3) }}>
            <Icon name="users" size={13} color={C.purple} strokeWidth={2.1} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.purple }}>Members</Text>
          </Pressable>
        ) : null}
      </LinearGradient>

      {/* Client Direct / Group sub-tabs (Clients tab) */}
      {subtabs ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(8,6,6,0.96)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
          {([['direct', 'Direct', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'], ['group', 'Group', null]] as const).map(([v, label, path]) => {
            if (v === 'direct' && !subtabs.hasDirect) return null;
            const active = subtabs.view === v;
            const col = v === 'direct' ? C.orange : C.purple;
            return (
              <Pressable key={v} onPress={() => subtabs.onChange(v)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'rgba(255,255,255,0.08)' }}>
                {v === 'direct' ? <Icon path={path as string} size={14} color={active ? col : C.muted2} strokeWidth={2.1} /> : <Icon name="users" size={14} color={active ? col : C.muted2} strokeWidth={2.1} />}
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? col : C.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Client-thread team panel — everyone assigned to this client, grouped by role */}
      {showMembers && membersOpen ? (
        <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(8,6,6,0.96)', gap: 8 }}>
          <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>CLIENT TEAM · {(membersQ.data ?? []).length} MEMBER{(membersQ.data ?? []).length === 1 ? '' : 'S'}</Mono>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {(membersQ.data ?? []).map((m) => {
              const rc = m.role === 'crm' ? C.gold : m.role === 'trainer' ? C.orange : m.role === 'doctor' ? C.blue : (m.role === 'admin' || m.role === 'super_admin') ? C.red : C.muted2;
              return (
                <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(rc, 0.08), borderWidth: 1, borderColor: hexA(rc, 0.28) }}>
                  <Avatar initial={chatInitials(m.name)} size={22} colors={avatarColors(m.name)} fontSize={9} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{m.name}{m.userId === meId ? ' (you)' : ''}</Text>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 9, letterSpacing: 0.5, color: rc }}>{m.roleLabel.toUpperCase()}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Messages (inverted: newest at bottom, scroll up loads older) */}
      {thread.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : thread.isError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Body style={{ fontSize: 12.5, color: C.red, textAlign: 'center' }}>Couldn't load messages ({(thread.error as Error).message}).</Body>
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon path="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" size={26} color="#4C4640" strokeWidth={1.6} />
          <Body style={{ fontSize: 13, color: C.muted3 }}>No messages yet.</Body>
        </View>
      ) : (
        <FlatList
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          onEndReached={() => { if (thread.hasNextPage && !thread.isFetchingNextPage) thread.fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          removeClippedSubviews
          windowSize={11}
          ListFooterComponent={thread.isFetchingNextPage ? <View style={{ paddingVertical: 14 }}><ActivityIndicator color={C.muted3} /></View> : null}
        />
      )}

      {/* Reply preview — the message being replied to (swipe a bubble to set) */}
      {replyTo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0E0B0A' }}>
          <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: C.orange }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.orange }}>Replying to {quoteName(replyTo.sender_id)}</Text>
            <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12.5, color: C.muted2, marginTop: 1 }}>{quoteText(replyTo)}</Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
          </Pressable>
        </View>
      ) : null}

      {/* @mention suggestions — appears while typing "@name" in a group chat */}
      {mentionSuggestions.length > 0 ? (
        <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0E0B0A', paddingVertical: 6 }}>
          {mentionSuggestions.map((m) => {
            const rc = m.role === 'crm' ? C.gold : m.role === 'trainer' ? C.orange : m.role === 'doctor' ? C.blue : (m.role === 'admin' || m.role === 'super_admin') ? C.red : C.muted2;
            return (
              <Pressable key={m.userId} onPress={() => applyMention(m.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 16 }}>
                <Avatar initial={chatInitials(m.name)} size={30} colors={avatarColors(m.name)} fontSize={11} />
                <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }} numberOfLines={1}>{m.name}</Body>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 9, letterSpacing: 0.6, color: rc }}>{m.roleLabel.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Composer — lifted above the keyboard via manual kbH */}
      {isReadOnly ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: composerPadBottom, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(8,6,6,0.96)', alignItems: 'center' }}>
          <Body style={{ fontSize: 12, color: C.muted3 }}>📢 Announcements — only admins can post here.</Body>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingHorizontal: 14, paddingTop: 12, paddingBottom: composerPadBottom, borderTopWidth: 1, borderTopColor: recording ? hexA(C.red, 0.3) : 'rgba(255,255,255,0.08)', backgroundColor: '#0B0908' }}>
            {/* Left area swaps (input ↔ recording strip) inside ONE stable view so the
                mic on the right keeps gesture ownership across the state change. */}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 9 }}>
              {recording ? (
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 42, borderRadius: 21, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red, opacity: Math.floor(recMs / 500) % 2 ? 0.35 : 1 }} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{fmtClock(recMs)}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <Icon name="chevLeft" size={13} color={C.muted3} strokeWidth={2.2} />
                    <Body style={{ fontSize: 12, color: C.muted2 }}>Slide to cancel</Body>
                  </View>
                </View>
              ) : showDeleted ? (
                /* Transient cancel confirmation — trash drops in and the strip fades out */
                <Animated.View style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, borderRadius: 21,
                  backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.35),
                  opacity: delAnim.interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [{ translateY: delAnim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [-8, 0, 6] }) }],
                }}>
                  <Animated.View style={{ transform: [{ rotate: delAnim.interpolate({ inputRange: [0, 0.2, 0.4], outputRange: ['-18deg', '8deg', '0deg'], extrapolate: 'clamp' }) }] }}>
                    <Icon path="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14ZM10 11v6M14 11v6" size={16} color={C.red} strokeWidth={2.1} />
                  </Animated.View>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Recording deleted</Text>
                </Animated.View>
              ) : (
                <>
                  <Pressable onPress={attach} disabled={mediaM.isPending} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: mediaM.isPending ? 0.5 : 1, marginBottom: 1 }}>
                    {mediaM.isPending ? <ActivityIndicator size="small" color={C.muted2} /> : <Icon name="plus" size={20} color={C.ink2} strokeWidth={2.4} />}
                  </Pressable>
                  <View style={{ flex: 1, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 11 : 6, minHeight: 42, justifyContent: 'center', maxHeight: 120 }}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder="Message…"
                      placeholderTextColor={C.muted3}
                      multiline
                      style={{ fontFamily: F.body, fontSize: 15, lineHeight: 20, color: '#fff', padding: 0, maxHeight: 98 }}
                    />
                  </View>
                </>
              )}
            </View>
            {draft.trim() ? (
              <Pressable onPress={send} style={{ marginBottom: 1 }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon path="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" size={17} color="#fff" strokeWidth={2.2} />
                </LinearGradient>
              </Pressable>
            ) : (
              /* Mic — HOLD to record (button swells + start blip), slide LEFT to
                 cancel, release to send (end blip). WhatsApp behaviour. */
              <Animated.View
                {...micPan.panHandlers}
                style={{ marginBottom: 1, transform: [{ translateX: micDrag }, { scale: micScale }], opacity: mediaM.isPending ? 0.5 : 1 }}
              >
                <LinearGradient colors={recording ? ['#F0564A', '#C93A30'] : ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon path="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3M8 21h8" size={18} color="#fff" strokeWidth={2.1} />
                </LinearGradient>
              </Animated.View>
            )}
        </View>
      )}

      {/* "Seen by" — long-press a bubble in a group to see who has read it */}
      <SeenBySheet msg={seenMsg} reads={readsQ.data ?? []} meId={meId} onClose={() => setSeenMsg(null)} />
      <MediaViewer media={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

/* ============ Voice message bubble (B2C interop) ============
   Streams the signed chat-media URL via expo-av — play/pause, live progress and
   duration, WhatsApp-style. Each bubble owns its sound and unloads on unmount. */
const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function VoiceBubble({ url, mine, pending, timeText, onLongPress }: { url: string; mine: boolean; pending?: boolean; timeText: string; onLongPress?: () => void }) {
  const soundRef = React.useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [posMs, setPosMs] = React.useState(0);
  const [durMs, setDurMs] = React.useState(0);

  React.useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const onStatus = (st: any) => {
    if (!st?.isLoaded) return;
    setPosMs(st.positionMillis ?? 0);
    if (st.durationMillis) setDurMs(st.durationMillis);
    setPlaying(!!st.isPlaying);
    // stopAsync (not setPositionAsync) — a bare seek-to-0 resumes playback while shouldPlay is still true, causing an endless loop
    if (st.didJustFinish) { setPlaying(false); setPosMs(0); soundRef.current?.stopAsync().catch(() => {}); }
  };

  const toggle = async () => {
    if (pending) return;
    try {
      if (!soundRef.current) {
        setLoading(true);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, progressUpdateIntervalMillis: 250 }, onStatus);
        soundRef.current = sound;
        setLoading(false);
        return;
      }
      const st: any = await soundRef.current.getStatusAsync();
      if (st?.isLoaded && st.isPlaying) await soundRef.current.pauseAsync();
      else await soundRef.current.playAsync();
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Playback failed', e?.message ?? 'Could not play this voice message.');
    }
  };

  const pct = durMs > 0 ? Math.min(1, posMs / durMs) : 0;
  const accent = mine ? '#fff' : C.orange;
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300} style={{ maxWidth: '80%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 16, minWidth: 210, backgroundColor: mine ? hexA(C.orange, 0.92) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: mine ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.08)', borderBottomRightRadius: mine ? 5 : 16, borderBottomLeftRadius: mine ? 16 : 5 }}>
        <Pressable onPress={toggle} hitSlop={6} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : hexA(C.orange, 0.15), borderWidth: 1, borderColor: mine ? 'rgba(255,255,255,0.35)' : hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
          {pending || loading ? (
            <ActivityIndicator size="small" color={accent} />
          ) : playing ? (
            <Icon path="M8 5h3v14H8zM13 5h3v14h-3z" size={16} color={accent} strokeWidth={0} fill={accent} />
          ) : (
            <Icon path="M8 5v14l11-7z" size={16} color={accent} strokeWidth={0} fill={accent} />
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon path="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3" size={12} color={mine ? 'rgba(255,255,255,0.85)' : C.muted2} strokeWidth={2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: mine ? '#fff' : C.ink2 }}>{pending ? 'Sending…' : 'Voice message'}</Text>
          </View>
          <View style={{ height: 4, borderRadius: 999, backgroundColor: mine ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <View style={{ width: `${pct * 100}%`, height: 4, backgroundColor: accent }} />
          </View>
          <Text style={{ fontFamily: F.mono, fontSize: 9, color: mine ? 'rgba(255,255,255,0.8)' : C.muted3 }}>
            {durMs ? `${fmtClock(posMs)} / ${fmtClock(durMs)}` : '· · ·'}
          </Text>
        </View>
      </View>
      <Text style={{ fontFamily: F.mono, fontSize: 8.5, color: C.muted3, alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 3 }}>{timeText}</Text>
    </Pressable>
  );
}

/* ============ In-app media viewer ============
   Photos, videos and documents open INSIDE the app (fullscreen, no browser, the
   signed URL is never shown): image → native viewer, video → expo-av player with
   controls, document/PDF → WebView (iOS renders PDFs natively; Android goes
   through the Docs viewer, still embedded). */
function MediaViewer({ media, onClose }: { media: { kind: string; url: string } | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!media) return null;
  const docUri = Platform.OS === 'android'
    ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(media.url)}`
    : media.url;
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {media.kind === 'image' ? (
          <Image source={{ uri: media.url }} style={{ flex: 1 }} resizeMode="contain" />
        ) : media.kind === 'video' ? (
          <Video
            source={{ uri: media.url }}
            style={{ flex: 1 }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
          />
        ) : (
          <WebView
            source={{ uri: docUri }}
            style={{ flex: 1, backgroundColor: '#000' }}
            startInLoadingState
            renderLoading={() => (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                <ActivityIndicator color={C.orange} size="large" />
              </View>
            )}
          />
        )}
        <Pressable onPress={onClose} style={{ position: 'absolute', top: insets.top + 10, right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={17} color="#fff" strokeWidth={2.4} />
        </Pressable>
      </View>
    </Modal>
  );
}

/* Read-receipt sheet: who in the group has seen the long-pressed message. A member
   has "seen" it when their last_read_at is at/after the message's created_at. */
function SeenBySheet({ msg, reads, meId, onClose }: { msg: (ChatMessage & { _pending?: boolean }) | null; reads: ConversationRead[]; meId: string; onClose: () => void }) {
  const roleColor = (role: string | null) => role === 'crm' ? C.gold : role === 'trainer' ? C.orange : role === 'doctor' ? C.blue : (role === 'admin' || role === 'super_admin') ? C.red : role === 'client' ? C.green : C.muted2;
  const msgAt = msg ? new Date(msg.created_at).getTime() : 0;
  // Everyone except the sender (they wrote it).
  const others = msg ? reads.filter((r) => r.userId !== msg.sender_id) : [];
  const seen = others.filter((r) => r.lastReadAt && new Date(r.lastReadAt).getTime() >= msgAt);
  const pending = others.filter((r) => !(r.lastReadAt && new Date(r.lastReadAt).getTime() >= msgAt));
  const Row = ({ r, when }: { r: ConversationRead; when?: string | null }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8 }}>
      <Avatar initial={chatInitials(r.name)} size={34} colors={avatarColors(r.name)} fontSize={12} />
      <View style={{ flex: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.name}{r.userId === meId ? ' (you)' : ''}</Body>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 9, letterSpacing: 0.5, color: roleColor(r.role) }}>{(r.role ?? 'member').toUpperCase()}</Text>
      </View>
      {when ? <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{relTime(when)}</Mono> : null}
    </View>
  );
  return (
    <SheetShell visible={!!msg} onClose={onClose} accent={C.blue} icon="checks" title="Seen by" subtitle={msg ? `${seen.length} of ${others.length} member${others.length === 1 ? '' : 's'}` : undefined}>
      {msg ? (
        <>
          <View style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <Body numberOfLines={2} style={{ fontSize: 12.5, color: C.ink3 }}>
              {msg.message_type !== 'text' ? ({ image: '📷 Photo', video: '🎥 Video', voice: '🎤 Voice', document: '📄 Document' }[msg.message_type] ?? 'Message') : msg.message}
            </Body>
          </View>
          {seen.length ? (
            <>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.green, marginTop: 6 }}>SEEN · {seen.length}</Mono>
              {seen.map((r) => <Row key={r.userId} r={r} when={r.lastReadAt} />)}
            </>
          ) : null}
          {pending.length ? (
            <>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3, marginTop: 6 }}>NOT SEEN YET · {pending.length}</Mono>
              {pending.map((r) => <Row key={r.userId} r={r} />)}
            </>
          ) : null}
          {others.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 12 }}>No other members in this chat.</Body> : null}
        </>
      ) : null}
    </SheetShell>
  );
}

/* ---------- Segmented tab bar (Clients · Team · Odds Group) ---------- */
function MsgTabBar({ tab, setTab, counts }: { tab: 'clients' | 'team' | 'odds'; setTab: (t: 'clients' | 'team' | 'odds') => void; counts: Record<string, number> }) {
  const megaphone = 'M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 0 1-5.8-1.6';
  const tabs: { id: 'clients' | 'team' | 'odds'; label: string; icon?: any; path?: string; color: string }[] = [
    { id: 'clients', label: 'Clients', icon: 'user', color: C.orange },
    { id: 'team', label: 'Team', icon: 'users', color: C.purple },
    { id: 'odds', label: 'Odds Group', path: megaphone, color: C.gold },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, padding: 5, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        const n = counts[t.id] ?? 0;
        return (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'transparent' }}>
            {active ? <LinearGradient colors={[hexA(t.color, 0.9), hexA(t.color, 0.55)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 11 }} /> : null}
            {t.path ? <Icon path={t.path} size={14} color={active ? '#fff' : C.muted2} strokeWidth={2} /> : <Icon name={t.icon} size={14} color={active ? '#fff' : C.muted2} strokeWidth={2} />}
            <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.muted }} numberOfLines={1}>{t.label}</Text>
            {n > 0 ? (
              <View style={{ minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: active ? 'rgba(255,255,255,0.28)' : C.orangeGradB, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: '#fff' }}>{n > 99 ? '99+' : n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Messenger home — three tabs ---------- */
function MessengerHome({ meId, onOpen, onOpenClient }: { meId: string; onOpen: (c: ChatConversation) => void; onOpenClient: (c: MessengerClient) => void }) {
  const [tab, setTab] = React.useState<'clients' | 'team' | 'odds'>('clients');
  const [search, setSearch] = React.useState('');
  const [opening, setOpening] = React.useState<string | null>(null);
  const overview = useChatOverview(meId);
  const roster = useTeamRoster(meId);
  const clientsQ = useCrmMessengerClients(meId);
  const openOrCreate = useOpenOrCreateDm();
  const qc = useQueryClient();

  const all = overview.data ?? [];
  const q = search.trim().toLowerCase();
  const directByProfile = React.useMemo(() => {
    const m = new Map<string, ChatConversation>();
    all.filter((c) => c.type === 'direct' && c.otherUserId).forEach((c) => { if (!m.has(c.otherUserId!)) m.set(c.otherUserId!, c); });
    return m;
  }, [all]);

  // --- Clients rows: preview the client's DIRECT DM only. The staff-only client
  //     thread (dedicated client_threads tables) and the care-team group are separate surfaces and
  //     must NOT bleed into this list's preview/unread. ---
  const clientRows = (clientsQ.data ?? []).map((cl) => {
    const d = cl.profileId ? directByProfile.get(cl.profileId) : undefined;
    return {
      client: cl, lastMessage: d?.lastMessage ?? null, lastMessageAt: d?.lastMessageAt ?? null,
      lastSenderId: d?.lastSenderId ?? null, unread: d?.unreadCount ?? 0, hasDirect: !!d,
    };
  });
  const clientRowsF = clientRows
    .filter((r) => !q || r.client.name.toLowerCase().includes(q))
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || a.client.name.localeCompare(b.client.name));

  // --- Team rows (roster + existing team DMs) ---
  const teamConvByUser = new Map<string, ChatConversation>();
  all.filter((c) => c.type === 'team' && c.otherUserId).forEach((c) => { if (!teamConvByUser.has(c.otherUserId!)) teamConvByUser.set(c.otherUserId!, c); });
  const teamRows = (roster.data ?? [])
    .filter((m) => !q || m.name.toLowerCase().includes(q) || m.roleLabel.toLowerCase().includes(q))
    .map((m) => ({ member: m, conv: teamConvByUser.get(m.userId) ?? null }))
    .sort((a, b) => {
      const at = a.conv?.lastMessageAt ?? '', bt = b.conv?.lastMessageAt ?? '';
      if (at !== bt) return bt.localeCompare(at);
      const au = a.conv?.unreadCount ?? 0, bu = b.conv?.unreadCount ?? 0;
      if (au !== bu) return bu - au;
      return a.member.name.localeCompare(b.member.name);
    });

  const oddsConv = all.find((c) => c.isAnnouncements) ?? null;

  const counts = {
    clients: clientRows.reduce((s, r) => s + r.unread, 0),
    team: [...teamConvByUser.values()].reduce((s, c) => s + c.unreadCount, 0),
    odds: oddsConv?.unreadCount ?? 0,
  };

  const openTeammate = async (member: TeamMember, conv: ChatConversation | null) => {
    if (conv) return onOpen(conv);
    setOpening(member.userId);
    try {
      const convId = await openOrCreate.mutateAsync({ otherUserId: member.userId, type: 'team' });
      qc.invalidateQueries({ queryKey: ['chat-overview', meId] });
      onOpen({ conversationId: convId, type: 'team', title: member.name, subtitle: member.roleLabel, otherUserId: member.userId, isAnnouncements: false, memberCount: 2, lastMessage: null, lastMessageType: null, lastMessageAt: null, lastSenderId: null, unreadCount: 0, myLastReadAt: null });
    } catch (e: any) {
      Alert.alert('Could not open chat', e?.message || 'Please try again.');
    } finally { setOpening(null); }
  };

  const ROLE_COLOR: Record<string, string> = { Admin: C.gold, Trainer: C.orange, Coach: C.green, Doctor: C.blue, CRM: C.purple, Compliance: '#4FB8C9' };

  return (
    <Page gap={13} pt={6}>
      <Serif style={{ fontSize: 26 }}>Messenger</Serif>
      <MsgTabBar tab={tab} setTab={setTab} counts={counts} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Icon name="search" size={16} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder={tab === 'clients' ? 'Search clients…' : tab === 'team' ? 'Search team…' : 'Search…'} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14.5, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.2} /></Pressable> : null}
      </View>

      {/* ---- CLIENTS ---- */}
      {tab === 'clients' ? (
        clientsQ.isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator color={C.orange} /></View>
        ) : clientRowsF.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' }}><Icon name="user" size={20} color="#5C554E" strokeWidth={1.8} /></View>
            <Body style={{ fontSize: 13, color: C.muted3 }}>{q ? 'No clients match your search.' : 'No active clients.'}</Body>
          </View>
        ) : (
          clientRowsF.map((r) => {
            const mine = r.lastSenderId === meId;
            return (
              <Pressable key={r.client.clientId} onPress={() => onOpenClient(r.client)} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 13, borderRadius: 18, backgroundColor: r.unread ? hexA(C.orange, 0.06) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: r.unread ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.06)' }}>
                <Avatar initial={chatInitials(r.client.name)} size={52} colors={avatarColors(r.client.name)} fontSize={18} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 15.5, fontFamily: r.unread ? F.bodyBold : F.bodySemi, color: '#fff' }}>{r.client.name}</Body>
                    {r.lastMessageAt ? <Mono style={{ fontSize: 9.5, color: r.unread ? C.orange : C.muted3 }}>{relTime(r.lastMessageAt)}</Mono> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, color: r.unread ? C.ink2 : C.muted2, fontFamily: r.unread ? F.bodySemi : F.body }}>
                      {r.lastMessage ? `${mine ? 'You: ' : ''}${r.lastMessage}` : (r.client.profileId ? 'Direct & group chat' : 'Team group chat')}
                    </Body>
                    {r.unread ? (
                      <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: C.orangeGradB, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{r.unread > 99 ? '99+' : r.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
              </Pressable>
            );
          })
        )
      ) : null}

      {/* ---- TEAM ---- */}
      {tab === 'team' ? (
        roster.isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator color={C.purple} /></View>
        ) : teamRows.length === 0 ? (
          <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center', paddingVertical: 40 }}>{q ? 'No teammates match your search.' : 'No teammates found.'}</Body>
        ) : (
          teamRows.map(({ member, conv }) => {
            const mine = conv?.lastSenderId === meId;
            const rc = ROLE_COLOR[member.roleLabel] ?? C.muted2;
            return (
              <Pressable key={member.userId} onPress={() => openTeammate(member, conv)} disabled={opening === member.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 16, backgroundColor: conv?.unreadCount ? hexA(C.purple, 0.06) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: conv?.unreadCount ? hexA(C.purple, 0.3) : 'rgba(255,255,255,0.07)', opacity: opening === member.userId ? 0.5 : 1 }}>
                <Avatar initial={chatInitials(member.name)} size={46} colors={avatarColors(member.name)} fontSize={16} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 15, fontFamily: conv?.unreadCount ? F.bodyBold : F.bodySemi, color: '#fff' }}>{member.name}</Body>
                    {conv?.lastMessageAt ? <Mono style={{ fontSize: 9.5, color: conv.unreadCount ? C.purple : C.muted3 }}>{relTime(conv.lastMessageAt)}</Mono> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(rc, 0.13), borderWidth: 1, borderColor: hexA(rc, 0.3) }}>
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: rc }}>{member.roleLabel}</Text>
                    </View>
                    <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, color: conv?.unreadCount ? C.ink3 : C.muted3 }}>{conv?.lastMessage ? `${mine ? 'You: ' : ''}${conv.lastMessage}` : 'Tap to message'}</Body>
                    {conv?.unreadCount ? (
                      <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })
        )
      ) : null}

      {/* ---- ODDS GROUP ---- */}
      {tab === 'odds' ? (
        overview.isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator color={C.gold} /></View>
        ) : !oddsConv ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
            <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: hexA(C.gold, 0.12), borderWidth: 1, borderColor: hexA(C.gold, 0.3), alignItems: 'center', justifyContent: 'center' }}>
              <Icon path="M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 0 1-5.8-1.6" size={22} color={C.gold} strokeWidth={2} />
            </View>
            <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center' }}>No Odds announcements channel yet.</Body>
          </View>
        ) : (
          <Pressable onPress={() => onOpen(oddsConv)} style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.gold, oddsConv.unreadCount ? 0.4 : 0.25), backgroundColor: oddsConv.unreadCount ? hexA(C.gold, 0.07) : 'rgba(0,0,0,0.22)' }}>
            <LinearGradient colors={[C.gold, C.orange]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: hexA(C.gold, 0.14), borderWidth: 1, borderColor: hexA(C.gold, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon path="M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 0 1-5.8-1.6" size={22} color={C.gold} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 15.5, fontFamily: F.bodyBold, color: '#fff' }}>Odds Announcements</Body>
                  {oddsConv.lastMessageAt ? <Mono style={{ fontSize: 9.5, color: oddsConv.unreadCount ? C.gold : C.muted3 }}>{relTime(oddsConv.lastMessageAt)}</Mono> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: oddsConv.unreadCount ? C.ink3 : C.muted2 }}>{oddsConv.lastMessage || 'Broadcast from Odds Admin'}</Body>
                  {oddsConv.unreadCount ? (
                    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#0c0808' }}>{oddsConv.unreadCount > 99 ? '99+' : oddsConv.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Icon name="chevRight" size={16} color={C.gold} strokeWidth={2.3} />
            </View>
          </Pressable>
        )
      ) : null}
    </Page>
  );
}

/* ---------- Client chat ----------
   Groups (care-team) for everyone; direct 1:1 DMs with the client are enabled
   ONLY for CRMs (allowDirect) — other staff keep the group-only rule so the
   whole team always has context. The B2C client app already supports staff
   DMs (live data: CRMs hold existing type='direct' conversations with clients),
   resolved/created via the get_or_create_dm RPC. */
function ClientChat({ meId, client, onBack, allowDirect }: { meId: string; client: MessengerClient; onBack: () => void; allowDirect?: boolean }) {
  const [openGroup, setOpenGroup] = React.useState<ChatConversation | null>(null);
  const overview = useChatOverview(meId);
  const groupsQ = useClientGroups(client.profileId, true);
  const qc = useQueryClient();

  // ---- Direct DM (CRM only) ----
  const hasDirect = !!allowDirect && !!client.profileId;
  const [view, setView] = React.useState<'direct' | 'group'>('group');
  const [dmConv, setDmConv] = React.useState<ChatConversation | null>(null);
  const [dmErr, setDmErr] = React.useState<string | null>(null);
  const openDm = useOpenOrCreateDm();
  const subtabs = hasDirect ? { view, hasDirect: true, onChange: setView } : undefined;
  React.useEffect(() => {
    if (view !== 'direct' || !hasDirect || dmConv) return;
    const ex = overview.data?.find((c) => c.type === 'direct' && c.otherUserId === client.profileId);
    if (ex) { setDmConv(ex); return; }
    setDmErr(null);
    openDm.mutateAsync({ otherUserId: client.profileId!, type: 'direct' })
      .then((id) => {
        qc.invalidateQueries({ queryKey: ['chat-overview'] });
        setDmConv({
          conversationId: id, type: 'direct', title: client.name, subtitle: 'Client', otherUserId: client.profileId,
          isAnnouncements: false, memberCount: 2, lastMessage: null, lastMessageType: null,
          lastMessageAt: null, lastSenderId: null, unreadCount: 0, myLastReadAt: null,
        });
      })
      .catch((e: any) => setDmErr(e?.message ?? 'Could not open the direct chat.'));
  }, [view, hasDirect, overview.data]);

  // Ensure the caller is a member of the client's care-team group so it's visible
  // (assigned staff aren't always participants, and RLS then hides the group).
  React.useEffect(() => {
    if (!client.clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { error } = await supabase.rpc('get_or_join_client_group', { p_client_id: client.clientId });
        if (!cancelled && !error) qc.invalidateQueries({ queryKey: ['client-groups', client.profileId] });
      } catch { /* RPC not deployed — fall back to the member-only list */ }
    })();
    return () => { cancelled = true; };
  }, [client.clientId]);

  const openGroupCard = (g: ClientGroup) => {
    const ex = overview.data?.find((c) => c.conversationId === g.conversationId);
    setOpenGroup(ex ?? {
      conversationId: g.conversationId, type: 'group', title: g.name, subtitle: null, otherUserId: null,
      isAnnouncements: false, memberCount: g.members.length, lastMessage: null, lastMessageType: null,
      lastMessageAt: null, lastSenderId: null, unreadCount: 0, myLastReadAt: null,
    });
  };

  // Exactly ONE group (the usual case — "My Longevity Team") → skip the group-list
  // page and open the chat directly. Back then exits to the clients list, never
  // the redundant single-card list.
  const soloGroup = (groupsQ.data ?? []).length === 1;
  const autoOpenedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoOpenedRef.current || openGroup) return;
    const gs = groupsQ.data ?? [];
    if (gs.length === 1) { autoOpenedRef.current = true; openGroupCard(gs[0]); }
  }, [groupsQ.data]);

  // ----- DIRECT DM (CRM only) -----
  if (view === 'direct' && hasDirect) {
    if (dmConv) return <MessageThread meId={meId} conv={dmConv} onBack={onBack} subtabs={subtabs} />;
    return (
      <ClientChatShell name={client.name} onBack={onBack} subtabs={subtabs}>
        {dmErr ? <ClientChatCentered text={dmErr} /> : <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>}
      </ClientChatShell>
    );
  }

  // ----- GROUP CHAT (a card was tapped, or the single group auto-opened) -----
  if (openGroup) return <MessageThread meId={meId} conv={openGroup} onBack={() => (soloGroup ? onBack() : setOpenGroup(null))} subtabs={subtabs} />;

  // ----- GROUPS LIST -----
  const groups = groupsQ.data ?? [];
  return (
    <ClientChatShell name={client.name} onBack={onBack} subtabs={subtabs}>
      {!client.profileId ? (
        <ClientChatCentered text="This client has no app account, so there are no groups." />
      ) : groupsQ.isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.purple} /></View>
      ) : groups.length === 0 ? (
        <ClientChatCentered text="No care-team group exists for this client yet." />
      ) : (
        <View style={{ padding: 14, gap: 12 }}>
          <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2 }}>{groups.length} GROUP{groups.length === 1 ? '' : 'S'} AVAILABLE</Mono>
          {groups.map((g) => {
            const conv = overview.data?.find((c) => c.conversationId === g.conversationId);
            return (
              <Pressable key={g.conversationId} onPress={() => openGroupCard(g)} style={{ borderRadius: 16, backgroundColor: conv?.unreadCount ? hexA(C.purple, 0.07) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: conv?.unreadCount ? hexA(C.purple, 0.3) : 'rgba(255,255,255,0.08)', padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(C.purple, 0.14), borderWidth: 1, borderColor: hexA(C.purple, 0.32), alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="users" size={18} color={C.purple} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{g.name}</Body>
                    <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{g.members.length} participant{g.members.length === 1 ? '' : 's'}{conv?.lastMessage ? ` · ${conv.lastMessage}` : ''}</Body>
                  </View>
                  {conv?.unreadCount ? (
                    <View style={{ minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{conv.unreadCount > 99 ? '99+' : conv.unreadCount}</Text>
                    </View>
                  ) : <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {g.members.slice(0, 6).map((m) => {
                    const rc = m.role === 'crm' ? C.gold : m.role === 'trainer' ? C.orange : m.role === 'doctor' ? C.blue : m.role === 'client' ? C.green : (m.role === 'admin' || m.role === 'super_admin') ? C.red : C.muted2;
                    return (
                      <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(rc, 0.1), borderWidth: 1, borderColor: hexA(rc, 0.28) }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: rc }} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: C.ink3 }} numberOfLines={1}>{m.name.split(' ')[0]}</Text>
                      </View>
                    );
                  })}
                  {g.members.length > 6 ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.muted3, alignSelf: 'center' }}>+{g.members.length - 6}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ClientChatShell>
  );
}
function ClientChatCentered({ text }: { text: string }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Body style={{ fontSize: 13, color: C.muted2, textAlign: 'center' }}>{text}</Body></View>;
}
/* Shell for the client chat's non-thread states (Direct loading/error, Groups list):
   header + Direct/Groups toggle + scrollable body. */
function ClientChatShell({ name, onBack, subtabs, children }: { name: string; onBack: () => void; subtabs?: { view: 'direct' | 'group'; hasDirect: boolean; onChange: (v: 'direct' | 'group') => void }; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      {/* No insets.top — the global app bar above already owns the safe area. */}
      <LinearGradient colors={['#241812', '#120E0D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 10, paddingBottom: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: hexA(C.orange, 0.18), borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.08)' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
          <Icon name="arrowLeft" size={17} color={C.ink2} strokeWidth={2.2} />
        </Pressable>
        <View style={{ padding: 2, borderRadius: 999, borderWidth: 1.5, borderColor: hexA(avatarColors(name)[0], 0.5) }}>
          <Avatar initial={chatInitials(name)} size={36} colors={avatarColors(name)} fontSize={13} />
        </View>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 15.5, fontFamily: F.bodySemi, color: '#fff' }}>{name}</Body>
      </LinearGradient>
      {subtabs ? (
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(8,6,6,0.96)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
          {([['direct', 'Direct'], ['group', 'Groups']] as const).map(([v, label]) => {
            if (v === 'direct' && !subtabs.hasDirect) return null;
            const active = subtabs.view === v;
            const col = v === 'direct' ? C.orange : C.purple;
            return (
              <Pressable key={v} onPress={() => subtabs.onChange(v)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.45) : 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? col : C.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  );
}

export function Messenger() {
  const { session, role } = useAuth();
  const meId = session?.user?.id ?? '';
  const { openChatId, setOpenChat } = useStore();
  const [active, setActive] = React.useState<ChatConversation | null>(null);
  const [activeClient, setActiveClient] = React.useState<MessengerClient | null>(null);
  const overview = useChatOverview(meId);

  // While a chat is open, the page-level swipe-back closes the chat (back to
  // the contacts list) instead of popping the route to the previous screen.
  React.useEffect(() => {
    if (active || activeClient) {
      backOverride.handler = () => { setActive(null); setActiveClient(null); };
    } else {
      backOverride.handler = null;
    }
    return () => { backOverride.handler = null; };
  }, [active, activeClient]);

  // Deep-link from a tapped notification: resolve the conversation and open it.
  React.useEffect(() => {
    if (!openChatId) return;
    if (overview.data) {
      const c = overview.data.find((x) => x.conversationId === openChatId);
      if (c) { setActiveClient(null); setActive(c); }
      setOpenChat(null);
    }
  }, [openChatId, overview.data]);

  if (!meId) {
    return (
      <Page gap={16} pt={6}>
        <Serif style={{ fontSize: 26 }}>Messenger</Serif>
        <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center', paddingVertical: 40 }}>Sign in to view your conversations.</Body>
      </Page>
    );
  }
  if (activeClient) return <ClientChat meId={meId} client={activeClient} onBack={() => setActiveClient(null)} allowDirect={role === 'crm'} />;
  if (active) return <MessageThread meId={meId} conv={active} onBack={() => setActive(null)} />;
  return <MessengerHome meId={meId} onOpen={setActive} onOpenClient={setActiveClient} />;
}

/* ---------- In-app new-message banner (shown on any screen except Messenger) ----------
   One RLS-scoped subscription to message INSERTs (delivers only my conversations),
   slide-in banner, tap → deep-link into the thread. */
export function ChatNotifications() {
  const { session, role } = useAuth();
  const meId = session?.user?.id ?? '';
  const { route, go, setOpenChat } = useStore();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const routeRef = React.useRef(route);
  routeRef.current = route;
  // Kept in a ref so the long-lived realtime closure always sees the current role.
  const roleRef = React.useRef(role);
  roleRef.current = role;
  const [banner, setBanner] = React.useState<{ convId: string; title: string; text: string } | null>(null);
  const anim = React.useRef(new Animated.Value(-160)).current;
  const nameCache = React.useRef(new Map<string, string>());
  const convCache = React.useRef(new Map<string, { type: string; name: string | null }>());
  const timer = React.useRef<any>(null);

  const hide = React.useCallback(() => {
    Animated.timing(anim, { toValue: -160, duration: 220, useNativeDriver: true }).start(() => setBanner(null));
  }, [anim]);
  // Haptic/vibration feedback for an incoming message. `emphatic` = a Longevity
  // Team message for a CRM → a PERSISTENT alarm-style vibration (B2C promises a
  // reply within 2 minutes, so this keeps buzzing for ~60s or until the CRM
  // reacts — tapping the banner or opening the messenger stops it). Normal
  // messages keep the short tap.
  const longBuzzTimer = React.useRef<any>(null);
  const longBuzzOn = React.useRef(false);
  const stopLongBuzz = React.useCallback(() => {
    if (!longBuzzOn.current) return;
    longBuzzOn.current = false;
    clearTimeout(longBuzzTimer.current);
    Vibration.cancel();
  }, []);
  React.useEffect(() => () => stopLongBuzz(), [stopLongBuzz]); // never outlive the component
  // Opening the messenger (any path — banner, drawer, tab) counts as "seen": stop.
  React.useEffect(() => { if (route === 'messenger') stopLongBuzz(); }, [route, stopLongBuzz]);
  const buzz = React.useCallback((emphatic: boolean) => {
    if (emphatic) {
      stopLongBuzz(); // restart cleanly if another Longevity message lands mid-alarm
      longBuzzOn.current = true;
      // Repeating buzz-pause pattern (Android honours durations; iOS repeats its
      // fixed pulse on the same cadence). Auto-stops after 60s.
      Vibration.vibrate([600, 1000, 800], true);
      longBuzzTimer.current = setTimeout(stopLongBuzz, 60_000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [stopLongBuzz]);
  const show = React.useCallback((b: { convId: string; title: string; text: string }) => {
    setBanner(b);
    Animated.spring(anim, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(hide, 4500);
  }, [anim, hide]);

  // CRM auto-join: realtime only delivers messages the caller can SEE, and CRMs
  // are often NOT participants of their clients' care-team groups — so Longevity
  // Team messages never reached them (no banner, no vibration). On app open
  // (throttled to 12h) join the CRM into every assigned client's group via the
  // get_or_join_client_group RPC. Idempotent; failures are silent.
  const joinedRef = React.useRef(false);
  React.useEffect(() => {
    if (!meId || role !== 'crm' || joinedRef.current) return;
    joinedRef.current = true;
    (async () => {
      try {
        const KEY = 'crm-group-autojoin:lastAt';
        const last = await AsyncStorage.getItem(KEY).catch(() => null);
        if (last && Date.now() - Number(last) < 12 * 3_600_000) return;
        const { data } = await supabase
          .from('trainer_clients')
          .select('client:clients(id, status)')
          .eq('trainer_id', meId).eq('actively_training', true);
        const ids = [...new Set(
          ((data ?? []) as any[])
            .map((r) => r.client)
            .filter((c) => c && !['inactive', 'discontinued'].includes((c.status ?? 'active').toLowerCase()))
            .map((c) => c.id as string)
        )];
        for (const cid of ids) {
          try { await supabase.rpc('get_or_join_client_group', { p_client_id: cid }); } catch { /* RPC missing / not authorized — skip */ }
        }
        await AsyncStorage.setItem(KEY, String(Date.now())).catch(() => {});
      } catch { /* fully best-effort */ }
    })();
  }, [meId, role]);

  React.useEffect(() => {
    if (!meId) return;
    const ch = supabase
      .channel('global-msgs-' + meId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new as any;
        if (!m || m.sender_id === meId || m.is_deleted) return;
        qc.invalidateQueries({ queryKey: ['chat-overview', meId] });

        // Resolve the conversation (cached) FIRST — we need its type to decide the
        // haptic, and we must buzz even when the messenger is already open.
        let conv = convCache.current.get(m.conversation_id);
        if (!conv) {
          const { data: cd } = await supabase.from('conversations').select('type, name').eq('id', m.conversation_id).maybeSingle();
          conv = { type: cd?.type ?? 'direct', name: cd?.name ?? null };
          convCache.current.set(m.conversation_id, conv);
        }
        const isAnn = conv.name === 'Odds Announcements';
        const isGroupConv = conv.type === 'group';
        // Longevity Team = any client care-team GROUP (every type='group' except
        // the Odds Announcements broadcast — this mirrors useClientGroups). CRMs
        // get the long, distinct buzz for these; everything else the short tap.
        const isLongevityTeam = isGroupConv && !isAnn;
        const emphatic = roleRef.current === 'crm' && isLongevityTeam;
        buzz(emphatic); // fires regardless of current screen

        if (routeRef.current === 'messenger') return; // in the messenger → skip the banner (buzz already fired)
        let name = nameCache.current.get(m.sender_id);
        if (!name) {
          const { data } = await supabase.from('profiles').select('first_name,last_name').eq('id', m.sender_id).maybeSingle();
          name = (data ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() : '') || 'New message';
          nameCache.current.set(m.sender_id, name);
        }
        const body = m.message_type && m.message_type !== 'text' ? '📎 Attachment' : (m.message || '');
        const title = isAnn ? 'Odds Announcements' : isGroupConv ? (displayGroupName(conv.name) || 'Group') : name;
        const text = isAnn ? body : isGroupConv ? `${name}: ${body}` : body;
        show({ convId: m.conversation_id, title, text });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); clearTimeout(timer.current); };
  }, [meId]);

  if (!banner) return null;
  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8, paddingHorizontal: 12, transform: [{ translateY: anim }], opacity: anim.interpolate({ inputRange: [-160, 0], outputRange: [0, 1] }), zIndex: 200 }}>
      <Pressable
        onPress={() => { hide(); setOpenChat(banner.convId); go('messenger'); }}
        style={{ borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}
      >
        <LinearGradient colors={['#2A1C14', '#151010']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 20, borderWidth: 1, borderColor: hexA(C.orange, 0.32) }}>
          {/* single precious ember accent */}
          <LinearGradient colors={[hexA(C.orange, 0.75), 'rgba(255,255,255,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4 }} />
          <View style={{ paddingHorizontal: 15, paddingTop: 11, paddingBottom: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 }}>
              <Icon path="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" size={11} color={C.orange} strokeWidth={2.2} />
              <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1.6, color: '#F0A875' }}>NEW MESSAGE</Mono>
              <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.muted3 }}>NOW</Mono>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
              <View style={{ padding: 2.5, borderRadius: 999, borderWidth: 1.5, borderColor: hexA(avatarColors(banner.title)[0], 0.55) }}>
                <Avatar initial={chatInitials(banner.title)} size={50} colors={avatarColors(banner.title)} fontSize={17} />
              </View>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 16.5, fontFamily: F.bodyBold, color: '#fff' }}>{banner.title}</Body>
                <Body numberOfLines={2} style={{ fontSize: 13.5, color: C.ink3, marginTop: 2, lineHeight: 18 }}>{banner.text || 'New message'}</Body>
              </View>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevRight" size={15} color={C.muted2} strokeWidth={2.3} />
              </View>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}
