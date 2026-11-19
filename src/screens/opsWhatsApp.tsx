/* WhatsApp inbox (Ops) in the app, 19 Nov 2026. Owner: "in ops dashboard add the WhatsApp page like Preeti Ch sees on
   the web, end to end, clean and the same UI as WhatsApp". The same data, rules and server function as the web page
   (hub-track src/pages/ops/OpsWhatsApp.tsx and src/components/ops/whatsapp/*): the chat list, then one chat at a
   time like WhatsApp on a phone, replies inside WhatsApp's 24 hours, approved templates outside them, a chat with a
   new number. Ops and admin only (the database rule is_whatsapp_staff says the same). Media files are not shown yet
   (a labelled placeholder, as on the web). Colours follow WhatsApp's own dark theme.
   Rules: src/lib/whatsapp.ts (tests/rules/whatsapp_test.js). Data: src/lib/whatsappQueries.ts.
   Feature doc: docs/features/android/ops/whatsapp-inbox.md */
import React from 'react';
import { View, Text, Pressable, TextInput, FlatList, ActivityIndicator, Modal, ScrollView, RefreshControl, Platform, Keyboard, AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { backOverride } from '../gestureLock';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { friendlyError } from '../lib/friendlyError';
import {
  blankLabel, bubbleTime, buildThread, canRetrySend, chatForKey, chatInitials, chatKey, chatMatches, chatTitle, composerMode,
  composerProblem, emptyTemplateValues, failedLabel, firstUnread, formatWaNumber, isEdited, lastTickOf, listTime, localSendBubbles,
  mediaOf, messagePreview, newClientRef, parseChatKey, parseNewChatNumber, placeholderChat, replyWindow, sentFromLabel,
  templateCategoryLabel, templateKey, templateLanguageOf, templateMatches, templateNameOf, templatePreview, templateProblem,
  templateSentText, tickOf, totalUnread, windowLeftText, WA_NEW_CHAT_HINT, WA_SEND_FAILED, WA_TEXT_MAX,
  type WaChat, type WaLocalSend, type WaMediaKind, type WaMessage, type WaReactionShown, type WaSendCheck, type WaTemplate,
  type WaTemplateValues, type WaTick,
} from '../lib/whatsapp';
import {
  useCanSeeWhatsApp, useMarkWhatsAppChatSeen, useSendWhatsApp, useSendWhatsAppTemplate, useWhatsAppChats, useWhatsAppRealtime,
  useWhatsAppSendCheck, useWhatsAppTemplates, useWhatsAppThread, useWhatsAppUnreadCount, WA_PAGE_SIZE,
} from '../lib/whatsappQueries';

/* WhatsApp's dark theme */
const WA = {
  bg: '#0B141A',
  list: '#111B21',
  bar: '#202C33',
  field: '#2A3942',
  inBubble: '#202C33',
  outBubble: '#005C4B',
  text: '#E9EDEF',
  sub: '#8696A0',
  green: '#00A884',
  greenSoft: '#103529',
  greenText: '#D9FDD3',
  blue: '#53BDEB',
  line: 'rgba(134,150,160,0.16)',
  chip: '#182229',
  red: '#F15C6D',
  avatar: '#6A7175',
  quoteBar: '#06CF9C',
};

const TICK_PATH = 'M5 12.5l4.5 4.5L19 7.5';
const PHOTO_PATH = 'M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM20 15l-5-5-11 9';
const NEW_CHAT_PATH = 'M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.9-.9L3 21l1.9-5.6A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5ZM12.5 8v7M9 11.5h7';

const MEDIA_ICON: Record<WaMediaKind, { name?: any; path?: string }> = {
  voice: { name: 'mic' },
  audio: { name: 'headphones' },
  photo: { path: PHOTO_PATH },
  video: { name: 'play' },
  document: { name: 'file' },
  sticker: { name: 'sparkle' },
  location: { name: 'pin' },
  contact: { name: 'user' },
  unsupported: { name: 'help' },
};

/* ======================================================================================= */

export function OpsWhatsApp() {
  const allowed = useCanSeeWhatsApp();
  const { go } = useStore();
  const chatsQ = useWhatsAppChats(allowed);
  useWhatsAppRealtime(allowed);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = React.useState(false);

  // Hardware back / edge swipe inside an open chat goes back to the list instead of leaving the page.
  React.useEffect(() => {
    backOverride.handler = selected ? () => setSelected(null) : null;
    return () => { backOverride.handler = null; };
  }, [!!selected]);

  const chats = chatsQ.data ?? [];
  const listLoaded = chatsQ.isSuccess;
  const selectedChat = React.useMemo(() => chatForKey(chats, selected, listLoaded), [chats, selected, listLoaded]);
  // our own number: the one every chat is on
  const ourNumberId = chats[0]?.phone_number_id ?? parseChatKey(selected)?.phoneNumberId ?? null;

  if (!allowed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10, backgroundColor: WA.bg }}>
        <Icon name="lock" size={26} color={WA.sub} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: WA.text, textAlign: 'center' }}>WhatsApp is for the Ops team</Text>
        <Pressable onPress={() => go('ops-dashboard')} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, color: WA.green }}>Back</Text></Pressable>
      </View>
    );
  }

  if (selected) {
    return selectedChat
      ? <ThreadView chat={selectedChat} onBack={() => setSelected(null)} />
      : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: WA.bg }}><ActivityIndicator color={WA.green} /></View>;
  }

  const startChat = (waId: string) => {
    if (!ourNumberId) return;
    setNewChatOpen(false);
    const found = chats.find((c) => c.contact_wa_id === waId);
    setSelected(chatKey(found ?? placeholderChat(ourNumberId, waId)));
  };

  return (
    <>
      <ChatListView
        chats={chats}
        loading={chatsQ.isLoading}
        error={chatsQ.isError ? chatsQ.error : null}
        refreshing={chatsQ.isRefetching}
        onRefresh={() => chatsQ.refetch()}
        onOpen={(c) => setSelected(chatKey(c))}
        onNewChat={ourNumberId ? () => setNewChatOpen(true) : undefined}
      />
      <NewChatSheet open={newChatOpen} onClose={() => setNewChatOpen(false)} onStart={startChat} />
    </>
  );
}

/* ---------------------------------- the chat list ---------------------------------- */

function WaAvatar({ chat, size = 48 }: { chat: Pick<WaChat, 'contact_name'>; size?: number }) {
  const initials = chatInitials(chat);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: initials ? '#103529' : WA.avatar, alignItems: 'center', justifyContent: 'center' }}>
      {initials
        ? <Text style={{ fontFamily: F.bodySemi, fontSize: size * 0.36, color: '#7AE3C3' }}>{initials}</Text>
        : <Icon name="user" size={size * 0.5} color="#CFD6DA" strokeWidth={2} />}
    </View>
  );
}

function TickIcon({ tick, size = 15 }: { tick: WaTick | null; size?: number }) {
  if (!tick) return null;
  if (tick === 'pending') return <Icon name="clock" size={size - 3} color={WA.sub} strokeWidth={2} />;
  if (tick === 'failed') return <Icon name="alert" size={size - 2} color={WA.red} strokeWidth={2.2} />;
  if (tick === 'sent') return <Icon path={TICK_PATH} size={size} color={WA.sub} strokeWidth={2.2} />;
  return <Icon name="checks" size={size} color={tick === 'read' ? WA.blue : WA.sub} strokeWidth={2.2} />;
}

const typeIconOf = (type: string | null): { name?: any; path?: string } | null => {
  if (type === 'audio') return { name: 'mic' };
  if (type === 'image' || type === 'sticker') return { path: PHOTO_PATH };
  if (type === 'video') return { name: 'play' };
  if (type === 'document') return { name: 'file' };
  if (type === 'location') return { name: 'pin' };
  return null;
};

function ChatListView({ chats, loading, error, refreshing, onRefresh, onOpen, onNewChat }: {
  chats: WaChat[]; loading: boolean; error: unknown; refreshing: boolean; onRefresh: () => void;
  onOpen: (c: WaChat) => void; onNewChat?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');
  const unreadChats = chats.filter((c) => Number(c.unread_count) > 0).length;
  const unreadMsgs = totalUnread(chats);
  const shown = React.useMemo(
    () => chats.filter((c) => chatMatches(c, query) && (filter === 'all' || Number(c.unread_count) > 0)),
    [chats, query, filter],
  );
  const now = new Date();

  const chip = (value: 'all' | 'unread', label: string) => {
    const on = filter === value;
    return (
      <Pressable key={value} onPress={() => setFilter(value)} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on ? WA.greenSoft : WA.bar }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: on ? WA.greenText : WA.sub }}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: WA.list }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: WA.text }}>WhatsApp</Text>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: unreadMsgs ? WA.green : WA.sub }}>{unreadMsgs > 0 ? `${unreadMsgs} unread` : 'All read'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: WA.bar, borderRadius: 999, paddingHorizontal: 14, height: 42 }}>
          <Icon name="search" size={17} color={WA.sub} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or number"
            placeholderTextColor={WA.sub}
            autoCorrect={false}
            style={{ flex: 1, fontFamily: F.body, fontSize: 15, color: WA.text, padding: 0 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="close" size={15} color={WA.sub} strokeWidth={2.2} /></Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {chip('all', 'All')}
          {chip('unread', unreadChats > 0 ? `Unread ${unreadChats}` : 'Unread')}
        </View>
      </View>

      {loading ? (
        <View style={{ paddingTop: 40 }}><ActivityIndicator color={WA.green} /></View>
      ) : error ? (
        <View style={{ padding: 28, alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub, textAlign: 'center' }}>{friendlyError(error, 'The chats could not be loaded. Check your connection and try again.')}</Text>
          <Pressable onPress={onRefresh} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: WA.green }}>Try again</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => chatKey(c)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={14}
          windowSize={9}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={WA.green} colors={[WA.green]} progressBackgroundColor={WA.bar} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          ListEmptyComponent={
            <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub, textAlign: 'center', paddingTop: 36, paddingHorizontal: 24 }}>
              {chats.length === 0 ? 'No chats yet. Messages will show here as they arrive.' : filter === 'unread' && !query.trim() ? 'No unread chats.' : 'No chat matches.'}
            </Text>
          }
          renderItem={({ item: c }) => {
            const unread = Number(c.unread_count) || 0;
            const named = !!(c.contact_name ?? '').trim();
            const tIcon = typeIconOf(c.last_message_type);
            return (
              <Pressable onPress={() => onOpen(c)} android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed && Platform.OS === 'ios' ? WA.bar : 'transparent' })}>
                <WaAvatar chat={c} />
                <View style={{ flex: 1, minWidth: 0, borderBottomWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: unread ? F.bodyBold : F.bodySemi, fontSize: 16, color: WA.text }}>{chatTitle(c)}</Text>
                    <Text style={{ fontFamily: unread ? F.bodySemi : F.body, fontSize: 12, color: unread ? WA.green : WA.sub }}>{listTime(c.last_message_at, now)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                    <TickIcon tick={lastTickOf(c)} size={16} />
                    {tIcon ? <Icon name={tIcon.name} path={tIcon.path} size={14} color={WA.sub} strokeWidth={2} /> : null}
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: unread ? WA.text : WA.sub }}>
                      {c.last_message_preview || (named ? formatWaNumber(c.contact_wa_id) : 'No messages yet')}
                    </Text>
                    {unread > 0 ? (
                      <View style={{ minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6, backgroundColor: WA.green, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${unread} unread`}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: WA.list }}>{unread > 99 ? '99+' : unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {onNewChat ? (
        <Pressable onPress={onNewChat} accessibilityRole="button" accessibilityLabel="New chat" hitSlop={10}
          style={({ pressed }) => ({ position: 'absolute', right: 18, bottom: insets.bottom + 22, width: 56, height: 56, borderRadius: 16, backgroundColor: WA.green, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1, elevation: 6, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } })}>
          <Icon path={NEW_CHAT_PATH} size={24} color={WA.list} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------------------------------- one chat ---------------------------------- */

function ThreadView({ chat, onBack }: { chat: WaChat; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const key = chatKey(chat);
  const [size, setSize] = React.useState(WA_PAGE_SIZE);
  const [unreadMark, setUnreadMark] = React.useState<{ key: string; id: string; count: number } | null>(null);
  const openedFor = React.useRef<string | null>(null);
  const lastSeenNewest = React.useRef<string | null>(null);

  const threadQ = useWhatsAppThread(chat.phone_number_id, chat.contact_wa_id, size);
  const data = threadQ.data;
  const markSeen = useMarkWhatsAppChatSeen();
  const markSeenRef = React.useRef(markSeen.mutate);
  markSeenRef.current = markSeen.mutate;

  // Data of the chat that is open (not the previous chat's rows shown while the new ones load).
  const ready = !!data && !threadQ.isPlaceholderData && (data.messages.length === 0 || data.messages[0].contact_wa_id === chat.contact_wa_id);

  // First load: remember where the unread messages start, then mark the chat as seen.
  React.useEffect(() => {
    if (!ready || !data || openedFor.current === key) return;
    openedFor.current = key;
    const first = firstUnread(data.messages);
    setUnreadMark(first ? { key, ...first } : null);
    if (first || Number(chat.unread_count) > 0) markSeenRef.current({ phoneNumberId: chat.phone_number_id, contactWaId: chat.contact_wa_id });
  }, [ready, data, key]);

  // A new message arrives while the chat is open and the app is in front: it has been seen.
  const newestId = ready && data && data.messages.length ? data.messages[data.messages.length - 1].id : null;
  React.useEffect(() => {
    if (!ready || !data || !newestId) return;
    const had = lastSeenNewest.current;
    lastSeenNewest.current = newestId;
    if (!had || had === newestId) return;
    if (data.messages.some((m) => m.direction === 'in' && !m.seen_at) && AppState.currentState === 'active') {
      markSeenRef.current({ phoneNumberId: chat.phone_number_id, contactWaId: chat.contact_wa_id });
    }
  }, [ready, data, newestId]);

  // Replies typed here that the table does not show yet, or that the server refused before storing them.
  const [localSends, setLocalSends] = React.useState<WaLocalSend[]>([]);
  const checkQ = useWhatsAppSendCheck(chat.phone_number_id, chat.contact_wa_id);
  const send = useSendWhatsApp();
  const sendRef = React.useRef(send.mutateAsync);
  sendRef.current = send.mutateAsync;
  const sendTpl = useSendWhatsAppTemplate();
  const sendTplRef = React.useRef(sendTpl.mutateAsync);
  sendTplRef.current = sendTpl.mutateAsync;
  const [templatesOpen, setTemplatesOpen] = React.useState(false);

  const dropLocal = React.useCallback((ref: string) => setLocalSends((l) => l.filter((s) => s.clientRef !== ref)), []);
  const failLocal = React.useCallback((ref: string, message: string) => setLocalSends((l) => l.map((s) => (s.clientRef === ref ? { ...s, state: 'failed', error: message } : s))), []);

  /** Sends a reply. With a clientRef it is a retry of that reply: the server never sends it twice. */
  const sendReply = (text: string, clientRef?: string) => {
    const ref = clientRef ?? newClientRef();
    const mine: WaLocalSend = { clientRef: ref, phoneNumberId: chat.phone_number_id, contactWaId: chat.contact_wa_id, text, at: new Date().toISOString(), state: 'sending' };
    setLocalSends((l) => [...l.filter((s) => s.clientRef !== ref), mine]);
    sendRef.current({ phoneNumberId: mine.phoneNumberId, contactWaId: mine.contactWaId, clientRef: ref, text })
      .then((res) => {
        // Stored: the row of the table takes over (it hides the local bubble by its client_ref); the local one is
        // dropped a little later in any case, so it can never stay "sending" for ever.
        if (res.ok || res.stored) setTimeout(() => dropLocal(ref), 8000);
        else failLocal(ref, res.message ?? WA_SEND_FAILED);
      })
      .catch(() => failLocal(ref, WA_SEND_FAILED));
  };

  /** Sends a template. With a clientRef it is a retry: the server sends what it stored the first time. */
  const sendTemplate = (tpl: { name: string; language: string; values: WaTemplateValues; text: string }, clientRef?: string) => {
    const ref = clientRef ?? newClientRef();
    const mine: WaLocalSend = {
      clientRef: ref, phoneNumberId: chat.phone_number_id, contactWaId: chat.contact_wa_id, text: tpl.text, at: new Date().toISOString(), state: 'sending',
      template: { name: tpl.name, language: tpl.language, values: tpl.values },
    };
    setLocalSends((l) => [...l.filter((s) => s.clientRef !== ref), mine]);
    sendTplRef.current({ phoneNumberId: mine.phoneNumberId, contactWaId: mine.contactWaId, clientRef: ref, templateName: tpl.name, language: tpl.language, values: tpl.values })
      .then((res) => {
        if (res.ok || res.stored) setTimeout(() => dropLocal(ref), 8000);
        else failLocal(ref, res.message ?? WA_SEND_FAILED);
      })
      .catch(() => failLocal(ref, WA_SEND_FAILED));
  };

  const title = chatTitle(chat);
  const named = !!(chat.contact_name ?? '').trim();
  const localBubbles = ready && data ? localSendBubbles(localSends, data.messages, chat) : [];
  const items = React.useMemo(
    () => (ready && data
      ? buildThread({ messages: [...data.messages, ...localBubbles], reactions: data.reactions, quoted: data.quoted, unread: unreadMark && unreadMark.key === key ? unreadMark : null })
      : []),
    [ready, data, localBubbles.map((b) => `${b.id}${b.status}`).join(','), unreadMark, key],
  );
  // Newest at the bottom: the list is inverted, so it is given newest first.
  const inverted = React.useMemo(() => items.slice().reverse(), [items]);

  const retryOf = (m: WaMessage): (() => void) | undefined => {
    if (!canRetrySend(m)) return undefined;
    const name = templateNameOf(m);
    const language = templateLanguageOf(m);
    if (name && language) return () => sendTemplate({ name, language, values: m.payload?.template?.values ?? emptyTemplateValues(), text: (m.body ?? '').trim() }, m.client_ref as string);
    return () => sendReply((m.body ?? '').trim(), m.client_ref as string);
  };
  const discardOf = (m: WaMessage): (() => void) | undefined =>
    m.payload?.local && m.status === 'failed' && m.client_ref ? () => dropLocal(m.client_ref as string) : undefined;

  const loadOlder = () => {
    if (data?.hasOlder && !threadQ.isFetching) setSize((s) => s + WA_PAGE_SIZE);
  };

  return (
    <View style={{ flex: 1, backgroundColor: WA.bg, paddingBottom: kb > 0 ? kb + (Platform.OS === 'android' ? insets.bottom : 0) : 0 }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: WA.bar }}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back to chats" style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrowLeft" size={21} color={WA.text} strokeWidth={2.2} />
        </Pressable>
        <WaAvatar chat={chat} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 16, color: WA.text }}>{title}</Text>
          <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12, color: WA.sub, marginTop: 1 }}>{named ? formatWaNumber(chat.contact_wa_id) : 'Name not shared yet'}</Text>
        </View>
      </View>

      {/* messages */}
      <View style={{ flex: 1 }}>
        {!ready && threadQ.isError ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 }}>
            <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub, textAlign: 'center' }}>{friendlyError(threadQ.error, 'The messages could not be loaded. Check your connection and try again.')}</Text>
            <Pressable onPress={() => threadQ.refetch()} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, color: WA.green }}>Try again</Text></Pressable>
          </View>
        ) : !ready ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={WA.green} /></View>
        ) : inverted.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
            <View style={{ backgroundColor: WA.chip, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }}>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: WA.sub, textAlign: 'center' }}>No messages in this chat yet.</Text>
            </View>
          </View>
        ) : (
          <FlatList
            data={inverted}
            inverted
            keyExtractor={(it) => it.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={20}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10 }}
            ListFooterComponent={data?.hasOlder ? (
              <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                {threadQ.isFetching ? <ActivityIndicator color={WA.green} /> : (
                  <Pressable onPress={loadOlder} hitSlop={10} style={{ backgroundColor: WA.chip, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: WA.sub }}>Load older messages</Text>
                  </Pressable>
                )}
              </View>
            ) : undefined}
            renderItem={({ item }) =>
              item.kind === 'day' ? (
                <View style={{ alignItems: 'center', marginVertical: 8 }}>
                  <View style={{ backgroundColor: WA.chip, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: WA.sub }}>{item.label}</Text>
                  </View>
                </View>
              ) : item.kind === 'unread' ? (
                <View style={{ alignItems: 'center', marginVertical: 8, backgroundColor: 'rgba(32,44,51,0.7)', paddingVertical: 6 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: WA.text }}>{item.count} unread {item.count === 1 ? 'message' : 'messages'}</Text>
                </View>
              ) : (
                <Bubble message={item.message} reactions={item.reactions} quoted={item.quoted} quotedMissing={item.quotedMissing} contactName={title}
                  onRetry={retryOf(item.message)} onDiscard={discardOf(item.message)} />
              )
            }
          />
        )}
      </View>

      <Composer chat={chat} check={checkQ.data ?? null} onSend={(t) => sendReply(t)} onOpenTemplates={() => { Keyboard.dismiss(); setTemplatesOpen(true); }} bottomInset={kb > 0 ? 0 : insets.bottom} />
      <TemplateSheet open={templatesOpen} onClose={() => setTemplatesOpen(false)} contactTitle={title}
        onSend={(t, values) => { setTemplatesOpen(false); sendTemplate({ name: t.name, language: t.language, values, text: templateSentText(t, values) }); }} />
    </View>
  );
}

/* ---------------------------------- one bubble ---------------------------------- */

const Bubble = React.memo(function Bubble({ message, reactions, quoted, quotedMissing, contactName, onRetry, onDiscard }: {
  message: WaMessage; reactions: WaReactionShown[]; quoted: WaMessage | null; quotedMissing: boolean; contactName: string;
  onRetry?: () => void; onDiscard?: () => void;
}) {
  const mine = message.direction === 'out';
  const media = mediaOf(message);
  const text = (message.body ?? '').trim();
  const from = sentFromLabel(message);
  const metaColor = mine ? 'rgba(233,237,239,0.62)' : WA.sub;
  const mi = media ? MEDIA_ICON[media.kind] : null;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginVertical: 2, marginBottom: reactions.length ? 14 : 2 }}>
      <View style={{ maxWidth: '84%' }}>
        <View style={{
          backgroundColor: mine ? WA.outBubble : WA.inBubble, borderRadius: 10, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 5,
          borderTopRightRadius: mine ? 2 : 10, borderTopLeftRadius: mine ? 10 : 2,
        }}>
          {quoted || quotedMissing ? (
            <View style={{ flexDirection: 'row', borderRadius: 7, overflow: 'hidden', backgroundColor: mine ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.05)', marginBottom: 5 }}>
              <View style={{ width: 4, backgroundColor: quoted?.direction === 'out' ? WA.blue : WA.quoteBar }} />
              <View style={{ flex: 1, paddingVertical: 5, paddingHorizontal: 8 }}>
                {quoted ? (
                  <>
                    <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: quoted.direction === 'out' ? WA.blue : WA.quoteBar }}>{quoted.direction === 'out' ? 'You' : contactName}</Text>
                    <Text numberOfLines={2} style={{ fontFamily: F.body, fontSize: 13, color: WA.sub, marginTop: 1 }}>{messagePreview(quoted)}</Text>
                  </>
                ) : (
                  <Text style={{ fontFamily: F.body, fontSize: 13, color: WA.sub }}>Reply to an earlier message</Text>
                )}
              </View>
            </View>
          ) : null}

          {media && mi ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2, minWidth: 180 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: mine ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={mi.name} path={mi.path} size={18} color={WA.text} strokeWidth={2} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14, color: WA.text }}>{media.label}</Text>
                {media.kind === 'unsupported' ? (
                  <Text style={{ fontFamily: F.body, fontSize: 12, color: metaColor, marginTop: 1 }}>{media.detail}</Text>
                ) : media.kind !== 'location' && media.kind !== 'contact' ? (
                  <Text style={{ fontFamily: F.body, fontSize: 12, color: metaColor, marginTop: 1 }}>Open it on the phone for now</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {text ? <Text selectable style={{ fontFamily: F.body, fontSize: 15, lineHeight: 20.5, color: WA.text, marginTop: media ? 5 : 0 }}>{text}</Text> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
            {from ? <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.body, fontSize: 11, color: metaColor, marginRight: 'auto', paddingRight: 8 }}>{from}</Text> : null}
            {isEdited(message) ? <Text style={{ fontFamily: F.body, fontSize: 11, color: metaColor }}>Edited</Text> : null}
            <Text style={{ fontFamily: F.body, fontSize: 11, color: metaColor }}>{bubbleTime(message.wa_timestamp)}</Text>
            <TickIcon tick={tickOf(message)} size={15} />
          </View>

          {mine && message.status === 'failed' ? (
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontFamily: F.body, fontSize: 12, color: '#FFB3BC' }}>{failedLabel(message)}</Text>
              {onRetry || onDiscard ? (
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
                  {onRetry ? <Pressable onPress={onRetry} hitSlop={10}><Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: WA.text, textDecorationLine: 'underline' }}>Try again</Text></Pressable> : null}
                  {onDiscard ? <Pressable onPress={onDiscard} hitSlop={10}><Text style={{ fontFamily: F.body, fontSize: 12.5, color: metaColor, textDecorationLine: 'underline' }}>Remove</Text></Pressable> : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {reactions.length ? (
          <View style={{ position: 'absolute', bottom: -13, ...(mine ? { right: 8 } : { left: 8 }), flexDirection: 'row', gap: 2, backgroundColor: WA.bar, borderRadius: 999, borderWidth: 2, borderColor: WA.bg, paddingHorizontal: 5, paddingVertical: 1 }}>
            {reactions.map((r) => <Text key={r.direction} style={{ fontSize: 13 }}>{r.emoji}</Text>)}
          </View>
        ) : null}
      </View>
    </View>
  );
});

/* ---------------------------------- the reply bar ---------------------------------- */

function Composer({ chat, check, onSend, onOpenTemplates, bottomInset }: {
  chat: WaChat; check: WaSendCheck | null; onSend: (text: string) => void; onOpenTemplates: () => void; bottomInset: number;
}) {
  const [text, setText] = React.useState('');
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { setText(''); }, [chatKey(chat)]);
  // The 24 hours run out while the chat is open: look again every half minute.
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const mode = composerMode(chat, check, now);
  const pad = { paddingBottom: 8 + bottomInset };

  if (mode.kind === 'checking' || mode.kind === 'locked') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, backgroundColor: WA.bar }, pad]}>
        {mode.kind === 'checking' ? <ActivityIndicator size="small" color={WA.sub} /> : <Icon name="lock" size={15} color={WA.sub} strokeWidth={2} />}
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: WA.sub }}>{mode.kind === 'locked' ? mode.message : 'Checking whether you can reply here...'}</Text>
      </View>
    );
  }

  if (mode.kind === 'template_only') {
    return (
      <View style={[{ paddingHorizontal: 14, paddingTop: 10, gap: 10, backgroundColor: WA.bar }, pad]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={15} color={WA.sub} strokeWidth={2} />
          <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: WA.sub }}>{mode.message}</Text>
        </View>
        <Pressable onPress={onOpenTemplates} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 999, backgroundColor: WA.green, opacity: pressed ? 0.85 : 1 })}>
          <Icon name="file" size={16} color={WA.list} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: WA.list }}>Send a template</Text>
        </Pressable>
      </View>
    );
  }

  const problem = composerProblem(text);
  const length = Array.from(text.trim()).length;
  const left = replyWindow(chat.last_inbound_at, now).msLeft;
  const submit = () => {
    if (problem) return;
    Haptics.selectionAsync().catch(() => {});
    onSend(text.trim());
    setText('');
  };

  return (
    <View style={[{ paddingHorizontal: 8, paddingTop: 6, backgroundColor: WA.bg }, pad]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: WA.bar, borderRadius: 24, paddingLeft: 6, paddingRight: 14, minHeight: 48 }}>
          <Pressable onPress={onOpenTemplates} hitSlop={10} accessibilityLabel="Send a template" style={{ width: 38, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file" size={20} color={WA.sub} strokeWidth={2} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={WA.sub}
            multiline
            maxLength={WA_TEXT_MAX + 200}
            style={{ flex: 1, fontFamily: F.body, fontSize: 16, lineHeight: 21, color: WA.text, paddingTop: Platform.OS === 'ios' ? 14 : 12, paddingBottom: Platform.OS === 'ios' ? 14 : 12, maxHeight: 130 }}
          />
        </View>
        <Pressable onPress={submit} disabled={!!problem} accessibilityRole="button" accessibilityLabel="Send"
          style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: problem ? WA.field : WA.green, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Icon name="send" size={20} color={problem ? WA.sub : WA.list} strokeWidth={2.2} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 4 }}>
        <Text style={{ flex: 1, fontFamily: F.body, fontSize: 11.5, color: WA.sub }}>You can reply here for {windowLeftText(left)} more.</Text>
        {length > WA_TEXT_MAX - 500 ? (
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: length > WA_TEXT_MAX ? WA.red : WA.sub }}>{length} / {WA_TEXT_MAX}</Text>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------- sheets ---------------------------------- */

function SheetShell({ open, onClose, title, children, onBack }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onBack ?? onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} accessibilityLabel="Close" />
        <View style={{ maxHeight: '90%', backgroundColor: WA.list, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: kb > 0 ? kb + 14 : insets.bottom + 16 }}>
          <View style={{ alignItems: 'center', paddingTop: 8 }}><View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(134,150,160,0.4)' }} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10 }}>
            {onBack ? (
              <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back"><Icon name="arrowLeft" size={20} color={WA.text} strokeWidth={2.2} /></Pressable>
            ) : null}
            <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 18, color: WA.text }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><Icon name="close" size={18} color={WA.sub} strokeWidth={2.2} /></Pressable>
          </View>
          <View style={{ flexShrink: 1, minHeight: 0 }}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

function TemplateSheet({ open, onClose, contactTitle, onSend }: { open: boolean; onClose: () => void; contactTitle: string; onSend: (t: WaTemplate, values: WaTemplateValues) => void }) {
  const q = useWhatsAppTemplates(open);
  const templates = q.data ?? [];
  const [query, setQuery] = React.useState('');
  const [pickedKey, setPickedKey] = React.useState<string | null>(null);
  const [values, setValues] = React.useState<WaTemplateValues>(emptyTemplateValues);

  React.useEffect(() => {
    if (open) { setQuery(''); setPickedKey(null); setValues(emptyTemplateValues()); }
  }, [open]);

  const picked = templates.find((t) => templateKey(t) === pickedKey) ?? null;
  const shown = templates.filter((t) => templateMatches(t, query));
  const problem = templateProblem(picked, values);
  const preview = picked ? templatePreview(picked, values) : null;
  const blanks = picked ? [...picked.variables.header.map((n) => ['header', n] as const), ...picked.variables.body.map((n) => ['body', n] as const)] : [];
  const setBlank = (part: 'header' | 'body', name: string, v: string) => setValues((cur) => ({ ...cur, [part]: { ...cur[part], [name]: v } }));

  return (
    <SheetShell open={open} onClose={onClose} title={picked ? picked.name : 'Send a template'} onBack={picked ? () => setPickedKey(null) : undefined}>
      {q.isLoading ? (
        <View style={{ padding: 30 }}><ActivityIndicator color={WA.green} /></View>
      ) : q.isError ? (
        <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub, textAlign: 'center' }}>{friendlyError(q.error, 'The templates could not be loaded. Check your connection and try again.')}</Text>
          <Pressable onPress={() => q.refetch()} hitSlop={10}><Text style={{ fontFamily: F.bodySemi, color: WA.green }}>{q.isFetching ? 'Loading...' : 'Try again'}</Text></Pressable>
        </View>
      ) : templates.length === 0 ? (
        <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub, textAlign: 'center', padding: 24 }}>No approved template yet. Templates are made in Chakra and approved by WhatsApp.</Text>
      ) : !picked || !preview ? (
        <View style={{ flexShrink: 1, minHeight: 0 }}>
          <Text style={{ fontFamily: F.body, fontSize: 13, color: WA.sub, paddingHorizontal: 16, paddingBottom: 10 }}>Pick an approved template, check what {contactTitle} will receive, then send it.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: WA.bar, borderRadius: 999, paddingHorizontal: 14, height: 40, marginHorizontal: 14, marginBottom: 6 }}>
            <Icon name="search" size={16} color={WA.sub} strokeWidth={2} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search templates" placeholderTextColor={WA.sub} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14.5, color: WA.text, padding: 0 }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {shown.length === 0 ? <Text style={{ fontFamily: F.body, fontSize: 13, color: WA.sub, textAlign: 'center', padding: 18 }}>No template matches.</Text> : null}
            {shown.map((t) => (
              <Pressable key={templateKey(t)} onPress={() => { setPickedKey(templateKey(t)); setValues(emptyTemplateValues()); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed ? WA.bar : 'transparent', opacity: t.sendable ? 1 : 0.55 })}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: WA.greenSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="file" size={16} color={WA.green} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: WA.text }}>{t.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 12, color: WA.sub, marginTop: 1 }}>
                    {templateCategoryLabel(t.category)} · {t.language}{t.sendable ? '' : ' · not sendable here'}
                  </Text>
                </View>
                <Icon name="chevRight" size={15} color={WA.sub} strokeWidth={2.2} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6, gap: 12 }}>
          {/* the template as the person will see it */}
          <View style={{ backgroundColor: WA.bg, borderRadius: 12, padding: 12 }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '92%', backgroundColor: WA.outBubble, borderRadius: 10, borderTopRightRadius: 2, paddingHorizontal: 10, paddingVertical: 7 }}>
              {preview.header ? <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: WA.text, marginBottom: 3 }}>{preview.header}</Text> : null}
              <Text style={{ fontFamily: F.body, fontSize: 14.5, lineHeight: 20, color: WA.text }}>{preview.body}</Text>
              {preview.footer ? <Text style={{ fontFamily: F.body, fontSize: 12, color: 'rgba(233,237,239,0.62)', marginTop: 4 }}>{preview.footer}</Text> : null}
              {preview.buttons.length ? (
                <View style={{ marginTop: 7, borderTopWidth: 1, borderTopColor: 'rgba(233,237,239,0.12)', paddingTop: 6, gap: 4 }}>
                  {preview.buttons.map((b, i) => <Text key={`${b}-${i}`} style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: WA.blue, textAlign: 'center', paddingVertical: 3 }}>{b}</Text>)}
                </View>
              ) : null}
            </View>
          </View>

          {blanks.map(([part, name]) => (
            <View key={`${part}-${name}`} style={{ gap: 5 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: WA.sub }}>{blankLabel(name)}{part === 'header' ? ' (top line)' : ''}</Text>
              <TextInput value={values[part][name] ?? ''} onChangeText={(v) => setBlank(part, name, v)} placeholder={`{{${name}}}`} placeholderTextColor={WA.sub} maxLength={500}
                style={{ backgroundColor: WA.bar, borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 11 : 8, fontFamily: F.body, fontSize: 15, color: WA.text }} />
            </View>
          ))}

          <Text style={{ fontFamily: F.body, fontSize: 12, color: WA.sub }}>{templateCategoryLabel(picked.category)} template, language {picked.language}. WhatsApp charges for each template message.</Text>
          {problem ? <Text style={{ fontFamily: F.body, fontSize: 12.5, color: picked.sendable ? WA.sub : '#F2C46D' }}>{problem}</Text> : null}
          <Pressable onPress={() => !problem && onSend(picked, values)} disabled={!!problem} accessibilityRole="button"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 999, backgroundColor: problem ? WA.field : WA.green, opacity: pressed ? 0.85 : 1 })}>
            <Icon name="send" size={17} color={problem ? WA.sub : WA.list} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: problem ? WA.sub : WA.list }}>Send to {contactTitle}</Text>
          </Pressable>
        </ScrollView>
      )}
    </SheetShell>
  );
}

function NewChatSheet({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (waId: string) => void }) {
  const [value, setValue] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => { if (open) { setValue(''); setTouched(false); } }, [open]);
  const parsed = parseNewChatNumber(value);
  const submit = () => {
    setTouched(true);
    if (parsed.ok) onStart(parsed.waId);
  };
  return (
    <SheetShell open={open} onClose={onClose} title="New chat">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 4 }}>
        <Text style={{ fontFamily: F.body, fontSize: 13.5, color: WA.sub }}>Message a number that is not in the list yet.</Text>
        <TextInput
          autoFocus
          value={value}
          onChangeText={setValue}
          onSubmitEditing={submit}
          keyboardType="phone-pad"
          placeholder="Mobile number"
          placeholderTextColor={WA.sub}
          style={{ backgroundColor: WA.bar, borderRadius: 12, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 13 : 10, fontFamily: F.body, fontSize: 17, color: WA.text }}
        />
        {parsed.ok ? (
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: WA.green }}>Will open {formatWaNumber(parsed.waId)}</Text>
        ) : (
          <Text style={{ fontFamily: F.body, fontSize: 12.5, color: touched && value.trim() ? WA.red : WA.sub }}>{touched && value.trim() && !parsed.ok ? parsed.error : WA_NEW_CHAT_HINT}</Text>
        )}
        <Text style={{ fontFamily: F.body, fontSize: 12.5, color: WA.sub }}>The first message to a new number can only be an approved template. Once the person replies, you can type freely for 24 hours.</Text>
        <Pressable onPress={submit} disabled={!parsed.ok} accessibilityRole="button"
          style={({ pressed }) => ({ height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: parsed.ok ? WA.green : WA.field, opacity: pressed ? 0.85 : 1, marginTop: 4 })}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: parsed.ok ? WA.list : WA.sub }}>Open chat</Text>
        </Pressable>
      </ScrollView>
    </SheetShell>
  );
}

/* ---------------------------------- Ops dashboard entry ---------------------------------- */

/** The WhatsApp card on the Ops dashboard: the unread count, opens the page. Draws nothing for other roles. */
export function OpsWhatsAppCard() {
  const allowed = useCanSeeWhatsApp();
  const unread = useWhatsAppUnreadCount();
  const { go } = useStore();
  if (!allowed) return null;
  return (
    <Pressable onPress={() => go('ops-whatsapp')} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 17, backgroundColor: '#0E1A17', borderWidth: 1, borderColor: 'rgba(0,168,132,0.35)', opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: WA.green, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bubble" size={20} color={WA.list} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: WA.text }}>WhatsApp</Text>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: WA.sub, marginTop: 1 }}>{unread > 0 ? `${unread} unread ${unread === 1 ? 'message' : 'messages'}` : 'All chats read'}</Text>
      </View>
      {unread > 0 ? (
        <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: WA.green, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: WA.list }}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
      <Icon name="chevRight" size={16} color={WA.green} strokeWidth={2.3} />
    </Pressable>
  );
}
