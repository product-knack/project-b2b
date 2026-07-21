import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Modal, Image, Animated, PanResponder, Easing, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Badge } from './common';

/* ============================================================================
   Report detail sheets — ported from the old web app.
   • Blood / health reports  → health_reports.extracted_data.tests[].markers[]
     (status recomputed, ref-range normalized, NO download button)
   • QHP reports             → qhp_details.qhp_json (normalized QHPJsonSchema)
   ========================================================================== */

const s = (v: any): string => (v == null ? '' : String(v)).trim();
const arr = (v: any): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : s(v) ? [s(v)] : []);
const has = (v: any) => (Array.isArray(v) ? v.length > 0 : !!s(v));

/* ---------- ported: reference-range normalizer ---------- */
function formatReferenceRange(range: string | null | undefined): string {
  if (!range || range === 'NA') return range || '';
  const t = range.trim();
  const lt = t.match(/^<\s*([\d.]+)\s*$/);
  if (lt) return `0 - ${lt[1]}`;
  const up = t.match(/^(?:upto|up\s*to)\s*([\d.]+)\s*$/i);
  if (up) return `0 - ${up[1]}`;
  return t;
}

/* ---------- ported: dynamic marker status (never trusts stored status) ---------- */
type MStatus = 'normal' | 'high' | 'low' | 'abnormal';
function getMarkerStatus(marker: any): MStatus {
  const value = marker?.value?.toString().toLowerCase() || '';
  const ref = marker?.reference_range?.toString() || '';
  if (value.includes('high') || value.includes('elevated') || value.includes('increase')) return 'high';
  if (value.includes('low') || value.includes('decreased') || value.includes('reduce')) return 'low';
  if (value.includes('abnormal') || value.includes('irregular') || value.includes('atypical')) return 'abnormal';
  if (value.includes('normal') || value.includes('within range') || value.includes('wn limits')) return 'normal';
  if (!ref || !ref.trim()) return 'normal';
  const num = parseFloat(value.replace(/[^\d.-]/g, ''));
  if (!isNaN(num)) {
    const lt = ref.match(/<\s*(\d+(?:\.\d+)?)/);
    if (lt) return num >= parseFloat(lt[1]) ? 'high' : 'normal';
    const gt = ref.match(/>\s*(\d+(?:\.\d+)?)/);
    if (gt) return num <= parseFloat(gt[1]) ? 'low' : 'normal';
    const rng = ref.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
    if (rng) {
      const lo = parseFloat(rng[1]);
      const hi = parseFloat(rng[2]);
      if (num < lo) return 'low';
      if (num > hi) return 'high';
      return 'normal';
    }
  }
  return 'normal';
}
const statusColor = (st: MStatus) => (st === 'high' ? C.red : st === 'low' ? C.blue : st === 'abnormal' ? C.orange : C.green);
const statusLabel = (st: MStatus) => (st === 'high' ? 'HIGH' : st === 'low' ? 'LOW' : st === 'abnormal' ? 'CHECK' : 'NORMAL');

/* ============================== shell ============================== */
export function SheetShell({ visible, onClose, accent, icon, title, subtitle, children }: {
  visible: boolean; onClose: () => void; accent: string;
  icon: string; title: string; subtitle?: string; children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const translateY = React.useRef(new Animated.Value(0)).current;
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => { if (visible) translateY.setValue(0); }, [visible]);
  const pan = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.6) {
          Animated.timing(translateY, { toValue: 900, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => closeRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 18 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* KeyboardAvoidingView keeps inputs (search fields etc.) above the keyboard;
          the sheet shrinks instead of being covered. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end' }}>
        <Animated.View style={{ height: '92%', backgroundColor: '#0B0908', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: hexA(accent, 0.18), overflow: 'hidden', transform: [{ translateY }] }}>
          {/* Grab + header */}
          <View {...pan.panHandlers} style={{ paddingTop: 9 }}>
            <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13 }}>
              <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: hexA(accent, 0.14), borderWidth: 1, borderColor: hexA(accent, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon as any} size={21} color={accent} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19, lineHeight: 23 }} numberOfLines={2}>{title}</Serif>
                {subtitle ? <Mono style={{ fontSize: 10, color: C.muted3, marginTop: 2 }}>{subtitle}</Mono> : null}
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={17} color={C.muted} strokeWidth={2.3} />
              </Pressable>
            </View>
            <View style={{ height: 2, backgroundColor: hexA(accent, 0.45) }} />
          </View>
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 34, gap: 14 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ============================== shared bits ============================== */
function SectionCard({ accent, icon, title, children }: { accent: string; icon?: string; title: string; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <View style={{ height: 3, backgroundColor: hexA(accent, 0.4) }} />
      <View style={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          {icon ? <Icon name={icon as any} size={16} color={accent} strokeWidth={2} /> : null}
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: accent, textTransform: 'uppercase' }}>{title}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

// A 2-column label/value grid. Rows with empty values are dropped.
function FieldGrid({ rows }: { rows: [string, any][] }) {
  const kept = rows.filter(([, v]) => has(v));
  if (!kept.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
      {kept.map(([label, val], i) => (
        <View key={i} style={{ width: '50%', paddingHorizontal: 6, paddingVertical: 6 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono>
          <Body style={{ fontSize: 13.5, color: '#fff', marginTop: 2 }}>{s(val)}</Body>
        </View>
      ))}
    </View>
  );
}

function ChipRow({ label, items, color }: { label: string; items: any; color: string }) {
  const list = arr(items);
  if (!list.length) return null;
  return (
    <View style={{ gap: 7 }}>
      <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {list.map((t, i) => (
          <View key={i} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(color, 0.1), borderWidth: 1, borderColor: hexA(color, 0.28) }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color }}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function BulletList({ label, items, color }: { label?: string; items: any; color: string }) {
  const list = arr(items);
  if (!list.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {label ? <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.muted3, textTransform: 'uppercase' }}>{label}</Mono> : null}
      {list.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: color, marginTop: 6 }} />
          <Body style={{ flex: 1, fontSize: 13, color: C.ink3, lineHeight: 19 }}>{t}</Body>
        </View>
      ))}
    </View>
  );
}

function Note({ text }: { text: any }) {
  if (!has(text)) return null;
  return <Body style={{ fontSize: 13, color: C.ink3, lineHeight: 19 }}>{s(text)}</Body>;
}

// Merge several string lists into one deduped list (case-insensitive).
const dedup = (...lists: any[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  lists.forEach((l) => arr(l).forEach((t) => {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }));
  return out;
};
const firstText = (...vals: any[]): string => { for (const v of vals) if (has(v)) return s(v); return ''; };

// Compact metric chips (label + value) — used instead of big grids to keep findings scannable.
function MetricChips({ items }: { items: [string, any][] }) {
  const kept = items.filter(([, v]) => has(v));
  if (!kept.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {kept.map(([lbl, v], i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
          <Mono style={{ fontSize: 8.5, color: C.muted3, textTransform: 'uppercase' }}>{lbl}</Mono>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{s(v)}</Text>
        </View>
      ))}
    </View>
  );
}

// Full-screen, pinch-zoomable photo viewer so postural photos are seen in full.
function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : null}
        </ScrollView>
        <Pressable onPress={onClose} style={{ position: 'absolute', top: insets.top + 8, right: 16, width: 42, height: 42, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color="#fff" strokeWidth={2.4} />
        </Pressable>
        <View style={{ position: 'absolute', bottom: insets.bottom + 16, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' }}>
          <Mono style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.75)' }}>PINCH TO ZOOM</Mono>
        </View>
      </View>
    </Modal>
  );
}

// A section that opens/closes; when closed it shows a short preview line so the
// report reads as a summary and the detail is one tap away.
function CollapsibleSection({ accent, icon, title, preview, defaultOpen = false, children }: {
  accent: string; icon?: string; title: string; preview?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <View style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <View style={{ height: 3, backgroundColor: hexA(accent, 0.4) }} />
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 14 }}>
        {icon ? <View style={{ marginTop: 1 }}><Icon name={icon as any} size={16} color={accent} strokeWidth={2} /></View> : null}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: accent, textTransform: 'uppercase' }}>{title}</Text>
          {!open && preview ? <Body numberOfLines={2} style={{ fontSize: 12, color: C.muted2, marginTop: 5, lineHeight: 17 }}>{preview}</Body> : null}
        </View>
        <View style={{ marginTop: 1 }}><Icon name={open ? 'chevUp' : 'chevDown'} size={16} color={C.muted} strokeWidth={2.2} /></View>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>{children}</View> : null}
    </View>
  );
}

/* ============================== BLOOD / HEALTH ============================== */

/* Numeric helpers for the marker range visualisation. */
const parseNum = (v: any): number => parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
function parseRange(ref: string): { lo: number; hi: number } | null {
  const m = ref.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lo = parseFloat(m[1]);
  const hi = parseFloat(m[2]);
  if (isNaN(lo) || isNaN(hi) || hi <= lo) return null;
  return { lo, hi };
}

/* Mini track: green band = normal range, dot = where this value sits.
   The track extends ~35% past the band on each side so out-of-range dots
   visibly sit in the danger zone instead of clamping at the band edge. */
function RangeBar({ value, lo, hi, color }: { value: number; lo: number; hi: number; color: string }) {
  const span = hi - lo;
  const pad = span * 0.35;
  const min = lo === 0 ? 0 : lo - pad;
  const max = hi + pad;
  const total = max - min || 1;
  const dot = Math.min(0.99, Math.max(0.01, (value - min) / total));
  const zL = (lo - min) / total;
  const zW = span / total;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n));
  return (
    <View style={{ gap: 3, paddingLeft: 16 }}>
      <View style={{ height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ position: 'absolute', left: `${zL * 100}%`, width: `${zW * 100}%`, top: 0, bottom: 0, borderRadius: 999, backgroundColor: hexA(C.green, 0.3) }} />
        <View style={{ position: 'absolute', left: `${dot * 100}%`, top: -2.5, marginLeft: -5, width: 10, height: 10, borderRadius: 999, backgroundColor: color, borderWidth: 2, borderColor: '#0B0908' }} />
      </View>
      <View style={{ height: 11 }}>
        <View style={{ position: 'absolute', left: `${zL * 100}%`, right: `${(1 - zL - zW) * 100}%`, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Mono style={{ fontSize: 8, color: C.muted3 }}>{fmt(lo)}</Mono>
          <Mono style={{ fontSize: 8, color: C.muted3 }}>{fmt(hi)}</Mono>
        </View>
      </View>
    </View>
  );
}

/* One marker line: dot + name (+ panel when shown out of its category),
   big colored value, status pill, then the range track underneath. */
function MarkerRow({ m, cat, first }: { m: any; cat?: string; first?: boolean }) {
  const st = getMarkerStatus(m);
  const col = statusColor(st);
  const flagged = st !== 'normal';
  const ref = formatReferenceRange(s(m?.reference_range));
  const rng = ref && ref !== 'NA' ? parseRange(ref) : null;
  const num = parseNum(m?.value);
  return (
    <View style={{ paddingVertical: 11, gap: 7, borderTopWidth: first ? 0 : 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: flagged ? col : 'rgba(255,255,255,0.16)' }} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 13.5, color: '#fff', fontFamily: flagged ? F.bodySemi : undefined }}>{s(m?.name) || '—'}</Body>
          {cat ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{cat}</Mono> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: flagged ? col : '#fff' }}>
            {s(m?.value) || '—'}{m?.unit ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: C.muted2 }}>  {s(m.unit)}</Text> : null}
          </Text>
          <View style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(col, 0.13), borderWidth: 1, borderColor: hexA(col, 0.3) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 8, letterSpacing: 0.5, color: col }}>{statusLabel(st)}</Text>
          </View>
        </View>
      </View>
      {rng && !isNaN(num) ? (
        <RangeBar value={num} lo={rng.lo} hi={rng.hi} color={flagged ? col : C.green} />
      ) : ref ? (
        <Mono style={{ fontSize: 8.5, color: C.muted3, paddingLeft: 16 }}>Range: {ref}</Mono>
      ) : null}
    </View>
  );
}

/* Top-of-sheet triage: how many markers need attention, proportion bar, legend. */
function TriageCard({ counts }: { counts: { total: number; normal: number; high: number; low: number; abnormal: number } }) {
  const flagged = counts.high + counts.low + counts.abnormal;
  const segs: [number, string][] = ([
    [counts.normal, C.green], [counts.high, C.red], [counts.low, C.blue], [counts.abnormal, C.orange],
  ] as [number, string][]).filter(([n]) => n > 0);
  const legend: [string, number, string][] = ([
    ['Normal', counts.normal, C.green], ['High', counts.high, C.red], ['Low', counts.low, C.blue], ['Check', counts.abnormal, C.orange],
  ] as [string, number, string][]).filter(([, n]) => n > 0);
  return (
    <View style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: flagged ? hexA(C.red, 0.22) : hexA(C.green, 0.2), padding: 14, gap: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        {flagged > 0 ? (
          <>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 27, color: C.red, lineHeight: 30 }}>{flagged}</Text>
            <Body style={{ fontSize: 13, color: C.ink3 }}>marker{flagged === 1 ? '' : 's'} need{flagged === 1 ? 's' : ''} attention</Body>
          </>
        ) : (
          <>
            <Icon name="checks" size={19} color={C.green} strokeWidth={2.2} />
            <Body style={{ fontSize: 13.5, color: C.green, fontFamily: F.bodySemi }}>All markers within range</Body>
          </>
        )}
        <View style={{ flex: 1 }} />
        <Mono style={{ fontSize: 9.5, color: C.muted3 }}>{counts.total} TOTAL</Mono>
      </View>
      <View style={{ flexDirection: 'row', height: 7, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {segs.map(([n, c], i) => (
          <View key={i} style={{ flex: n, backgroundColor: hexA(c, 0.55), borderRadius: 999 }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {legend.map(([lbl, n, c], i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: c }} />
            <Mono style={{ fontSize: 9, color: C.muted2 }}>{n} {lbl.toUpperCase()}</Mono>
          </View>
        ))}
      </View>
    </View>
  );
}

export function BloodReportSheet({ report, accent = C.blue, icon = 'activity', onClose }: {
  report: any | null; accent?: string; icon?: string; onClose: () => void;
}) {
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  const [q, setQ] = React.useState('');
  const ed = report?.extracted_data;
  const tests: any[] = Array.isArray(ed?.tests) ? ed.tests : [];

  // Legacy fallback: flatten biomarkers (array or object map) into one category.
  const legacy: any[] = React.useMemo(() => {
    if (tests.length) return [];
    const bm = report?.biomarkers;
    const list = Array.isArray(bm) ? bm : bm && typeof bm === 'object' ? Object.values(bm) : [];
    return list
      .map((m: any) => ({
        name: s(m?.name || m?.marker || m?.test_name || m?.parameter || m?.label),
        value: s(m?.value ?? m?.result ?? m?.reading),
        unit: s(m?.unit || m?.units),
        reference_range: s(m?.reference_range || m?.range || m?.normal_range || m?.ref_range),
      }))
      .filter((m: any) => m.name || m.value);
  }, [report]);

  const categories = tests.length ? tests : legacy.length ? [{ test_name: 'Biomarkers', markers: legacy }] : [];
  const measurements = report?.measurements && typeof report.measurements === 'object' ? report.measurements : null;
  const ai = report?.ai_analysis?.analysis ?? report?.ai_analysis ?? null;

  // Every marker flattened once: powers the triage card, the Needs Attention
  // list and search. Status is computed here so each row isn't re-classified.
  const flat = React.useMemo(
    () => categories.flatMap((cat: any, ci: number) =>
      (Array.isArray(cat?.markers) ? cat.markers : []).map((m: any) => ({
        m, st: getMarkerStatus(m), cat: s(cat?.test_name || cat?.category) || `Test Group ${ci + 1}`,
      }))
    ),
    [report]
  );
  const counts = React.useMemo(() => ({
    total: flat.length,
    normal: flat.filter((f) => f.st === 'normal').length,
    high: flat.filter((f) => f.st === 'high').length,
    low: flat.filter((f) => f.st === 'low').length,
    abnormal: flat.filter((f) => f.st === 'abnormal').length,
  }), [flat]);
  const flagged = React.useMemo(() => flat.filter((f) => f.st !== 'normal'), [flat]);
  const query = q.trim().toLowerCase();
  const results = React.useMemo(
    () => (query ? flat.filter((f) => s(f.m?.name).toLowerCase().includes(query) || f.cat.toLowerCase().includes(query)) : []),
    [flat, query]
  );

  React.useEffect(() => {
    // Fresh report → clear search; open the first category with a flagged marker.
    if (!report) return;
    setQ('');
    const flaggedIdx = categories.findIndex((c: any) => (c.markers ?? []).some((m: any) => getMarkerStatus(m) !== 'normal'));
    setOpen({ [flaggedIdx >= 0 ? flaggedIdx : 0]: true });
  }, [report]);

  const dateStr = report ? (report.test_date || report.upload_date || '') : '';
  const aiRisks = arr(ai?.risk_factors?.identified_risks);
  const aiActions = arr(ai?.action_plan?.immediate);

  return (
    <SheetShell
      visible={!!report}
      onClose={onClose}
      accent={accent}
      icon={icon}
      title={report?.report_name || report?.report_type || 'Health Report'}
      subtitle={[s(report?.report_type), s(dateStr)].filter(Boolean).join('  ·  ').toUpperCase()}
    >
      {/* Scores */}
      {report && (report.metabolic_score != null || report.longevity_score != null) ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {report.metabolic_score != null ? <ScorePill label="Metabolic" value={report.metabolic_score} color={C.green} /> : null}
          {report.longevity_score != null ? <ScorePill label="Longevity" value={report.longevity_score} color={C.orange} /> : null}
        </View>
      ) : null}

      {/* Triage: what needs attention, at a glance */}
      {flat.length > 0 ? <TriageCard counts={counts} /> : null}

      {/* Search across all markers */}
      {flat.length >= 8 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.045)', borderWidth: 1, borderColor: query ? hexA(accent, 0.35) : 'rgba(255,255,255,0.08)' }}>
          <Icon name="search" size={15} color={query ? accent : C.muted3} strokeWidth={2} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={`Search ${flat.length} markers…`}
            placeholderTextColor={C.muted3}
            style={{ flex: 1, paddingVertical: 11, fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}
          />
          {query ? (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {query ? (
        /* ===== Search results (flat, with panel labels) ===== */
        <View style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 4 }}>
          {results.length === 0 ? (
            <Body style={{ color: C.muted3, fontSize: 12.5, textAlign: 'center', paddingVertical: 22 }}>No markers match “{q.trim()}”.</Body>
          ) : (
            results.map((f, i) => <MarkerRow key={i} m={f.m} cat={f.cat} first={i === 0} />)
          )}
        </View>
      ) : (
        <>
          {/* ===== Needs Attention — every flagged marker, front and center ===== */}
          {flagged.length > 0 ? (
            <View style={{ borderRadius: 16, backgroundColor: hexA(C.red, 0.05), borderWidth: 1, borderColor: hexA(C.red, 0.24), overflow: 'hidden' }}>
              <View style={{ height: 3, backgroundColor: hexA(C.red, 0.5) }} />
              <View style={{ paddingHorizontal: 14, paddingTop: 13, paddingBottom: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="alert" size={15} color={C.red} strokeWidth={2.1} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: C.red }}>NEEDS ATTENTION</Text>
                  <View style={{ flex: 1 }} />
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{flagged.length} MARKER{flagged.length === 1 ? '' : 'S'}</Mono>
                </View>
                {flagged.map((f, i) => <MarkerRow key={i} m={f.m} cat={f.cat} first={i === 0} />)}
              </View>
            </View>
          ) : null}

          {/* AI summary (optional) */}
          {ai && (has(ai?.detailed_overview?.summary) || has(ai?.detailed_overview?.key_findings)) ? (
            <SectionCard accent={C.purple} icon="sparkle" title="AI Insights">
              <Note text={ai?.detailed_overview?.summary} />
              <BulletList items={ai?.detailed_overview?.key_findings} color={C.purple} />
            </SectionCard>
          ) : null}

          {/* AI risks + immediate actions (optional, collapsed) */}
          {(aiRisks.length || aiActions.length) ? (
            <CollapsibleSection accent={C.orange} icon="target" title="Risks & Next Steps" preview={aiRisks[0] || aiActions[0]}>
              <BulletList label="Identified risks" items={aiRisks} color={C.red} />
              <BulletList label="Do first" items={aiActions} color={C.gold} />
            </CollapsibleSection>
          ) : null}

          {/* Marker categories */}
          {categories.length === 0 ? (
            <View style={{ alignItems: 'center', gap: 10, paddingVertical: 30 }}>
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: hexA(accent, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon as any} size={19} color={accent} strokeWidth={1.8} />
              </View>
              <Body style={{ color: C.muted3, fontSize: 12.5, textAlign: 'center' }}>No structured values were extracted from this report.</Body>
              {has(report?.notes) ? <Body style={{ color: C.ink3, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{s(report?.notes)}</Body> : null}
            </View>
          ) : (
            <>
              {categories.length > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: C.muted2 }}>ALL PANELS</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                  <Mono style={{ fontSize: 9, color: C.muted3 }}>{categories.length}</Mono>
                </View>
              ) : null}
              {categories.map((cat: any, ci: number) => {
                const markers: any[] = Array.isArray(cat?.markers) ? cat.markers : [];
                const catFlagged = markers.filter((m) => getMarkerStatus(m) !== 'normal').length;
                const isOpen = !!open[ci];
                return (
                  <View key={ci} style={{ borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: catFlagged ? hexA(C.red, 0.16) : 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <Pressable onPress={() => setOpen((o) => ({ ...o, [ci]: !o[ci] }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{s(cat?.test_name || cat?.category) || `Test Group ${ci + 1}`}</Body>
                        <Mono style={{ fontSize: 9.5, color: catFlagged ? C.red : C.green, marginTop: 2 }}>
                          {catFlagged ? `${catFlagged} of ${markers.length} flagged` : `All ${markers.length} in range`}
                        </Mono>
                      </View>
                      {catFlagged > 0 ? <Badge text={`${catFlagged} flagged`} color={C.red} /> : null}
                      <Icon name={isOpen ? 'chevUp' : 'chevDown'} size={16} color={C.muted} strokeWidth={2.2} />
                    </Pressable>
                    {isOpen ? (
                      <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
                        {markers.map((m, mi) => <MarkerRow key={mi} m={m} first={mi === 0} />)}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </>
          )}

          {/* Measurements */}
          {measurements ? (
            <SectionCard accent={accent} icon="ruler" title="Measurements">
              <FieldGrid rows={Object.entries(measurements).map(([k, v]) => [k.replace(/_/g, ' '), v as any])} />
            </SectionCard>
          ) : null}

          {/* Notes */}
          {has(report?.notes) && categories.length > 0 ? (
            <SectionCard accent={accent} icon="file" title="Notes"><Note text={report?.notes} /></SectionCard>
          ) : null}
        </>
      )}
    </SheetShell>
  );
}

function ScorePill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ flex: 1, borderRadius: 16, backgroundColor: hexA(color, 0.08), borderWidth: 1, borderColor: hexA(color, 0.25), padding: 14, alignItems: 'center', gap: 3 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 30, color }}>{value}<Text style={{ fontSize: 13, color: hexA(color, 0.6) }}>/100</Text></Text>
      <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted2, textTransform: 'uppercase' }}>{label}</Mono>
    </View>
  );
}

/* ============================== QHP ============================== */
export function QhpReportSheet({ report, label, onClose }: {
  report: any | null; label?: string; onClose: () => void;
}) {
  const accent = C.gold;
  const j = report?.qhp_json ?? {};
  const meta = j.report_metadata ?? {};
  const overview = j.client_overview ?? {};
  const exec = j.executive_summary ?? {};
  const insights = j.key_insights ?? {};
  const body = j.body_measurements ?? {};
  const cardio = j.cardiovascular_markers ?? {};
  const move = j.movement_mobility_assessment ?? {};
  const strength = j.strength_endurance_tests ?? {};
  const balance = j.balance_functional_tests ?? {};
  const postural = j.postural_assessment ?? {};
  const medical = j.personal_medical_context ?? {};
  const roadmap = j.transformation_roadmap ?? {};
  const conclusion = j.final_conclusion ?? {};
  const wbt = j.what_body_is_telling_you ?? {};
  const modalities: any[] = Array.isArray(j.recommended_modalities) ? j.recommended_modalities : [];
  const outcomes: any[] = Array.isArray(j.priority_outcomes) ? j.priority_outcomes : [];
  const refs = arr(j.references);
  const [photo, setPhoto] = React.useState<string | null>(null);

  // Merged "at a glance" lists (executive summary + key insights + conclusion).
  const strengths = dedup(exec.key_strengths, insights.strengths);
  const watchouts = dedup(exec.primary_risks, insights.longevity_risks);
  const focus = dedup(conclusion.primary_focus_areas, exec.key_limiters, insights.aesthetic_limiters);
  const summaryText = firstText(exec.summary_text, exec.overall_interpretation);
  const summaryText2 = has(exec.overall_interpretation) && s(exec.overall_interpretation) !== summaryText ? s(exec.overall_interpretation) : '';

  const score = s(meta.overall_score || j.overall_score);
  const goal = s(meta.primary_goal || j.primary_goal);
  const aDate = s(meta.assessment_date || meta.refresh_date || j.assessment_date || report?.created_at);
  // overall_score is either one value ("48") or a journey ("72 → 85 → 98"):
  // baseline → refresh(es) → current. Parse the steps; the LAST one is current.
  const scoreSteps = score
    .split(/\s*(?:→|->|>)\s*/)
    .map((t) => parseFloat(t))
    .filter((n) => !isNaN(n));
  const scoreNow = scoreSteps.length ? scoreSteps[scoreSteps.length - 1] : NaN;
  const scoreDelta = scoreSteps.length > 1 ? +(scoreNow - scoreSteps[0]).toFixed(1) : null;
  const scoreColor = (() => {
    if (isNaN(scoreNow)) return accent;
    if (scoreNow >= 90) return C.green;
    if (scoreNow >= 75) return accent;
    if (scoreNow >= 60) return C.orange;
    return C.red;
  })();

  const empty = !report?.qhp_json || Object.keys(report.qhp_json || {}).length === 0;

  return (
    <SheetShell
      visible={!!report}
      onClose={onClose}
      accent={accent}
      icon="heart"
      title={label || s(meta.report_type) || 'QHP Report'}
      subtitle={[report?.approved ? 'APPROVED' : 'DRAFT', s(aDate)].filter(Boolean).join('  ·  ').toUpperCase()}
    >
      {empty ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 34 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(accent, 0.1), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="heart" size={20} color={accent} strokeWidth={1.8} />
          </View>
          <Body style={{ color: C.muted3, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>This QHP assessment doesn't have a generated report yet.</Body>
        </View>
      ) : (
        <>
          {/* Score + goal hero — one card; handles single scores and journeys ("72 → 85 → 98") */}
          {(score || goal) ? (
            <View style={{ borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: hexA(scoreColor, 0.24), overflow: 'hidden' }}>
              <View style={{ height: 3, backgroundColor: hexA(scoreColor, 0.5) }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 }}>
                {score ? (
                  <>
                    <View style={{ alignItems: 'center', minWidth: 88, gap: 2 }}>
                      {!isNaN(scoreNow) ? (
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 40, color: scoreColor, lineHeight: 44 }}>
                          {scoreNow}<Text style={{ fontSize: 14, color: hexA(scoreColor, 0.55) }}>/100</Text>
                        </Text>
                      ) : (
                        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: F.bodyBold, fontSize: 24, color: scoreColor, maxWidth: 110 }}>{score}</Text>
                      )}
                      <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted2 }}>QHP SCORE</Mono>
                      {scoreDelta != null && scoreDelta !== 0 ? (
                        <View style={{ marginTop: 3, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(scoreDelta > 0 ? C.green : C.red, 0.12), borderWidth: 1, borderColor: hexA(scoreDelta > 0 ? C.green : C.red, 0.3) }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: scoreDelta > 0 ? C.green : C.red }}>{scoreDelta > 0 ? '+' : '−'}{Math.abs(scoreDelta)} vs baseline</Text>
                        </View>
                      ) : null}
                    </View>
                    {goal || has(conclusion.longevity_status) ? <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.07)' }} /> : null}
                  </>
                ) : null}
                {(goal || has(conclusion.longevity_status)) ? (
                  <View style={{ flex: 1, gap: 5 }}>
                    {goal ? (
                      <>
                        <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, textTransform: 'uppercase' }}>Primary Goal</Mono>
                        <Body style={{ fontSize: 15.5, color: '#fff', fontFamily: F.bodySemi, lineHeight: 21 }}>{goal}</Body>
                      </>
                    ) : null}
                    {has(conclusion.longevity_status) ? (
                      <View style={{ alignSelf: 'flex-start', marginTop: goal ? 4 : 0, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(accent, 0.13), borderWidth: 1, borderColor: hexA(accent, 0.3) }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: accent }}>{s(conclusion.longevity_status)}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
              {/* Journey strip: baseline → refreshes → now */}
              {scoreSteps.length > 1 ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 15, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3 }}>SCORE JOURNEY</Mono>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
                    {scoreSteps.map((n, i) => {
                      const last = i === scoreSteps.length - 1;
                      const lbl = i === 0 ? 'BASE' : last ? 'NOW' : `R${i}`;
                      return (
                        <React.Fragment key={i}>
                          {i > 0 ? <Icon name="arrowRight" size={12} color={C.muted3} strokeWidth={2} /> : null}
                          <View style={{ alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: last ? hexA(scoreColor, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: last ? hexA(scoreColor, 0.4) : 'rgba(255,255,255,0.08)' }}>
                            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: last ? scoreColor : C.ink3 }}>{n}</Text>
                            <Mono style={{ fontSize: 7.5, letterSpacing: 0.6, color: last ? scoreColor : C.muted3, marginTop: 1 }}>{lbl}</Mono>
                          </View>
                        </React.Fragment>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ===== SUMMARY (always open — the plain-English read) ===== */}
          {(summaryText || strengths.length || watchouts.length || focus.length) ? (
            <SectionCard accent={accent} icon="clipboard" title="Summary">
              {summaryText ? <Body style={{ fontSize: 13.5, color: C.ink3, lineHeight: 20 }}>{summaryText}</Body> : null}
              {summaryText2 ? <Body style={{ fontSize: 13, color: C.muted2, lineHeight: 19 }}>{summaryText2}</Body> : null}
              {strengths.length ? <ChipRow label="✓ Strengths" items={strengths} color={C.green} /> : null}
              {watchouts.length ? <ChipRow label="⚠ Watch-outs" items={watchouts} color={C.red} /> : null}
              {focus.length ? <ChipRow label="◎ Focus areas" items={focus} color={C.gold} /> : null}
            </SectionCard>
          ) : null}

          {/* ===== What the body is telling you (trainer-facing) ===== */}
          {(has(wbt.key_messages) || has(wbt.movement_faults) || has(wbt.risk_if_ignored)) ? (
            <SectionCard accent={C.purple} icon="sparkle" title="What This Means">
              <BulletList label="Key messages" items={wbt.key_messages} color={C.purple} />
              <BulletList label="Movement faults" items={wbt.movement_faults} color={C.gold} />
              <BulletList label="Risk if ignored" items={wbt.risk_if_ignored} color={C.red} />
            </SectionCard>
          ) : null}

          {/* ===== The plan: what to do ===== */}
          {(modalities.length || has(conclusion.expected_benefits) || has(roadmap.weeks_1_4)) ? (
            <SectionCard accent={C.green} icon="target" title="The Plan">
              {modalities.length ? (
                <View style={{ gap: 8 }}>
                  {modalities.map((m, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                      <View style={{ flex: 1 }}>
                        <Body style={{ fontSize: 13.5, color: '#fff', fontFamily: F.bodySemi }}>{s(m?.modality)}</Body>
                        {has(m?.purpose) ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{s(m.purpose)}</Body> : null}
                      </View>
                      {has(m?.frequency) ? <Badge text={s(m.frequency)} color={C.green} /> : null}
                    </View>
                  ))}
                </View>
              ) : null}
              {has(roadmap.weeks_1_4) ? (
                <View style={{ gap: 4 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.green, textTransform: 'uppercase' }}>First 4 weeks</Mono>
                  <Body style={{ fontSize: 13, color: C.ink3, lineHeight: 19 }}>{s(roadmap.weeks_1_4)}</Body>
                </View>
              ) : null}
              <BulletList label="Expected benefits" items={conclusion.expected_benefits} color={C.green} />
            </SectionCard>
          ) : null}

          {/* ===== Assessment findings — summarised (interpretation leads, metrics on tap) ===== */}
          {Object.keys(body).length ? (
            <CollapsibleSection accent={accent} icon="ruler" title="Body Composition" preview={firstText(body.interpretation)}>
              <Note text={body.interpretation} />
              <MetricChips items={[
                ['Waist (narrow)', body.waist_narrow], ['Waist (wide)', body.waist_wide], ['Chest', body.chest],
                ['Hips', body.hips], ['Thighs', body.thighs], ['Arms', body.arms], ['Waist:Hip', body.waist_hip_ratio],
              ]} />
            </CollapsibleSection>
          ) : null}

          {Object.keys(cardio).length ? (
            <CollapsibleSection accent={C.red} icon="activity" title="Cardiovascular" preview={firstText(cardio.aerobic_fitness_interpretation)}>
              <Note text={cardio.aerobic_fitness_interpretation} />
              <MetricChips items={[
                ['VO₂ Max', cardio.vo2_max], ['Mean HR', cardio.mean_heart_rate], ['SDNN', cardio.sdnn],
                ['RMSSD', cardio.rmssd], ['Mean IBI', cardio.mean_ibi], ['Coherence', cardio.normalized_coherence],
              ]} />
            </CollapsibleSection>
          ) : null}

          {Object.keys(move).length ? (
            <CollapsibleSection accent={C.purple} icon="route" title="Movement & Mobility" preview={firstText(move.movement_interpretation)}>
              <Note text={move.movement_interpretation} />
              <MetricChips items={[
                ['ASLR L', move.aslr_left], ['ASLR R', move.aslr_right], ['Sit & Reach', move.sit_and_reach],
                ['OH Squat', move.overhead_squat], ['Apley L', move.apley_left], ['Apley R', move.apley_right],
              ]} />
            </CollapsibleSection>
          ) : null}

          {Object.keys(strength).length ? (
            <CollapsibleSection accent={C.orange} icon="dumbbell" title="Strength & Endurance" preview={firstText(strength.interpretation)}>
              <Note text={strength.interpretation} />
              <MetricChips items={[['Wall Sit', strength.wall_sit_time], ['Grip', strength.grip_strength]]} />
            </CollapsibleSection>
          ) : null}

          {Object.keys(balance).length ? (
            <CollapsibleSection accent={C.blue} icon="target" title="Balance & Functional" preview={firstText(balance.functional_interpretation)}>
              <Note text={balance.functional_interpretation} />
              <MetricChips items={[
                ['SL Balance L', balance.single_leg_balance_left], ['SL Balance R', balance.single_leg_balance_right],
                ['Sit-to-Rise', balance.sitting_rising_test],
              ]} />
            </CollapsibleSection>
          ) : null}

          {/* Postural — photos shown large & fully; tap to view full-screen */}
          {(postural.front_view || postural.side_view || postural.back_view || has(postural.overall_posture_summary)) ? (
            <CollapsibleSection accent={accent} icon="user" title="Postural Assessment" preview={firstText(postural.overall_posture_summary)}>
              <Note text={postural.overall_posture_summary} />
              {(['front_view', 'side_view', 'back_view'] as const).map((k) => {
                const v = postural[k];
                if (!v || (!has(v.observations) && !has(v.interpretation) && !s(v.photo_reference || v.photo_url))) return null;
                const src = s(v.photo_reference || v.photo_url);
                const isUrl = /^https?:\/\//.test(src);
                return (
                  <View key={k} style={{ gap: 8 }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: accent, textTransform: 'uppercase' }}>{k.replace('_view', '')} view</Mono>
                    {isUrl ? (
                      <Pressable onPress={() => setPhoto(src)} style={{ borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#000' }}>
                        <Image source={{ uri: src }} style={{ width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000' }} resizeMode="contain" />
                        <View style={{ position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.55)' }}>
                          <Icon name="eye" size={12} color="#fff" strokeWidth={2} />
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: '#fff' }}>TAP TO ENLARGE</Text>
                        </View>
                      </Pressable>
                    ) : null}
                    <BulletList items={v.observations} color={accent} />
                    <Note text={v.interpretation} />
                  </View>
                );
              })}
            </CollapsibleSection>
          ) : null}

          {/* Priority outcomes */}
          {outcomes.length ? (
            <CollapsibleSection accent={C.green} icon="target" title="Priority Outcomes" preview={`${outcomes.length} tracked targets — baseline → final`}>
              <View style={{ borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.04)', paddingVertical: 8, paddingHorizontal: 10 }}>
                  {['Metric', 'Base', 'Mid', 'Final'].map((h, i) => (
                    <Mono key={i} style={{ flex: i === 0 ? 2 : 1, fontSize: 8.5, letterSpacing: 0.5, color: C.muted3, textTransform: 'uppercase' }}>{h}</Mono>
                  ))}
                </View>
                {outcomes.map((o, i) => (
                  <View key={i} style={{ flexDirection: 'row', paddingVertical: 9, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                    <Body style={{ flex: 2, fontSize: 12, color: '#fff' }}>{s(o?.metric)}</Body>
                    <Body style={{ flex: 1, fontSize: 12, color: C.muted2 }}>{s(o?.baseline) || '—'}</Body>
                    <Body style={{ flex: 1, fontSize: 12, color: C.gold }}>{s(o?.midpoint_target) || '—'}</Body>
                    <Body style={{ flex: 1, fontSize: 12, color: C.green }}>{s(o?.final_target) || '—'}</Body>
                  </View>
                ))}
              </View>
            </CollapsibleSection>
          ) : null}

          {/* Transformation roadmap (full 12 weeks) */}
          {(has(roadmap.weeks_5_8) || has(roadmap.weeks_9_12)) ? (
            <CollapsibleSection accent={C.orange} icon="calendar" title="12-Week Roadmap" preview="Full week-by-week progression">
              {([['Weeks 1–4', roadmap.weeks_1_4], ['Weeks 5–8', roadmap.weeks_5_8], ['Weeks 9–12', roadmap.weeks_9_12]] as [string, any][]).map(([lbl, val], i) =>
                has(val) ? (
                  <View key={i} style={{ gap: 4 }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.6, color: C.orange, textTransform: 'uppercase' }}>{lbl}</Mono>
                    <Body style={{ fontSize: 13, color: C.ink3, lineHeight: 19 }}>{s(val)}</Body>
                  </View>
                ) : null
              )}
            </CollapsibleSection>
          ) : null}

          {/* Medical context */}
          {Object.keys(medical).length ? (
            <CollapsibleSection accent={C.red} icon="clipboard" title="Medical Context" preview={dedup(medical.medical_conditions, medical.medications).slice(0, 3).join(', ') || 'Conditions, meds, lifestyle'}>
              <BulletList label="Medical Conditions" items={medical.medical_conditions} color={C.red} />
              <BulletList label="Medications" items={medical.medications} color={C.orange} />
              <BulletList label="Surgical History" items={medical.surgical_history} color={C.muted2} />
              <BulletList label="Pain Areas" items={medical.pain_areas} color={C.gold} />
              <ChipRow label="Supplements" items={medical.supplements} color={C.green} />
              <MetricChips items={[
                ['Sleep', medical.sleep_duration], ['Steps', medical.daily_steps], ['Smoking', medical.smoking_status],
                ['Alcohol', medical.alcohol_intake], ['Diet', medical.diet_type], ['Digestion', medical.digestion_issues],
              ]} />
            </CollapsibleSection>
          ) : null}

          {/* Client overview */}
          {Object.keys(overview).length ? (
            <CollapsibleSection accent={C.blue} icon="user" title="Client Details" preview={[s(overview.age) && `${s(overview.age)} yrs`, s(overview.gender), s(overview.profession)].filter(Boolean).join(' · ')}>
              <FieldGrid rows={[
                ['Name', overview.client_name], ['Gender', overview.gender], ['Age', overview.age],
                ['DOB', overview.date_of_birth], ['Height', overview.height], ['Weight', overview.weight],
                ['Profession', overview.profession], ['Location', overview.location],
                ['Assessor', overview.assessor], ['Analyst', overview.analyst],
              ]} />
            </CollapsibleSection>
          ) : null}

          {/* References */}
          {refs.length ? (
            <CollapsibleSection accent={C.muted2} icon="file" title="References" preview={`${refs.length} citation${refs.length === 1 ? '' : 's'}`}>
              {refs.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                  <Mono style={{ fontSize: 10, color: C.muted3 }}>{i + 1}.</Mono>
                  <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2, lineHeight: 17 }}>{r}</Body>
                </View>
              ))}
            </CollapsibleSection>
          ) : null}
        </>
      )}
      <PhotoViewer uri={photo} onClose={() => setPhoto(null)} />
    </SheetShell>
  );
}
