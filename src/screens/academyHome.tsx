import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, ActivityIndicator, Alert, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, HScroll, BackLink } from './common';
import { PdfPreview } from '../components/PdfPreview';
import { useStore } from '../store';
import { ClientThreadsUnreadBanner } from '../components/clientThreadsCard';
import { useAcademyBanners, useQhpAnalyser, qhpPdfUrl, QHP_OVERDUE_MS, QhpAnalyserRow } from '../lib/academyQueries';
import { useMyCapabilities } from '../lib/capabilities';
import { PendingAttendanceBanner } from './academyApproval';

/* ============================================================================
   Academy Admin home — a lightweight launcher: three data-driven action
   banners over a toolkit grid. Mirrors the web /academy page.
   ========================================================================== */

const ACC = '#6EA8FE';

const fmtDT = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}`;
};
const agoDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);

export function AcademyHome() {
  const { go } = useStore();
  const q = useAcademyBanners();
  const caps = useMyCapabilities();
  const b = q.data;

  const TOOLS: { label: string; sub: string; icon: any; route: string; colors: [string, string] }[] = [
    // Senior Analyst and Workout Plans Analyst are capability-gated exactly like
    // the web dashboard (profiles.senior_analyst / workout_compliances_analyst).
    ...(caps.data.seniorAnalyst ? [{ label: 'Senior Analyst', sub: 'Client overview by goal', icon: 'trend' as any, route: 'academy-senior-analyst', colors: ['#2E5E6B', '#1A343C'] as [string, string] }] : []),
    { label: 'QHP Analyser', sub: 'Completion to PDF turnaround', icon: 'chart', route: 'academy-qhp-analyser', colors: ['#2B4A7E', '#1B2A46'] },
    ...(caps.data.workoutComplianceAnalyst ? [{ label: 'Workout Plans Analyst', sub: 'Plan compliance by client', icon: 'activity' as any, route: 'plans-analyst', colors: ['#5E2E6B', '#341A3C'] as [string, string] }] : []),
    { label: 'Progression', sub: 'Client progression metrics', icon: 'chart', route: 'coach-progression', colors: ['#2E6B6B', '#1A3C3C'] },
    { label: 'Daily Goals Analyser', sub: 'Trainer logging compliance', icon: 'target', route: 'academy-daily-goals', colors: ['#6B4A2E', '#3C2A1A'] },
    { label: 'Weekly Summary', sub: 'Who reads the AI summary', icon: 'calendar', route: 'academy-weekly-summary', colors: ['#2E6B5A', '#1A3C33'] },
    { label: 'Academy Management', sub: 'Students, batches, attendance', icon: 'award', route: 'academy-management', colors: ['#3D2E6B', '#221A3C'] },
    { label: 'B2C Reports', sub: 'Client QHP report library', icon: 'file', route: 'b2c-reports', colors: ['#6B3A2E', '#3C211A'] },
    { label: 'Client Threads', sub: 'Internal team thread per client', icon: 'atSign', route: 'client-threads', colors: ['#3A2E6B', '#1F1A3C'] },
    { label: 'Messenger', sub: 'Team and client chats', icon: 'chat', route: 'messenger', colors: ['#2E5A4A', '#1A3229'] },
  ];

  const banner = (
    key: string,
    tone: string,
    icon: any,
    title: string,
    sub: string,
    rows: { id: string; clientName: string; coachName: string; at: string | null }[],
    cta?: { label: string; onPress: () => void },
  ) => {
    if (!rows.length) return null;
    return (
      <Card key={key} colors={[hexA(tone, 0.1), 'rgba(18,16,20,0.6)']} border={hexA(tone, 0.35)} radius={17} style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(tone, 0.16), borderWidth: 1, borderColor: hexA(tone, 0.4), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={15} color={tone} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: tone }}>{rows.length} {title}</Text>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>{sub}</Body>
          </View>
        </View>
        {rows.slice(0, 4).map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>{r.coachName.toUpperCase()} · {fmtDT(r.at)}</Mono>
            </View>
          </View>
        ))}
        {rows.length > 4 ? (
          <Mono style={{ fontSize: 8.5, color: C.muted3, textAlign: 'right' }}>+{rows.length - 4} MORE</Mono>
        ) : null}
        {cta ? (
          <Pressable onPress={cta.onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(tone, 0.14), borderWidth: 1, borderColor: hexA(tone, 0.42) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: tone }}>{cta.label}</Text>
            <Icon name="chevRight" size={12} color={tone} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </Card>
    );
  };

  return (
    <Page gap={13} pt={6}>
      <TitleBlock title="Academy" sub="Research and academy tools" />
      {/* Teacher-submitted attendance waiting for review (web PendingAttendanceBanner). */}
      <PendingAttendanceBanner onPress={() => go('academy-management')} />
      <ClientThreadsUnreadBanner />

      {q.isPending ? (
        <ActivityIndicator color={ACC} style={{ paddingVertical: 22 }} />
      ) : q.isError ? (
        <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 14 }}>{(q.error as Error).message}</Body>
      ) : (
        <>
          {banner('hod', C.gold, 'alert', 'QHP reports pending HOD sign-off', 'Waiting on the head doctor to review and sign.', b?.pendingHod ?? [], { label: 'Open review queue', onPress: () => go('qhp-review') })}
          {banner('hold', C.red, 'alert', 'QHP reports on hold', 'A senior sent these back — they need changes before signing.', b?.onHold ?? [], { label: 'Open review queue', onPress: () => go('qhp-review') })}
          {banner('missing', C.orange, 'file', 'QHP reports missing', 'Assessments completed with captured data but no report created yet.', b?.missing ?? [], { label: 'Open QHP Analyser', onPress: () => go('academy-qhp-analyser') })}
          {!b?.pendingHod.length && !b?.onHold.length && !b?.missing.length ? (
            <Card colors={['rgba(30,48,38,0.5)', 'rgba(16,20,18,0.55)']} border={hexA(C.green, 0.25)} radius={17} style={{ padding: 16, alignItems: 'center', gap: 7 }}>
              <Icon name="checks" size={22} color={C.green} strokeWidth={2} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.green }}>Nothing needs attention</Text>
              <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center' }}>Every completed QHP has a report and no sign-offs are pending.</Body>
            </Card>
          ) : null}
        </>
      )}

      <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2, marginTop: 4 }}>TOOLKIT</Mono>
      <View style={{ gap: 9 }}>
        {TOOLS.map((t) => (
          <Pressable key={t.route} onPress={() => go(t.route)} style={{ borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
            <LinearGradient colors={t.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15 }}>
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={t.icon} size={19} color="#fff" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff' }}>{t.label}</Text>
                <Body style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>{t.sub}</Body>
              </View>
              <Icon name="chevRight" size={17} color="rgba(255,255,255,0.65)" strokeWidth={2.3} />
            </LinearGradient>
          </Pressable>
        ))}
      </View>
    </Page>
  );
}

/* ============================================================================
   QHP Analyser — completion → PDF turnaround, with the 3-day pending SLA.
   ========================================================================== */
type StatusFilter = 'all' | 'pending' | 'done';
type RangeKey = '7d' | '30d' | '90d' | 'all';
const RANGE_MS: Record<RangeKey, number | null> = { '7d': 7 * 864e5, '30d': 30 * 864e5, '90d': 90 * 864e5, all: null };

const turnColor = (ms: number) => (ms <= 24 * 3.6e6 ? C.green : ms <= 72 * 3.6e6 ? C.gold : C.red);
const fmtTurn = (ms: number) => {
  const h = ms / 3.6e6;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export function AcademyQhpAnalyser() {
  const { back, canGoBack, go } = useStore();
  const q = useQhpAnalyser();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [range, setRange] = React.useState<RangeKey>('30d');
  const [sortByTurn, setSortByTurn] = React.useState(false);
  const [preview, setPreview] = React.useState<QhpAnalyserRow | null>(null);
  // Pagination: 40 rows per page, reset whenever any filter changes.
  const PAGE = 40;
  const [visible, setVisible] = React.useState(PAGE);
  React.useEffect(() => setVisible(PAGE), [search, status, range, sortByTurn]);

  const rows = q.data ?? [];
  const stats = React.useMemo(() => {
    const done = rows.filter((r) => r.status === 'done');
    const turns = done.map((r) => r.turnaroundMs ?? 0).filter((n) => n > 0);
    return {
      completed: rows.length,
      generated: done.length,
      pending: rows.length - done.length,
      overdue: rows.filter((r) => r.isOverdue).length,
      avgHours: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length / 3.6e6 : null,
    };
  }, [rows]);

  const filtered = React.useMemo(() => {
    const qq = search.trim().toLowerCase();
    const cutoff = RANGE_MS[range] == null ? null : Date.now() - (RANGE_MS[range] as number);
    const now = Date.now();
    const out = rows
      .filter((r) => (status === 'all' ? true : r.status === status))
      .filter((r) => (cutoff == null ? true : r.completedMs >= cutoff))
      .filter((r) => !qq || r.clientName.toLowerCase().includes(qq) || r.coachName.toLowerCase().includes(qq));
    // Sorting by turnaround treats a pending row as "elapsed so far", so the
    // longest-waiting reports rise to the top.
    return sortByTurn
      ? out.slice().sort((a, b) => ((b.turnaroundMs ?? now - b.completedMs) - (a.turnaroundMs ?? now - a.completedMs)))
      : out.slice().sort((a, b) => b.completedMs - a.completedMs);
  }, [rows, search, status, range, sortByTurn]);

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back to Academy" onPress={() => (canGoBack ? back() : go('academy-dashboard'))} />
      <TitleBlock title="QHP Analyser" sub="Assessment completed to report delivered" />

      {/* Stats */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([['Completed', stats.completed, ACC], ['Reports', stats.generated, C.green], ['Pending', stats.pending, C.gold], ['Overdue', stats.overdue, C.red]] as const).map(([lab, n, col]) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 14, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.25) }}>
            <Serif style={{ fontSize: 22, color: col }}>{q.isPending ? '…' : n}</Serif>
            <Mono style={{ fontSize: 7, letterSpacing: 0.7, color: C.muted3, marginTop: 2 }}>{lab.toUpperCase()}</Mono>
          </View>
        ))}
      </View>
      {stats.avgHours != null ? (
        <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center', marginTop: -5 }}>
          Average turnaround {stats.avgHours < 48 ? `${stats.avgHours.toFixed(1)} hours` : `${(stats.avgHours / 24).toFixed(1)} days`} · pending over 3 days counts as overdue
        </Body>
      ) : null}

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search client or coach…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
      </View>

      {/* Filters */}
      <HScroll gap={7}>
        {(['all', 'pending', 'done'] as StatusFilter[]).map((s) => {
          const on = status === s;
          const col = s === 'pending' ? C.gold : s === 'done' ? C.green : ACC;
          return (
            <Pressable key={s} onPress={() => setStatus(s)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? col : C.muted, textTransform: 'capitalize' }}>{s}</Text>
            </Pressable>
          );
        })}
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 3 }} />
        {(['7d', '30d', '90d', 'all'] as RangeKey[]).map((r) => {
          const on = range === r;
          return (
            <Pressable key={r} onPress={() => setRange(r)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: on ? C.purple : C.muted }}>{r === 'all' ? 'All time' : r}</Text>
            </Pressable>
          );
        })}
      </HScroll>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={() => setSortByTurn((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: sortByTurn ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: sortByTurn ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.09)' }}>
          <Icon name="swap" size={11} color={sortByTurn ? C.orange : C.muted2} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: sortByTurn ? C.orange : C.muted }}>{sortByTurn ? 'Slowest first' : 'Newest first'}</Text>
        </Pressable>
        <Mono style={{ flex: 1, textAlign: 'right', fontSize: 9, color: C.muted3 }}>{filtered.length} SHOWN</Mono>
      </View>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 30 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{(q.error as Error).message}</Body>
        : filtered.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>No assessments match these filters.</Body>
        : filtered.slice(0, visible).map((r) => {
          const done = r.status === 'done';
          const badgeCol = done ? C.green : r.isOverdue ? C.red : C.gold;
          const badgeText = done ? 'Done' : r.isOverdue ? 'Overdue' : 'Pending';
          const elapsed = Date.now() - r.completedMs;
          return (
            <View key={r.id} style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(badgeCol, 0.18), gap: 9 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                <View style={{ flex: 1 }}>
                  <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                  <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{r.coachName.toUpperCase()}</Mono>
                </View>
                <View style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(badgeCol, 0.14), borderWidth: 1, borderColor: hexA(badgeCol, 0.4) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: badgeCol }}>{badgeText}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.7, color: C.muted3 }}>COMPLETED</Mono>
                  <Body style={{ fontSize: 11.5, color: C.ink3, marginTop: 1 }}>{fmtDT(r.completedAt)}</Body>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.7, color: C.muted3 }}>TURNAROUND</Mono>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: done ? turnColor(r.turnaroundMs ?? 0) : badgeCol, marginTop: 1 }}>
                    {done ? fmtTurn(r.turnaroundMs ?? 0) : `${fmtTurn(elapsed)} waiting`}
                  </Text>
                </View>
              </View>

              {done ? (
                r.pdfStoragePath ? (
                  <View style={{ flexDirection: 'row', gap: 7 }}>
                    <Pressable onPress={() => setPreview(r)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 11, backgroundColor: hexA(ACC, 0.12), borderWidth: 1, borderColor: hexA(ACC, 0.4) }}>
                      <Icon name="eye" size={12} color={ACC} strokeWidth={2.1} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: ACC }}>View report</Text>
                    </Pressable>
                    <Pressable onPress={() => Linking.openURL(qhpPdfUrl(r.pdfStoragePath!)).catch(() => Alert.alert('Could not open', 'The report link could not be opened.'))} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                      <Icon path="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" size={12} color={C.ink3} strokeWidth={2.1} />
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                    <Icon name="alert" size={11} color={C.muted3} strokeWidth={2.1} />
                    <Body style={{ flex: 1, fontSize: 10.5, color: C.muted3 }}>Report exists but no PDF was saved. Ask the coach to open it and use Finalize and Download.</Body>
                  </View>
                )
              ) : null}
            </View>
          );
        })}
      {filtered.length > visible ? (
        <Pressable onPress={() => setVisible((v) => v + PAGE)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(ACC, 0.35), backgroundColor: hexA(ACC, 0.05) }}>
          <Icon name="chevDown" size={14} color={ACC} strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: ACC }}>
            Load {Math.min(PAGE, filtered.length - visible)} more · {visible} of {filtered.length} shown
          </Text>
        </Pressable>
      ) : filtered.length > PAGE ? (
        <Mono style={{ fontSize: 9, color: C.muted3, textAlign: 'center' }}>ALL {filtered.length} SHOWN</Mono>
      ) : null}

      {/* PDF preview */}
      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPreview(null)} />
          <View style={{ backgroundColor: '#12131A', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: hexA(ACC, 0.18), paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 17 }} numberOfLines={1}>{preview?.clientName}</Serif>
                <Body style={{ fontSize: 11, color: C.muted2 }}>QHP report · {preview ? fmtDT(preview.completedAt) : ''}</Body>
              </View>
              <Pressable onPress={() => setPreview(null)} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color={C.muted2} strokeWidth={2.3} />
              </Pressable>
            </View>
            {preview?.pdfStoragePath ? <PdfPreview url={qhpPdfUrl(preview.pdfStoragePath)} height={430} /> : null}
          </View>
        </View>
      </Modal>
    </Page>
  );
}
