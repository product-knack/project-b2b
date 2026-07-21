import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, Linking, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, BackLink } from './common';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { useMyCapabilities } from '../lib/capabilities';
import { generateNarratives, buildQhpHtml, saveQhpDetails, renderAndUploadPdf, getAssessmentSource, deepGet } from '../lib/qhpPdf';
import { qhpFullLabel } from '../lib/coachClientQueries';

/* ============ Assessment Details (web /trainer/assessments/:id) ============
   Overview + captured assessment data + AI biomechanical + notes, and the
   "Generate QHP PDF" pipeline for profiles.qhp_report_creator users. */

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const labelOf = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (s) => s.toUpperCase());
const hasData = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;

function useAssessmentDetail(id: string | null) {
  return useQuery({
    queryKey: ['assessment-details', id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('*, assessor:profiles!coach_id(first_name, last_name), client:clients!client_id(first_name, last_name, phone, location)')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/* Recursive renderer for captured assessment / report jsonb (web renderSection port).
   Also reused by the B2C Reports detail view. */
export function DataSection({ name, data, depth = 0 }: { name: string; data: any; depth?: number }) {
  if (!data || typeof data !== 'object') return null;
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: depth === 0 ? 14 : 12.5, color: depth === 0 ? C.orange : '#fff', marginTop: depth === 0 ? 4 : 2 }}>{name}</Text>
      <View style={{ gap: 7 }}>
        {entries.map(([key, value]) => {
          const label = labelOf(key);
          if (typeof value === 'object' && !Array.isArray(value)) {
            // habit + frequency pair (web special case)
            if ((value as any).habit !== undefined && (value as any).frequency !== undefined) {
              return (
                <View key={key} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Body style={{ flex: 1, fontSize: 12, color: '#fff' }}>{String((value as any).habit)}</Body>
                  <Badge text={String((value as any).frequency)} color={C.blue} />
                </View>
              );
            }
            return <View key={key} style={{ paddingLeft: depth > 1 ? 0 : 6 }}><DataSection name={label} data={value} depth={depth + 1} /></View>;
          }
          if (Array.isArray(value)) {
            return (
              <View key={key} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 6 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3 }}>{label.toUpperCase()}</Mono>
                {value.map((item, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {typeof item === 'object' && item !== null && (item as any).habit !== undefined ? (
                      <>
                        <Body style={{ flex: 1, fontSize: 11.5, color: C.ink2 }}>{String((item as any).habit)}</Body>
                        <Badge text={String((item as any).frequency ?? '')} color={C.blue} />
                      </>
                    ) : (
                      <Body style={{ flex: 1, fontSize: 11.5, color: C.ink2 }}>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</Body>
                    )}
                  </View>
                ))}
              </View>
            );
          }
          const long = typeof value === 'string' && value.length > 90;
          return (
            <View key={key} style={{ padding: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 3, ...(long ? {} : { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 }) }}>
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.5, color: C.muted3, ...(long ? {} : { flex: 1 }) }}>{label.toUpperCase()}</Mono>
              <Body style={{ fontSize: 12, fontFamily: long ? F.body : F.bodySemi, color: '#fff', lineHeight: 17, ...(long ? {} : { maxWidth: '55%' as any, textAlign: 'right' as const }) }}>{String(value)}</Body>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* All completed QHPs for the client — the generator's assessment picker
   (web query + getAssessmentData source priority + Baseline/Refresh labels). */
type GenAssessment = { id: string; date: string | null; label: string; score: number | null; source: string; data: any };
function useClientCompletedAssessments(clientId: string | null) {
  return useQuery({
    queryKey: ['gen-client-assessments', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<GenAssessment[]> => {
      const { data, error } = await supabase
        .from('coach_assessment')
        .select('id, assessment_date, mechanical_score, qhp_data, new_client_assessment_data, existing_client_assessment_data')
        .eq('client_id', clientId!)
        .order('assessment_date', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[])
        .map((a) => ({ a, src: getAssessmentSource(a) }))
        .filter((x) => x.src)
        .map((x, idx) => ({ id: x.a.id, date: x.a.assessment_date ?? null, label: qhpFullLabel(idx + 1), score: x.a.mechanical_score ?? null, source: x.src!.source, data: x.src!.data }));
    },
  });
}

function OptionRow({ label, sub, active, onPress, badges }: { label: string; sub?: string | null; active: boolean; onPress: () => void; badges?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 12, backgroundColor: active ? hexA(C.orange, 0.1) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.08)' }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: active ? C.orange : C.muted3, alignItems: 'center', justifyContent: 'center' }}>
        {active ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.orange }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{label}</Body>
        {sub ? <Body numberOfLines={1} style={{ fontSize: 10, color: C.muted2, marginTop: 1 }}>{sub}</Body> : null}
      </View>
      {badges}
    </Pressable>
  );
}

/* The end-to-end Generate QHP PDF pipeline — web QHPPDFGenerator flow:
   pick assessment → comparison setup → 5-batch AI generation with progress →
   review → finalize (qhp_details + styled PDF upload → review queue). */
function GeneratePdfModal({ assessment, onClose }: { assessment: any; onClose: () => void }) {
  const clientName = `${assessment.client?.first_name ?? ''} ${assessment.client?.last_name ?? ''}`.trim() || assessment.client_name || 'Client';
  const listQ = useClientCompletedAssessments(assessment.client_id);
  const all = listQ.data ?? [];

  const [phase, setPhase] = React.useState<'setup' | 'working' | 'preview' | 'uploading' | 'done' | 'error'>('setup');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [compareId, setCompareId] = React.useState<string | null | 'unset'>('unset');
  const [baselineId, setBaselineId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState({ label: '', pct: 0 });
  const [narratives, setNarratives] = React.useState<Record<string, any> | null>(null);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState('');

  // Defaults: the opened assessment is selected; compare against the latest earlier QHP (web default).
  React.useEffect(() => {
    if (!all.length) return;
    const sel = all.find((a) => a.id === assessment.id) ?? all[all.length - 1];
    setSelectedId((cur) => cur ?? sel.id);
    if (compareId === 'unset') {
      const selIdx = all.findIndex((a) => a.id === sel.id);
      setCompareId(selIdx > 0 ? all[selIdx - 1].id : null);
    }
  }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = all.find((a) => a.id === selectedId) ?? null;
  const selIdx = selected ? all.findIndex((a) => a.id === selected.id) : -1;
  const earlier = selIdx > 0 ? all.slice(0, selIdx) : [];
  const compare = compareId && compareId !== 'unset' ? all.find((a) => a.id === compareId) ?? null : null;
  const baselineOpts = compare ? earlier.filter((a) => a.id !== compare.id && (a.date ?? '') < (compare.date ?? '')) : [];
  const baseline = baselineId ? baselineOpts.find((a) => a.id === baselineId) ?? null : null;
  const isComparison = !!compare;
  const reportLabel = isComparison && selected ? `${selected.label} Report` : 'QHP Baseline Report';

  const run = async () => {
    if (!selected) return;
    setPhase('working');
    setErr('');
    try {
      const result = await generateNarratives(
        {
          assessmentData: selected.data, clientName, assessmentDate: selected.date,
          previous: compare ? { data: compare.data, date: compare.date } : null,
          baseline: baseline ? { data: baseline.data, date: baseline.date } : null,
        },
        setProgress,
      );
      setNarratives(result);
      setPhase('preview');
    } catch (e: any) {
      setErr(e?.message ?? 'Generation failed.');
      setPhase('error');
    }
  };

  const finalize = async () => {
    if (!selected || !narratives) return;
    setPhase('uploading');
    try {
      setProgress({ label: 'Saving the report for review…', pct: 30 });
      const preapproved = { ...narratives, _meta: { client_name: clientName, assessment_date: selected.date, report_label: reportLabel, is_comparison: isComparison, compared_to: compare?.date ?? null, generated_from: 'odds-app' } };
      const detailId = await saveQhpDetails({ clientId: assessment.client_id, coachAssessmentId: selected.id, preapproved });
      setProgress({ label: 'Rendering & uploading the PDF…', pct: 70 });
      const d = selected.data;
      const html = buildQhpHtml({
        clientName, reportLabel, dateLabel: fmtDate(selected.date), score: selected.score,
        isComparison, comparedToLabel: compare ? `${compare.label} (${fmtDate(compare.date)})` : null,
        info: [
          { label: 'Client Name', value: clientName },
          { label: 'Age', value: deepGet(d, 'age', 'clientAge') },
          { label: 'Gender', value: deepGet(d, 'gender', 'clientGender', 'sex') },
          { label: 'QHP Date', value: fmtDate(selected.date) },
          { label: 'Height', value: deepGet(d, 'height', 'clientHeight') },
          { label: 'Weight', value: deepGet(d, 'weight', 'clientWeight') },
          { label: 'Profession', value: deepGet(d, 'profession', 'occupation') },
          { label: 'Location', value: assessment.location || deepGet(d, 'location') },
          { label: 'Analyst', value: assessment.assessor ? `${assessment.assessor.first_name ?? ''} ${assessment.assessor.last_name ?? ''}`.trim() : '' },
          { label: 'Primary Goal', value: deepGet(d, 'selectedGoal', 'goal', 'primaryGoal') },
          ...(selected.score != null ? [{ label: 'QHP Score', value: isComparison && compare?.score != null ? `${compare.score} → ${selected.score}` : `${selected.score}/100` }] : []),
        ],
      }, narratives);
      const url = await renderAndUploadPdf({ detailId, clientId: assessment.client_id, clientName, html });
      setPdfUrl(url);
      setPhase('done');
    } catch (e: any) {
      setErr(e?.message ?? 'Finalize failed.');
      setPhase('error');
    }
  };

  const busy = phase === 'working' || phase === 'uploading';
  const previewKeys = narratives ? Object.keys(narratives).filter((k) => !k.startsWith('_')) : [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? () => {} : onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 18 }}>
        <View style={{ maxHeight: '88%', backgroundColor: '#0E0A09', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,150,90,0.18)', padding: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: hexA(C.orange, 0.14), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="file" size={16} color={C.orange} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 17 }}>Generate QHP PDF</Serif>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2 }}>{clientName}</Body>
            </View>
            {!busy ? <Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={14} color={C.muted2} strokeWidth={2.3} /></Pressable> : null}
          </View>

          {phase === 'setup' ? (
            listQ.isLoading ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View> : !all.length ? (
              <Body style={{ fontSize: 12, color: C.muted2, textAlign: 'center', paddingVertical: 16 }}>No completed assessments with captured data for this client.</Body>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                <View style={{ gap: 7 }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>ASSESSMENT TO GENERATE FROM</Mono>
                  {all.map((a) => (
                    <OptionRow key={a.id} label={`${fmtDate(a.date)} · ${a.label}`} sub={`Source: ${a.source}`} active={selectedId === a.id}
                      onPress={() => { setSelectedId(a.id); setCompareId('unset'); setBaselineId(null); }}
                      badges={a.score != null ? <Badge text={`Score ${a.score}/100`} color={C.gold} /> : undefined} />
                  ))}
                </View>

                <View style={{ gap: 7 }}>
                  <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>COMPARE AGAINST (PREVIOUS QHP)</Mono>
                  <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15 }}>Pick None to generate a fresh Baseline report (no comparison).</Body>
                  <OptionRow label="None — fresh Baseline report" active={!compare} onPress={() => { setCompareId(null); setBaselineId(null); }} />
                  {earlier.map((a) => (
                    <OptionRow key={a.id} label={`${fmtDate(a.date)} · ${a.label}`} active={compare?.id === a.id}
                      onPress={() => { setCompareId(a.id); setBaselineId(null); }}
                      badges={a.score != null ? <Badge text={`${a.score}/100`} color={C.blue} /> : undefined} />
                  ))}
                </View>

                {compare && baselineOpts.length ? (
                  <View style={{ gap: 7 }}>
                    <Mono style={{ fontSize: 9, letterSpacing: 0.9, color: C.muted3 }}>OLDER BASELINE REFERENCE (OPTIONAL)</Mono>
                    <OptionRow label="None" active={!baseline} onPress={() => setBaselineId(null)} />
                    {baselineOpts.map((a) => (
                      <OptionRow key={a.id} label={`${fmtDate(a.date)} · ${a.label}`} active={baseline?.id === a.id} onPress={() => setBaselineId(a.id)} />
                    ))}
                  </View>
                ) : null}

                <Body style={{ fontSize: 10.5, color: isComparison ? C.blue : C.muted2 }}>
                  {isComparison ? `Will generate a comparison report (current vs ${fmtDate(compare!.date)}).` : 'Will generate a fresh Baseline report.'}
                </Body>
                <Pressable onPress={run} disabled={!selected} style={{ overflow: 'hidden', borderRadius: 13, opacity: selected ? 1 : 0.5 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13, flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
                    <Icon name="sparkle" size={15} color="#fff" strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>Proceed to Generate Report</Text>
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            )
          ) : busy ? (
            <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16 }}>
              <ActivityIndicator size="large" color={C.orange} />
              <Body style={{ fontSize: 12.5, color: C.ink2, textAlign: 'center' }}>{progress.label}</Body>
              <View style={{ width: '100%', height: 7, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(4, progress.pct)}%`, height: 7 }} />
              </View>
              <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{progress.pct}% COMPLETE</Mono>
              {phase === 'working' ? <Body style={{ fontSize: 10, color: C.muted3 }}>Generating in 5 focused batches for better quality</Body> : null}
            </View>
          ) : phase === 'preview' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 11, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
                <Icon name="checks" size={14} color={C.green} strokeWidth={2.2} />
                <Body style={{ flex: 1, fontSize: 11, color: C.ink2 }}>{reportLabel} rendered — review the sections, then finalize.</Body>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 7 }}>
                {previewKeys.map((k) => {
                  const v = (narratives as any)[k];
                  const count = Array.isArray(v) ? `${v.length} items` : typeof v === 'string' ? `${Math.min(v.length, 999)} chars` : typeof v === 'object' && v ? `${Object.keys(v).length} fields` : '';
                  const empty = v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
                  return (
                    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: empty ? hexA(C.red, 0.3) : 'rgba(255,255,255,0.06)' }}>
                      <Icon path={empty ? 'M6 6l12 12M18 6 6 18' : 'M20 6 9 17l-5-5'} size={11} color={empty ? C.red : C.green} strokeWidth={2.5} />
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 11, color: '#fff' }}>{labelOf(k)}</Body>
                      <Mono style={{ fontSize: 8, color: C.muted3 }}>{empty ? 'EMPTY' : count.toUpperCase()}</Mono>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setPhase('setup')} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Back</Text>
                </Pressable>
                <Pressable onPress={finalize} style={{ flex: 2, overflow: 'hidden', borderRadius: 12 }}>
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 12, flexDirection: 'row', justifyContent: 'center', gap: 7 }}>
                    <Icon name="file" size={14} color="#fff" strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Finalize & Upload PDF</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </>
          ) : phase === 'done' ? (
            <>
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <View style={{ width: 50, height: 50, borderRadius: 17, backgroundColor: hexA(C.green, 0.12), alignItems: 'center', justifyContent: 'center' }}><Icon name="checks" size={24} color={C.green} strokeWidth={2.2} /></View>
                <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{reportLabel} submitted</Body>
                <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center' }}>The PDF is uploaded and now awaits Senior Researcher review.</Body>
              </View>
              {pdfUrl ? (
                <Pressable onPress={() => Linking.openURL(pdfUrl)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.blue, 0.1), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                  <Icon name="eye" size={14} color={C.blue} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.blue }}>Open PDF</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={{ alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted }}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Body style={{ fontSize: 12, color: C.red, lineHeight: 17 }}>{err}</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setPhase('setup')} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Back to setup</Text>
                </Pressable>
                <Pressable onPress={narratives ? finalize : run} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Try again</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function QhpAssessmentDetail() {
  const { selectedClientId: assessmentId, selectedClientName, back } = useStore();
  const caps = useMyCapabilities();
  const q = useAssessmentDetail(assessmentId);
  const [genOpen, setGenOpen] = React.useState(false);
  const a: any = q.data;

  const assessmentData = a ? (a.qhp_data ?? a.new_client_assessment_data ?? a.existing_client_assessment_data) : null;
  const type = a?.qhp_data ? (a.qhp_data?.['Standardized Assessment']?.selectedGoal || 'QHP Assessment') : a?.new_client_assessment_data ? 'New Client' : a?.existing_client_assessment_data ? 'Existing Client' : 'Assessment';
  const clientName = a ? (`${a.client?.first_name ?? ''} ${a.client?.last_name ?? ''}`.trim() || a.client_name || selectedClientName || 'Client') : (selectedClientName ?? 'Client');

  return (
    <Page gap={14}>
      <BackLink label="QHP" onPress={back} />
      <TitleBlock title="Assessment Details" sub={clientName} />
      {q.isError ? <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center' }}>{(q.error as Error).message}</Body> : null}
      {q.isLoading ? <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View> : !a ? (
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 24 }}>Assessment not found.</Body>
      ) : (
        <>
          {/* Generate QHP PDF — report creators only (web gate: profiles.qhp_report_creator) */}
          {a.client_id && caps.data.qhpReportCreator ? (
            <Pressable onPress={() => setGenOpen(true)} style={{ overflow: 'hidden', borderRadius: 14 }}>
              <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
                <Icon name="file" size={15} color="#fff" strokeWidth={2.2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Generate QHP PDF</Text>
              </LinearGradient>
            </Pressable>
          ) : null}

          {/* Overview */}
          <Card colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(C.orange, 0.16)} radius={16} style={{ padding: 14, gap: 10 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>OVERVIEW</Mono>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(([
                ['TYPE', type, C.gold],
                ['ASSESSOR', a.assessor ? `${a.assessor.first_name ?? ''} ${a.assessor.last_name ?? ''}`.trim() : 'Unassigned', C.blue],
                ['SCHEDULED', fmtDate(a.assessment_date), C.orange],
                ['COMPLETED', a.completed && assessmentData ? fmtDate(a.completed) : '—', C.green],
                ...(a.mechanical_score != null ? [['SCORE', `${a.mechanical_score}`, C.purple]] : []),
                ...(a.location || a.client?.location ? [['LOCATION', a.location || a.client?.location, C.muted2]] : []),
              ]) as [string, string, string][]).map(([lab, val, col]) => (
                <View key={lab} style={{ minWidth: '30%', flexGrow: 1, padding: 10, borderRadius: 11, backgroundColor: hexA(col, 0.07), borderWidth: 1, borderColor: hexA(col, 0.2), gap: 2 }}>
                  <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
                  <Body numberOfLines={2} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{val}</Body>
                </View>
              ))}
            </View>
          </Card>

          {/* Assessment data */}
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 10 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>ASSESSMENT DATA</Mono>
            {hasData(assessmentData) ? <DataSection name="Assessment Details" data={assessmentData} /> : <Body style={{ fontSize: 12, color: C.muted2 }}>No assessment data available.</Body>}
          </Card>

          {/* AI biomechanical */}
          {a.ai_biomechanical ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 10 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>AI BIOMECHANICAL ANALYSIS</Mono>
              {typeof a.ai_biomechanical === 'string'
                ? <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 18 }}>{a.ai_biomechanical}</Body>
                : <DataSection name="Analysis" data={a.ai_biomechanical} />}
            </Card>
          ) : null}

          {/* Notes */}
          {a.notes ? (
            <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.1)" radius={16} style={{ padding: 14, gap: 8 }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono }}>NOTES</Mono>
              <Body style={{ fontSize: 12, color: C.ink2, lineHeight: 18 }}>{a.notes}</Body>
            </Card>
          ) : null}
        </>
      )}
      {genOpen && a ? <GeneratePdfModal assessment={a} onClose={() => setGenOpen(false)} /> : null}
    </Page>
  );
}
