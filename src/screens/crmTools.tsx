import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono } from '../components/primitives';
import { Page, BackLink, Badge, MiniAvatar, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useBloodReportStatus, BloodClientRow } from '../lib/bloodQueries';
import { BloodReportSheet } from './reportDetail';

/* ============ CRM: Tools hub + Blood Reports tool (moved under Tools,
   mirrors the web CRMTools / CRMBloodReports). ============ */

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const AVS: [string, string][] = [['#F0883E', '#C05621'], ['#4FD1C5', '#2C7A7B'], ['#B794F4', '#6B46C1'], ['#F687B3', '#B83280'], ['#68D391', '#276749'], ['#63B3ED', '#2B6CB0']];
const istD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/* ================= TOOLS HUB ================= */
export function CrmTools() {
  const { go } = useStore();
  const TOOLS = [
    {
      id: 'blood', route: 'crm-blood', icon: 'activity', color: C.red,
      title: 'Blood Reports',
      desc: 'See which clients have blood reports on file, spot who is missing one, and open any report.',
    },
  ] as const;
  return (
    <Page gap={13} pt={6}>
      <View>
        <Serif style={{ fontSize: 24 }}>Tools</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Quick utilities for managing your assigned clients</Body>
      </View>
      {TOOLS.map((t) => (
        <Pressable key={t.id} onPress={() => go(t.route)} style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: hexA(t.color, 0.2), overflow: 'hidden' }}>
          <LinearGradient colors={[hexA(t.color, 0.5), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2.5 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15 }}>
            <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(t.color, 0.12), borderWidth: 1, borderColor: hexA(t.color, 0.32) }}>
              <Icon name={t.icon as any} size={21} color={t.color} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{t.title}</Body>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 3, lineHeight: 16 }}>{t.desc}</Body>
            </View>
            <Icon name="chevRight" size={16} color={t.color} strokeWidth={2.3} />
          </View>
        </Pressable>
      ))}
      <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center', marginTop: 6 }}>More tools coming here as they go live.</Body>
    </Page>
  );
}

/* ================= BLOOD REPORTS TOOL ================= */
export function CrmBloodReports() {
  const { back, canGoBack, go } = useStore();
  const { session } = useAuth();
  const crmId = session?.user?.id ?? null;
  const statusQ = useBloodReportStatus(crmId);
  const [tab, setTab] = React.useState<'missing' | 'with'>('missing');
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<any | null>(null);

  const rows = statusQ.data ?? [];
  const missing = rows.filter((r) => r.count === 0);
  const withReports = rows.filter((r) => r.count > 0);
  const q = query.trim().toLowerCase();
  const list = (tab === 'missing' ? missing : withReports).filter((r) => !q || r.clientName.toLowerCase().includes(q));

  return (
    <Page gap={13} pt={6}>
      <BackLink label="Tools" onPress={() => (canGoBack ? back() : go('crm-tools'))} />
      <View>
        <Serif style={{ fontSize: 24 }}>Blood Reports</Serif>
        <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Who has reports on file — and who's missing one</Body>
      </View>

      {/* Stat strip */}
      <View style={{ flexDirection: 'row', borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
        {([['MISSING REPORTS', missing.length, C.red], ['WITH REPORTS', withReports.length, C.green]] as [string, number, string][]).map(([lab, val, col], i) => (
          <View key={lab} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: col }}>{statusQ.isLoading ? '…' : val}</Text>
            <Mono style={{ fontSize: 6.5, letterSpacing: 0.6, color: C.muted3 }}>{lab}</Mono>
          </View>
        ))}
      </View>

      {/* Tabs + search */}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([['missing', 'Missing', C.red, missing.length], ['with', 'Has Reports', C.green, withReports.length]] as ['missing' | 'with', string, string, number][]).map(([id, label, col, n]) => {
          const active = tab === id;
          return (
            <AnimChip key={id} grow active={active} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, backgroundColor: active ? hexA(col, 0.15) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(col, 0.5) : 'rgba(255,255,255,0.08)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? col : C.muted }}>{label}</Text>
              {!statusQ.isLoading ? <Text style={{ fontFamily: F.mono, fontSize: 9.5, color: active ? col : C.muted3 }}>{n}</Text> : null}
            </AnimChip>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={15} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search clients…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', padding: 0 }} />
      </View>

      {statusQ.isLoading ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={C.orange} />
          <Body style={{ fontSize: 12.5, color: C.muted3 }}>Checking reports…</Body>
        </View>
      ) : list.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 9, paddingVertical: 28 }}>
          <Icon name={tab === 'missing' ? 'checks' : 'activity'} size={26} color={tab === 'missing' ? C.green : C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 12.5, color: tab === 'missing' ? C.green : C.muted2, fontFamily: tab === 'missing' ? F.bodySemi : F.body }}>
            {tab === 'missing' ? 'Every client has a blood report — excellent.' : 'No clients match.'}
          </Body>
        </View>
      ) : (
        <View style={{ borderRadius: 17, backgroundColor: 'rgba(24,17,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)', overflow: 'hidden' }}>
          {list.slice(0, 60).map((r: BloodClientRow, i) => {
            const open = expanded === r.clientId;
            return (
              <View key={r.clientId} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Pressable
                  onPress={() => r.count > 0 && setExpanded(open ? null : r.clientId)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 13 }}
                >
                  <MiniAvatar initial={initials(r.clientName)} colors={AVS[i % AVS.length]} size={38} />
                  <View style={{ flex: 1 }}>
                    <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{r.clientName}</Body>
                    <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 2 }}>
                      {r.count ? `${r.count} REPORT${r.count > 1 ? 'S' : ''} · LAST ${istD(r.lastTest).toUpperCase()}` : 'NO BLOOD REPORT ON FILE'}
                    </Mono>
                  </View>
                  {r.count ? (
                    <>
                      <Badge text={`${r.count}`} color={C.green} />
                      <Icon name={open ? 'chevUp' : 'chevDown'} size={13} color={C.muted2} strokeWidth={2.2} />
                    </>
                  ) : (
                    <Badge text="Missing" color={C.red} />
                  )}
                </Pressable>
                {open ? (
                  <View style={{ paddingHorizontal: 13, paddingBottom: 12, gap: 6 }}>
                    {r.reports.map((h: any) => (
                      <Pressable key={h.id} onPress={() => setReport(h)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, backgroundColor: hexA(C.blue, 0.06), borderWidth: 1, borderColor: hexA(C.blue, 0.22) }}>
                        <Icon name="activity" size={14} color={C.blue} strokeWidth={2} />
                        <View style={{ flex: 1 }}>
                          <Body numberOfLines={1} style={{ fontSize: 12.5, fontFamily: F.bodySemi, color: '#fff' }}>{h.report_name || h.report_type || 'Blood Report'}</Body>
                          <Mono style={{ fontSize: 8, color: C.muted3, marginTop: 1 }}>{istD(h.test_date || h.upload_date).toUpperCase()}</Mono>
                        </View>
                        <Icon name="chevRight" size={13} color={C.blue} strokeWidth={2.2} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {list.length > 60 ? <Body style={{ fontSize: 11, color: C.muted3, textAlign: 'center' }}>+{list.length - 60} more — refine the search</Body> : null}

      <BloodReportSheet report={report} onClose={() => setReport(null)} />
    </Page>
  );
}
