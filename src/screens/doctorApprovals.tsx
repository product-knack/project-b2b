import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, BackLink, AccessPending, Badge } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { friendlyError } from '../lib/friendlyError';
import { HEAD_DOCTOR_ID } from '../lib/doctorQueries';
import {
  SESSION_CODE_OFF, STATUS_WORD, codedSentence, fmtWhen, rejectNoteProblem, requesterText, typeTitle,
  type ApprovalListRow, type ApprovalStatus,
} from '../lib/approvalRequests';
import { useApprovalCounts, useApprovalRequests, useReviewApprovalRequest } from '../lib/approvalRequestQueries';

/* ============ Pending Approvals (doctors' manager) ============
   Port of hub-track src/pages/shared/ApprovalRequests.tsx (2 Nov 2026). One section per request type the signed-in
   person may review (get_approval_counts); the first type is "Session code off": a CRM asks to turn off a client's
   Session code and it goes off only when approved here. The RPCs re-check everything on the server. */

type Filter = ApprovalStatus | 'all';
const FILTERS: [Filter, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
const STATUS_COLOR: Record<ApprovalStatus, string> = { pending: C.gold, approved: C.green, rejected: C.red, withdrawn: C.muted2, cancelled: C.muted2 };

export function DoctorPendingApprovals() {
  const { back, canGoBack, go } = useStore();
  const { session, dbRole } = useAuth();
  const caps = useMyCapabilities();
  const uid = session?.user?.id ?? null;
  const allowed = caps.data.isPhysioHod || uid === HEAD_DOCTOR_ID || dbRole === 'admin' || dbRole === 'super_admin';
  const countsQ = useApprovalCounts(allowed);
  const types = (countsQ.data ?? []).length ? countsQ.data! : [{ request_type: SESSION_CODE_OFF, label: 'Session code off', pending: 0 }];
  const [type, setType] = React.useState<string>(SESSION_CODE_OFF);
  React.useEffect(() => { if (!types.some((t) => t.request_type === type)) setType(types[0].request_type); }, [types.map((t) => t.request_type).join(',')]);
  const [filter, setFilter] = React.useState<Filter>('pending');
  const q = useApprovalRequests(type, filter, allowed);
  const [decide, setDecide] = React.useState<{ row: ApprovalListRow; decision: 'approve' | 'reject' } | null>(null);

  if (caps.isPending || caps.isError) return <AccessPending paused={caps.isPaused} error={caps.isError} onRetry={caps.refetch} />;
  if (!allowed) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Pending Approvals" sub="Doctors' manager" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>This page is for the doctors' manager only.</Body>
      </Page>
    );
  }

  const rows = q.data ?? [];
  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back" onPress={() => (canGoBack ? back() : go('doctor-dashboard'))} />
      <TitleBlock title="Pending Approvals" sub="Requests that wait for your decision. Nothing changes until you approve." />

      {types.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {types.map((t) => {
            const on = t.request_type === type;
            return (
              <Pressable key={t.request_type} onPress={() => setType(t.request_type)} hitSlop={10}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.gold, 0.5) : 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: on ? C.gold : C.muted }}>{typeTitle(t.request_type, t.label)}</Text>
                {t.pending > 0 ? <Badge text={String(t.pending)} color={C.gold} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.gold }}>{typeTitle(types[0].request_type, types[0].label).toUpperCase()}{types[0].pending ? ` · ${types[0].pending} WAITING` : ''}</Mono>
      )}

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(([f, lab]) => {
          const on = f === filter;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? '#fff' : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? '#fff' : 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: on ? '#111' : C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isPending ? <ActivityIndicator color={C.gold} style={{ paddingVertical: 30 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(codedSentence(q.error) ?? friendlyError(q.error, "Couldn't load the requests. Pull to refresh."))}</Body>
        : rows.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 34, gap: 8 }}>
            <Icon name="checks" size={24} color={filter === 'pending' ? C.green : C.muted3} strokeWidth={2} />
            <Body style={{ fontSize: 12.5, color: C.muted3 }}>{filter === 'pending' ? 'Nothing waiting for you.' : 'No requests here.'}</Body>
          </View>
        ) : rows.map((r) => {
          const partner = r.payload?.partner_name as string | undefined;
          const otpNow = r.current_state?.otp;
          return (
            <Card key={r.id} colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border={hexA(STATUS_COLOR[r.status], 0.28)} radius={17} style={{ padding: 14, gap: 9, borderLeftWidth: 3, borderLeftColor: STATUS_COLOR[r.status] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff' }} numberOfLines={1}>{r.client_name || 'Client'}</Body>
                  {partner ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Also turns off for {partner} (training partner)</Body> : null}
                </View>
                <Badge text={`${STATUS_WORD[r.status]}${r.auto_approved ? ' (admin)' : ''}`} color={STATUS_COLOR[r.status]} />
              </View>
              <Body style={{ fontSize: 10.5, color: C.muted2 }}>{requesterText(r)} asked on {fmtWhen(r.requested_at)}</Body>
              <View style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)', borderLeftWidth: 3, borderLeftColor: hexA(C.gold, 0.7) }}>
                <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 18 }}>{r.reason}</Body>
              </View>
              {r.request_type === SESSION_CODE_OFF ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="shield" size={12} color={otpNow ? C.green : C.muted3} strokeWidth={2.2} />
                  <Body style={{ fontSize: 11.5, color: C.muted2 }}>Session code is <Text style={{ fontFamily: F.bodyBold, color: otpNow ? C.green : C.muted }}>{otpNow ? 'on' : 'off'}</Text> now</Body>
                </View>
              ) : null}
              {r.status !== 'pending' && (r.reviewed_at || r.withdrawn_at) ? (
                <Body style={{ fontSize: 11, color: C.muted3 }}>
                  {r.status === 'withdrawn' ? `Withdrawn on ${fmtWhen(r.withdrawn_at)}` : `${r.reviewed_by_name ? `${r.reviewed_by_name}, ` : ''}${fmtWhen(r.reviewed_at)}${r.review_note ? `: ${r.review_note}` : ''}`}
                </Body>
              ) : null}
              {r.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <Pressable onPress={() => setDecide({ row: r, decision: 'reject' })} accessibilityRole="button" accessibilityLabel={`Reject the request for ${r.client_name}`}
                    style={{ flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Icon name="close" size={12} color={C.red} strokeWidth={2.5} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Reject</Text>
                  </Pressable>
                  <Pressable onPress={() => setDecide({ row: r, decision: 'approve' })} accessibilityRole="button" accessibilityLabel={`Approve the request for ${r.client_name}`}
                    style={{ flex: 1.3, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                    <Icon name="checks" size={13} color={C.green} strokeWidth={2.6} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>Approve</Text>
                  </Pressable>
                </View>
              ) : null}
            </Card>
          );
        })}

      <ApprovalDecisionSheet row={decide?.row ?? null} decision={decide?.decision ?? 'approve'} onClose={() => setDecide(null)} />
    </Page>
  );
}

function ApprovalDecisionSheet({ row, decision, onClose }: { row: ApprovalListRow | null; decision: 'approve' | 'reject'; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const reviewM = useReviewApprovalRequest();
  const [note, setNote] = React.useState('');
  const visible = !!row;
  React.useEffect(() => { if (visible) { setNote(''); reviewM.reset(); } }, [visible]);
  const reject = decision === 'reject';
  const col = reject ? C.red : C.green;
  const problem = reject ? rejectNoteProblem(note) : null;
  const partner = row?.payload?.partner_name as string | undefined;
  const confirm = () => {
    if (!row || reviewM.isPending || problem) return;
    Keyboard.dismiss();
    reviewM.mutate({ id: row.id, decision, note, clientId: row.client_id }, {
      onSuccess: (r) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        Alert.alert(r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Closed',
          r.status === 'approved' ? 'The Session code is off now and the CRM is told.'
            : r.status === 'rejected' ? 'The Session code stays on and the CRM sees your note.'
            : r.review_note || 'Nothing was left to do for this request.');
      },
      onError: (e) => Alert.alert(reject ? "Couldn't reject" : "Couldn't approve", (codedSentence(e) ?? friendlyError(e, 'Try again.'))),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!reviewM.isPending) onClose(); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !reviewM.isPending && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(col, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19 }}>{reject ? 'Reject this request?' : 'Approve and turn off the Session code?'}</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
            {reject
              ? 'The Session code stays on and the CRM sees your note.'
              : `The Session code goes off for ${row?.client_name || 'this client'}${partner ? ` and ${partner}` : ''} now, and the CRM is told.`}
          </Body>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 3 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{row?.client_name}</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2 }}>{row ? requesterText(row) : ''}: {row?.reason}</Body>
            </View>
            <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{reject ? 'WHY (REQUIRED)' : 'NOTE (OPTIONAL)'}</Mono>
            <TextInput value={note} onChangeText={setNote} multiline maxLength={500} placeholder={reject ? 'Why is it rejected?' : 'Anything to add'} placeholderTextColor={C.muted3}
              accessibilityLabel="Decision note"
              style={{ minHeight: 70, textAlignVertical: 'top', fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            {reject && problem && note.length > 0 ? <Body style={{ fontSize: 11, color: C.muted3 }}>{problem}</Body> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} disabled={reviewM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Back</Text>
            </Pressable>
            <Pressable onPress={confirm} disabled={reviewM.isPending || !!problem} accessibilityRole="button" accessibilityLabel={reject ? 'Reject' : 'Approve'}
              style={{ flex: 1.4, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: hexA(col, problem ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(col, problem ? 0.2 : 0.5), opacity: reviewM.isPending ? 0.6 : 1 }}>
              {reviewM.isPending ? <ActivityIndicator size="small" color={col} /> : <Icon name={reject ? 'close' : 'checks'} size={13} color={problem ? C.muted3 : col} strokeWidth={2.6} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: problem ? C.muted3 : col }}>{reviewM.isPending ? 'Saving…' : reject ? 'Yes, reject' : 'Yes, approve'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
