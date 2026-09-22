import React from 'react';
import { View, Text, Pressable, TextInput, Modal, Alert, Image, Animated, Easing, ActivityIndicator, Linking, Platform, ScrollView, Keyboard, LayoutAnimation, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, AccessPending, HScroll } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { VoicePlayer, useVoiceRecorder, VoiceHoldButton } from '../components/VoiceNote';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';

import {
  ACK_VERDICT_LABEL, ALL_PLATFORMS, ALL_TYPES, PRIORITY_COLOR, PRIORITY_LABEL, PLATFORM_LABEL, PLATFORM_ON_TICKET,
  STATUS_COLOR, STATUS_LABEL, STAGE_LABEL, STAGE_ORDER,
  TYPE_ICON, TYPE_LABEL, TYPE_LABEL_LONG, TYPE_PROMPT, RESOLUTION_LABEL, TechAck, TechAckVerdict, TechMessage, TechPlatform, TechPriority, TechTicket, TechType,
  ackLine, awaitingMyAck, clockOf, currentTechRoute, fmtBytes, fullStamp, initialsOf, isOpenStatus, personName, reachedAtMap,
  sortTickets, stageIndexOf, statusColor, systemLineText, ticketNo, timeAgo, togglePlatformIn, typeLongOf,
} from '../lib/techDesk';
import {
  PickedTechFile, canUseTechDesk, isTechStaffRole, reporterHasUnread,
  useAcknowledgeTicket, useCloseTicketWithReason, useMarkTicketSeen, useRaiseTicket, useSendTechMessage, useSignedTechUrl,
  useTechActivity, useTechDeskRealtime, useTechMessages, useTechStaff, useTechTicket, useTechTickets,
} from '../lib/techDeskQueries';

/* ============ Tech Desk — member side (raise, track, converse) ============
   Every staff role except super_admin gets these screens. The tech/admin console
   lives in techDeskInbox.tsx and reuses the shared pieces exported from here. */

/* ---------- shared atoms ---------- */

/** Breathing dot — used for live pills, unread pings and the current stage ring. */
export function Pulse({ color, size = 7, style }: { color: string; size?: number; style?: any }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={[{
      width: size, height: size, borderRadius: size, backgroundColor: color,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
    }, style]} />
  );
}

export function FadeIn({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: any }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

/* Keyboard lift for a pinned composer — the messenger's recipe (manual height,
   because KeyboardAvoidingView is unreliable on Android edge-to-edge), with a
   LayoutAnimation so the bar glides with the keyboard instead of jumping. */
export function useComposerLift() {
  const insets = useSafeAreaInsets();
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(Platform.OS === 'ios' ? (e?.duration || 250) : 200, 'easeInEaseOut', 'opacity'));
      setKbH(e.endCoordinates?.height ?? 0);
    });
    const h = Keyboard.addListener(hideEvt, (e: any) => {
      LayoutAnimation.configureNext(LayoutAnimation.create(Platform.OS === 'ios' ? (e?.duration || 220) : 180, 'easeInEaseOut', 'opacity'));
      setKbH(0);
    });
    return () => { s.remove(); h.remove(); };
  }, []);
  // Android edge-to-edge under-reports the keyboard by the bottom system-bar inset.
  const lift = kbH > 0 ? kbH + (Platform.OS === 'android' ? insets.bottom : 0) : 0;
  return { padBottom: lift > 0 ? lift + 12 : insets.bottom + 12, lifted: lift > 0 };
}

export function StatusChip({ status, small, dark }: { status: TechTicket['status']; small?: boolean; dark?: boolean }) {
  const col = statusColor(status, dark);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: small ? 3 : 5, paddingHorizontal: small ? 8 : 10, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.35) }}>
      <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: col }} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 9.5 : 10.5, color: col }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function PriorityDot({ priority }: { priority: TechPriority }) {
  const col = PRIORITY_COLOR[priority];
  if (priority === 'urgent') return <Pulse color={col} size={7} />;
  return <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: col }} />;
}

export function PersonAvatar({ name, url, size = 24, ring }: { name: string; url?: string | null; size?: number; ring?: string }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 1.5 : 0, borderColor: ring ?? 'transparent' }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: ring ? 1.5 : 1, borderColor: ring ?? 'rgba(255,255,255,0.12)' }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: size * 0.38, color: C.ink2 }}>{initialsOf(name)}</Text>
    </View>
  );
}

/* ---------- voice memo recording ----------
   The recorder, hold button and player live in components/VoiceNote.tsx,
   shared with the CRM communication log (15 Sep 2026). */

/* ---------- attachments ---------- */
export async function pickTechMedia(): Promise<PickedTechFile[]> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 5 });
  if (res.canceled || !res.assets?.length) return [];
  return res.assets.map((a) => {
    const mime = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
    return { uri: a.uri, name: a.fileName || (mime.startsWith('video') ? 'video.mp4' : 'photo.jpg'), mime, size: (a as any).fileSize ?? 0 };
  });
}
export async function pickTechPdf(): Promise<PickedTechFile[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return [];
  const a = res.assets[0];
  return [{ uri: a.uri, name: a.name || 'document.pdf', mime: a.mimeType || 'application/pdf', size: a.size ?? 0 }];
}
export function attachMenu(onPicked: (files: PickedTechFile[]) => void) {
  Alert.alert('Attach', 'Screenshots help Tech reproduce the issue.', [
    { text: 'Photo or video', onPress: () => pickTechMedia().then(onPicked).catch((e) => Alert.alert("Couldn't open gallery", String(e?.message ?? e))) },
    { text: 'PDF', onPress: () => pickTechPdf().then(onPicked).catch((e) => Alert.alert("Couldn't open files", String(e?.message ?? e))) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/* ---------- voice memo player ----------
   Resolves the short-lived signed URL, then streams it through the shared player. */
function VoiceMemo({ path, dark }: { path: string; dark?: boolean }) {
  const urlQ = useSignedTechUrl(path);
  return <VoicePlayer url={urlQ.data ?? null} accent={dark ? '#5CE1E6' : C.orange} />;
}

/* ---------- in-app file preview ----------
   Attachments used to leave the app through Linking.openURL, which handed a
   private signed URL to the browser and dropped the user out of the ticket.
   This keeps them inside: photos pinch-zoom (iOS) in a black viewer, videos play
   through expo-video, PDFs render in a WebView. WKWebView shows PDFs natively;
   Android's WebView cannot, so it goes through the Docs viewer, the same
   fallback the messenger and PdfPreview already use. The signed URL is never
   shown to the user. */
function PreviewVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.play(); });
  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" />;
}

export function TechFilePreview({ file, url, onClose }: { file: { name: string; kind: string } | null; url: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [pdfFailed, setPdfFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => { setPdfFailed(false); }, [url]);
  if (!file || !url) return null;
  const docUri = Platform.OS === 'android' ? `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}` : url;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {file.kind === 'image' ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
            maximumZoomScale={5} minimumZoomScale={1} centerContent
            showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
          >
            <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel={file.name} />
          </ScrollView>
        ) : file.kind === 'video' ? (
          <PreviewVideo uri={url} />
        ) : pdfFailed ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 }}>
            <Icon name="file" size={28} color={C.muted3} strokeWidth={1.8} />
            <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>Couldn't preview this file in the app.</Body>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable onPress={() => { setPdfFailed(false); setAttempt((a) => a + 1); }} accessibilityRole="button"
                style={{ minHeight: 42, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Retry</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL(url).catch(() => Alert.alert("Couldn't open the file"))} accessibilityRole="button"
                style={{ minHeight: 42, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 11, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.blue }}>Open outside the app</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <WebView
            key={attempt}
            source={{ uri: docUri }}
            style={{ flex: 1, backgroundColor: '#000' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#000' }}>
                <ActivityIndicator color={C.orange} size="large" />
                <Mono style={{ fontSize: 9, color: C.muted3 }}>LOADING {file.kind.toUpperCase()}</Mono>
              </View>
            )}
            onError={() => setPdfFailed(true)}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) setPdfFailed(true); }}
          />
        )}

        {/* Header floats over the content: name on the left, close on the right. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{file.name}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close preview"
            style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={18} color="#fff" strokeWidth={2.4} />
          </Pressable>
        </View>
        {file.kind === 'image' && Platform.OS === 'ios' ? (
          <View pointerEvents="none" style={{ position: 'absolute', bottom: insets.bottom + 16, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <Mono style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.75)' }}>PINCH TO ZOOM</Mono>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/* ---------- file bubble (signed url, 10 min) ---------- */
function FileBlock({ file, dark }: { file: { path: string; name: string; mime: string; size: number; kind: string }; dark?: boolean }) {
  const urlQ = useSignedTechUrl(file.path);
  const url = urlQ.data ?? null;
  const [open, setOpen] = React.useState(false);
  // Open the in-app viewer; a URL that has not resolved yet just does nothing.
  const show = () => { if (url) setOpen(true); };
  if (file.kind === 'audio') return <VoiceMemo path={file.path} dark={dark} />;
  const bubble = file.kind === 'image' ? (
    <Pressable onPress={show} accessibilityRole="imagebutton" accessibilityLabel={`Attachment ${file.name}. Opens a preview.`} style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', minHeight: 130, justifyContent: 'center' }}>
      {url ? <Image source={{ uri: url }} style={{ width: 190, height: 140 }} resizeMode="cover" /> : <ActivityIndicator color={dark ? '#5CE1E6' : C.orange} />}
    </Pressable>
  ) : (
    <Pressable onPress={show} accessibilityRole="button" accessibilityLabel={`Preview ${file.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', opacity: url ? 1 : 0.6 }}>
      <Icon name={file.kind === 'video' ? 'eye' : 'file'} size={15} color={dark ? '#5CE1E6' : C.orange} strokeWidth={2} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{file.name}</Text>
        <Mono style={{ fontSize: 9, color: C.muted3 }}>{file.kind.toUpperCase()}{file.size ? ` · ${fmtBytes(file.size)}` : ''} · TAP TO PREVIEW</Mono>
      </View>
    </Pressable>
  );
  return (
    <>
      {bubble}
      <TechFilePreview file={open ? file : null} url={url} onClose={() => setOpen(false)} />
    </>
  );
}

/* ---------- thread ---------- */
export function Thread({ ticket, messages, meId, dark }: { ticket: TechTicket; messages: TechMessage[]; meId: string; dark?: boolean }) {
  const staffQ = useTechStaff();
  const staffName = React.useCallback((id: string) => {
    const p = (staffQ.data ?? []).find((s) => s.id === id);
    return p ? personName(p) : null;
  }, [staffQ.data]);

  if (!messages.length) {
    return <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 16 }}>No messages yet.</Body>;
  }
  return (
    <View style={{ gap: 10 }}>
      {messages.map((m) => {
        const p = m.message;
        if (!p) return null;
        if (p.type === 'system') {
          const actor = m.sender ? personName(m.sender) : 'System';
          const col = p.event === 'status' ? statusColor(p.to as any, dark) ?? C.muted2
            : p.event === 'priority' ? (PRIORITY_COLOR as any)[p.to ?? ''] ?? C.muted2 : C.muted2;
          return (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 2 }}>
              <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: col }} />
              <Mono style={{ fontSize: 9.5, color: C.muted3, textAlign: 'center' }}>
                {systemLineText(p, actor, staffName)} · {timeAgo(m.created_at)}
              </Mono>
            </View>
          );
        }
        // Reporter on the left, Tech Desk on the right.
        const mine = m.sender_id === ticket.created_by;
        const name = m.sender ? personName(m.sender) : 'Tech Desk';
        const role = (m.sender?.role ?? 'tech').toUpperCase();
        const bg = mine ? 'rgba(255,255,255,0.06)' : hexA(dark ? '#5CE1E6' : C.orange, 0.13);
        const bd = mine ? 'rgba(255,255,255,0.1)' : hexA(dark ? '#5CE1E6' : C.orange, 0.32);
        return (
          <View key={m.id} style={{ alignSelf: mine ? 'flex-start' : 'flex-end', maxWidth: '88%', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: mine ? 'flex-start' : 'flex-end' }}>
              <PersonAvatar name={name} url={m.sender?.avatar_url} size={18} />
              <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{name.split(' ')[0].toUpperCase()} · {role}</Mono>
            </View>
            <View style={{ backgroundColor: bg, borderWidth: 1, borderColor: bd, borderRadius: 14, padding: 10, gap: 7 }}>
              {p.type === 'file' ? <FileBlock file={p.file} dark={dark} /> : null}
              {p.type === 'text' || (p.type === 'file' && p.text) ? (
                <Body style={{ fontSize: 13, color: '#fff', lineHeight: 18 }}>{p.type === 'text' ? p.text : p.text}</Body>
              ) : null}
              <Mono style={{ fontSize: 8, color: C.muted3, alignSelf: 'flex-end' }}>{timeAgo(m.created_at)}</Mono>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ---------- composer ---------- */
export function Composer({ ticketId, closed, dark }: { ticketId: string; closed: boolean; dark?: boolean }) {
  const sendM = useSendTechMessage();
  const [text, setText] = React.useState('');
  const [file, setFile] = React.useState<PickedTechFile | null>(null);
  const accent = dark ? '#5CE1E6' : C.orange;
  const sendingRef = React.useRef(false);

  // Voice memo: same recorder the raise sheet uses.
  const { recording, recMs, start: startRec, finish: finishRec } = useVoiceRecorder((f) => setFile(f));

  if (closed) {
    return (
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center' }}>This ticket is closed. Raise a new one if it comes back.</Body>
      </View>
    );
  }
  const send = () => {
    if (sendingRef.current) return;                       // synchronous double-tap guard
    if (!text.trim() && !file) return;
    sendingRef.current = true;
    const payloadText = text;
    const payloadFile = file;
    setText(''); setFile(null);
    sendM.mutate({ ticketId, text: payloadText, file: payloadFile ?? undefined }, {
      onError: (e: any) => {
        setText((t) => (t.trim() ? t : payloadText));
        setFile(payloadFile);
        Alert.alert('Not sent', e?.message ?? 'Check your connection and try again.');
      },
      onSettled: () => { sendingRef.current = false; },
    });
  };
  // While recording, the composer becomes a recorder: timer + discard + stop.
  const isVoice = !!file && file.mime.startsWith('audio/');
  return (
    <View style={{ gap: 8 }}>
      {file ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.3) }}>
          <Icon name={isVoice ? 'bell' : 'file'} size={13} color={accent} strokeWidth={2} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 11.5, color: '#fff' }}>{isVoice ? 'Voice memo ready to send' : file.name}</Text>
          <Pressable onPress={() => setFile(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove attachment">
            <Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} />
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {recording ? null : <Pressable onPress={() => attachMenu((fs) => fs[0] && setFile(fs[0]))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Attach a file"
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <Icon name="plus" size={16} color={C.ink2} strokeWidth={2.2} />
        </Pressable>}
        {recording ? null : <View style={{ flex: 1, minHeight: 40, maxHeight: 110, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <TextInput
            value={text} onChangeText={setText} placeholder="Write a reply" placeholderTextColor={C.muted3} multiline
            accessibilityLabel="Reply"
            style={{ fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 10, maxHeight: 96 }}
          />
        </View>}
        {/* Hold-to-record mic — hidden once something is attached. */}
        {!file ? (
          <VoiceHoldButton compact recording={recording} recMs={recMs} onStart={startRec} onFinish={finishRec} accent={accent} />
        ) : null}
        {recording ? null : <Pressable onPress={send} disabled={sendM.isPending || (!text.trim() && !file)} accessibilityRole="button" accessibilityLabel="Send reply"
          style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', opacity: sendM.isPending || (!text.trim() && !file) ? 0.45 : 1, backgroundColor: hexA(accent, 0.18), borderWidth: 1, borderColor: hexA(accent, 0.4) }}>
          {sendM.isPending ? <ActivityIndicator size="small" color={accent} /> : <Icon name="send" size={16} color={accent} strokeWidth={2.2} />}
        </Pressable>}
      </View>
    </View>
  );
}

/* ---------- reporter stage timeline (§4.5) ---------- */
export function StageTimeline({ ticket, messages, dark }: { ticket: TechTicket; messages: TechMessage[]; dark?: boolean }) {
  const accent = dark ? '#5CE1E6' : C.orange;
  const reached = reachedAtMap(ticket, messages);
  const closed = ticket.status === 'closed';
  const waiting = ticket.status === 'waiting_on_reporter';
  const currentIdx = stageIndexOf(ticket.status);
  const fill = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fill, { toValue: currentIdx / (STAGE_ORDER.length - 1), duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [currentIdx]);

  return (
    <View style={{ gap: 14 }}>
      {/* Track sits BEHIND the nodes, centred on the 26px dot (13 - 3/2 = 11.5) and
          inset by half a column so it runs dot-to-dot, not edge-to-edge. */}
      <View>
        <View pointerEvents="none" style={{ position: 'absolute', left: '12.5%', right: '12.5%', top: 11.5, height: 3, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.09)', overflow: 'hidden' }}>
          <Animated.View style={{ height: 3, backgroundColor: accent, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
        </View>
        <View style={{ flexDirection: 'row' }}>
        {STAGE_ORDER.map((stage, i) => {
          const done = i < currentIdx || (i === currentIdx && (ticket.status === 'resolved' || closed));
          const current = i === currentIdx && !done;
          const at = reached.get(stage);
          const col = current && waiting ? C.gold : done || current ? accent : C.faint2;
          const lit = done || current;
          return (
            <View key={stage} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? hexA(col, 0.22) : C.panel, borderWidth: 1.5, borderColor: hexA(col, lit ? 0.75 : 0.28) }}>
                {done ? <Icon name="checks" size={11} color={col} strokeWidth={2.6} />
                  : current ? <Pulse color={col} size={8} />
                  : <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: C.faint2 }} />}
              </View>
              <Mono style={{ fontSize: 8.5, color: lit ? C.ink3 : C.faint, textAlign: 'center' }}>{STAGE_LABEL[stage].toUpperCase()}</Mono>
              {/* Reserve the timestamp line on every node so the row keeps one height. */}
              <Mono style={{ fontSize: 7.5, color: C.muted3, textAlign: 'center' }}>{lit && at ? timeAgo(at) : ' '}</Mono>
            </View>
          );
        })}
        </View>
      </View>
      {waiting ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 11, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
          <Icon name="clock" size={13} color={C.gold} strokeWidth={2.2} />
          <Body style={{ flex: 1, fontSize: 11.5, color: C.gold }}>Tech Desk is waiting on your reply below.</Body>
        </View>
      ) : null}
      {closed ? <Mono style={{ fontSize: 9, color: C.muted3, alignSelf: 'center' }}>CLOSED · {ticket.timeline?.closed_at ? fullStamp(ticket.timeline.closed_at) : ''}</Mono> : null}
    </View>
  );
}

/* ---------- the acknowledgement gate (§ resolved -> closed) ----------
   "Resolved" is Tech's claim, not the end of the ticket. The person who raised it
   answers: confirming closes the ticket, "Not fixed" sends it back to In Progress
   with a reason. One RPC applies the answer and records it, so a ticket sitting in
   Resolved is exactly one nobody has answered yet. */
export function AcknowledgeCard({ ticket }: { ticket: TechTicket }) {
  const ackM = useAcknowledgeTicket();
  const [note, setNote] = React.useState('');
  const [needNote, setNeedNote] = React.useState(false);
  const col = STATUS_COLOR.resolved;
  const busy = ackM.isPending;
  const sending = busy ? ackM.variables?.verdict : null;   // which button to show as working
  const fixer = ticket.assignee ? personName(ticket.assignee).split(' ')[0] : 'Tech Desk';

  // isPending drops the instant the RPC returns, but this card only unmounts once
  // the refetched ticket arrives — a fast second tap in that gap would hit an
  // already-answered ticket and get "not waiting for your acknowledgement".
  const sentRef = React.useRef(false);
  const answer = (verdict: TechAckVerdict) => {
    if (busy || sentRef.current) return;
    // Sending it back without saying what is wrong just costs everyone another round trip.
    if (verdict === 'reopened' && !note.trim()) { setNeedNote(true); return; }
    setNeedNote(false);
    Keyboard.dismiss();
    sentRef.current = true;
    ackM.mutate({ id: ticket.id, verdict, note }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
      onError: (e: any) => {
        sentRef.current = false;                 // a failure has to stay retryable
        Alert.alert("Couldn't send that", e?.message ?? 'Check your connection and try again.');
      },
    });
  };

  return (
    <View style={{ gap: 12, padding: 15, borderRadius: 16, backgroundColor: hexA(col, 0.08), borderWidth: 1, borderColor: hexA(col, 0.34) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pulse color={col} size={7} />
        <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 1.1, color: col }}>WAITING ON YOU</Mono>
      </View>
      <Serif style={{ fontSize: 18 }}>Did this fix it?</Serif>
      <Body style={{ fontSize: 12.5, color: C.muted2, lineHeight: 18 }}>
        {fixer} marked {ticketNo(ticket.serial_no)} resolved{ticket.resolution ? ` as ${RESOLUTION_LABEL[ticket.resolution].toLowerCase()}` : ''}.
        {' '}Confirm it and the ticket closes itself. If it is still happening, send it back and it goes straight to the top of their queue.
      </Body>

      <TextInput
        value={note} onChangeText={(v) => { setNote(v); if (v.trim()) setNeedNote(false); }}
        placeholder={needNote ? 'Tell Tech what is still wrong' : 'Anything to add (optional)'}
        placeholderTextColor={needNote ? C.red : C.muted3}
        multiline accessibilityLabel="Acknowledgement note"
        style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', minHeight: 62, textAlignVertical: 'top', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: needNote ? hexA(C.red, 0.55) : 'rgba(255,255,255,0.1)' }}
      />

      <View style={{ flexDirection: 'row', gap: 9 }}>
        <Pressable onPress={() => answer('confirmed')} disabled={busy} accessibilityRole="button" accessibilityLabel="Yes, it is fixed. Close the ticket."
          style={{ flex: 1.5, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, opacity: busy && sending !== 'confirmed' ? 0.45 : 1, backgroundColor: hexA(col, 0.18), borderWidth: 1, borderColor: hexA(col, 0.5) }}>
          {sending === 'confirmed' ? <ActivityIndicator size="small" color={col} /> : <Icon name="checks" size={14} color={col} strokeWidth={2.6} />}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>Yes, it's fixed</Text>
        </Pressable>
        <Pressable onPress={() => answer('reopened')} disabled={busy} accessibilityRole="button" accessibilityLabel="Not fixed. Send it back to Tech Desk."
          style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, opacity: busy && sending !== 'reopened' ? 0.45 : 1, borderWidth: 1, borderColor: hexA(C.red, 0.38) }}>
          {sending === 'reopened' ? <ActivityIndicator size="small" color={C.red} /> : <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Not fixed</Text>}
        </Pressable>
      </View>
      {needNote ? <Mono style={{ fontSize: 8.5, color: C.red }}>ADD A LINE ABOUT WHAT IS STILL WRONG</Mono> : null}
    </View>
  );
}

/* ---------- closing needs a reason ----------
   A ticket that just vanishes tells Tech nothing. The reason is mandatory, lands in
   the thread as a message from the closer, and stays on the ticket for good. */
export function CloseReasonSheet({ ticket, visible, onClose }: { ticket: TechTicket; visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const closeM = useCloseTicketWithReason();
  const [reason, setReason] = React.useState('');
  const [needReason, setNeedReason] = React.useState(false);
  const sentRef = React.useRef(false);

  React.useEffect(() => {
    if (visible) { setReason(''); setNeedReason(false); sentRef.current = false; closeM.reset(); }
  }, [visible]);

  const submit = () => {
    if (closeM.isPending || sentRef.current) return;
    if (!reason.trim()) { setNeedReason(true); return; }
    setNeedReason(false);
    Keyboard.dismiss();
    sentRef.current = true;
    closeM.mutate({ id: ticket.id, reason }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); },
      onError: (e: any) => { sentRef.current = false; Alert.alert("Couldn't close", e?.message ?? 'Check your connection and try again.'); },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19, marginBottom: 4 }}>Close {ticketNo(ticket.serial_no)}?</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginBottom: 12 }}>
            Tech Desk stops working on it. Say why, so Tech knows what happened. The reason stays on this ticket.
          </Body>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 0.8, color: needReason ? C.red : C.muted3 }}>REASON *</Mono>
              <Mono style={{ fontSize: 9, color: reason.length > 1000 ? C.red : C.faint }}>{reason.length}/1000</Mono>
            </View>
            <TextInput
              value={reason}
              onChangeText={(v) => { setReason(v.slice(0, 1000)); if (v.trim()) setNeedReason(false); }}
              placeholder={needReason ? 'Tell Tech why you are closing this' : 'Sorted itself out, no longer needed, raised by mistake, found a workaround...'}
              placeholderTextColor={needReason ? C.red : C.muted3}
              multiline accessibilityLabel="Reason for closing"
              style={{ fontFamily: F.body, fontSize: 14, color: '#fff', minHeight: 92, textAlignVertical: 'top', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: needReason ? hexA(C.red, 0.55) : 'rgba(255,255,255,0.1)' }}
            />
            <Mono style={{ fontSize: 8, color: needReason ? C.red : C.faint }}>
              {needReason ? 'ADD A REASON TO CLOSE' : 'REQUIRED. TECH SEES IT IN THE THREAD AND ON THE TICKET.'}
            </Mono>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Keep open</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={closeM.isPending} accessibilityRole="button" accessibilityLabel="Close ticket"
              style={{ flex: 1.3, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, opacity: closeM.isPending ? 0.5 : 1, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.45) }}>
              {closeM.isPending ? <ActivityIndicator size="small" color={C.red} />
                : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Close ticket</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Why this ticket was closed. Permanent and shown to BOTH sides: if the ticket is
    reopened later the record stays and says so. Shared with the console. */
export function ClosureRecord({ ticket, dark }: { ticket: TechTicket; dark?: boolean }) {
  const c = ticket.closure;
  if (!c) return null;
  const who = c.by_name?.trim() || (c.by_role === 'reporter' ? 'The reporter' : 'Tech Desk');
  const reopened = ticket.status !== 'closed';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
      <View style={{ marginTop: 2 }}><Icon name="shield" size={13} color={C.muted2} strokeWidth={2.1} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted2 }}>
          {c.by_role === 'reporter' ? 'CLOSED BY REPORTER' : 'CLOSED BY TECH DESK'}{reopened ? ' (REOPENED SINCE)' : ''}
        </Mono>
        <Mono style={{ fontSize: 9, color: dark ? '#7E8CA0' : C.muted3 }}>{who} · {fullStamp(c.at)}</Mono>
        <Body style={{ fontSize: 12, color: dark ? '#E6EDF6' : C.ink2, lineHeight: 17 }}>{c.reason}</Body>
      </View>
    </View>
  );
}

/** What the reporter answered, once the ticket has moved on. Shared with the console. */
export function AckRecord({ ack, dark }: { ack: TechAck; dark?: boolean }) {
  const good = ack.verdict === 'confirmed';
  const col = good ? STATUS_COLOR.resolved : C.gold;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 10, borderRadius: 11, backgroundColor: hexA(col, 0.09), borderWidth: 1, borderColor: hexA(col, 0.28) }}>
      <View style={{ marginTop: 2 }}><Icon name={good ? 'checks' : 'alert'} size={13} color={col} strokeWidth={2.3} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: col }}>{ACK_VERDICT_LABEL[ack.verdict].toUpperCase()}</Mono>
        <Mono style={{ fontSize: 9, color: dark ? '#7E8CA0' : C.muted3 }}>{ackLine(ack)}</Mono>
        {ack.note ? <Body style={{ fontSize: 12, color: dark ? '#E6EDF6' : C.ink2, lineHeight: 17 }}>{ack.note}</Body> : null}
      </View>
    </View>
  );
}

/* ---------- shared detail shell: fixed header, scrolling body, pinned composer ----------
   A short thread used to leave the composer stranded in the middle of the page;
   pinning it (and lifting it with the keyboard) makes every ticket read like a chat. */
export function TicketShell({ dark, onBack, backLabel, header, children, composer }: {
  dark?: boolean; onBack: () => void; backLabel: string;
  header?: React.ReactNode; children: React.ReactNode; composer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { padBottom } = useComposerLift();
  const accent = dark ? '#5CE1E6' : C.orange;
  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#070B12' : 'transparent' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Back to ${backLabel}`}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <Icon name="arrowLeft" size={15} color={dark ? accent : C.ink2} strokeWidth={2.2} />
        </Pressable>
        <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 14, color: dark ? '#E6EDF6' : C.ink }}>{backLabel}</Text>
        {header}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }}
      >
        {children}
      </ScrollView>
      {composer ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: padBottom, borderTopWidth: 1, borderTopColor: dark ? 'rgba(120,190,255,0.12)' : 'rgba(255,255,255,0.07)', backgroundColor: dark ? 'rgba(7,11,18,0.97)' : 'rgba(8,6,6,0.96)' }}>
          {composer}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- ticket row (member + console share it) ---------- */
export function TicketRow({ t, unread, onPress, dark, showReporter, ackNeeded }: { t: TechTicket; unread: boolean; onPress: () => void; dark?: boolean; showReporter?: boolean; ackNeeded?: boolean }) {
  // A row waiting on the reader outranks an unread one: it wears the resolved
  // green and keeps its ping even after the reply itself has been read.
  const accent = ackNeeded ? STATUS_COLOR.resolved : dark ? '#5CE1E6' : C.orange;
  const lit = unread || !!ackNeeded;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${ticketNo(t.serial_no)} ${t.title}${ackNeeded ? '. Waiting for you to confirm the fix.' : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 13, backgroundColor: lit ? hexA(accent, 0.06) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: lit ? hexA(accent, 0.28) : 'rgba(255,255,255,0.07)' })}>
      <View style={{ width: 8, alignItems: 'center' }}>{lit ? <Pulse color={accent} size={6} /> : null}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Mono style={{ fontSize: 10, color: accent }}>{ticketNo(t.serial_no)}</Mono>
          <PriorityDot priority={t.priority} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: lit ? F.bodyBold : F.bodySemi, fontSize: 13.5, color: '#fff' }}>{t.title}</Text>
          {/* A written type takes over the glyph and adds its name, so a re-filed
              ticket never still reads as "Other". */}
          {t.type_label?.trim() ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(C.blue, 0.14), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
              <Icon name="tag" size={9} color={C.blue} strokeWidth={2.2} />
              <Mono style={{ fontSize: 7.5, color: C.blue }} numberOfLines={1}>{t.type_label.trim().toUpperCase()}</Mono>
            </View>
          ) : (
            <Icon name={TYPE_ICON[t.type]} size={12} color={C.muted3} strokeWidth={2} />
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {showReporter && t.creator ? (
            <>
              <PersonAvatar name={personName(t.creator)} url={t.creator.avatar_url} size={15} />
              <Mono style={{ fontSize: 8.5, color: C.muted2 }}>{personName(t.creator).split(' ')[0].toUpperCase()}</Mono>
              <Mono style={{ fontSize: 7.5, color: C.faint }}>{(t.creator.role ?? '').toUpperCase()}</Mono>
            </>
          ) : ackNeeded ? (
            <View style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(accent, 0.16) }}>
              <Mono style={{ fontSize: 8, color: accent }}>CONFIRM FIX</Mono>
            </View>
          ) : unread ? (
            <View style={{ paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, backgroundColor: hexA(accent, 0.14) }}>
              <Mono style={{ fontSize: 8, color: accent }}>TECH REPLIED</Mono>
            </View>
          ) : null}
          <Mono style={{ fontSize: 8.5, color: C.muted3 }} numberOfLines={1}>
            {t.platforms.map((p) => PLATFORM_ON_TICKET[p].toUpperCase()).join(' · ')} · {timeAgo(t.created_at)}
            {t.assignee ? ` · ${personName(t.assignee).split(' ')[0]}` : ''}
          </Mono>
        </View>
      </View>
      <StatusChip status={t.status} small />
    </Pressable>
  );
}

/* ---------- shared detail body (meta + description) ---------- */
export function TicketMeta({ t, dark }: { t: TechTicket; dark?: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = t.description.length > 240;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {t.platforms.map((p) => (
          <View key={p} style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Mono style={{ fontSize: 8.5, color: C.ink3 }}>{PLATFORM_ON_TICKET[p].toUpperCase()}</Mono>
          </View>
        ))}
        {t.route ? <Mono style={{ fontSize: 9, color: C.muted3 }}>{t.route}</Mono> : null}
      </View>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
        <Body numberOfLines={expanded ? undefined : 3} style={{ fontSize: 13, color: C.ink2, lineHeight: 19 }}>{t.description}</Body>
        {long ? (
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8} accessibilityRole="button" style={{ marginTop: 6 }}>
            <Mono style={{ fontSize: 9, color: dark ? '#5CE1E6' : C.orange }}>{expanded ? 'SHOW LESS' : 'SHOW MORE'}</Mono>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* ================= MEMBER — My Tickets ================= */
export function TechDesk() {
  const { go, set } = useStore();
  const { session, dbRole } = useAuth();
  const me = session?.user?.id ?? '';
  const ticketsQ = useTechTickets('mine');
  const activityQ = useTechActivity(ticketsQ.data ?? []);
  useTechDeskRealtime();
  const [tab, setTab] = React.useState<'active' | 'resolved' | 'all'>('active');
  const [raiseOpen, setRaiseOpen] = React.useState(false);
  const isStaff = isTechStaffRole(dbRole);

  if (!dbRole) return <AccessPending />;
  if (!canUseTechDesk(dbRole)) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Tech Desk" sub="Not available" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>Tech Desk is not available for this account.</Body>
      </Page>
    );
  }

  const rows = sortTickets(ticketsQ.data ?? []);
  const act = activityQ.data ?? {};
  const unreadOf = (t: TechTicket) => reporterHasUnread(t, act[t.id]);
  const unreadCount = rows.filter(unreadOf).length;
  // A ticket Tech has resolved is not finished until I say so, so it belongs in
  // Active, not tucked away in Resolved where nobody would look for a job to do.
  const ackOf = (t: TechTicket) => awaitingMyAck(t, me);
  const ackCount = rows.filter(ackOf).length;
  const activeForMe = (t: TechTicket) => isOpenStatus(t.status) || ackOf(t);
  const shown = tab === 'active' ? rows.filter(activeForMe)
    : tab === 'resolved' ? rows.filter((t) => !activeForMe(t) && (t.status === 'resolved' || t.status === 'closed')) : rows;
  const counts = {
    active: rows.filter(activeForMe).length,
    resolved: rows.filter((t) => !activeForMe(t) && (t.status === 'resolved' || t.status === 'closed')).length,
    all: rows.length,
  };
  const openTicket = (id: string) => { set({ selectedTicketId: id }); go('tech-desk-ticket'); };
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (session?.user?.user_metadata?.first_name as string) || '';

  return (
    <Page gap={16} pt={6}>
      <FadeIn>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Serif style={{ flex: 1, fontSize: 24 }}>Tech Desk</Serif>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.green, 0.1), borderWidth: 1, borderColor: hexA(C.green, 0.28) }}>
              <Pulse color={C.green} size={5} />
              <Mono style={{ fontSize: 8, color: C.green }}>LIVE</Mono>
            </View>
          </View>
          <Body style={{ fontSize: 12.5, color: C.muted2 }}>
            {greet}{firstName ? `, ${firstName}` : ''}. Raise a bug or a feature request and watch it move.
          </Body>
          <Pressable onPress={() => setRaiseOpen(true)} accessibilityRole="button" accessibilityLabel="Raise a ticket" style={{ borderRadius: 13, overflow: 'hidden' }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
              <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Raise ticket</Text>
            </LinearGradient>
          </Pressable>
          {ackCount > 0 ? (
            <Pressable onPress={() => setTab('active')} accessibilityRole="button" accessibilityLabel={`${ackCount} fixes waiting for you to confirm`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 11, backgroundColor: hexA(STATUS_COLOR.resolved, 0.09), borderWidth: 1, borderColor: hexA(STATUS_COLOR.resolved, 0.32) }}>
              <Pulse color={STATUS_COLOR.resolved} size={6} />
              <Body style={{ flex: 1, fontSize: 11.5, color: STATUS_COLOR.resolved }}>
                {ackCount === 1 ? 'A fix is waiting for you to confirm it' : `${ackCount} fixes are waiting for you to confirm them`}
              </Body>
            </Pressable>
          ) : null}
          {unreadCount > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 11, backgroundColor: hexA(C.orange, 0.08), borderWidth: 1, borderColor: hexA(C.orange, 0.28) }}>
              <Pulse color={C.orange} size={6} />
              <Body style={{ fontSize: 11.5, color: C.orange }}>{unreadCount} ticket{unreadCount === 1 ? '' : 's'} {unreadCount === 1 ? 'has' : 'have'} new replies</Body>
            </View>
          ) : null}
          {isStaff ? (
            <Pressable onPress={() => go('tech-desk-inbox')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(92,225,230,0.08)', borderWidth: 1, borderColor: 'rgba(92,225,230,0.3)' }}>
              <Icon name="inbox" size={14} color="#5CE1E6" strokeWidth={2} />
              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: '#5CE1E6' }}>All Tickets</Text>
              <Icon name="chevRight" size={13} color="#5CE1E6" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </FadeIn>

      <HScroll gap={8}>
        {([['active', 'Active', counts.active], ['resolved', 'Resolved', counts.resolved], ['all', 'All', counts.all]] as const).map(([id, label, n]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? C.orange : C.muted }}>{label}</Text>
              <Mono style={{ fontSize: 9, color: on ? C.orange : C.muted3 }}>{n}</Mono>
            </Pressable>
          );
        })}
      </HScroll>

      {ticketsQ.isPending ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      ) : ticketsQ.isError ? (
        <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(ticketsQ.error as Error).message}</Body>
      ) : !rows.length ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40 }}>
          <Icon name="inbox" size={30} color={C.faint} strokeWidth={1.6} />
          <Body style={{ fontSize: 12.5, color: C.muted2 }}>You haven't raised anything yet.</Body>
          <Pressable onPress={() => setRaiseOpen(true)} accessibilityRole="button" style={{ paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Raise your first ticket</Text>
          </Pressable>
        </View>
      ) : !shown.length ? (
        <Body style={{ fontSize: 12, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>All clear, nothing waiting on Tech.</Body>
      ) : (
        <View style={{ gap: 9 }}>
          {shown.map((t, i) => (
            <FadeIn key={t.id} delay={Math.min(i * 45, 320)}>
              <TicketRow t={t} unread={unreadOf(t)} ackNeeded={ackOf(t)} onPress={() => openTicket(t.id)} />
            </FadeIn>
          ))}
        </View>
      )}

      {raiseOpen ? (
        <RaiseTicketSheet
          onClose={() => setRaiseOpen(false)}
          onDone={(id) => { setRaiseOpen(false); setTab('active'); openTicket(id); }}
        />
      ) : null}
    </Page>
  );
}

/* ================= MEMBER — ticket detail ================= */
export function TechDeskTicket() {
  const { back, canGoBack, go, selectedTicketId } = useStore();
  const { session } = useAuth();
  const me = session?.user?.id ?? '';
  const ticketQ = useTechTicket(selectedTicketId);
  const msgsQ = useTechMessages(selectedTicketId);
  const [closeOpen, setCloseOpen] = React.useState(false);
  useTechDeskRealtime();
  const messages = msgsQ.data ?? [];
  useMarkTicketSeen(selectedTicketId, messages.length);

  const goBack = () => (canGoBack ? back() : go('tech-desk'));
  const t = ticketQ.data;

  if (ticketQ.isPending) return <Page gap={16} pt={6}><View style={{ paddingVertical: 50, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View></Page>;
  if (!t) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Ticket" sub="Not found" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>This ticket is no longer available.</Body>
      </Page>
    );
  }
  const closed = t.status === 'closed';
  // Resolved and mine to answer: the acknowledgement card IS the way this closes,
  // so the plain "Close ticket" button stands down rather than offering a second one.
  const needsMyAck = awaitingMyAck(t, me);

  return (
    <TicketShell
      onBack={goBack}
      backLabel="Tech Desk"
      header={<StatusChip status={t.status} small />}
      composer={<Composer ticketId={t.id} closed={closed} />}
    >
      {/* ---- title block ---- */}
      <View style={{ gap: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono style={{ fontSize: 11.5, color: C.orange }}>{ticketNo(t.serial_no)}</Mono>
          <Icon name={t.type_label?.trim() ? 'tag' : TYPE_ICON[t.type]} size={12} color={t.type_label?.trim() ? C.blue : C.muted3} strokeWidth={2} />
          <Mono style={{ fontSize: 8.5, color: t.type_label?.trim() ? C.blue : C.muted3 }}>{typeLongOf(t).toUpperCase()}</Mono>
          <View style={{ flex: 1 }} />
          <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{timeAgo(t.created_at)}</Mono>
        </View>
        <Serif style={{ fontSize: 22, lineHeight: 28 }}>{t.title}</Serif>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <PriorityDot priority={t.priority} />
            <Mono style={{ fontSize: 8.5, color: C.muted2 }}>{PRIORITY_LABEL[t.priority].toUpperCase()}</Mono>
          </View>
          {t.resolution ? <Mono style={{ fontSize: 8.5, color: C.green }}>{RESOLUTION_LABEL[t.resolution].toUpperCase()}</Mono> : null}
          {t.assignee ? <Mono style={{ fontSize: 8.5, color: C.muted3 }}>WITH {personName(t.assignee).split(' ')[0].toUpperCase()}</Mono> : null}
        </View>
      </View>

      <TicketMeta t={t} />
      {/* Why it was closed, kept even after a reopen. */}
      <ClosureRecord ticket={t} />

      {/* ---- progress ---- */}
      <Card style={{ padding: 16, gap: 14 }}>
        <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.muted3 }}>PROGRESS</Mono>
        <StageTimeline ticket={t} messages={messages} />
        {/* What was answered last time, once the ticket has moved past the question. */}
        {t.acknowledgement && !needsMyAck ? <AckRecord ack={t.acknowledgement} /> : null}
      </Card>

      {/* ---- the ask: Tech says it is fixed, only the reporter can agree ---- */}
      {needsMyAck ? <AcknowledgeCard ticket={t} /> : null}

      {/* ---- conversation ---- */}
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.muted3 }}>CONVERSATION</Mono>
          <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        </View>
        {msgsQ.isPending ? <ActivityIndicator color={C.orange} /> : <Thread ticket={t} messages={messages} meId={me} />}
      </View>

      {/* ---- close (bottom: a destructive action should not sit under the title) ---- */}
      {!closed && !needsMyAck ? (
        <Pressable onPress={() => setCloseOpen(true)} accessibilityRole="button" accessibilityLabel="Close ticket"
          style={{ alignSelf: 'center', marginTop: 4, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.red }}>Close ticket</Text>
        </Pressable>
      ) : null}

      <CloseReasonSheet ticket={t} visible={closeOpen} onClose={() => setCloseOpen(false)} />
    </TicketShell>
  );
}

/* ================= MEMBER — raise sheet ================= */
export function RaiseTicketSheet({ onClose, onDone }: { onClose: () => void; onDone: (ticketId: string) => void }) {
  const kb = useKeyboardHeight();
  const raiseM = useRaiseTicket();
  const [type, setType] = React.useState<TechType>('bug');
  const [priority, setPriority] = React.useState<TechPriority>('medium');
  const [platforms, setPlatforms] = React.useState<TechPlatform[]>([Platform.OS === 'ios' ? 'ios' : 'android']);
  const [title, setTitle] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [files, setFiles] = React.useState<PickedTechFile[]>([]);
  // Voice memo on the RAISE form too: describing a bug out loud is often faster
  // than typing it, and it was previously only possible after the ticket existed.
  const voice = useVoiceRecorder((f) => setFiles((xs) => [...xs, f].slice(0, 5)));
  const route = React.useMemo(() => currentTechRoute(), []);

  // One rule for the exclusive None, shared with the web (togglePlatformIn).
  const togglePlatform = (p: TechPlatform) => setPlatforms((xs) => togglePlatformIn(xs, p));

  /* Keyboard + a pinned footer + a long form is the worst case for a bottom sheet:
     the keyboard eats the bottom of the screen and the footer eats the bottom of what
     is left, so the field you just tapped ends up half-hidden behind the buttons.
     Nudge the focused input clear of BOTH, the way Page does for full screens. */
  const scrollRef = React.useRef<ScrollView>(null);
  const offsetRef = React.useRef(0);
  React.useEffect(() => {
    if (!kb) return;
    const t = setTimeout(() => {
      const input: any = (TextInput as any).State?.currentlyFocusedInput?.();
      if (!input || !scrollRef.current) return;
      try {
        input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
          // FOOTER_CLEARANCE covers the button row, its padding and the invalid hint.
          const usableBottom = Dimensions.get('window').height - kb - 96;
          const overlap = y + h + 12 - usableBottom;
          if (overlap > 0) scrollRef.current?.scrollTo({ y: offsetRef.current + overlap, animated: true });
        });
      } catch { /* input unmounted mid-measure */ }
    }, Platform.OS === 'ios' ? 60 : 150);
    return () => clearTimeout(t);
  }, [kb]);
  const valid = title.trim().length > 0 && title.trim().length <= 120 && desc.trim().length > 0 && platforms.length > 0;
  const submit = () => {
    if (!valid || raiseM.isPending) return;
    raiseM.mutate({ type, priority, title, description: desc, platforms, route, files }, {
      onSuccess: (t) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onDone(t.id);
      },
      onError: (e: any) => Alert.alert("Couldn't raise the ticket", e?.message ?? 'Check your connection and try again.'),
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Sibling backdrop — never a parent Pressable wrapping the sheet body. */}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        {/* With the keyboard up the panel already reserves its height below, so the 8%
            headroom is dead space — give it back to the fields. */}
        <View accessibilityViewIsModal style={{ maxHeight: kb > 0 ? '98%' : '92%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + kb }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <Serif style={{ flex: 1, fontSize: 19 }}>Raise a ticket</Serif>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            // flexShrink lets the scroll area give way to the pinned footer instead of
            // pushing it off; the bottom padding keeps the last field off the buttons.
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
          >
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Mono style={{ flex: 1, fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>TITLE</Mono>
                <Mono style={{ fontSize: 9, color: title.length > 120 ? C.red : C.faint }}>{title.length}/120</Mono>
              </View>
              <TextInput value={title} onChangeText={(v) => setTitle(v.slice(0, 120))} placeholder="One line, what is wrong or what you want" placeholderTextColor={C.muted3}
                accessibilityLabel="Ticket title"
                style={{ fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            </View>

            <View style={{ gap: 7 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>TYPE</Mono>
              {/* Four across would squeeze the labels, so the row wraps. "Other" is the
                  reporter's escape hatch: they should never have to guess a category. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ALL_TYPES.map((k) => {
                  const on = type === k;
                  return (
                    <Pressable key={k} onPress={() => setType(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={{ flexGrow: 1, flexBasis: '46%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 11, backgroundColor: on ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.09)' }}>
                      <Icon name={TYPE_ICON[k]} size={13} color={on ? C.orange : C.muted2} strokeWidth={2} />
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? C.orange : C.muted }}>{TYPE_LABEL[k]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {type === 'other' ? (
                <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 15 }}>
                  Not sure where it fits? That is fine. Tech reads it and files it under the right type, and you see the change here.
                </Body>
              ) : null}
            </View>

            <View style={{ gap: 7 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>PRIORITY</Mono>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['low', 'medium', 'high', 'urgent'] as TechPriority[]).map((k) => {
                  const on = priority === k;
                  const col = PRIORITY_COLOR[k];
                  return (
                    <Pressable key={k} onPress={() => setPriority(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 9, borderRadius: 11, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.45) : 'rgba(255,255,255,0.09)' }}>
                      <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: col }} />
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: on ? col : C.muted }}>{PRIORITY_LABEL[k]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 7 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>PLATFORM</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ALL_PLATFORMS.map((p) => {
                  const on = platforms.includes(p);
                  // None is exclusive and drawn dashed, so it reads as "not one of these".
                  const isNone = p === 'none';
                  return (
                    <Pressable key={p} onPress={() => setPlatforms((xs) => togglePlatformIn(xs, p))} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: on ? hexA(C.blue, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderStyle: isNone ? 'dashed' : 'solid', borderColor: on ? hexA(C.blue, 0.45) : 'rgba(255,255,255,0.09)' }}>
                      <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? C.blue : C.muted }}>{PLATFORM_LABEL[p]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>
                {TYPE_PROMPT[type].toUpperCase()}
              </Mono>
              <TextInput value={desc} onChangeText={setDesc}
                placeholder={type === 'other' ? 'Say what you need and who it is for. Access, a device, an account, a question, anything Tech can help with.' : 'Steps, screen, what you saw'}
                placeholderTextColor={C.muted3} multiline
                accessibilityLabel="Ticket description"
                style={{ fontFamily: F.body, fontSize: 14, color: '#fff', minHeight: 96, textAlignVertical: 'top', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            </View>

            <View style={{ gap: 7 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>ATTACHMENTS ({files.length}/5)</Mono>
              {files.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Icon name={f.mime.startsWith('audio/') ? 'bell' : 'file'} size={13} color={f.mime.startsWith('audio/') ? C.orange : C.muted2} strokeWidth={2} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.body, fontSize: 11.5, color: C.ink2 }}>{f.mime.startsWith('audio/') ? 'Voice memo' : f.name}</Text>
                  {f.size ? <Mono style={{ fontSize: 8.5, color: C.faint }}>{fmtBytes(f.size)}</Mono> : null}
                  <Pressable onPress={() => setFiles((xs) => xs.filter((_, k) => k !== i))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`}>
                    <Icon name="close" size={12} color={C.muted2} strokeWidth={2.2} />
                  </Pressable>
                </View>
              ))}
              {files.length < 5 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {voice.recording ? null : (
                    <Pressable onPress={() => attachMenu((fs) => setFiles((xs) => [...xs, ...fs].slice(0, 5)))} accessibilityRole="button" accessibilityLabel="Add a screenshot or PDF"
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)' }}>
                      <Icon name="plus" size={13} color={C.muted} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Screenshot or PDF</Text>
                    </Pressable>
                  )}
                  <VoiceHoldButton recording={voice.recording} recMs={voice.recMs} onStart={voice.start} onFinish={voice.finish} accent={C.orange} />
                </View>
              ) : null}
              {!voice.recording && files.length < 5 ? (
                <Mono style={{ fontSize: 8, color: C.faint }}>HOLD THE MIC TO RECORD A VOICE MEMO</Mono>
              ) : null}
            </View>

            {route ? <Mono style={{ fontSize: 9, color: C.faint }}>Page: {route}</Mono> : null}
          </ScrollView>

          {/* Footer OUTSIDE the scroll area so it never scrolls away behind the keyboard. */}
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!valid || raiseM.isPending} accessibilityRole="button" accessibilityLabel="Raise ticket"
              style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden', opacity: !valid || raiseM.isPending ? 0.5 : 1 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{raiseM.isPending ? 'Sending…' : 'Raise ticket'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
          {!valid ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center', marginTop: 7 }}>Add a title, a description and a platform. Pick at least one, or None.</Mono> : null}
        </View>
      </View>
    </Modal>
  );
}
