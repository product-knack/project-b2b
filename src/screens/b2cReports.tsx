import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card, Avatar } from '../components/primitives';
import { Page, TitleBlock, Badge, BackLink } from './common';
import { useAuth } from '../auth';
import { qhpFullLabel } from '../lib/coachClientQueries';
import { DataSection } from './qhpAssessmentDetail';
import { PdfPreview } from '../components/PdfPreview';
import {
  B2C_REPORTS_UID, useB2cQhpClients, useB2cClientQhpReports, useB2cBloodClients, useB2cClientBloodReports,
  type B2cClient, type B2cQhpReport,
} from '../lib/b2cReportQueries';

/* ============ B2C Reports (web /academy/b2c-qhp-reports) — Rajat only ============ */

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const AV_GRADS: [string, string][] = [['#FB8B3A', '#EE5E16'], ['#57C98A', '#2E9A63'], ['#7C8FE8', '#4A5AC8'], ['#9A7BEA', '#6E5BD0'], ['#E0A53C', '#C07C1E'], ['#4FD1C5', '#2C8A86'], ['#F687B3', '#C2568A'], ['#F0883E', '#C05621']];
const avColors = (seed: string): [string, string] => AV_GRADS[[...(seed || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_GRADS.length];

function Loading() {
  return <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
      <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
      <TextInput value={value} onChangeText={onChange} placeholder="Search client by name…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      {value ? <Pressable onPress={() => onChange('')} hitSlop={8}><Icon name="close" size={13} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
    </View>
  );
}

function ClientList({ clients, loading, error, onSelect, emptyText }: { clients: B2cClient[]; loading: boolean; error: string | null; onSelect: (c: B2cClient) => void; emptyText: string }) {
  const [q, setQ] = React.useState('');
  const [visible, setVisible] = React.useState(25);
  const term = q.trim().toLowerCase();
  const list = term ? clients.filter((c) => c.name.toLowerCase().includes(term)) : clients;
  return (
    <>
      <Search value={q} onChange={(v) => { setQ(v); setVisible(25); }} />
      {error ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{error}</Body> : null}
      {loading ? <Loading /> : list.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>{term ? 'No clients match.' : emptyText}</Body> : (
        <>
          <Body style={{ fontSize: 11, color: C.muted3 }}>{list.length} client{list.length === 1 ? '' : 's'}</Body>
          {list.slice(0, visible).map((c) => (
            <Card key={c.id} onPress={() => onSelect(c)} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={14} style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar initial={c.initial} size={40} fontSize={15} colors={avColors(c.name)} />
              <View style={{ flex: 1 }}>
                <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{c.name}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  {c.subscription ? <Badge text={c.subscription} color={C.gold} /> : null}
                  <Body style={{ fontSize: 10.5, color: C.muted2 }}>{c.reportCount} report{c.reportCount === 1 ? '' : 's'}</Body>
                  {c.latestAt ? <Body style={{ fontSize: 10.5, color: C.muted3 }}>Latest {fmtDay(c.latestAt)}</Body> : null}
                </View>
              </View>
              <Icon name="chevRight" size={16} color={C.muted3} strokeWidth={2.2} />
            </Card>
          ))}
          {visible < list.length ? (
            <Pressable onPress={() => setVisible((v) => v + 25)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.orange }}>Load more ({list.length - visible})</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );
}

/* ---------------- QHP tab drill-down ---------------- */
function QhpTab() {
  const [client, setClient] = React.useState<B2cClient | null>(null);
  const [report, setReport] = React.useState<{ row: B2cQhpReport; chrono: number } | null>(null);
  const clientsQ = useB2cQhpClients(true);
  const reportsQ = useB2cClientQhpReports(client?.id ?? null);

  if (client && report) {
    const title = qhpFullLabel(report.chrono);
    return (
      <>
        <BackLink label={client.name} onPress={() => setReport(null)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Serif style={{ flex: 1, fontSize: 19 }}>{title}</Serif>
          {report.row.approved ? <Badge text="Approved" color={C.green} /> : <Badge text="Draft" color={C.muted2} />}
        </View>
        <Mono style={{ fontSize: 9, letterSpacing: 0.6, color: C.muted3 }}>CREATED {fmtDay(report.row.createdAt).toUpperCase()} · {client.name.toUpperCase()}</Mono>
        {report.row.pdfUrl ? (
          <>
            <Pressable onPress={() => Linking.openURL(report.row.pdfUrl!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.08), borderWidth: 1, borderColor: hexA(C.blue, 0.3) }}>
              <Icon name="file" size={15} color={C.blue} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 12, color: C.blue, fontFamily: F.bodySemi }}>QHP Report PDF</Body>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>Open PDF</Text>
            </Pressable>
            <PdfPreview url={report.row.pdfUrl} height={400} />
          </>
        ) : null}
        {report.row.qhpJson && typeof report.row.qhpJson === 'object' && Object.keys(report.row.qhpJson).length ? (
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 10 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>STRUCTURED REPORT DATA</Mono>
            <DataSection name={title} data={report.row.qhpJson} />
          </Card>
        ) : (
          <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 16 }}>No structured data found for this report.</Body>
        )}
      </>
    );
  }

  if (client) {
    const reports = reportsQ.data ?? [];
    return (
      <>
        <BackLink label="Clients" onPress={() => setClient(null)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar initial={client.initial} size={40} fontSize={15} colors={avColors(client.name)} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 19 }}>{client.name}</Serif>
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>{reports.length || client.reportCount} QHP report{(reports.length || client.reportCount) === 1 ? '' : 's'}</Body>
          </View>
        </View>
        {reportsQ.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(reportsQ.error as Error).message}</Body> : null}
        {reportsQ.isLoading ? <Loading /> : reports.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No reports for this client.</Body> : reports.map((r, idx) => {
          const chrono = idx + 1;
          return (
            <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(r.approved ? C.green : C.muted2, 0.18)} radius={14} style={{ padding: 12, borderLeftWidth: 3, borderLeftColor: r.approved ? C.green : C.muted2, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{qhpFullLabel(chrono)}</Body>
                {r.approved ? <Badge text="Approved" color={C.green} /> : <Badge text="Draft" color={C.muted2} />}
              </View>
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{fmtDay(r.createdAt).toUpperCase()}</Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setReport({ row: r, chrono })} style={{ flex: 1, overflow: 'hidden', borderRadius: 11 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 10 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>View Report</Text>
                  </LinearGradient>
                </Pressable>
                {r.pdfUrl ? (
                  <Pressable onPress={() => Linking.openURL(r.pdfUrl!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
                    <Icon name="file" size={13} color={C.blue} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>PDF</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          );
        })}
      </>
    );
  }

  return <ClientList clients={clientsQ.data ?? []} loading={clientsQ.isLoading} error={clientsQ.isError ? (clientsQ.error as Error).message : null} onSelect={setClient} emptyText="No B2C clients with QHP reports found." />;
}

/* ---------------- Blood tab drill-down ---------------- */
/* Marker status — web getMarkerStatus port: textual hints first, then numeric vs range. */
function getMarkerStatus(marker: any): 'normal' | 'high' | 'low' {
  const value = String(marker?.value ?? '').toLowerCase();
  const range = String(marker?.reference_range ?? '');
  if (value.includes('high') || value.includes('elevated')) return 'high';
  if (value.includes('low') || value.includes('decreased')) return 'low';
  if (value.includes('normal') || value.includes('within range')) return 'normal';
  if (!range.trim()) return 'normal';
  const n = parseFloat(value.replace(/[^\d.-]/g, ''));
  if (!isNaN(n)) {
    const m = range.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
    if (m) {
      if (n < parseFloat(m[1])) return 'low';
      if (n > parseFloat(m[2])) return 'high';
    }
  }
  return 'normal';
}
/* "<1.2" / "Upto 1.2" → "0 - 1.2" (web formatReferenceRange port). */
function formatRefRange(range: string | null | undefined): string {
  if (!range || range === 'NA') return range || '';
  const t = range.trim();
  const lt = t.match(/^<\s*([\d.]+)\s*$/);
  if (lt) return `0 - ${lt[1]}`;
  const upto = t.match(/^(?:upto|up\s*to)\s*([\d.]+)\s*$/i);
  if (upto) return `0 - ${upto[1]}`;
  return t;
}
const MARKER_META = { normal: { label: 'Normal', color: C.green }, high: { label: 'High', color: C.red }, low: { label: 'Low', color: C.gold } } as const;

/* One report accordion: report header → test-category accordions → marker rows. */
function BloodReportCard({ report }: { report: { id: string; name: string; uploadedAt: string | null; fileUrl: string | null; extracted: any } }) {
  const [open, setOpen] = React.useState(false);
  const [openCats, setOpenCats] = React.useState<Set<number>>(new Set());
  const tests: any[] = report.extracted?.tests ?? [];
  const hasData = tests.length > 0;
  const totalFlagged = tests.reduce((s, t) => s + ((t?.markers ?? []) as any[]).filter((m) => getMarkerStatus(m) !== 'normal').length, 0);
  const toggleCat = (i: number) => setOpenCats((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(totalFlagged > 0 ? C.red : C.green, 0.16)} radius={14} style={{ padding: 0 }}>
      {/* Report header */}
      <Pressable disabled={!hasData} onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12 }}>
        {hasData ? <Icon name={open ? 'chevDown' : 'chevRight'} size={13} color={C.muted3} strokeWidth={2.2} /> : null}
        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: hexA(C.gold, 0.13), alignItems: 'center', justifyContent: 'center' }}><Icon name="file" size={14} color={C.gold} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{report.name}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.4, color: C.muted3 }}>{fmtDay(report.uploadedAt).toUpperCase()}</Mono>
            {!hasData ? <Badge text="No data" color={C.muted2} /> : totalFlagged > 0 ? <Badge text={`${totalFlagged} flagged`} color={C.red} /> : <Badge text="All normal" color={C.green} />}
          </View>
        </View>
        {report.fileUrl ? (
          <Pressable onPress={() => Linking.openURL(report.fileUrl!)} hitSlop={6} style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 9, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.35) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.blue }}>PDF</Text>
          </Pressable>
        ) : null}
      </Pressable>

      {/* Test categories */}
      {open && hasData ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 7 }}>
          {tests.map((test: any, ti: number) => {
            const markers: any[] = test?.markers ?? [];
            const flagged = markers.filter((m) => getMarkerStatus(m) !== 'normal').length;
            const catOpen = openCats.has(ti);
            return (
              <View key={ti} style={{ borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: flagged > 0 ? hexA(C.red, 0.22) : 'rgba(255,255,255,0.06)' }}>
                <Pressable onPress={() => toggleCat(ti)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11 }}>
                  <Icon name={catOpen ? 'chevDown' : 'chevRight'} size={12} color={C.muted3} strokeWidth={2.2} />
                  <Body numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{test?.test_name || test?.category || test?.name || `Test ${ti + 1}`}</Body>
                  <Badge text={`${markers.length} tests`} color={C.blue} />
                  {flagged > 0 ? <Badge text={`${flagged} flagged`} color={C.red} /> : null}
                </Pressable>
                {catOpen ? (
                  <View style={{ paddingHorizontal: 11, paddingBottom: 10, gap: 6 }}>
                    {markers.map((m: any, mi: number) => {
                      const st = MARKER_META[getMarkerStatus(m)];
                      return (
                        <View key={mi} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)', borderLeftWidth: 2.5, borderLeftColor: st.color }}>
                          <View style={{ flex: 1 }}>
                            <Body numberOfLines={2} style={{ fontSize: 12, fontFamily: F.bodySemi, color: '#fff' }}>{m?.name ?? '—'}</Body>
                            {m?.reference_range ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>REF {formatRefRange(m.reference_range)}</Mono> : null}
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 3 }}>
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: st.color === C.green ? '#fff' : st.color }}>
                              {m?.value ?? '—'}{m?.unit ? <Text style={{ fontFamily: F.body, fontSize: 10, color: C.muted2 }}> {m.unit}</Text> : null}
                            </Text>
                            <Badge text={st.label} color={st.color} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function BloodTab() {
  const [client, setClient] = React.useState<B2cClient | null>(null);
  const clientsQ = useB2cBloodClients(true);
  const reportsQ = useB2cClientBloodReports(client?.id ?? null);

  if (client) {
    const reports = reportsQ.data ?? [];
    return (
      <>
        <BackLink label="Clients" onPress={() => setClient(null)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar initial={client.initial} size={40} fontSize={15} colors={avColors(client.name)} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 19 }}>{client.name}</Serif>
            <Body style={{ fontSize: 10.5, color: C.muted2 }}>Blood & health reports</Body>
          </View>
        </View>
        {reportsQ.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(reportsQ.error as Error).message}</Body> : null}
        {reportsQ.isLoading ? <Loading /> : reports.length === 0 ? <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>No active reports for this client.</Body> : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="heart" size={14} color={C.red} strokeWidth={2.1} />
              <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono }}>BLOOD REPORTS</Mono>
              <Badge text={`${reports.length}`} color={C.gold} />
            </View>
            {reports.map((r) => <BloodReportCard key={r.id} report={r} />)}
          </>
        )}
      </>
    );
  }

  return <ClientList clients={clientsQ.data ?? []} loading={clientsQ.isLoading} error={clientsQ.isError ? (clientsQ.error as Error).message : null} onSelect={setClient} emptyText="No B2C clients with blood reports found." />;
}

export function B2cReports() {
  const { session } = useAuth();
  const [tab, setTab] = React.useState<'qhp' | 'blood'>('qhp');
  if (session?.user?.id !== B2C_REPORTS_UID) {
    return (
      <Page gap={14}>
        <TitleBlock title="B2C Reports" sub="Academy" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>You don't have access to B2C Reports.</Body>
      </Page>
    );
  }
  return (
    <Page gap={13}>
      <TitleBlock title="B2C Reports" sub="Every B2C client's QHP & blood reports in one place" />
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        {(([['qhp', 'QHP Reports'], ['blood', 'Blood Reports']]) as ['qhp' | 'blood', string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
              {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? '#fff' : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === 'qhp' ? <QhpTab /> : <BloodTab />}
    </Page>
  );
}
