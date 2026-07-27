import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, TitleBlock, BackLink } from './common';
import { PdfPreview } from '../components/PdfPreview';
import { useStore } from '../store';
import { useMyCapabilities } from '../lib/capabilities';
import { reviewPdfUrl } from '../lib/qhpReviewQueries';
import {
  useRehabRecommendationQueue, usePhysioMarkSeen, useQhpDetailsRealtime,
  RehabQueueRow, PHYSIO_NOTE_MAX,
} from '../lib/physioHodQueries';
import { PhysioHodNotesThread, PhysioHodStatusBadge, PHYSIO_ACC } from '../components/physioHodThread';

/* ============================================================================
   Rehab Recommendation — the Physio HOD's queue of QHP reports pushed over by
   the Academy HOD. Pending / Seen tabs, PDF preview, Mark as Seen (+ optional
   note), and the shared two-color thread. Gated on role_specialization
   containing 'physio_hod' (the mark-seen RPC also enforces this server-side).
   ========================================================================== */

const fmtAt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}`;
};

export function DoctorRehabRecommendation() {
  const { back, canGoBack, go } = useStore();
  const caps = useMyCapabilities();
  const allowed = caps.data.isPhysioHod;
  const q = useRehabRecommendationQueue(allowed);
  useQhpDetailsRealtime();
  const seenM = usePhysioMarkSeen();
  const [tab, setTab] = React.useState<'pending' | 'seen'>('pending');
  const [openRow, setOpenRow] = React.useState<RehabQueueRow | null>(null);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [seenNote, setSeenNote] = React.useState('');

  // Keep the open sheet in sync with fresh query data (thread updates etc.).
  const rows = q.data ?? [];
  const openLive = openRow ? rows.find((r) => r.id === openRow.id) ?? openRow : null;

  React.useEffect(() => {
    let cancelled = false;
    setPdfUrl(null);
    if (openLive?.pdfPath) {
      reviewPdfUrl(openLive.pdfPath).then((u) => { if (!cancelled) setPdfUrl(u); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [openLive?.id, openLive?.pdfPath]);

  if (!caps.isLoading && !allowed) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Rehab Recommendation" sub="Physio HOD" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>
          This page is for the Physio HOD only.
        </Body>
      </Page>
    );
  }

  const pending = rows.filter((r) => r.status === 'pending');
  const seen = rows.filter((r) => r.status === 'seen');
  const list = tab === 'pending' ? pending : seen;

  const markSeen = (row: RehabQueueRow) => {
    seenM.mutate({ id: row.id, note: seenNote }, {
      onSuccess: () => { setSeenNote(''); Alert.alert('Marked as seen', `${row.clientName}'s report is acknowledged — the Academy HOD can see it.`); },
      onError: (e: any) => Alert.alert('Could not mark seen', e?.message ?? 'Try again'),
    });
  };

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back" onPress={() => (canGoBack ? back() : go('doctor-dashboard'))} />
      <TitleBlock title="Rehab Recommendation" sub="QHP reports pushed by the Academy HOD" />

      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['pending', `Pending (${pending.length})`], ['seen', `Seen (${seen.length})`]] as const).map(([id, lab]) => {
          const on = tab === id;
          return on ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isPending ? <ActivityIndicator color={PHYSIO_ACC} style={{ paddingVertical: 30 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error).message}</Body>
        : list.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 34, gap: 8 }}>
            <Icon name="checks" size={24} color={tab === 'pending' ? C.green : C.muted3} strokeWidth={2} />
            <Body style={{ fontSize: 12.5, color: C.muted3 }}>
              {tab === 'pending' ? 'No reports waiting on you.' : 'Nothing marked seen yet.'}
            </Body>
          </View>
        ) : list.map((r) => (
          <Pressable key={r.id} onPress={() => setOpenRow(r)} style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(r.status === 'pending' ? C.gold : C.green, 0.22), gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>
                  PUSHED BY {r.pushedByName.toUpperCase()} · {fmtAt(r.pushedAt).toUpperCase()}
                </Mono>
              </View>
              <PhysioHodStatusBadge push={r.push} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {r.notes.length ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="chat" size={10} color={PHYSIO_ACC} strokeWidth={2.1} />
                  <Mono style={{ fontSize: 8.5, color: PHYSIO_ACC }}>{r.notes.length} NOTE{r.notes.length === 1 ? '' : 'S'}</Mono>
                </View>
              ) : null}
              <Mono style={{ flex: 1, textAlign: 'right', fontSize: 8, color: C.muted3 }}>REPORT {fmtAt(r.createdAt).toUpperCase()}</Mono>
              <Icon name="chevRight" size={13} color={C.muted3} strokeWidth={2.3} />
            </View>
          </Pressable>
        ))}

      {/* Detail sheet: PDF + mark seen + thread */}
      <Modal visible={!!openLive} transparent animationType="slide" onRequestClose={() => setOpenRow(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpenRow(null)} />
          <View style={{ maxHeight: '92%', backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(PHYSIO_ACC, 0.22), paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 18 }} numberOfLines={1}>{openLive?.clientName}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>
                  Pushed by {openLive?.pushedByName} · {fmtAt(openLive?.pushedAt ?? null)}
                </Body>
              </View>
              {openLive ? <PhysioHodStatusBadge push={openLive.push} /> : null}
              <Pressable onPress={() => setOpenRow(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 13, paddingBottom: 8 }}>
              {openLive?.pdfPath ? (
                pdfUrl ? <PdfPreview url={pdfUrl} height={340} /> : <View style={{ height: 340, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)' }}><ActivityIndicator color={PHYSIO_ACC} /></View>
              ) : (
                <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 14 }}>No PDF stored for this report.</Body>
              )}

              {openLive?.status === 'pending' ? (
                <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.28) }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.gold }}>ACKNOWLEDGE THIS REPORT</Mono>
                  <TextInput
                    value={seenNote} onChangeText={(t) => setSeenNote(t.slice(0, PHYSIO_NOTE_MAX))}
                    placeholder="Optional note back to the Academy HOD…" placeholderTextColor={C.muted3} multiline
                    style={{ minHeight: 52, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 12.5, textAlignVertical: 'top' }}
                  />
                  <Pressable onPress={() => openLive && markSeen(openLive)} disabled={seenM.isPending} style={{ borderRadius: 12, overflow: 'hidden', opacity: seenM.isPending ? 0.6 : 1 }}>
                    <LinearGradient colors={['#3FBF77', '#2E9A5D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12 }}>
                      <Icon name="checks" size={14} color="#fff" strokeWidth={2.6} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{seenM.isPending ? 'Saving…' : 'Mark as Seen'}</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : openLive ? (
                <Body style={{ fontSize: 11, color: C.green, textAlign: 'center' }}>
                  Seen by {openLive.push[openLive.push.length - 1]?.seen_by_name ?? 'Physio HOD'} · {fmtAt(openLive.push[openLive.push.length - 1]?.seen_at ?? null)}
                </Body>
              ) : null}

              {openLive ? <PhysioHodNotesThread qhpDetailsId={openLive.id} notes={openLive.notes} /> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Page>
  );
}
