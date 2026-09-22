import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Alert, ActivityIndicator, TextInput, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { F } from '../theme';
import { Icon, IconName } from '../icons';
import { useStore } from '../store';
import { useAuth } from '../auth';
import {
  ConsultationSlot, DiagnosisRow, RxData, RxApproval, RxEditEntry, MeetingSummary, ConsultAINotes,
  isSlotElapsed, slotPersonName, timeLabel, rxState, hasMeetingNotes, hasAiNotes, istStamp, dateFromYmd, MONTHS_SHORT, pad2,
  useUpdateSlotStatus, useProvisionRoom, describeConsultError, joinTargetRef, fmtLongDate,
} from '../lib/consultantQueries';
import { medicineFields } from '../lib/prescriptionSheet';

/* ============ Consultant workspace: the web's light indigo-on-lavender look ============
   The rest of the app is obsidian and ember; the consultant pages copy the
   web's ConsultantDashboard / ConsultantCalls surface instead (user request,
   22 Sep 2026): #f6f7fc to #eceef8 canvas, #5b6cf5 to #8a97ff indigo, white
   cards with a 24 radius, status colours indigo / amber / emerald / slate and
   a bottom pill with Dashboard, All calls and Sign out. Everything here is
   shared by the dashboard, All Calls and the month calendar. */

export const CX = {
  bgA: '#f6f7fc', bgB: '#f2f3fa', bgC: '#eceef8',
  indigo: '#5b6cf5', indigoMid: '#6e7cf8', indigoB: '#8a97ff', indigo50: '#eef2ff', indigo100: '#e0e7ff', indigo200: '#c7d2fe', indigo700: '#4338ca',
  slate900: '#0f172a', slate800: '#1e293b', slate700: '#334155', slate600: '#475569', slate500: '#64748b', slate400: '#94a3b8', slate300: '#cbd5e1', slate200: '#e2e8f0', slate100: '#f1f5f9', slate50: '#f8fafc',
  emerald: '#10b981', emerald50: '#ecfdf5', emerald100: '#d1fae5', emerald600: '#059669', emerald700: '#047857',
  amber: '#f59e0b', amber50: '#fffbeb', amber100: '#fef3c7', amber600: '#d97706', amber700: '#b45309',
  rose: '#f43f5e', rose50: '#fff1f2', rose200: '#fecdd3', rose600: '#e11d48',
  pink400: '#f472b6', pink500: '#ec4899',
  sky600: '#0284c7', sky50: '#f0f9ff', sky100: '#e0f2fe',
  violet400: '#a78bfa', violet50: '#f5f3ff', violet100: '#ede9fe',
  white: '#ffffff', sheet: '#f6f7fe',
} as const;
export const INDIGO_GRAD: [string, string] = [CX.indigo, CX.indigoB];

/** A Date that ticks every `ms` (the live clock and the elapsed tests). */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export const initialsOf = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

const shadow = { shadowColor: '#4f5bd5', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 2 } as const;

/* ---------- shell: gradient canvas, scroll body, bottom pill ---------- */
export function ConsultantShell({ active, children }: { active: 'dashboard' | 'calls'; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try { await qc.refetchQueries({ type: 'active' }); } catch { /* offline */ }
    setTimeout(() => setRefreshing(false), 400);
  }, [qc]);
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={[CX.bgA, CX.bgB, CX.bgC]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -130, right: -90, width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(129,140,248,0.16)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -120, left: '28%', width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(167,139,250,0.13)' }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 124, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CX.indigo} colors={[CX.indigo]} progressBackgroundColor="#fff" />}
      >
        {children}
      </ScrollView>
      <PillNav active={active} />
    </View>
  );
}

function PillNav({ active }: { active: 'dashboard' | 'calls' }) {
  const insets = useSafeAreaInsets();
  const { go, resetSession } = useStore();
  const { signOut } = useAuth();
  const items: { key: string; label: string; icon: IconName; onPress: () => void }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'home', onPress: () => go('doctor-dashboard', true) },
    { key: 'calls', label: 'All calls', icon: 'calendar', onPress: () => go('doctor-consultant-calls') },
    { key: 'signout', label: 'Sign out', icon: 'logout', onPress: () => Alert.alert('Sign out?', 'You will need to sign in again to see your consultations.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { resetSession(); signOut(); go('signin', true); } },
    ]) },
  ];
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 14, alignItems: 'center' }}>
      <LinearGradient colors={[CX.indigo, '#7d8bfd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ width: '100%', maxWidth: 420, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 7, paddingHorizontal: 8, shadowColor: '#5b6cf5', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 10 }}>
        {items.map((it) => (
          <Pressable key={it.key} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.label} accessibilityState={{ selected: active === it.key }} hitSlop={6}
            style={({ pressed }) => ({ alignItems: 'center', paddingVertical: 5, paddingHorizontal: 16, borderRadius: 999, minWidth: 88, backgroundColor: active === it.key ? 'rgba(255,255,255,0.22)' : pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
            <Icon name={it.icon} size={18} color="#fff" strokeWidth={2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: '#fff', marginTop: 2 }}>{it.label}</Text>
          </Pressable>
        ))}
      </LinearGradient>
    </View>
  );
}

/* ---------- atoms ---------- */
export function LCard({ children, style, pad = 16 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  return <View style={[{ backgroundColor: CX.white, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(99,102,241,0.08)', padding: pad, ...shadow }, style]}>{children}</View>;
}
export function CardHead({ title, chip, right }: { title: string; chip?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: CX.slate100, marginBottom: 14 }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: CX.slate800 }}>{title}</Text>
      {right ?? (chip ? <View style={{ backgroundColor: CX.indigo50, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: CX.indigo }}>{chip}</Text></View> : null)}
    </View>
  );
}
export type BtnTone = 'indigo' | 'emerald' | 'slate' | 'rose' | 'solid' | 'outline' | 'ghost';
const TONES: Record<BtnTone, { bg: string; fg: string; border: string }> = {
  indigo: { bg: CX.indigo50, fg: CX.indigo, border: 'transparent' },
  emerald: { bg: CX.emerald50, fg: CX.emerald600, border: 'transparent' },
  slate: { bg: CX.slate100, fg: CX.slate600, border: 'transparent' },
  rose: { bg: CX.rose50, fg: CX.rose600, border: 'transparent' },
  solid: { bg: CX.indigo, fg: '#fff', border: 'transparent' },
  outline: { bg: 'rgba(238,242,255,0.6)', fg: CX.indigo, border: CX.indigo200 },
  ghost: { bg: 'transparent', fg: CX.slate600, border: CX.slate200 },
};
export function LightBtn({ label, icon, tone = 'indigo', onPress, disabled, busy, small, style }: { label: string; icon?: IconName; tone?: BtnTone; onPress?: () => void; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = TONES[tone];
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: small ? 30 : 38, paddingHorizontal: small ? 12 : 16, borderRadius: 999, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, opacity: disabled || busy ? 0.55 : pressed ? 0.8 : 1 }, style]}>
      {busy ? <ActivityIndicator size="small" color={t.fg} /> : icon ? <Icon name={icon} size={small ? 12 : 14} color={t.fg} strokeWidth={2.3} /> : null}
      <Text style={{ fontFamily: F.bodySemi, fontSize: small ? 11.5 : 13, color: t.fg }}>{label}</Text>
    </Pressable>
  );
}
export type PillTone = 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose';
const PILLS: Record<PillTone, { bg: string; fg: string }> = {
  indigo: { bg: CX.indigo50, fg: CX.indigo }, emerald: { bg: CX.emerald50, fg: CX.emerald700 }, amber: { bg: CX.amber50, fg: CX.amber700 }, slate: { bg: CX.slate100, fg: CX.slate500 }, rose: { bg: CX.rose50, fg: CX.rose600 },
};
export function StatusPill({ label, tone, icon }: { label: string; tone: PillTone; icon?: IconName }) {
  const p = PILLS[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: p.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 }}>
      {icon ? <Icon name={icon} size={10} color={p.fg} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: p.fg }}>{label}</Text>
    </View>
  );
}
export const slotTone = (s: Pick<ConsultationSlot, 'status' | 'consultation_date' | 'end_time'>, now?: number): { tone: PillTone; label: string; bar: string } =>
  s.status === 'completed' ? { tone: 'emerald', label: 'Completed', bar: '#6ee7b7' }
  : s.status === 'cancelled' ? { tone: 'slate', label: 'Cancelled', bar: CX.slate300 }
  : isSlotElapsed(s, now) ? { tone: 'amber', label: 'Elapsed', bar: '#fcd34d' }
  : { tone: 'indigo', label: 'Scheduled', bar: '#a5b4fc' };

export function SegChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} hitSlop={4}
      style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? CX.indigo : pressed ? CX.slate100 : 'transparent', ...(active ? { shadowColor: CX.indigo, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 } : null) })}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: active ? '#fff' : CX.slate500 }}>{label}</Text>
    </Pressable>
  );
}
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flex: 1, height: 44, borderRadius: 999, backgroundColor: CX.white, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 8, gap: 8, ...shadow }}>
      <Icon name="search" size={15} color={CX.slate400} strokeWidth={2.2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={CX.slate400} returnKeyType="search" accessibilityLabel={placeholder}
        style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: CX.slate700, paddingVertical: 0 }} />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search" style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: CX.slate100 }}>
          <Icon name="close" size={12} color={CX.slate500} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}
export function LightInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={CX.slate400} {...props} style={[{ backgroundColor: CX.white, borderWidth: 1, borderColor: CX.slate200, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.body, fontSize: 13.5, color: CX.slate800 }, props.style]} />;
}
export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 0.9, color: CX.slate400, textTransform: 'uppercase' }}>{children}</Text>;
}

/* ---------- record views (port of ConsultationRecordViews.tsx) ---------- */
export function EmptyPanel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: CX.slate200, backgroundColor: 'rgba(255,255,255,0.7)' }}>
      <Icon name={icon} size={24} color={CX.slate300} strokeWidth={1.8} />
      <Text style={{ marginTop: 8, fontFamily: F.bodyReg, fontSize: 13, lineHeight: 19, color: CX.slate500, textAlign: 'center', maxWidth: 320 }}>{text}</Text>
    </View>
  );
}

const UNITS = '%|mg\\/dL|g\\/dL|mmol\\/L|ng\\/mL|mIU\\/L|IU\\/L|U\\/L|bpm|kg|cm|ms|hrs?|min';
const FIGURE = new RegExp(`\\d+(?:[.,]\\d+)?(?:\\s?(?:${UNITS}))?`, 'g');
/** A measurement worth tinting: carries a unit, is a decimal, or has two or more digits; never a year. */
const isFigure = (s: string): boolean => {
  const v = s.trim();
  if (/^(19|20)\d{2}$/.test(v)) return false;
  return /[a-zA-Z%/]/.test(v) || /[.,]/.test(v) || /^\d{2,}$/.test(v);
};
/** Split on figures, skipping ones glued to a letter ("HbA1c", "T3"); no lookbehind so Hermes is safe. */
const splitFigures = (text: string): { t: string; fig: boolean }[] => {
  const out: { t: string; fig: boolean }[] = [];
  let last = 0; let m: RegExpExecArray | null;
  FIGURE.lastIndex = 0;
  while ((m = FIGURE.exec(text))) {
    const start = m.index;
    if (start > 0 && /[A-Za-z]/.test(text[start - 1])) continue;
    if (start > last) out.push({ t: text.slice(last, start), fig: false });
    out.push({ t: m[0], fig: isFigure(m[0]) });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), fig: false });
  return out;
};
/** One line of clinical prose: bold "Label:" lead, tinted figures. */
export function NoteLine({ text, style }: { text: string; style?: any }) {
  const m = text.match(/^([^:]{2,32}):\s+(.*)$/);
  const lead = m?.[1];
  const rest = m ? m[2] : text;
  return (
    <Text style={[{ fontFamily: F.bodyReg, fontSize: 13, lineHeight: 20, color: CX.slate700, flex: 1 }, style]}>
      {lead ? <Text style={{ fontFamily: F.bodySemi, color: CX.slate900 }}>{lead}: </Text> : null}
      {splitFigures(rest).map((p, i) => <Text key={i} style={p.fig ? { fontFamily: F.bodySemi, color: CX.indigo700 } : undefined}>{p.t}</Text>)}
    </Text>
  );
}
export function Bullets({ items, dot = CX.indigo }: { items: string[]; dot?: string }) {
  return (
    <View style={{ gap: 7 }}>
      {items.map((t, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
          <NoteLine text={t} />
        </View>
      ))}
    </View>
  );
}
/** A titled block with a tinted rule down its left edge. */
export function Block({ title, icon, iconColor = CX.indigo, accent, tint, border, count, children }: { title: string; icon: IconName; iconColor?: string; accent: string; tint?: string; border?: string; count?: number; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderLeftWidth: 3, borderColor: border ?? CX.slate200, borderLeftColor: accent, backgroundColor: tint ?? 'rgba(248,250,252,0.7)', paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={13} color={iconColor} strokeWidth={2.2} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: CX.slate600, flex: 1 }}>{title}</Text>
        {count != null && count > 0 ? <View style={{ backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, borderWidth: 1, borderColor: CX.slate200 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: CX.slate500 }}>{count}</Text></View> : null}
      </View>
      {children}
    </View>
  );
}
export function CardShell({ icon, title, stamp, children }: { icon: IconName; title: string; stamp?: string | null; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: CX.white, borderRadius: 20, borderWidth: 1, borderColor: CX.indigo100, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: CX.indigo100, backgroundColor: 'rgba(238,242,255,0.5)' }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: CX.indigo100, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={13} color={CX.indigo} strokeWidth={2.2} /></View>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: CX.slate900, flex: 1 }}>{title}</Text>
        {stamp ? <Text style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate500 }}>{stamp}</Text> : null}
      </View>
      <View style={{ padding: 16, gap: 12 }}>{children}</View>
    </View>
  );
}
/** One suggested test: "Name — why" split into a heading and a rationale. */
export function TestRow({ text }: { text: string }) {
  const m = text.match(/^\s*(.{2,60}?)\s*[—–-]\s+(.+)$/);
  const name = m?.[1] ?? text;
  const why = m?.[2];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: CX.sky100, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}><Icon name="activity" size={11} color={CX.sky600} strokeWidth={2.2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: CX.slate900, lineHeight: 18 }}>{name}</Text>
        {why ? <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, color: CX.slate500, lineHeight: 18, marginTop: 1 }}>{why}</Text> : null}
      </View>
    </View>
  );
}

/** meeting_summary: key takeaways, notes sections, action items. */
export function MeetingNotesView({ summary }: { summary: MeetingSummary | null }) {
  if (!hasMeetingNotes(summary)) return <EmptyPanel icon="bubble" text="No meeting notes for this call. They are written from the consultation room once the call has a transcript." />;
  const takeaways = summary?.key_takeaways ?? [];
  const sections = summary?.sections ?? [];
  const actions = summary?.action_items ?? [];
  return (
    <CardShell icon="bubble" title="Meeting notes" stamp={istStamp(summary?.generated_at)}>
      {takeaways.length > 0 ? (
        <Block title="Key takeaways" icon="sparkle" accent="#818cf8" tint="rgba(238,242,255,0.5)" border={CX.indigo100} count={takeaways.length}>
          <View style={{ gap: 8 }}>
            {takeaways.map((t, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: CX.indigo }} />
                <Text style={{ flex: 1, fontFamily: F.bodyReg, fontSize: 13, lineHeight: 20, color: CX.slate700 }}>
                  <Text style={{ fontFamily: F.bodySemi, color: CX.slate900 }}>{t.title}</Text>
                  <Text style={{ color: CX.slate400 }}> · </Text>
                  {splitFigures(t.text).map((p, j) => <Text key={j} style={p.fig ? { fontFamily: F.bodySemi, color: CX.indigo700 } : undefined}>{p.t}</Text>)}
                </Text>
              </View>
            ))}
          </View>
        </Block>
      ) : null}
      {sections.map((sec, i) => (
        <Block key={i} title={sec.heading} icon="list" accent={CX.slate300}>
          {sec.overview ? <Text style={{ fontFamily: F.bodyReg, fontSize: 13, lineHeight: 20, color: CX.slate700 }}>{sec.overview}{sec.timestamp ? <Text style={{ color: CX.slate400 }}> ({sec.timestamp})</Text> : null}</Text> : null}
          {(sec.points?.length ?? 0) > 0 ? (
            <View style={{ gap: 7 }}>
              {sec.points!.map((p, j) => (
                <View key={j} style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                    <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: '#818cf8' }} />
                    <NoteLine text={p.text} />
                  </View>
                  {(p.subpoints?.length ?? 0) > 0 ? (
                    <View style={{ paddingLeft: 22, gap: 3 }}>
                      {p.subpoints!.map((sp, k) => <Text key={k} style={{ fontFamily: F.bodyReg, fontSize: 12.5, lineHeight: 18, color: CX.slate600 }}>– {sp}</Text>)}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </Block>
      ))}
      {actions.length > 0 ? (
        <Block title="Action items" icon="checks" iconColor={CX.emerald600} accent="#34d399" tint="rgba(236,253,245,0.5)" border={CX.emerald100}>
          <View style={{ gap: 10 }}>
            {actions.map((a, i) => (
              <View key={i} style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="users" size={12} color={CX.emerald600} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: CX.slate800 }}>{a.person}</Text>
                </View>
                {a.items.map((it, j) => (
                  <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingLeft: 4 }}>
                    <View style={{ marginTop: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: CX.emerald }} />
                    <Text style={{ flex: 1, fontFamily: F.bodyReg, fontSize: 13, lineHeight: 20, color: CX.slate700 }}>{it.text}{it.timestamp ? <Text style={{ color: CX.slate400 }}> ({it.timestamp})</Text> : null}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </Block>
      ) : null}
    </CardShell>
  );
}

/** ai_notes: the clinical read of the call. */
export function AiNotesView({ notes }: { notes: ConsultAINotes | null }) {
  if (!hasAiNotes(notes)) return <EmptyPanel icon="sparkle" text="No AI summary for this call. It is generated from the consultation room once the call has a transcript." />;
  return (
    <CardShell icon="sparkle" title="AI summary" stamp={istStamp(notes?.generated_at)}>
      {notes?.short_summary ? <Text style={{ fontFamily: F.body, fontSize: 13.5, lineHeight: 21, color: CX.slate800 }}>{notes.short_summary}</Text> : null}
      {(notes?.summary_points?.length ?? 0) > 0 ? <Block title="Summary" icon="list" accent="#818cf8" count={notes!.summary_points!.length}><Bullets items={notes!.summary_points!} /></Block> : null}
      {notes?.clinical_impression ? (
        <Block title="Clinical impression" icon="heart" accent={CX.violet400} tint="rgba(245,243,255,0.5)" border={CX.violet100}>
          <NoteLine text={notes.clinical_impression} />
        </Block>
      ) : null}
      {(notes?.red_flags?.length ?? 0) > 0 ? (
        <Block title="Red flags" icon="alert" iconColor={CX.rose600} accent={CX.rose} tint="rgba(255,241,242,0.7)" border={CX.rose200} count={notes!.red_flags!.length}>
          <Bullets items={notes!.red_flags!} dot={CX.rose} />
        </Block>
      ) : null}
      {(notes?.medications?.length ?? 0) > 0 ? (
        <Block title="Medications discussed" icon="clipboard" accent="#818cf8" count={notes!.medications!.length}>
          <View style={{ gap: 8 }}>
            {notes!.medications!.map((m, i) => (
              <View key={i} style={{ backgroundColor: CX.white, borderWidth: 1, borderColor: CX.slate200, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: CX.slate900 }}>{m.name}</Text>
                  {m.dosage_note ? <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: CX.indigo700, backgroundColor: CX.indigo50, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>{m.dosage_note}</Text> : null}
                </View>
                {m.reason ? <NoteLine text={m.reason} /> : null}
              </View>
            ))}
          </View>
        </Block>
      ) : null}
      {(notes?.recommendations?.length ?? 0) > 0 ? (
        <Block title="Recommendations" icon="checks" iconColor={CX.emerald600} accent="#34d399" tint="rgba(236,253,245,0.5)" border={CX.emerald100} count={notes!.recommendations!.length}>
          <Bullets items={notes!.recommendations!} dot={CX.emerald} />
        </Block>
      ) : null}
      {(notes?.tests_suggested?.length ?? 0) > 0 ? (
        <Block title="Tests suggested" icon="activity" iconColor={CX.sky600} accent="#38bdf8" tint="rgba(240,249,255,0.5)" border={CX.sky100} count={notes!.tests_suggested!.length}>
          <View style={{ gap: 9 }}>{notes!.tests_suggested!.map((t, i) => <TestRow key={i} text={t} />)}</View>
        </Block>
      ) : null}
    </CardShell>
  );
}

export function RxBadge({ rx }: { rx: RxData | null }) {
  const s = rxState(rx);
  if (s === 'none') return null;
  return s === 'finalized' ? <StatusPill label={`Rx v${rx?.version ?? 1}`} tone="indigo" icon="clipboard" /> : <StatusPill label="Rx draft" tone="slate" icon="clipboard" />;
}
/** The CRM's approval: locked, no edit; the client sees this version. */
export function ApprovedBadge({ approval }: { approval: RxApproval }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CX.emerald50, borderWidth: 1, borderColor: CX.emerald100, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
      <Icon name="shield" size={12} color={CX.emerald700} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: CX.emerald700 }}>
        Approved{approval.version != null ? ` v${approval.version}` : ''} and locked{approval.approved_by_name ? ` · ${approval.approved_by_name}` : ''}
      </Text>
    </View>
  );
}

const fmtDob = (dob: string) => { const d = dateFromYmd(dob); return isNaN(d.getTime()) ? dob : `${pad2(d.getDate())}-${MONTHS_SHORT[d.getMonth()]}-${d.getFullYear()}`; };

/** Read-only rendering of one call's prescription. */
export function PrescriptionView({ rx }: { rx: RxData | null }) {
  const s = rxState(rx);
  if (s === 'none') return <EmptyPanel icon="clipboard" text="No prescription was written in this call." />;
  const medicines = (rx?.medicines ?? []).filter((m) => (m?.name ?? '').trim() !== '');
  const earlier = Array.isArray(rx?.history) ? rx!.history!.length : 0;
  const meta = [rx?.patient?.age != null ? `${rx.patient.age} yrs` : null, rx?.patient?.dob ? `DOB ${fmtDob(rx.patient.dob)}` : null, rx?.doctor?.name ? `by ${rx.doctor.name}` : null].filter(Boolean).join(' · ');
  return (
    <CardShell icon="clipboard" title="Prescription" stamp={istStamp(rx?.finalized_at)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <LinearGradient colors={INDIGO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#fff' }}>{initialsOf(rx?.patient?.name ?? '?')}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: CX.slate900 }}>{rx?.patient?.name || 'Patient'}</Text>
          {meta ? <Text style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate500 }}>{meta}</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {s === 'finalized' ? <StatusPill label={`Finalized v${rx?.version ?? 1}`} tone="indigo" /> : <StatusPill label="Draft · not finalized" tone="amber" />}
          {earlier > 0 ? <StatusPill label={`${earlier} earlier version${earlier === 1 ? '' : 's'} kept`} tone="slate" /> : null}
        </View>
      </View>
      {medicines.length > 0 ? (
        <Block title="Medicines" icon="clipboard" accent="#818cf8" count={medicines.length}>
          <View style={{ gap: 10 }}>
            {medicines.map((m, i) => {
              const fields = medicineFields(m);
              return (
                <View key={m.line_id || i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: CX.indigo100, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: CX.indigo }}>{i + 1}</Text></View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: CX.slate900 }}>{m.name}{m.strength ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> {m.strength}</Text> : null}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {fields.map((f) => (
                        <View key={f.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CX.white, borderWidth: 1, borderColor: CX.slate200, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: CX.slate400 }}>{f.label.toUpperCase()}</Text>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: CX.slate800 }}>{f.value}{f.hint ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> · {f.hint.toLowerCase()}</Text> : null}</Text>
                        </View>
                      ))}
                    </View>
                    {m.instruction?.trim() ? <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, lineHeight: 18, color: CX.slate600 }}>{m.instruction.trim()}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Block>
      ) : null}
      {(rx?.lab_tests?.length ?? 0) > 0 ? (
        <Block title="Tests advised" icon="activity" iconColor={CX.sky600} accent="#38bdf8" tint="rgba(240,249,255,0.5)" border={CX.sky100} count={rx!.lab_tests.length}>
          <View style={{ gap: 9 }}>{rx!.lab_tests.map((t, i) => <TestRow key={t.line_id || i} text={t.name} />)}</View>
        </Block>
      ) : null}
      {(rx?.advice?.length ?? 0) > 0 ? (
        <Block title="Recommendations" icon="checks" iconColor={CX.emerald600} accent="#34d399" tint="rgba(236,253,245,0.5)" border={CX.emerald100} count={rx!.advice.length}>
          <Bullets items={rx!.advice.map((a) => a.text)} dot={CX.emerald} />
        </Block>
      ) : null}
      {rx?.follow_up?.after_value != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: CX.indigo50, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Icon name="calendar" size={13} color={CX.indigo} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, color: CX.slate700 }}>Follow up after <Text style={{ fontFamily: F.bodySemi, color: CX.slate900 }}>{rx.follow_up.after_value} {rx.follow_up.after_unit}</Text></Text>
        </View>
      ) : null}
    </CardShell>
  );
}

/** The prescription's edit trail, newest first. */
export function EditHistoryList({ entries }: { entries: RxEditEntry[] | null | undefined }) {
  const list = Array.isArray(entries) ? [...entries].reverse() : [];
  if (list.length === 0) return null;
  const diff = (before: string[] | undefined, after: string[] | undefined) => {
    const b = new Set(before ?? []); const a = new Set(after ?? []);
    return { added: [...a].filter((x) => !b.has(x)), removed: [...b].filter((x) => !a.has(x)) };
  };
  return (
    <View style={{ backgroundColor: CX.white, borderRadius: 16, borderWidth: 1, borderColor: CX.slate200, padding: 14, gap: 10 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: CX.slate500 }}>Edit history · {list.length}</Text>
      {list.map((e) => {
        const meds = diff(e.medicines_before, e.medicines_after);
        const tests = diff(e.tests_before, e.tests_after);
        const who = [e.editor_name || 'Someone', e.editor_role ? `(${e.editor_role})` : ''].filter(Boolean).join(' ');
        const what = e.action === 'approve' ? `Approved v${e.to_version ?? 1} for the client and locked`
          : e.action === 'finalize' ? `Finalized v${e.to_version ?? 1} in the call`
          : e.from_version != null ? `Edited after the call: v${e.from_version} to v${e.to_version ?? '?'}` : `Written after the call as v${e.to_version ?? 1}`;
        const parts = [meds.added.length ? `added ${meds.added.join(', ')}` : '', meds.removed.length ? `removed ${meds.removed.join(', ')}` : '', tests.added.length ? `tests added ${tests.added.join(', ')}` : '', tests.removed.length ? `tests removed ${tests.removed.join(', ')}` : ''].filter(Boolean);
        return (
          <View key={e.id} style={{ gap: 2, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: CX.indigo100 }}>
            <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, lineHeight: 18, color: CX.slate600 }}><Text style={{ fontFamily: F.bodySemi, color: CX.slate800 }}>{what}</Text> · {istStamp(e.at) ?? ''} · {who}</Text>
            {parts.length > 0 ? <Text style={{ fontFamily: F.bodyReg, fontSize: 12, color: CX.slate600 }}>{parts.join('; ')}</Text> : null}
            {e.note ? <Text style={{ fontFamily: F.italic, fontSize: 12, color: CX.slate500 }}>"{e.note}"</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/* ---------- slot actions shared by the dashboard, the month view and All Calls ---------- */
export function useSlotActions() {
  const { set, go } = useStore();
  const updateStatus = useUpdateSlotStatus();
  const provision = useProvisionRoom();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const complete = (s: ConsultationSlot) => {
    if (updateStatus.isPending) return;
    Alert.alert('Mark as complete?', `${slotPersonName(s.client)} · ${fmtLongDate(s.consultation_date)} · ${timeLabel(s.start_time)} to ${timeLabel(s.end_time)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete', onPress: () => { setBusyId(s.id); updateStatus.mutate({ id: s.id, status: 'completed' }, { onError: (e) => Alert.alert("Couldn't mark complete", describeConsultError(e)), onSettled: () => setBusyId(null) }); } },
    ]);
  };
  const join = (s: ConsultationSlot) => {
    if (!s.meet_url) return;
    joinTargetRef.current = { slotId: s.id, url: s.meet_url, clientName: slotPersonName(s.client) };
    go('doctor-consultation-join');
  };
  /** View Reports: the client's medical record (Medical tab: history + lab reports, Reports tab: findings). */
  const reports = (s: ConsultationSlot) => {
    set({ selectedClientId: s.client_id, selectedClientName: slotPersonName(s.client), clientInitialTab: 'medical' });
    go('doctor-client-detail');
  };
  const generateLink = (s: ConsultationSlot) => {
    if (provision.isPending) return;
    setBusyId(s.id);
    provision.mutate(s.id, { onError: (e) => Alert.alert("Couldn't create the video link", describeConsultError(e)), onSettled: () => setBusyId(null) });
  };
  return { complete, join, reports, generateLink, busyId, completing: updateStatus.isPending, provisioning: provision.isPending };
}
export type SlotActions = ReturnType<typeof useSlotActions>;

/** One booked slot in a day list (dashboard calendar card and the month view). */
export function SlotCard({ slot, actions, now }: { slot: ConsultationSlot; actions: SlotActions; now?: number }) {
  const elapsed = isSlotElapsed(slot, now);
  const tone = slotTone(slot, now);
  const busy = actions.busyId === slot.id;
  return (
    <View style={{ backgroundColor: CX.white, borderRadius: 14, borderWidth: 1, borderColor: CX.slate100, paddingLeft: 14, paddingRight: 12, paddingVertical: 10, overflow: 'hidden', gap: 4 }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: tone.bar }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={11} color={CX.slate400} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: CX.slate400 }}>{timeLabel(slot.start_time)} to {timeLabel(slot.end_time)}</Text>
        </View>
        {elapsed ? <StatusPill label="Elapsed" tone="amber" /> : null}
        {slot.status === 'completed' ? <StatusPill label="Done" tone="emerald" /> : null}
      </View>
      <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: CX.slate700 }}>{slotPersonName(slot.client)}</Text>
      {slot.description ? <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate400 }}>{slot.description}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {slot.meet_url && slot.status === 'scheduled' ? <LightBtn small label="Join Meet" icon="phone" tone="indigo" onPress={() => actions.join(slot)} /> : null}
        {!slot.meet_url && slot.status === 'scheduled' ? <LightBtn small label="Generate link" icon="send" tone="outline" busy={busy && actions.provisioning} onPress={() => actions.generateLink(slot)} /> : null}
        {slot.status === 'scheduled' ? <LightBtn small label="Complete" icon="checks" tone="emerald" busy={busy && actions.completing} onPress={() => actions.complete(slot)} /> : null}
        <LightBtn small label="View Reports" tone="slate" onPress={() => actions.reports(slot)} />
      </View>
    </View>
  );
}
const STATUS_DOT: Record<string, string> = { pending: CX.amber, scheduled: CX.indigo, completed: CX.emerald, cancelled: CX.slate300 };
/** A medical_diagnosis request on the day (no actions on this surface, as on the web). */
export function DiagRow({ row, name }: { row: DiagnosisRow; name: string }) {
  const at = row.scheduled_at ? new Date(row.scheduled_at) : null;
  const time = at && !isNaN(at.getTime()) ? `${at.getHours() % 12 === 0 ? 12 : at.getHours() % 12}:${pad2(at.getMinutes())} ${at.getHours() >= 12 ? 'PM' : 'AM'}` : '--';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, width: 74, marginTop: 1 }}>
        <Icon name="clock" size={11} color={CX.slate500} strokeWidth={2.2} />
        <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: CX.slate500 }}>{time}</Text>
      </View>
      <View style={{ marginTop: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: STATUS_DOT[row.status] ?? CX.slate300 }} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 13, color: CX.slate800 }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate400 }}>{row.problem_statement}</Text>
      </View>
    </View>
  );
}
