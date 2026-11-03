/* Client complaints panel (3 Nov 2026): the two segments (Inaccurate logs, Reports), the status chips, the cards,
   the Mark handled sheet and the report action sheet. One component for every viewer; the screen around it decides
   the scope chips (a manager's teams, or the manager filter for the physio HOD and admins). Sheet rules: one Modal at
   a time, sibling backdrop, useKeyboardHeight, keyboardShouldPersistTaps, hitSlop 10. */
import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { friendlyError } from '../lib/friendlyError';
import { trackEvent } from '../lib/amplitude';
import {
  type InaccurateLog, type SpecialistReport, type ComplaintKind, type ComplaintStatusFilter, type ReportStatus, type Tone,
  sessionLine, issueChips, flaggedLine, loggedBlock, handledLine, reportStatusChip, roleChip, reportExpert, reportSessionLine,
  reportHandledLine, sourceLabel, fmtWhen, emptyLine, codedComplaintSentence, REPORT_PRIVACY_LINE,
} from '../lib/clientComplaints';
import { useMarkLogHandled, useUnmarkLogHandled, useSetReportStatus } from '../lib/clientComplaintsQueries';

const toneColor = (t: Tone) => (t === 'green' ? C.green : t === 'amber' ? C.gold : t === 'red' ? C.red : t === 'blue' ? C.blue : C.muted);
const errText = (e: unknown, fallback: string) => codedComplaintSentence(e) ?? friendlyError(e, fallback);

function Chip({ text, tone = 'grey' }: { text: string; tone?: Tone }) {
  const col = toneColor(tone);
  return (
    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.45) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: col, letterSpacing: 0.6 }}>{text}</Text>
    </View>
  );
}
function Pill({ text, active, count, onPress }: { text: string; active: boolean; count?: number | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.13) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.3) : 'rgba(255,255,255,0.07)' }}>
      <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{text}</Text>
      {count ? <Text style={{ fontFamily: F.mono, fontSize: 11, color: active ? C.orange : C.muted2 }}>{count}</Text> : null}
    </Pressable>
  );
}

/* ---------- the Mark handled sheet ---------- */
function HandleLogSheet({ target, onClose }: { target: InaccurateLog | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const m = useMarkLogHandled();
  const [note, setNote] = React.useState('');
  const [fixed, setFixed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (target) { setNote(''); setFixed(false); setErr(null); } else Keyboard.dismiss(); }, [target]);
  const save = async () => {
    if (!target || m.isPending) return;
    try {
      await m.mutateAsync({ sessionId: target.session_id, note, logFixed: fixed });
      trackEvent('Log Complaint Handled', { session_id: target.session_id, log_fixed: fixed, has_note: !!note.trim() });
      onClose();
    } catch (e) { setErr(errText(e, 'Could not save. Try again.')); }
  };
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Mark handled</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{target ? `${target.client.name} about ${target.expert.name}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>
            <Pressable onPress={() => setFixed((f) => !f)} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: fixed }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>The log was corrected</Text>
                <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>The expert fixed the session log after this flag.</Body>
              </View>
              <Switch value={fixed} onValueChange={setFixed} trackColor={{ true: hexA(C.green, 0.6), false: 'rgba(255,255,255,0.15)' }} thumbColor={fixed ? C.green : '#ccc'} />
            </Pressable>
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE (OPTIONAL)</Mono>
              <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 500))} placeholder="What was done, e.g. spoke to the expert, sets corrected" placeholderTextColor={C.muted3} multiline
                style={{ minHeight: 64, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
            </View>
            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. Marking needs the network.</Body> : null}
            <Pressable onPress={save} disabled={!online || m.isPending} accessibilityRole="button" style={{ paddingVertical: 14, borderRadius: 13, alignItems: 'center', backgroundColor: online ? C.orange : 'rgba(255,255,255,0.1)', opacity: m.isPending ? 0.6 : 1 }}>
              {m.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Save</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- the report action sheet ---------- */
const ACTIONS: { status: ReportStatus; label: string; blurb: string; tone: Tone }[] = [
  { status: 'in_review', label: 'Start review', blurb: 'Management is looking into it.', tone: 'amber' },
  { status: 'confirmed', label: 'Confirm (month free)', blurb: 'The report stands. The free month is credited by billing, not here.', tone: 'green' },
  { status: 'dismissed', label: 'Dismiss', blurb: 'Nothing to act on.', tone: 'grey' },
];
function ReportActionSheet({ target, onClose }: { target: SpecialistReport | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const m = useSetReportStatus();
  const [note, setNote] = React.useState('');
  const [pick, setPick] = React.useState<ReportStatus | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (target) { setNote(target.staff?.note ?? ''); setPick(target.status === 'new' ? null : target.status); setErr(null); } else Keyboard.dismiss(); }, [target]);
  const save = async () => {
    if (!target || !pick || m.isPending) return;
    try {
      await m.mutateAsync({ id: target.id, status: pick, note });
      trackEvent('Specialist Report Status Set', { report_id: target.id, status: pick, has_note: !!note.trim() });
      onClose();
    } catch (e) { setErr(errText(e, 'Could not save. Try again.')); }
  };
  const reopen = async () => {
    if (!target || m.isPending) return;
    try { await m.mutateAsync({ id: target.id, status: 'new', note: '' }); onClose(); } catch (e) { setErr(errText(e, 'Could not reopen. Try again.')); }
  };
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.16)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Report status</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{target ? `${target.client.name} about ${reportExpert(target).name}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
            {ACTIONS.map((a) => {
              const on = pick === a.status;
              const col = toneColor(a.tone);
              return (
                <Pressable key={a.status} onPress={() => setPick(a.status)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: on ? hexA(col, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(col, 0.6) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? col : C.muted3, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: col }} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: on ? '#fff' : C.ink }}>{a.label}</Text>
                    <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{a.blurb}</Body>
                  </View>
                </Pressable>
              );
            })}
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE (OPTIONAL)</Mono>
              <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 500))} placeholder="For the management record only" placeholderTextColor={C.muted3} multiline
                style={{ minHeight: 56, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
            </View>
            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}
            {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. Changing the status needs the network.</Body> : null}
            <Pressable onPress={save} disabled={!online || !pick || m.isPending} accessibilityRole="button" style={{ paddingVertical: 14, borderRadius: 13, alignItems: 'center', backgroundColor: online && pick ? C.orange : 'rgba(255,255,255,0.1)', opacity: m.isPending ? 0.6 : 1 }}>
              {m.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Save</Text>}
            </Pressable>
            {target && target.status !== 'new' ? (
              <Pressable onPress={reopen} disabled={!online || m.isPending} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 6 }}>
                <Body style={{ fontSize: 12, color: C.muted, textDecorationLine: 'underline' }}>Reopen as new</Body>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- cards ---------- */
function LogCard({ l, allTeams, onHandle, onReopen }: { l: InaccurateLog; allTeams: boolean; onHandle: () => void; onReopen: () => void }) {
  const [open, setOpen] = React.useState(false);
  const handled = !!l.staff;
  const block = loggedBlock(l);
  return (
    <View style={{ padding: 14, borderRadius: 18, gap: 9, backgroundColor: handled ? 'rgba(255,255,255,0.02)' : 'rgba(50,30,19,0.42)', borderWidth: 1, borderColor: handled ? 'rgba(255,255,255,0.06)' : hexA(C.red, 0.3), opacity: handled ? 0.8 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{l.client.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            <Body style={{ fontSize: 12, color: C.ink3 }}>about {l.expert.name}</Body>
            <Chip text={roleChip(l.expert.role)} tone="blue" />
            {allTeams && l.team_manager ? <Body style={{ fontSize: 11, color: C.muted2 }}>· Team {l.team_manager.name.split(' ')[0]}</Body> : allTeams ? <Body style={{ fontSize: 11, color: C.muted2 }}>· No team</Body> : null}
          </View>
        </View>
        <Chip text={handled ? 'HANDLED' : 'OPEN'} tone={handled ? 'green' : 'red'} />
      </View>
      <Body style={{ fontSize: 12, color: C.muted }}>{sessionLine(l)}</Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {issueChips(l.issues).map((c) => <Chip key={c} text={c} tone="red" />)}
      </View>
      {l.note ? <Body style={{ fontSize: 13, color: C.ink, lineHeight: 18 }}>"{l.note}"</Body> : null}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>{flaggedLine(l.at)}</Body>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.gold} strokeWidth={2.4} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.gold }}>As logged by {l.expert.name.split(' ')[0]}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 4, padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)' }}>
          {block.lines.map((t, i) => <Body key={i} style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>· {t}</Body>)}
          {block.notes ? <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 17 }}>{block.notes}</Body> : null}
          {block.empty ? <Body style={{ fontSize: 12, color: C.muted2 }}>{block.empty}</Body> : null}
        </View>
      ) : null}
      {handled ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Body style={{ flex: 1, fontSize: 11.5, color: C.green }}>{handledLine(l.staff)}</Body>
          <Pressable onPress={onReopen} hitSlop={8} accessibilityRole="button"><Body style={{ fontSize: 11.5, color: C.muted, textDecorationLine: 'underline' }}>Reopen</Body></Pressable>
        </View>
      ) : (
        <Pressable onPress={onHandle} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Mark handled</Text>
        </Pressable>
      )}
    </View>
  );
}

function ReportCard({ r, allTeams, onAct }: { r: SpecialistReport; allTeams: boolean; onAct: () => void }) {
  const chip = reportStatusChip(r.status);
  const ex = reportExpert(r);
  const sl = reportSessionLine(r);
  const hl = reportHandledLine(r);
  const closed = r.status === 'confirmed' || r.status === 'dismissed';
  return (
    <View style={{ padding: 14, borderRadius: 18, gap: 9, backgroundColor: closed ? 'rgba(255,255,255,0.02)' : 'rgba(76,52,140,0.22)', borderWidth: 1, borderColor: closed ? 'rgba(255,255,255,0.06)' : hexA('#A78BFA', 0.4), opacity: closed ? 0.85 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{r.client.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
            <Body style={{ fontSize: 12, color: C.ink3 }}>reported {ex.name}</Body>
            <Chip text={ex.chip} tone={ex.unmatched ? 'amber' : 'blue'} />
            {allTeams ? <Body style={{ fontSize: 11, color: C.muted2 }}>· {r.team_manager ? `Team ${r.team_manager.name.split(' ')[0]}` : 'No team'}</Body> : null}
          </View>
        </View>
        <Chip text={chip.text} tone={chip.tone} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Chip text={sourceLabel(r.source)} />
        {sl ? <Body style={{ fontSize: 11.5, color: C.muted }}>{sl}</Body> : null}
      </View>
      {r.note ? <Body style={{ fontSize: 13, color: C.ink, lineHeight: 18 }}>"{r.note}"</Body> : <Body style={{ fontSize: 12, color: C.muted2 }}>No note from the client.</Body>}
      <Body style={{ fontSize: 10.5, color: C.muted3 }}>Reported {fmtWhen(r.created_at)}</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="lock" size={11} color={C.muted3} strokeWidth={2} />
        <Body style={{ flex: 1, fontSize: 10.5, color: C.muted3 }}>{REPORT_PRIVACY_LINE}</Body>
      </View>
      {hl ? <Body style={{ fontSize: 11.5, color: r.status === 'confirmed' ? C.green : C.muted }}>{hl}</Body> : null}
      <Pressable onPress={onAct} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.5) }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#A78BFA' }}>{closed ? 'Change status' : r.status === 'in_review' ? 'Decide' : 'Review'}</Text>
      </Pressable>
    </View>
  );
}

/* ---------- the panel ---------- */
export function ClientComplaintsPanel({ logs, reports, logsQ, reportsQ, allTeams, kind, onKind, status, onStatus, counts }: {
  logs: InaccurateLog[]; reports: SpecialistReport[];
  logsQ: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  reportsQ: { isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  allTeams: boolean;
  kind: ComplaintKind; onKind: (k: ComplaintKind) => void;
  status: ComplaintStatusFilter; onStatus: (s: ComplaintStatusFilter) => void;
  counts: { logsOpen: number; reportsOpen: number };
}) {
  const [handle, setHandle] = React.useState<InaccurateLog | null>(null);
  const [act, setAct] = React.useState<SpecialistReport | null>(null);
  const unmark = useUnmarkLogHandled();
  const online = useIsOnline();
  const q = kind === 'logs' ? logsQ : reportsQ;
  const list = kind === 'logs' ? logs : reports;
  const reopen = (l: InaccurateLog) => {
    if (!online) { Alert.alert('No connection', 'Reopening needs the network.'); return; }
    Alert.alert('Reopen this flag?', 'It goes back to Open for the team.', [
      { text: 'Keep handled', style: 'cancel' },
      { text: 'Reopen', onPress: async () => { try { await unmark.mutateAsync({ sessionId: l.session_id }); } catch (e) { Alert.alert('Could not reopen', errText(e, 'Try again.')); } } },
    ]);
  };
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill text="Inaccurate logs" active={kind === 'logs'} count={counts.logsOpen || null} onPress={() => onKind('logs')} />
        <Pill text="Reports" active={kind === 'reports'} count={counts.reportsOpen || null} onPress={() => onKind('reports')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['open', 'handled', 'all'] as ComplaintStatusFilter[]).map((s) => <Pill key={s} text={s === 'open' ? 'Open' : s === 'handled' ? 'Handled' : 'All'} active={status === s} onPress={() => onStatus(s)} />)}
      </View>
      {q.isPending ? (
        <View style={{ alignItems: 'center', paddingVertical: 30 }}><ActivityIndicator color={C.orange} /></View>
      ) : q.isError ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28), gap: 8 }}>
          <Body style={{ fontSize: 12, color: '#E0A090' }}>{errText(q.error, 'Could not load client complaints. Pull to refresh.')}</Body>
          <Pressable onPress={() => q.refetch()} hitSlop={8} accessibilityRole="button"><Body style={{ fontSize: 12, color: C.orange, textDecorationLine: 'underline' }}>Try again</Body></Pressable>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 34 }}>
          <Icon name="checks" size={24} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingHorizontal: 24 }}>{emptyLine(kind, allTeams, status)}</Body>
        </View>
      ) : kind === 'logs' ? (
        logs.map((l) => <LogCard key={l.session_id} l={l} allTeams={allTeams} onHandle={() => setHandle(l)} onReopen={() => reopen(l)} />)
      ) : (
        reports.map((r) => <ReportCard key={r.id} r={r} allTeams={allTeams} onAct={() => setAct(r)} />)
      )}
      {/* one Modal at a time: the report sheet renders only while the log sheet is closed */}
      <HandleLogSheet target={handle} onClose={() => setHandle(null)} />
      {!handle ? <ReportActionSheet target={act} onClose={() => setAct(null)} /> : null}
    </View>
  );
}
