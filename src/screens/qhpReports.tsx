import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, ScrollView, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { useMyCapabilities } from '../lib/capabilities';
import {
  useAllQhps, useWithoutReport, useDataMissing, useMyReportTasks, useQhpPdfClients, useQhpPdfReports,
  type PdfClientRow,
} from '../lib/qhpReportQueries';
import { useHeldOwnReports, type HeldOwnRow } from '../lib/qhpReviewQueries';
import { ResubmitSheet } from '../components/qhpAlerts';

/* ============ QHP — report-generator view (web TrainerAssessments for
   view-all / qhp_report_creator trainers like Furqan Saifi). ============ */

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (t: string | null) => (t ? String(t).slice(0, 5) : null);

function Loading() {
  return <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Err({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 12 }}>{(q.error as Error)?.message ?? 'Could not load.'}</Body>;
}
function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}

const STAGE_META: Record<string, { label: string; color: string }> = {
  on_hold: { label: 'On hold', color: C.red },
  fully_signed: { label: 'Fully signed', color: C.green },
  pending_hod: { label: 'Pending HOD', color: C.gold },
  pending_senior: { label: 'Pending Senior', color: C.blue },
};

/* Per-client reports sheet (Report PDFs tab). */
function PdfReportsSheet({ client, onClose }: { client: PdfClientRow; onClose: () => void }) {
  const q = useQhpPdfReports(client.clientId);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '82%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 26 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="file" size={15} color={C.gold} strokeWidth={2} /></View>
            <Serif numberOfLines={1} style={{ flex: 1, fontSize: 18 }}>{client.name}</Serif>
            <Badge text={`${client.reportCount} report${client.reportCount === 1 ? '' : 's'}`} color={C.gold} />
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {q.isLoading ? <Loading /> : <Err q={q} />}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingBottom: 12 }}>
            {(q.data ?? []).map((r) => {
              const st = STAGE_META[r.stage];
              return (
                <View key={r.id} style={{ padding: 12, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(st.color, 0.22), borderLeftWidth: 3, borderLeftColor: st.color, gap: 8 }}>
                  <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.fileName}</Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge text={st.label} color={st.color} />
                    {r.approved ? <Badge text="Approved" color={C.green} /> : null}
                    <Mono style={{ fontSize: 8.5, color: C.muted3 }}>{fmtDate(r.createdAt).toUpperCase()}</Mono>
                    <View style={{ flex: 1 }} />
                    {r.pdfUrl ? (
                      <Pressable onPress={() => Linking.openURL(r.pdfUrl!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                        <Icon name="eye" size={12} color={C.blue} strokeWidth={2.2} />
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>Open PDF</Text>
                      </Pressable>
                    ) : <Mono style={{ fontSize: 8.5, color: C.muted3 }}>NO PDF</Mono>}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type TabId = 'all' | 'noreport' | 'missing' | 'tasks' | 'held' | 'pdfs';

type QhpStatusFilter = 'all' | 'completed' | 'pending' | 'reported';

export function QhpReports() {
  const { session } = useAuth();
  const { set, go } = useStore();
  const uid = session?.user?.id ?? null;
  const caps = useMyCapabilities();
  const isCreator = caps.data.qhpReportCreator;
  // Report creators land on "No Report" (web default); others on All QHPs.
  const [tab, setTab] = React.useState<TabId | null>(null);
  const activeTab: TabId = tab ?? (isCreator ? 'noreport' : 'all');

  // Web scope rule for Without-Report / Data-Missing: OWN assessments unless QHP manager.
  const allScope = caps.data.isQhpManager;
  const allQ = useAllQhps(activeTab === 'all');
  const nrQ = useWithoutReport(uid, allScope, true); // badge count is always shown, like the web tab label
  const dmQ = useDataMissing(uid, allScope, true);
  const tasksQ = useMyReportTasks(uid, isCreator);
  const heldQ = useHeldOwnReports(uid, isCreator);
  const pdfQ = useQhpPdfClients(activeTab === 'pdfs');
  const [resubmitFor, setResubmitFor] = React.useState<HeldOwnRow | null>(null);

  const [search, setSearch] = React.useState('');
  const [visible, setVisible] = React.useState(25);
  const [pdfClient, setPdfClient] = React.useState<PdfClientRow | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<QhpStatusFilter>('all');
  const term = search.trim().toLowerCase();
  React.useEffect(() => { setSearch(''); setVisible(25); setStatusFilter('all'); }, [activeTab]);
  const openAssessment = (id: string, clientName: string) => { set({ selectedClientId: id, selectedClientName: clientName }); go('qhp-assessment-detail'); };

  const tabs: { id: TabId; label: string; count: number | null; alert?: boolean }[] = [
    { id: 'all', label: 'All QHPs', count: null },
    { id: 'noreport', label: 'No Report', count: nrQ.data?.length ?? null, alert: true },
    { id: 'missing', label: 'Data Missing', count: dmQ.data?.length ?? null, alert: true },
    ...(isCreator ? ([
      { id: 'tasks' as TabId, label: 'My Tasks', count: tasksQ.data?.length ?? null, alert: true },
      { id: 'held' as TabId, label: 'Held Reports', count: heldQ.data?.length ?? null, alert: true },
      { id: 'pdfs' as TabId, label: 'Report PDFs', count: null },
    ]) : []),
  ];

  const loadMore = (total: number) => (visible < total ? (
    <Pressable onPress={() => setVisible((v) => v + 25)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({total - visible})</Text>
    </Pressable>
  ) : null);

  return (
    <Page gap={13}>
      <TitleBlock title="QHP" sub={isCreator ? 'Generate & track QHP reports across all trainers' : 'All QHPs across trainers'} />

      <HScroll gap={7}>
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? 'transparent' : 'rgba(255,255,255,0.09)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? '#fff' : C.muted }}>{t.label}</Text>
              {t.count != null && t.count > 0 ? (
                <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: active ? 'rgba(255,255,255,0.25)' : hexA(t.alert ? C.gold : C.blue, 0.2), alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? '#fff' : t.alert ? C.gold : C.blue }}>{t.count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </HScroll>

      {activeTab === 'all' ? (
        <>
          <Search value={search} onChange={(v) => { setSearch(v); setVisible(25); }} placeholder="Search by client or assessor…" />
          {/* Status sub-filter — Completed = assessment data captured (QHP done) */}
          <HScroll gap={7}>
            {(([['all', 'All', C.orange], ['completed', 'Completed', C.green], ['pending', 'Pending', C.gold], ['reported', 'Report ready', C.blue]]) as [QhpStatusFilter, string, string][]).map(([id, label, col]) => {
              const active = statusFilter === id;
              const n = id === 'all' ? allQ.data?.length : (allQ.data ?? []).filter((r) => (id === 'completed' ? r.done : id === 'reported' ? r.hasReport : !r.done)).length;
              return (
                <Pressable key={id} onPress={() => { setStatusFilter(id); setVisible(25); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
                  <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? col : C.muted }}>{label}</Text>
                  {n != null ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? col : C.muted3 }}>{n}</Text> : null}
                </Pressable>
              );
            })}
          </HScroll>
          <Err q={allQ} />
          {allQ.isLoading ? <Loading /> : (() => {
            const list = (allQ.data ?? [])
              .filter((r) => (statusFilter === 'all' ? true : statusFilter === 'completed' ? r.done : statusFilter === 'reported' ? r.hasReport : !r.done))
              .filter((r) => !term || r.clientName.toLowerCase().includes(term) || r.assessorName.toLowerCase().includes(term));
            if (!list.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No QHPs match.</Body>;
            return (
              <>
                {list.slice(0, visible).map((r) => {
                  const col = r.hasReport ? C.green : r.done ? C.blue : r.scheduled ? C.gold : C.muted2;
                  const label = r.hasReport ? 'Report ready' : r.done ? 'Completed' : r.scheduled ? 'Scheduled' : 'Not scheduled';
                  return (
                    <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.16)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: col, gap: 7 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                        <Badge text={label} color={col} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <Body style={{ fontSize: 11, color: C.muted2 }}>Assessor {r.assessorName}</Body>
                        {r.date ? <Body style={{ fontSize: 11, color: C.muted2 }}>{fmtDate(r.date)}{fmtTime(r.time) ? ` · ${fmtTime(r.time)}` : ''}</Body> : null}
                        <View style={{ flex: 1 }} />
                        {r.done ? (
                          <Pressable onPress={() => openAssessment(r.id, r.clientName)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                            <Icon name="eye" size={12} color={C.blue} strokeWidth={2.2} />
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>View QHP</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </Card>
                  );
                })}
                {loadMore(list.length)}
              </>
            );
          })()}
        </>
      ) : activeTab === 'noreport' ? (
        <>
          <View style={{ padding: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1, borderColor: hexA(C.gold, 0.3), flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(C.gold, 0.16), alignItems: 'center', justifyContent: 'center' }}><Icon name="alert" size={15} color={C.gold} strokeWidth={2.1} /></View>
            <Body style={{ flex: 1, fontSize: 11.5, color: C.ink2, lineHeight: 16 }}>Clients whose latest completed QHP has no generated report yet — these need a report created.</Body>
          </View>
          <Search value={search} onChange={(v) => { setSearch(v); setVisible(25); }} placeholder="Search clients…" />
          <Err q={nrQ} />
          {nrQ.isLoading ? <Loading /> : (() => {
            const list = (nrQ.data ?? []).filter((r) => !term || r.clientName.toLowerCase().includes(term) || r.trainerName.toLowerCase().includes(term));
            if (!list.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>All completed QHPs have reports. 🎉</Body>;
            return (
              <>
                {list.slice(0, visible).map((r) => (
                  <Card key={r.id} onPress={() => openAssessment(r.id, r.clientName)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.gold, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: C.gold, gap: 7 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                      {r.mechanicalScore != null ? <Badge text={`MAQ ${r.mechanicalScore}`} color={C.blue} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      <Body style={{ fontSize: 11, color: C.muted2 }}>Assessor {r.trainerName}</Body>
                      <Body style={{ fontSize: 11, color: C.muted2 }}>QHP {fmtDate(r.date)}{fmtTime(r.time) ? ` · ${fmtTime(r.time)}` : ''}</Body>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Mono style={{ flex: 1, fontSize: 8.5, letterSpacing: 0.5, color: r.lastWorkoutAt ? C.muted3 : C.red }}>
                        {r.lastWorkoutAt ? `LAST WORKOUT ${fmtDate(r.lastWorkoutAt).toUpperCase()}` : 'NO WORKOUTS LOGGED'}
                      </Mono>
                      <Icon name="eye" size={12} color={C.blue} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: C.blue }}>View QHP</Text>
                    </View>
                  </Card>
                ))}
                {loadMore(list.length)}
              </>
            );
          })()}
        </>
      ) : activeTab === 'missing' ? (
        <>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Scheduled QHPs whose date has passed but no assessment data was captured.</Body>
          <Err q={dmQ} />
          {dmQ.isLoading ? <Loading /> : (() => {
            const list = (dmQ.data ?? []).filter((r) => !term || r.clientName.toLowerCase().includes(term));
            if (!list.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>Nothing overdue — every past QHP has data.</Body>;
            return (
              <>
                {list.slice(0, visible).map((r) => (
                  <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.red, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: C.red, gap: 6 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      <Body style={{ fontSize: 11, color: C.muted2 }}>Assessor {r.trainerName}</Body>
                      <Body style={{ fontSize: 11, color: C.red }}>Was due {fmtDate(r.date)}{fmtTime(r.time) ? ` · ${fmtTime(r.time)}` : ''}</Body>
                    </View>
                  </Card>
                ))}
                {loadMore(list.length)}
              </>
            );
          })()}
        </>
      ) : activeTab === 'tasks' ? (
        <>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>QHPs assigned to you to build the report PDF — tap a task to open the assessment and generate the report.</Body>
          <Err q={tasksQ} />
          {tasksQ.isLoading ? <Loading /> : (tasksQ.data ?? []).length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No QHP report tasks assigned to you right now.</Body>
          ) : (tasksQ.data ?? []).map((r) => (
            <Card key={r.id} onPress={() => openAssessment(r.id, r.clientName)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.orange, 0.2)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: C.orange, gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                <Badge text={r.status === 'in_progress' ? 'In progress' : 'Assigned'} color={r.status === 'in_progress' ? C.blue : C.gold} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                {r.date ? <Body style={{ fontSize: 11, color: C.muted2 }}>QHP {fmtDate(r.date)}</Body> : null}
                {r.mechanicalScore != null ? <Badge text={`MAQ ${r.mechanicalScore}`} color={C.blue} /> : null}
              </View>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>
                {r.assignerName ? `ASSIGNED BY ${r.assignerName.toUpperCase()} · ` : ''}{r.assignedAt ? fmtDate(r.assignedAt).toUpperCase() : ''}
              </Mono>
            </Card>
          ))}
        </>
      ) : activeTab === 'held' ? (
        <>
          <Body style={{ fontSize: 11.5, color: C.muted2 }}>Reports a reviewer sent back to you. Fix the report (open the QHP and regenerate the PDF — it overwrites the same report), then resubmit.</Body>
          <Err q={heldQ} />
          {heldQ.isLoading ? <Loading /> : (heldQ.data ?? []).length === 0 ? (
            <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>Nothing on hold — you're all clear. 🎉</Body>
          ) : (heldQ.data ?? []).map((r) => {
            const lastHold = [...r.notes].reverse().find((n) => n.type === 'hold' || n.type === 'hod_hold');
            return (
              <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.gold, 0.22)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: C.gold, gap: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Badge text="On hold" color={C.gold} />
                </View>
                {lastHold ? (
                  <View style={{ padding: 9, borderRadius: 10, backgroundColor: hexA(C.gold, 0.06), borderLeftWidth: 2, borderLeftColor: hexA(C.gold, 0.6) }}>
                    <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.gold }}>REVIEWER'S NOTE</Mono>
                    <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 15, marginTop: 2 }}>{lastHold.message}</Body>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {r.heldAt ? <Mono style={{ flex: 1, fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>HELD {fmtDate(r.heldAt).toUpperCase()}</Mono> : <View style={{ flex: 1 }} />}
                  {r.coachAssessmentId ? (
                    <Pressable onPress={() => openAssessment(r.coachAssessmentId!, r.clientName)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                      <Icon name="eye" size={12} color={C.blue} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.blue }}>Open QHP</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setResubmitFor(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.green }}>Resubmit</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </>
      ) : (
        <>
          <Search value={search} onChange={(v) => { setSearch(v); setVisible(25); }} placeholder="Search clients…" />
          <Err q={pdfQ} />
          {pdfQ.isLoading ? <Loading /> : (() => {
            const list = (pdfQ.data ?? []).filter((c) => !term || c.name.toLowerCase().includes(term));
            if (!list.length) return <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No clients with QHP reports.</Body>;
            return (
              <>
                <Body style={{ fontSize: 11, color: C.muted3 }}>Showing {Math.min(visible, list.length)} of {list.length} client{list.length === 1 ? '' : 's'} with reports</Body>
                {list.slice(0, visible).map((c) => (
                  <Card key={c.clientId} onPress={() => setPdfClient(c)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="file" size={15} color={C.gold} strokeWidth={2} /></View>
                    <View style={{ flex: 1 }}>
                      <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                      <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>Latest {fmtDate(c.latestAt)}</Body>
                    </View>
                    <Badge text={`${c.reportCount}`} color={C.gold} />
                    <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
                  </Card>
                ))}
                {loadMore(list.length)}
              </>
            );
          })()}
        </>
      )}
      {pdfClient ? <PdfReportsSheet client={pdfClient} onClose={() => setPdfClient(null)} /> : null}
      {resubmitFor ? <ResubmitSheet row={resubmitFor} onClose={() => setResubmitFor(null)} /> : null}
    </Page>
  );
}
