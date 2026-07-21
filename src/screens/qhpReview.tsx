import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { PdfPreview } from '../components/PdfPreview';
import {
  useQhpReviewQueue, useSignAsSenior, useSignAsHod, useHoldReport, useQhpReportMissing,
  reviewPdfUrl, stageOf, type QhpReviewRow, type ReviewNote,
} from '../lib/qhpReviewQueries';

/* ============ QHP Report Review — two-stage Senior Researcher → HOD queue
   (web /research/qhp-report-review). Gate: junior_researcher (first signer)
   or role_specialization 'hod' (final signer). ============ */

const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

const STAGE_META = {
  on_hold: { label: 'On Hold', color: C.gold },
  pending_senior: { label: 'Pending Senior', color: C.blue },
  pending_hod: { label: 'Pending HOD', color: C.purple },
  fully_signed: { label: 'Fully Signed', color: C.green },
} as const;
const stageMeta = (r: QhpReviewRow) => (r.held ? STAGE_META.on_hold : STAGE_META[stageOf(r)]);

function Loading() {
  return <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}

/* Review notes thread — hold / resubmit trail on a report. */
export function NotesThread({ notes }: { notes: ReviewNote[] }) {
  if (!notes.length) return null;
  return (
    <View style={{ gap: 7 }}>
      <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>REVIEW NOTES · {notes.length}</Mono>
      {notes.map((n, i) => {
        const isHold = n.type === 'hold' || n.type === 'hod_hold';
        const col = isHold ? C.gold : C.green;
        const label = n.type === 'hod_hold' ? 'Held by HOD' : n.type === 'hold' ? 'On hold' : 'Resubmitted';
        return (
          <View key={i} style={{ padding: 10, borderRadius: 11, backgroundColor: hexA(col, 0.06), borderWidth: 1, borderColor: hexA(col, 0.28), borderLeftWidth: 3, borderLeftColor: col, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Badge text={label} color={col} />
              <Mono style={{ fontSize: 8, color: C.muted3 }}>{(n.by_name ?? '').toUpperCase()}{n.by_name ? ' · ' : ''}{fmtAt(n.at).toUpperCase()}</Mono>
            </View>
            <Body style={{ fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>{n.message}</Body>
          </View>
        );
      })}
    </View>
  );
}

/* Review bottom sheet — PDF, notes, sign-off history, hold / sign actions. */
function ReviewSheet({ row, onClose }: { row: QhpReviewRow; onClose: () => void }) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? '';
  const caps = useMyCapabilities();
  const signSenior = useSignAsSenior();
  const signHod = useSignAsHod();
  const hold = useHoldReport();
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [showHold, setShowHold] = React.useState(false);
  const [holdMsg, setHoldMsg] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (row.pdfPath) reviewPdfUrl(row.pdfPath).then((u) => { if (!cancelled) setPdfUrl(u); });
    return () => { cancelled = true; };
  }, [row.pdfPath]);

  const meta = stageMeta(row);
  const canSignSenior = caps.data.juniorResearcher && !row.seniorSigned && !row.held;
  const canSignHod = caps.data.isHod && row.seniorSigned && !row.hodSigned && !row.held;
  const canHold = canSignSenior || canSignHod;
  const holdAsHod = canSignHod;
  const busy = signSenior.isPending || signHod.isPending || hold.isPending;
  const fail = (e: any) => setErr(e?.message ?? 'Action failed.');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Avatar initial={(row.clientName[0] ?? '?').toUpperCase()} size={38} fontSize={15} colors={avColors(row.clientName)} />
            <View style={{ flex: 1 }}>
              <Serif numberOfLines={1} style={{ fontSize: 18 }}>{row.clientName}</Serif>
              <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>QHP report review</Body>
            </View>
            <Badge text={meta.label} color={meta.color} />
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            {/* Meta grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(([['CREATED BY (JUNIOR RESEARCHER)', row.creatorName], ['CREATED AT', fmtAt(row.createdAt)]]) as [string, string][]).map(([lab, val]) => (
                <View key={lab} style={{ minWidth: '46%', flexGrow: 1, padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 2 }}>
                  <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                  <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{val}</Body>
                </View>
              ))}
            </View>

            {/* PDF */}
            <Pressable disabled={!pdfUrl} onPress={() => pdfUrl && Linking.openURL(pdfUrl)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.3), opacity: pdfUrl ? 1 : 0.5 }}>
              <Icon name="file" size={15} color={C.blue} strokeWidth={2} />
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, color: C.blue, fontFamily: F.bodySemi }}>{row.pdfFilename || 'QHP Report PDF'}</Body>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>{row.pdfPath ? (pdfUrl ? 'Open PDF' : 'Loading…') : 'No PDF'}</Text>
            </Pressable>

            {/* Inline preview of the ORIGINAL report PDF (web dialog embeds it the same way) */}
            {pdfUrl ? <PdfPreview url={pdfUrl} height={430} /> : row.pdfPath ? (
              <View style={{ height: 120, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <ActivityIndicator color={C.orange} />
                <Body style={{ fontSize: 10.5, color: C.muted3 }}>Preparing preview…</Body>
              </View>
            ) : null}

            <NotesThread notes={row.notes} />

            {/* Sign-off history */}
            <View style={{ padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 8 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>SIGN-OFF HISTORY</Mono>
              {(([['Senior Researcher', row.seniorSigned, row.seniorName, row.seniorAt], ['HOD', row.hodSigned, row.hodName, row.hodAt]]) as [string, boolean, string | null, string | null][]).map(([who, signed, name, at]) => (
                <View key={who} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Icon path={signed ? 'M20 6 9 17l-5-5' : 'M12 8v4M12 16h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z'} size={14} color={signed ? C.green : C.muted3} strokeWidth={2.3} />
                  <Body style={{ flex: 1, fontSize: 12, color: '#fff' }}>{who}</Body>
                  <Body style={{ fontSize: 11, color: signed ? C.green : C.muted3 }}>{signed ? `${name} · ${fmtAt(at)}` : 'Pending'}</Body>
                </View>
              ))}
            </View>

            {/* Hold form */}
            {showHold ? (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.35), gap: 9 }}>
                <Body style={{ fontSize: 12, fontFamily: F.bodySemi, color: C.gold }}>Reason for hold (required)</Body>
                {holdAsHod ? (
                  <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15 }}>Holding here clears the Senior Researcher signature and sends the report back to the creator. After resubmission it returns to the Senior queue before coming back to you.</Body>
                ) : null}
                <TextInput value={holdMsg} onChangeText={(v) => setHoldMsg(v.slice(0, 500))} placeholder="What does the creator need to fix?" placeholderTextColor={C.muted3} multiline style={{ minHeight: 72, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 11, color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
                <Mono style={{ fontSize: 8, color: C.muted3, textAlign: 'right' }}>{holdMsg.length}/500</Mono>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setShowHold(false)} disabled={busy} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={() => { setErr(null); hold.mutate({ id: row.id, message: holdMsg.trim() }, { onSuccess: onClose, onError: fail }); }} disabled={busy || !holdMsg.trim()} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11, backgroundColor: hexA(C.gold, !holdMsg.trim() ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.gold, !holdMsg.trim() ? 0.2 : 0.5) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: !holdMsg.trim() ? C.muted3 : C.gold }}>{hold.isPending ? 'Holding…' : 'Confirm hold'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {err ? <Body style={{ fontSize: 11.5, color: C.red }}>{err}</Body> : null}

            {/* Actions */}
            <View style={{ gap: 8 }}>
              {canHold && !showHold ? (
                <Pressable onPress={() => setShowHold(true)} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.4) }}>
                  <Icon name="alert" size={14} color={C.gold} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.gold }}>Hold & Send Back</Text>
                </Pressable>
              ) : null}
              {canSignSenior ? (
                <Pressable onPress={() => { setErr(null); signSenior.mutate({ id: row.id, uid }, { onSuccess: onClose, onError: fail }); }} disabled={busy} style={{ overflow: 'hidden', borderRadius: 12 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
                    <Icon name="checks" size={15} color="#fff" strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{signSenior.isPending ? 'Signing…' : 'Sign as Senior Researcher'}</Text>
                  </LinearGradient>
                </Pressable>
              ) : null}
              {canSignHod ? (
                <Pressable onPress={() => { setErr(null); signHod.mutate({ id: row.id, uid }, { onSuccess: onClose, onError: fail }); }} disabled={busy} style={{ overflow: 'hidden', borderRadius: 12 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
                    <Icon name="checks" size={15} color="#fff" strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{signHod.isPending ? 'Signing…' : 'Sign as HOD'}</Text>
                  </LinearGradient>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type TabId = 'mytask' | 'senior' | 'hod' | 'held' | 'missing';

export function QhpReviewCenter() {
  const caps = useMyCapabilities();
  const canSenior = caps.data.juniorResearcher;
  const canHod = caps.data.isHod;
  const allowed = canSenior || canHod;
  const q = useQhpReviewQueue(allowed);
  const missingQ = useQhpReportMissing(allowed);
  const [tab, setTab] = React.useState<TabId>('mytask');
  const [open, setOpen] = React.useState<QhpReviewRow | null>(null);
  const [visible, setVisible] = React.useState(20);
  React.useEffect(() => setVisible(20), [tab]);

  const rows = q.data ?? [];
  const seniorQueue = rows.filter((r) => !r.seniorSigned && !r.held);
  const hodQueue = rows.filter((r) => r.seniorSigned && !r.hodSigned && !r.held);
  const heldQueue = rows.filter((r) => r.held);
  const myTask = [...(canSenior ? seniorQueue : []), ...(canHod ? hodQueue : [])];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const signedToday = rows.filter((r) => r.hodSigned && r.hodAt && new Date(r.hodAt).getTime() >= todayStart.getTime()).length;
  const missing = missingQ.data ?? [];
  const roleLabel = canSenior && !canHod ? 'Senior Researcher' : canHod && !canSenior ? 'HOD' : 'Reviewer';

  if (!caps.isLoading && !allowed) {
    return (
      <Page gap={14}>
        <TitleBlock title="QHP Report Review" sub="Two-stage review queue" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>You don't have access to QHP Report Review.</Body>
      </Page>
    );
  }

  const tabs: { id: TabId; label: string; count: number; color: string }[] = [
    { id: 'mytask', label: 'My Task', count: myTask.length, color: C.orange },
    { id: 'senior', label: 'Pending Senior', count: seniorQueue.length, color: C.blue },
    { id: 'hod', label: 'Pending HOD', count: hodQueue.length, color: C.purple },
    { id: 'held', label: 'On Hold', count: heldQueue.length, color: C.gold },
    { id: 'missing', label: 'Missing Reports', count: missing.length, color: C.red },
  ];
  const list = tab === 'mytask' ? myTask : tab === 'senior' ? seniorQueue : tab === 'hod' ? hodQueue : tab === 'held' ? heldQueue : [];

  return (
    <Page gap={13}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TitleBlock title="QHP Report Review" sub="Two-stage Senior Researcher → HOD review queue" />
        </View>
        <Badge text={roleLabel} color={C.purple} />
      </View>

      {/* KPIs */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(([['users', 'PENDING SENIOR', seniorQueue.length, C.blue], ['file', 'PENDING HOD', hodQueue.length, C.purple], ['alert', 'ON HOLD', heldQueue.length, C.gold], ['checks', 'SIGNED TODAY', signedToday, C.green]]) as [IconName, string, number, string][]).map(([ic, lab, val, col]) => (
          <Card key={lab} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(col, 0.22)} radius={14} style={{ width: '47.5%', flexGrow: 1, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(col, 0.14), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={ic} size={14} color={col} strokeWidth={2.1} />
            </View>
            <View>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 19, color: col }}>{String(val).padStart(2, '0')}</Text>
              <Mono style={{ fontSize: 7, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
            </View>
          </Card>
        ))}
      </View>

      {/* Action needed strip */}
      {myTask.length + heldQueue.length + missing.length > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
          <Icon name="alert" size={14} color={C.gold} strokeWidth={2.2} />
          <Body style={{ flex: 1, fontSize: 11, color: C.ink2 }}>
            <Text style={{ fontFamily: F.bodyBold, color: C.gold }}>Action needed</Text>
            {'  '}{myTask.length} in My Task · {missing.length} QHP report{missing.length === 1 ? '' : 's'} missing · {heldQueue.length} on hold
          </Body>
        </View>
      ) : null}

      {/* Tabs */}
      <HScroll gap={7}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: active ? hexA(t.color, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(t.color, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? t.color : C.muted }}>{t.label}</Text>
              {t.count > 0 ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? t.color : C.muted3 }}>{t.count}</Text> : null}
            </Pressable>
          );
        })}
      </HScroll>

      {tab === 'missing' ? (
        <>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>QHPs completed on/after 20 May 2026 with captured data but no report generated yet.</Body>
          {missingQ.isLoading ? <Loading /> : missing.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No missing reports.</Body> : (
            <>
              {missing.slice(0, visible).map((r) => (
                <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.red, 0.16)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: C.red, gap: 5 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    <Body style={{ fontSize: 11, color: C.muted2 }}>Assessor {r.trainerName}</Body>
                    <Body style={{ fontSize: 11, color: C.muted2 }}>Completed {fmtAt(r.completedAt)}</Body>
                  </View>
                </Card>
              ))}
              {visible < missing.length ? (
                <Pressable onPress={() => setVisible((v) => v + 20)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({missing.length - visible})</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
          {q.isLoading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 22 }}>No reports in this queue. 🎉</Body> : (
            <>
              {list.slice(0, visible).map((r) => {
                const meta = stageMeta(r);
                return (
                  <Card key={r.id} onPress={() => setOpen(r)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(meta.color, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: meta.color, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Avatar initial={(r.clientName[0] ?? '?').toUpperCase()} size={36} fontSize={14} colors={avColors(r.clientName)} />
                      <View style={{ flex: 1 }}>
                        <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                        <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>by {r.creatorName} · {fmtAt(r.createdAt)}</Body>
                      </View>
                      <Badge text={meta.label} color={meta.color} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: r.seniorSigned ? C.green : C.muted3 }}>SENIOR {r.seniorSigned ? '✓' : 'PENDING'}</Mono>
                      <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: r.hodSigned ? C.green : C.muted3 }}>HOD {r.hodSigned ? '✓' : 'PENDING'}</Mono>
                      <View style={{ flex: 1 }} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                        <Icon name="eye" size={12} color={C.orange} strokeWidth={2.2} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Open</Text>
                      </View>
                    </View>
                  </Card>
                );
              })}
              {visible < list.length ? (
                <Pressable onPress={() => setVisible((v) => v + 20)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({list.length - visible})</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </>
      )}
      {open ? <ReviewSheet row={open} onClose={() => setOpen(null)} /> : null}
    </Page>
  );
}
