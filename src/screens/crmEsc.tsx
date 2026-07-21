import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, Badge, AnimChip, HScroll } from './common';
import { useAuth } from '../auth';
import { useEscalations, ESC_META, ESC_TYPES, TIER_META, EscalationType, EscalationRow } from '../lib/escalationQueries';
import { SheetShell } from './reportDetail';

/* ============ CRM: Escalations — read-only monitor over the escalations
   ladder (T1 CRM → T2 Ops → T3 Super Admin). Rows are opened, bumped and
   auto-resolved by the backend — this page keeps the CRM ahead of them. ============ */

const istDT = (iso: string | null) => (iso ? `${new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}` : '—');
const ago = (iso: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

/* One rule-specific detail line per escalation type. */
function detailLine(r: EscalationRow): string | null {
  const d = r.details ?? {};
  switch (r.type) {
    case 'communication_log_missing':
      return d.last_counselling_done_at ? `Last counselling ${istDT(d.last_counselling_done_at)}` : 'Never counselled';
    case 'no_recent_session':
      return d.last_session_at ? `Last session ${istDT(d.last_session_at)}` : 'No session on record';
    case 'roster_expired_no_session':
      return d.latest_session_at ? `Roster ended ${istDT(d.latest_session_at)}` : 'Nothing ever scheduled';
    case 'single_trainer_first_14d':
      return d.sole_trainer_name ? `Only trainer: ${d.sole_trainer_name}` : null;
    case 'multi_trainer_same_modality':
      return d.modality ? `${d.trainer_count ?? '3+'} trainers on ${d.modality}${Array.isArray(d.trainer_names) ? ` — ${d.trainer_names.slice(0, 3).join(', ')}` : ''}` : null;
    case 'package_exhausted_renewal_pending':
      return d.package_size ? `${d.sessions_used ?? '?'}/${d.package_size} sessions used${d.exhausted_at ? ` · exhausted ${istDT(d.exhausted_at)}` : ''}` : null;
    case 'qhp_scheduled_pending':
      return d.remarks?.t1 ? String(d.remarks.t1) : 'Scheduled QHP not completed 3h past its slot';
    default: return null;
  }
}

export function CrmEsc() {
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const [status, setStatus] = React.useState<'open' | 'completed'>('open');
  const [type, setType] = React.useState<'all' | EscalationType>('all');
  const [mineOnly, setMineOnly] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [rulesOpen, setRulesOpen] = React.useState(false);
  const escQ = useEscalations(crmId, status);

  const all = escQ.data ?? [];
  const scoped = mineOnly ? all.filter((r) => r.mine) : all;
  const q = query.trim().toLowerCase();
  const list = scoped
    .filter((r) => type === 'all' || r.type === type)
    .filter((r) => !q || (r.clientName ?? r.title).toLowerCase().includes(q));
  const countOf = (t: EscalationType) => scoped.filter((r) => r.type === t).length;
  const tierCounts = [1, 2, 3].map((lv) => scoped.filter((r) => r.level === lv).length);

  return (
    <Page gap={13} pt={6}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 24 }}>Escalations</Serif>
          <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Auto-raised issues climbing CRM → Ops → Super Admin</Body>
        </View>
        <Pressable onPress={() => setRulesOpen(true)} style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Icon name="alert" size={16} color={C.muted} strokeWidth={2.1} />
        </Pressable>
      </View>

      {/* Tier strip */}
      <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {[1, 2, 3].map((lv, i) => (
          <View key={lv} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: TIER_META[lv].color }}>{escQ.isLoading ? '…' : tierCounts[lv - 1]}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{TIER_META[lv].label.toUpperCase()}</Mono>
          </View>
        ))}
      </View>

      {/* Open/Completed + Mine toggle */}
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 5, padding: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
          {(['open', 'completed'] as const).map((st) => {
            const active = status === st;
            return (
              <AnimChip key={st} grow active={active} onPress={() => setStatus(st)} style={{ alignItems: 'center', paddingVertical: 8, borderRadius: 9, overflow: 'hidden', backgroundColor: active ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                {active ? <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
                <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? '#fff' : C.muted }}>{st === 'open' ? 'Open' : 'Resolved'}</Text>
              </AnimChip>
            );
          })}
        </View>
        <AnimChip active={mineOnly} onPress={() => setMineOnly(!mineOnly)} style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: mineOnly ? hexA(C.orange, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: mineOnly ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: mineOnly ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: mineOnly ? C.orange : C.muted }}>Mine</Text>
        </AnimChip>
      </View>

      {/* Type chips */}
      <HScroll gap={6}>
        <AnimChip active={type === 'all'} onPress={() => setType('all')} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, backgroundColor: type === 'all' ? hexA(C.orange, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: type === 'all' ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
          <Text style={{ fontFamily: type === 'all' ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: type === 'all' ? C.orange : C.muted }}>All</Text>
          {!escQ.isLoading ? <Text style={{ fontFamily: F.mono, fontSize: 9, color: type === 'all' ? C.orange : C.muted3 }}>{scoped.length}</Text> : null}
        </AnimChip>
        {ESC_TYPES.map((t) => {
          const meta = ESC_META[t];
          const active = type === t;
          const n = countOf(t);
          return (
            <AnimChip key={t} active={active} onPress={() => setType(t)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: active ? hexA(meta.color, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(meta.color, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? meta.color : C.muted }}>{meta.short}</Text>
              {!escQ.isLoading && n ? <Text style={{ fontFamily: F.mono, fontSize: 9, color: active ? meta.color : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </HScroll>

      {/* Search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {escQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Loading escalations…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
          <Icon name={status === 'open' ? 'checks' : 'inbox'} size={26} color={status === 'open' ? C.green : C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 12.5, color: status === 'open' ? C.green : C.muted2, fontFamily: status === 'open' ? F.bodySemi : F.body }}>
            {status === 'open' ? 'Nothing escalated — clean board.' : 'No resolved escalations here.'}
          </Body>
        </View>
      ) : (
        list.slice(0, 60).map((r) => {
          const meta = ESC_META[r.type];
          const tier = TIER_META[r.level] ?? TIER_META[1];
          const detail = detailLine(r);
          return (
            <View key={r.id} style={{ borderRadius: 16, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(tier.color, 0.25), overflow: 'hidden' }}>
              <View style={{ height: 2.5, backgroundColor: hexA(tier.color, 0.55) }} />
              <View style={{ padding: 13, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(meta.color, 0.12), borderWidth: 1, borderColor: hexA(meta.color, 0.32) }}>
                    <Icon name={meta.icon as any} size={15} color={meta.color} strokeWidth={2.1} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName ?? r.title}</Body>
                    <Mono style={{ fontSize: 7.5, color: meta.color, marginTop: 2 }}>{meta.label.toUpperCase()}</Mono>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Badge text={tier.label} color={tier.color} />
                    {status === 'open' ? <Mono style={{ fontSize: 7.5, color: C.muted3 }}>OPEN {ago(r.escalatedAt).toUpperCase()}</Mono> : null}
                  </View>
                </View>
                {detail ? <Body style={{ fontSize: 11.5, color: C.muted2 }} numberOfLines={2}>{detail}</Body> : null}
                <Mono style={{ fontSize: 7.5, color: C.muted3 }}>RAISED {istDT(r.escalatedAt).toUpperCase()} · {meta.resolves.toUpperCase()}</Mono>
              </View>
            </View>
          );
        })
      )}
      {list.length > 60 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 60} more — refine filters</Body> : null}

      {/* Rules explainer */}
      <SheetShell visible={rulesOpen} onClose={() => setRulesOpen(false)} accent={C.orange} icon="alert" title="How escalations work" subtitle="AUTO-RAISED · AUTO-RESOLVED">
        <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 18 }}>
          The system raises these automatically and moves them up the ladder if unaddressed: Tier 1 lands with you, Tier 2 goes to Ops, Tier 3 to the Super Admin. They resolve themselves the moment the underlying issue is fixed — no button needed here.
        </Body>
        {ESC_TYPES.map((t) => {
          const meta = ESC_META[t];
          return (
            <View key={t} style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.24)', borderWidth: 1, borderColor: hexA(meta.color, 0.22), gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name={meta.icon as any} size={13} color={meta.color} strokeWidth={2.2} />
                <Body style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{meta.label}</Body>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2 }}>{meta.rule}</Body>
              <Mono style={{ fontSize: 8, color: C.green }}>{meta.resolves.toUpperCase()}</Mono>
            </View>
          );
        })}
      </SheetShell>
    </Page>
  );
}
