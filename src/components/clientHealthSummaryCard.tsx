/* "Listen before the session" (9 Oct 2026): two play buttons that read the
   client's spoken overviews, the listen trail (who listened, when) and the
   mandatory listen gate shown before a session is logged from Today's Roster.
   Mirrors the web ClientHealthSummaryCard (hub-track
   src/components/trainer/ClientHealthSummaryCard.tsx); the backend is shared.
   Since 15 Oct 2026 the voice is Sarvam's, through the edge function
   speak-client-summary (src/lib/summaryVoice.ts); the device voice (expo-speech)
   is the fallback when the recording cannot be fetched or played. */
import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon, type IconName } from '../icons';
import { Serif, Mono, Body } from './primitives';
import { ReplayMask } from './ReplayShield';
import { useAuth } from '../auth';
import { useClientHealthSummary, useLogSummaryListen } from '../lib/clientHealthSummaryQueries';
import { useSummaryVoice, type SummaryVoice, type VoiceSource } from '../lib/summaryVoice';
import {
  TITLES, type Which, type ClientHealthSummaryRow, type WeeklySummary, type ContextSummary,
  durationText, fmtStamp, historyOf, summaryOf, generatedAtOf, hasScript, lastListen, isNewSince,
  listenGate, gateDue, type GateState,
} from '../lib/clientHealthSummary';

const GOLD = C.gold;
const WEEKLY = C.green;
const CONTEXT = '#8FB4FF';
const colorOf = (which: Which) => (which === 'weekly' ? WEEKLY : CONTEXT);
const iconOf = (which: Which): IconName => (which === 'weekly' ? 'activity' : 'stethoscope');
const nothingYet = (which: Which) =>
  which === 'weekly' ? 'Built nightly at 11:59 PM; nothing yet for this client.' : 'Built when a QHP, blood or medical report arrives; nothing yet.';

const subLine = (row: ClientHealthSummaryRow | null, which: Which): string => {
  const s = summaryOf(row, which);
  if (!s?.script) return nothingYet(which);
  const built = fmtStamp(generatedAtOf(row, which));
  if (which === 'weekly') return `Last 7 days · built ${built} · ${durationText(s.script)}`;
  const n = (s as ContextSummary).sources?.length ?? 0;
  return `${n} document${n === 1 ? '' : 's'} · built ${built} · ${durationText(s.script)}`;
};

/* ---------- the round play / pause / stop control ----------
   busy: the recording is being fetched (a press stops). The recording pauses on both
   platforms; the device-voice fallback only pauses on iOS (Android: stop). */
function PlayButton({ which, active, paused, busy, canPause, disabled, onPress, size = 44 }: {
  which: Which; active: boolean; paused: boolean; busy: boolean; canPause: boolean; disabled: boolean; onPress: () => void; size?: number;
}) {
  const col = colorOf(which);
  const label = busy ? 'Preparing the voice' : active ? (canPause ? (paused ? 'Resume' : 'Pause') : 'Stop') : `Play ${TITLES[which]}`;
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? col : hexA(col, 0.14), borderWidth: 1, borderColor: active ? col : hexA(col, 0.45), opacity: disabled ? 0.4 : 1 }}>
      {busy ? (
        <ActivityIndicator size="small" color="#0c0808" />
      ) : active && canPause && !paused ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: '#0c0808' }} />
          <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: '#0c0808' }} />
        </View>
      ) : active && !canPause ? (
        <Icon name="stopSq" size={size * 0.38} color="#0c0808" strokeWidth={2.4} fill="#0c0808" />
      ) : (
        <Icon name="play" size={size * 0.42} color={active ? '#0c0808' : col} strokeWidth={2.2} fill={active ? '#0c0808' : col} />
      )}
    </Pressable>
  );
}

/** A press on the row that is already active: stop while preparing, pause / resume where possible, else stop. */
const tapActive = (v: SummaryVoice) => {
  if (v.busyId) { v.stop(); return; }
  if (v.canPause) { if (v.paused) v.resume(); else v.pause(); } else v.stop();
};
const rowVoiceProps = (v: SummaryVoice, which: Which) => ({
  active: v.speakingId === which, paused: v.paused, busy: v.busyId === which, canPause: v.canPause,
  source: v.speakingId === which ? v.source : null, part: v.part, parts: v.parts,
});
const BOTH_FAILED = (m: string) => `Neither the recording nor this device could speak (${m}). The transcript is shown instead.`;

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(color, 0.12), borderWidth: 1, borderColor: hexA(color, 0.32) }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}

function FindingChips({ which, row }: { which: Which; row: ClientHealthSummaryRow | null }) {
  const s = summaryOf(row, which);
  if (!s?.script) return null;
  if (which === 'weekly') {
    const hl = ((s as WeeklySummary).highlights ?? []).filter(Boolean).slice(0, 3);
    return hl.length ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
        {hl.map((h, i) => <Chip key={i} text={h} color={C.ink3} />)}
      </View>
    ) : null;
  }
  const c = s as ContextSummary;
  const imp = c.improved?.length ?? 0, wor = c.worsened?.length ?? 0, wat = c.watch?.length ?? 0;
  return imp || wor || wat ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
      {imp ? <Chip text={`${imp} improved`} color={C.green} /> : null}
      {wor ? <Chip text={`${wor} worsened`} color={C.red} /> : null}
      {wat ? <Chip text={`${wat} to watch`} color={GOLD} /> : null}
    </View>
  ) : null;
}

/* ---------- one summary row (shared by the card and the gate) ---------- */
type RowProps = {
  which: Which;
  row: ClientHealthSummaryRow | null;
  uid: string | null;
  active: boolean;
  paused: boolean;
  /** The recording is being fetched. */
  busy: boolean;
  canPause: boolean;
  /** What is speaking while active: the Sarvam recording or the device fallback. */
  source: VoiceSource | null;
  part: number;
  parts: number;
  transcriptOpen: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToggleTranscript: () => void;
  /** Gate mode: a status chip instead of the "new since you listened" badge. */
  status?: { text: string; color: string } | null;
  ordinal?: number;
};
function SummaryRow({ which, row, uid, active, paused, busy, canPause, source, part, parts, transcriptOpen, onPlay, onStop, onToggleTranscript, status, ordinal }: RowProps) {
  const s = summaryOf(row, which);
  const col = colorOf(which);
  const has = hasScript(row, which);
  const last = lastListen(historyOf(row), which);
  const fresh = !status && isNewSince(row, which, uid);
  const sub = busy ? 'Preparing the voice…' : active && source === 'sarvam' && parts > 1 ? `${subLine(row, which)} · part ${part} of ${parts}` : subLine(row, which);
  return (
    <View style={{ borderRadius: 16, padding: 12, backgroundColor: hexA(col, 0.05), borderWidth: 1, borderColor: hexA(col, active ? 0.5 : 0.2), gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
        <PlayButton which={which} active={active} paused={paused} busy={busy} canPause={canPause} disabled={!has} onPress={onPlay} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            {ordinal != null ? <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: col }}>{String(ordinal).padStart(2, '0')}</Mono> : null}
            <Icon name={iconOf(which)} size={13} color={col} strokeWidth={2.1} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: '#fff' }}>{TITLES[which]}</Text>
            {fresh ? <Chip text="New since you listened" color={GOLD} /> : null}
            {status ? <Chip text={status.text} color={status.color} /> : null}
            {s?.fallback ? <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>PLAIN VERSION</Mono> : null}
            {active && !busy && source === 'device' ? <Mono style={{ fontSize: 8, letterSpacing: 0.6, color: C.muted3 }}>DEVICE VOICE</Mono> : null}
          </View>
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 3, lineHeight: 15 }}>{sub}</Body>
          {which === 'context' && s && (s as ContextSummary).exclusions_confirmed === false ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 5 }}>
              <Icon name="alert" size={11} color={GOLD} strokeWidth={2.1} />
              <Body style={{ flex: 1, fontSize: 10.5, color: GOLD, lineHeight: 14 }}>Only the standard blood panel is spoken until the clinical team confirms the full list.</Body>
            </View>
          ) : null}
          <FindingChips which={which} row={row} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {active ? (
            <Pressable onPress={onStop} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop"
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="stopSq" size={11} color="#fff" strokeWidth={2.2} fill="#fff" />
            </Pressable>
          ) : null}
          {has ? (
            <Pressable onPress={onToggleTranscript} hitSlop={10} accessibilityRole="button" accessibilityLabel={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Icon name={transcriptOpen ? 'chevUp' : 'chevDown'} size={11} color={C.muted} strokeWidth={2.3} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.muted }}>Transcript</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {transcriptOpen && s?.script ? (
        <Body style={{ fontSize: 12.5, color: C.ink, lineHeight: 19, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)' }}>{s.script}</Body>
      ) : null}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>
        {last ? `Last listened by ${last.by_name ?? 'someone'} · ${fmtStamp(last.at)}` : has ? 'Nobody has listened yet' : ''}
      </Body>
    </View>
  );
}

/* ---------- who-listened sheet ---------- */
function HistorySheet({ visible, onClose, row }: { visible: boolean; onClose: () => void; row: ClientHealthSummaryRow | null }) {
  const insets = useSafeAreaInsets();
  const items = [...historyOf(row)].reverse().slice(0, 30);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
        <View style={{ maxHeight: '70%', backgroundColor: C.sheetBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.12)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18 }}>
          <View style={{ width: 38, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Icon name="history" size={17} color={GOLD} strokeWidth={2} />
            <Serif style={{ flex: 1, fontSize: 19 }}>Who listened</Serif>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
            {items.length === 0 ? <Body style={{ fontSize: 12, color: C.muted2 }}>Nobody has listened yet.</Body> : items.map((h, i) => (
              <View key={`${h.at}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                <Icon name={iconOf(h.which)} size={13} color={colorOf(h.which)} strokeWidth={2.1} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{h.by_name ?? 'Unknown'}{h.role ? <Text style={{ color: C.muted3 }}> · {h.role}</Text> : null}</Text>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, marginTop: 1 }}>{h.which === 'weekly' ? 'WEEK' : 'CONTEXT'} · {fmtStamp(h.at).toUpperCase()}</Mono>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- the card ---------- */
export function ClientHealthSummaryCard({ clientId }: { clientId: string | null | undefined }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = useClientHealthSummary(clientId ?? null);
  const logM = useLogSummaryListen(clientId ?? null);
  const voice = useSummaryVoice();
  const [transcript, setTranscript] = React.useState<Which | null>(null);
  const [histOpen, setHistOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const row = q.data ?? null;
  const history = historyOf(row);

  const play = (which: Which) => {
    const s = summaryOf(row, which);
    if (!s?.script || !clientId) return;
    if (voice.speakingId === which) { tapActive(voice); return; }
    setErr(null);
    // The trail first: the RPC is the record of who listened, whatever the voice does next.
    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
    voice.play(which, { clientId, which, script: s.script }, {
      onError: (m) => { setTranscript(which); setErr(BOTH_FAILED(m)); },
    });
  };

  if (!clientId || q.isError) return null;
  return (
    <ReplayMask>
      <LinearGradient colors={['rgba(40,30,22,0.55)', 'rgba(18,14,14,0.6)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 19, borderWidth: 1, borderColor: hexA(GOLD, 0.28), padding: 14, gap: 11 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(GOLD, 0.13), borderWidth: 1, borderColor: hexA(GOLD, 0.35), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="headphones" size={18} color={GOLD} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 17 }}>Listen before the session</Serif>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2, lineHeight: 15 }}>Short spoken overviews in an Indian English voice. Numbers come from the records; anything clinical is for the doctor consultation.</Body>
          </View>
          {history.length > 0 ? (
            <Pressable onPress={() => setHistOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Who listened, ${history.length} entries`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Icon name="history" size={12} color={C.muted} strokeWidth={2.1} />
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>{history.length}</Text>
            </Pressable>
          ) : null}
        </View>
        {q.isLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={GOLD} />
            <Body style={{ fontSize: 11.5, color: C.muted2 }}>Loading summaries…</Body>
          </View>
        ) : (
          <View style={{ gap: 9 }}>
            {(['weekly', 'context'] as Which[]).map((which) => (
              <SummaryRow key={which} which={which} row={row} uid={uid} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))} />
            ))}
          </View>
        )}
        {voice.notice ? <Body style={{ fontSize: 11, color: GOLD }}>{voice.notice}</Body> : null}
        {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
      </LinearGradient>
      <HistorySheet visible={histOpen} onClose={() => setHistOpen(false)} row={row} />
    </ReplayMask>
  );
}

/* ---------- compact strip for list cards (Essentials auction session cards, 15 Oct 2026) ----------
   Owner: "in the Essentials card also show the client's weekly and long summary". A folded
   row "Client summaries" that opens into the same two play rows as the card (Sarvam voice,
   transcript, the listen trail), for the training day the card is about: the recording
   asked for is that day's. */
export function ClientSummaryStrip({ clientId, date, accent = GOLD }: { clientId: string | null | undefined; date?: string | null; accent?: string }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [open, setOpen] = React.useState(false);
  const q = useClientHealthSummary(clientId ?? null, true, date ?? null);
  const logM = useLogSummaryListen(clientId ?? null);
  const voice = useSummaryVoice();
  const [transcript, setTranscript] = React.useState<Which | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const row = q.data ?? null;
  React.useEffect(() => { if (!open) voice.stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!clientId || q.isError) return null;
  const hasWeekly = hasScript(row, 'weekly'), hasContext = hasScript(row, 'context');
  const summaryLine = q.isLoading ? 'Loading…' : !row || (!hasWeekly && !hasContext) ? 'Nothing built yet for this day' : [hasWeekly ? `This week · ${durationText(row!.weekly_summary!.script)}` : null, hasContext ? `Health context · ${durationText(row!.context_summary!.script)}` : null].filter(Boolean).join('   ');
  const play = (which: Which) => {
    const s = summaryOf(row, which);
    if (!s?.script) return;
    if (voice.speakingId === which) { tapActive(voice); return; }
    setErr(null);
    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
    voice.play(which, { clientId, which, script: s.script, date: row?.briefing_date ?? date ?? null }, {
      onError: (m) => { setTranscript(which); setErr(BOTH_FAILED(m)); },
    });
  };
  return (
    <ReplayMask>
      <View style={{ borderRadius: 14, backgroundColor: hexA(accent, 0.06), borderWidth: 1, borderColor: hexA(accent, open ? 0.4 : 0.22) }}>
        <Pressable onPress={() => setOpen((o) => !o)} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Client summaries"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 12 }}>
          <Icon name="headphones" size={14} color={accent} strokeWidth={2.1} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>Client summaries</Text>
            <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3, marginTop: 2 }} numberOfLines={1}>{summaryLine.toUpperCase()}</Mono>
          </View>
          <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={accent} strokeWidth={2.4} />
        </Pressable>
        {open ? (
          <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>
            {(['weekly', 'context'] as Which[]).map((which) => (
              <SummaryRow key={which} which={which} row={row} uid={uid} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))} />
            ))}
            {voice.notice ? <Body style={{ fontSize: 11, color: GOLD }}>{voice.notice}</Body> : null}
            {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
          </View>
        ) : null}
      </View>
    </ReplayMask>
  );
}

/* ---------- the mandatory listen gate (Today's Roster > add session) ----------
   Shown by the Workout form when the client's summaries are due. The trainer
   must hear each due summary to the end (or open its transcript when the device
   cannot speak); the trail is logged on play, as on the card. No backdrop tap:
   the only ways out are Continue (when everything due is heard) and Back. */
const gateStatus = (which: Which, state: GateState, heardNow: boolean, row: ClientHealthSummaryRow | null): { text: string; color: string } => {
  if (state === 'none') return { text: 'Nothing to hear yet', color: C.muted2 };
  if (heardNow) return { text: 'Heard just now', color: C.green };
  if (state === 'done') return { text: which === 'weekly' ? 'Heard today' : 'Up to date', color: C.green };
  if (which === 'weekly') return { text: 'Due today', color: C.red };
  const built = fmtStamp(generatedAtOf(row, 'context'));
  return { text: built ? `New report · ${built}` : 'Not heard yet', color: C.red };
};

export function ListenGateSheet({ visible, clientId, clientName, onContinue, onLeave }: {
  visible: boolean; clientId: string | null; clientName: string; onContinue: () => void; onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = useClientHealthSummary(clientId, visible);
  const logM = useLogSummaryListen(clientId);
  const voice = useSummaryVoice();
  const row = q.data ?? null;
  const gate = listenGate(row, uid);
  const [heard, setHeard] = React.useState<Record<Which, boolean>>({ weekly: false, context: false });
  const [transcript, setTranscript] = React.useState<Which | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (visible) { setHeard({ weekly: false, context: false }); setTranscript(null); setErr(null); } else voice.stop();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const need = (which: Which) => gate[which] === 'due' && !heard[which];
  const allDone = !need('weekly') && !need('context');
  const play = (which: Which) => {
    const s = summaryOf(row, which);
    if (!s?.script || !clientId) return;
    if (voice.speakingId === which) { tapActive(voice); return; }
    setErr(null);
    logM.mutate(which, { onError: (e) => setErr((e as Error).message) });
    voice.play(which, { clientId, which, script: s.script }, {
      // Heard to the end: the recording's last part, or the device voice when it stood in.
      onDone: () => setHeard((h) => ({ ...h, [which]: true })),
      onError: (m) => {
        // Nothing could speak: the transcript stands in and counts as heard.
        setTranscript(which);
        setHeard((h) => ({ ...h, [which]: true }));
        setErr(`Neither the recording nor this device could speak (${m}). Read the transcript instead.`);
      },
    });
  };
  const finish = () => { voice.stop(); onContinue(); };
  const leave = () => { voice.stop(); onLeave(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={leave}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' }} />
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.35), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="headphones" size={18} color={C.red} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 20 }}>Listen before you log</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3, lineHeight: 16 }}>You need to listen to this before adding {clientName}'s session. This week's training every day, and the health context whenever a new report has updated it.</Body>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 8 }}>
            {q.isLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={GOLD} />
                <Body style={{ fontSize: 11.5, color: C.muted2 }}>Loading summaries…</Body>
              </View>
            ) : (['weekly', 'context'] as Which[]).map((which, i) => (
              <SummaryRow key={which} which={which} row={row} uid={uid} ordinal={i + 1} {...rowVoiceProps(voice, which)} transcriptOpen={transcript === which}
                onPlay={() => play(which)} onStop={voice.stop} onToggleTranscript={() => setTranscript((t) => (t === which ? null : which))}
                status={gateStatus(which, gate[which], heard[which], row)} />
            ))}
            {voice.notice ? <Body style={{ fontSize: 11, color: GOLD }}>{voice.notice}</Body> : null}
            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
            <Body style={{ fontSize: 10.5, color: C.muted3, lineHeight: 15 }}>Every play is recorded with your name and the time. Red items must be heard to the end before you can continue.</Body>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable onPress={leave} hitSlop={10} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.muted }}>Back to roster</Text>
            </Pressable>
            <Pressable onPress={finish} disabled={!allDone} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !allDone }} style={{ flex: 1.3, borderRadius: 14, overflow: 'hidden', opacity: allDone ? 1 : 0.45 }}>
              <LinearGradient colors={allDone ? [C.green, '#1F8F5A'] : ['#5A4030', '#3A2A20']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14 }}>
                <Icon name="checks" size={15} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{allDone ? 'Continue to log' : 'Listen first'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export { gateDue };
