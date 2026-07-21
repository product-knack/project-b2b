import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal, Linking, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon, IconName } from '../icons';
import { Serif, Body, Mono, Card, CountUp } from '../components/primitives';
import { Page, TitleBlock, Badge, HScroll } from './common';
import { useAuth } from '../auth';
import { useStore } from '../store';
import {
  useAdminReferrals, useUpdateReferralStatus, useAdminUpgradeRequests, useUpdateUpgradeStatus,
  useAdminRenewalRequests, useUpdateRenewalRequestStatus, useAdminCrossSellRequests, useUpdateCrossSellStatus,
  useAdminNewLeadRows, useConvertLeadToClient, useReferredLeads, useUpdateReferredLeadStatus, useAddReferredClient,
  useRenewalPayRequests, useDecideRenewalPayment, useMarkRenewalCashPaid,
  useInvoiceRaisedRows, useLeadInvoiceRequests, useGenerateLeadPayment, useRetryRazorpayLink, useMarkLeadInvoicePaid,
  usePaidCancellations, useApprovePaidCancellation, useRejectPaidCancellation,
  personName, REF_LEAD_STATUSES, type Referral, type AdminNewLead, type InvoiceRaisedLead, type PaidCancellation,
} from '../lib/adminRequestQueries';

/* ============ ADMIN — Requests (referrals + upgrade/renewal/cross-sell approvals) ============ */

const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function Loading() {
  return <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>;
}
/* Offline-paused queries keep isPending=true forever with no cached data — a bare
   spinner would hang indefinitely. Show a spinner only while actually fetching,
   otherwise an honest offline note. */
function LoadState({ q }: { q: { fetchStatus?: string } }) {
  if (q.fetchStatus === 'fetching') return <Loading />;
  return (
    <View style={{ alignItems: 'center', gap: 7, paddingVertical: 24 }}>
      <Icon name="alert" size={16} color={C.gold} strokeWidth={2.2} />
      <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center' }}>Offline — connect to the internet to load this queue.</Body>
    </View>
  );
}
function Err({ q }: { q: { isError: boolean; error: unknown } }) {
  if (!q.isError) return null;
  return <Body style={{ fontSize: 11.5, color: C.red, textAlign: 'center', paddingVertical: 8 }}>{(q.error as Error)?.message ?? 'Could not load.'}</Body>;
}
function SectionHead({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9, marginTop: 3 }}>
      <Mono style={{ fontSize: 9.5, letterSpacing: 1.4, color: C.mono }}>{label}</Mono>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
    </View>
  );
}
const statusColor = (s: string | null) => (s === 'approved' ? C.green : s === 'rejected' ? C.red : s === 'pending' ? C.gold : C.blue);
const statusLabel = (s: string | null) => (s === 'pending' ? 'Pending' : s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

/* From → To badge pair (e.g. "Odds plus → Odds pro", "16 → 32"). */
function FromTo({ from, to }: { from: string | null; to: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Badge text={from || 'None'} color={C.gold} />
      <Icon name="arrowRight" size={11} color={C.muted3} strokeWidth={2.3} />
      <Badge text={to} color={C.blue} />
    </View>
  );
}
function ApproveRejectRow({ busy, onApprove, onReject }: { busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable disabled={busy} onPress={onApprove} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.green, busy ? 0.06 : 0.14), borderWidth: 1, borderColor: hexA(C.green, busy ? 0.2 : 0.45) }}>
        <Icon name="checks" size={13} color={busy ? C.muted3 : C.green} strokeWidth={2.4} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: busy ? C.muted3 : C.green }}>Approve</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={onReject} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
        <Icon name="close" size={12} color={C.red} strokeWidth={2.6} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.red }}>Reject</Text>
      </Pressable>
    </View>
  );
}

/* Confirm sheet — approve (optional notes) or reject (reason). Shared by all request kinds. */
function ConfirmSheet({ action, title, clientName, detail, busy, onConfirm, onClose }: {
  action: 'approve' | 'reject'; title: string; clientName: string; detail?: React.ReactNode;
  busy: boolean; onConfirm: (notes: string) => void; onClose: () => void;
}) {
  const [notes, setNotes] = React.useState('');
  const col = action === 'approve' ? C.green : C.red;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 18 }}>{action === 'approve' ? 'Approve' : 'Reject'} {title}</Serif>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{clientName}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          {detail ? <View style={{ marginBottom: 10 }}>{detail}</View> : null}
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.mono2, marginBottom: 5 }}>{action === 'approve' ? 'NOTES (OPTIONAL)' : 'REJECTION REASON'}</Mono>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder={action === 'approve' ? 'Add any notes…' : 'Explain why this request is being rejected…'} placeholderTextColor={C.muted3}
            style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13, minHeight: 64, textAlignVertical: 'top', marginBottom: 12 }} />
          <Pressable disabled={busy} onPress={() => onConfirm(notes)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(col, busy ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(col, busy ? 0.2 : 0.5) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: busy ? C.muted3 : col }}>{busy ? 'Processing…' : action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* Generic request card used by upgrades / renewals / cross-sell. */
function RequestCard({ status, clientName, requesterName, children, requestedAt, actions }: {
  status: string | null; clientName: string; requesterName: string | null;
  children?: React.ReactNode; requestedAt: string | null; actions?: React.ReactNode;
}) {
  const col = statusColor(status);
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: col }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{clientName}</Body>
        <Badge text={statusLabel(status)} color={col} />
      </View>
      {requesterName ? <Body style={{ fontSize: 11, color: C.muted2 }}>Requested by <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{requesterName}</Text></Body> : null}
      {children}
      {requestedAt ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>REQUESTED {fmtAt(requestedAt).toUpperCase()}</Mono> : null}
      {actions}
    </Card>
  );
}

/* ---------------- Tab 1: Referrals (moved from the old Referrals page) ---------------- */
function ReferralCard({ r, profileId }: { r: Referral; profileId: string | null }) {
  const update = useUpdateReferralStatus();
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const col = statusColor(r.status);
  return (
    <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 9, borderLeftWidth: 3, borderLeftColor: col }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.3), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="gift" size={15} color={C.orange} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{r.referred_client_name}</Body>
            <Badge text={r.status === 'pending' ? 'Pending Review' : statusLabel(r.status)} color={col} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3, alignItems: 'center' }}>
            {r.referred_client_phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${r.referred_client_phone}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="phone" size={10} color={C.blue} strokeWidth={2.2} />
                <Body style={{ fontSize: 10.5, color: C.blue }}>{r.referred_client_phone}</Body>
              </Pressable>
            ) : null}
            {r.referred_client_email ? <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 10.5, color: C.muted2 }}>{r.referred_client_email}</Body> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Body style={{ fontSize: 11, color: C.muted2 }}>Referred by <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{personName(r.referrer)}</Text></Body>
            {r.referrer?.role ? <Badge text={r.referrer.role.toUpperCase()} color={C.blue} /> : null}
          </View>
          <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3, marginTop: 4 }}>SUBMITTED {fmtAt(r.created_at).toUpperCase()}</Mono>
        </View>
      </View>
      {r.notes ? <Body style={{ fontSize: 11, color: C.ink2, lineHeight: 15, padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)' }}>{r.notes}</Body> : null}
      {r.rejection_reason ? <Body style={{ fontSize: 10.5, color: C.red }}>Reason: {r.rejection_reason}</Body> : null}
      {err ? <Body style={{ fontSize: 10.5, color: C.red }}>{err}</Body> : null}
      {r.status === 'pending' ? (
        <ApproveRejectRow busy={update.isPending}
          onApprove={() => { setErr(null); update.mutate({ referralId: r.id, status: 'approved', profileId }, { onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
          onReject={() => setRejectOpen(true)} />
      ) : null}
      {rejectOpen ? (
        <ConfirmSheet action="reject" title="Referral" clientName={r.referred_client_name} busy={update.isPending} onClose={() => setRejectOpen(false)}
          onConfirm={(notes) => { setErr(null); update.mutate({ referralId: r.id, status: 'rejected', rejectionReason: notes.trim() || undefined, profileId }, { onSuccess: () => setRejectOpen(false), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }} />
      ) : null}
    </Card>
  );
}

function ReferralsTab({ profileId }: { profileId: string | null }) {
  const q = useAdminReferrals();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const referrals = q.data ?? [];
  const pendingCount = referrals.filter((r) => r.status === 'pending').length;
  const term = search.toLowerCase();
  const filtered = referrals.filter((r) => {
    const matches = !term || (r.referred_client_name ?? '').toLowerCase().includes(term)
      || (r.referrer?.first_name ?? '').toLowerCase().includes(term) || (r.referrer?.last_name ?? '').toLowerCase().includes(term);
    return matches && (filter === 'all' || r.status === filter);
  });
  return (
    <View style={{ gap: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search by client or referrer name…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={12} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {(([['pending', pendingCount ? `Pending (${pendingCount})` : 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']]) as ['pending' | 'approved' | 'rejected' | 'all', string][]).map(([id, label]) => {
          const active = filter === id;
          return (
            <Pressable key={id} onPress={() => setFilter(id)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Err q={q} />
      {q.isPending ? <LoadState q={q} /> : filtered.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>{filter === 'pending' ? 'No pending referrals to review' : 'No referrals match your search criteria'}</Body>
      ) : filtered.map((r) => <ReferralCard key={r.id} r={r} profileId={profileId} />)}
    </View>
  );
}

/* ---------------- Tabs 2–4: pending + history sections ---------------- */
type PendingAction = { action: 'approve' | 'reject'; id: string } | null;

function UpgradesTab({ profileId }: { profileId: string | null }) {
  const q = useAdminUpgradeRequests();
  const update = useUpdateUpgradeStatus();
  const [act, setAct] = React.useState<PendingAction>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  const processed = rows.filter((r) => r.status !== 'pending').slice(0, 10);
  const sel = act ? rows.find((r) => r.id === act.id) : null;
  return (
    <View style={{ gap: 10 }}>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No subscription upgrade requests</Body>
      ) : (
        <>
          {pending.length > 0 ? <SectionHead label="PENDING APPROVAL" /> : null}
          {pending.map((r) => (
            <RequestCard key={r.id} status={r.status} clientName={personName(r.client)} requesterName={personName(r.requester)} requestedAt={r.created_at}
              actions={<ApproveRejectRow busy={update.isPending} onApprove={() => setAct({ action: 'approve', id: r.id })} onReject={() => setAct({ action: 'reject', id: r.id })} />}>
              <FromTo from={r.previous_subscription_type} to={r.new_subscription_type} />
              {r.change_reason ? <Body style={{ fontSize: 11, color: C.muted2 }}>Reason: <Text style={{ color: C.ink2 }}>{r.change_reason}</Text></Body> : null}
            </RequestCard>
          ))}
          {processed.length > 0 ? <SectionHead label="HISTORY" /> : null}
          {processed.map((r) => (
            <RequestCard key={r.id} status={r.status} clientName={personName(r.client)} requesterName={null} requestedAt={null}>
              <FromTo from={r.previous_subscription_type} to={r.new_subscription_type} />
              {r.admin_notes ? <Body style={{ fontSize: 11, color: C.muted2 }}>Notes: <Text style={{ color: C.ink2 }}>{r.admin_notes}</Text></Body> : null}
              {r.reviewed_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>REVIEWED ON {fmtDay(r.reviewed_at).toUpperCase()}</Mono> : null}
            </RequestCard>
          ))}
        </>
      )}
      {act && sel ? (
        <ConfirmSheet action={act.action} title="Subscription Upgrade" clientName={personName(sel.client)} busy={update.isPending} onClose={() => setAct(null)}
          detail={<FromTo from={sel.previous_subscription_type} to={sel.new_subscription_type} />}
          onConfirm={(notes) => {
            setErr(null);
            update.mutate({ requestId: sel.id, status: act.action === 'approve' ? 'approved' : 'rejected', adminNotes: notes.trim() || undefined, clientId: sel.client_id, newSubscriptionType: sel.new_subscription_type, profileId },
              { onSuccess: () => setAct(null), onError: (e: any) => { setAct(null); setErr(e?.message ?? 'Failed'); } });
          }} />
      ) : null}
    </View>
  );
}

function RenewalsTab({ profileId }: { profileId: string | null }) {
  const q = useAdminRenewalRequests();
  const update = useUpdateRenewalRequestStatus();
  const [act, setAct] = React.useState<PendingAction>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.request_status === 'pending');
  const processed = rows.filter((r) => r.request_status && r.request_status !== 'pending').slice(0, 10);
  const sel = act ? rows.find((r) => r.id === act.id) : null;
  const meta = (r: (typeof rows)[number]) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {r.package_sessions ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Sessions <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{r.package_sessions}</Text></Body> : null}
      {r.package_duration ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Duration <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{r.package_duration} months</Text></Body> : null}
      {r.package_amount ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Amount <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>₹{r.package_amount.toLocaleString('en-IN')}</Text></Body> : null}
      {r.cycle_type ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Cycle <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{r.cycle_type}</Text></Body> : null}
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No renewal requests</Body>
      ) : (
        <>
          {pending.length > 0 ? <SectionHead label="PENDING APPROVAL" /> : null}
          {pending.map((r) => (
            <RequestCard key={r.id} status={r.request_status} clientName={personName(r.client)} requesterName={personName(r.requester)} requestedAt={r.created_at}
              actions={<ApproveRejectRow busy={update.isPending} onApprove={() => setAct({ action: 'approve', id: r.id })} onReject={() => setAct({ action: 'reject', id: r.id })} />}>
              <FromTo from={r.previous_package} to={r.new_package || 'Renewal'} />
              {meta(r)}
            </RequestCard>
          ))}
          {processed.length > 0 ? <SectionHead label="HISTORY" /> : null}
          {processed.map((r) => (
            <RequestCard key={r.id} status={r.request_status} clientName={personName(r.client)} requesterName={null} requestedAt={null}>
              <FromTo from={r.previous_package} to={r.new_package || 'Renewal'} />
              {r.admin_notes ? <Body style={{ fontSize: 11, color: C.muted2 }}>Notes: <Text style={{ color: C.ink2 }}>{r.admin_notes}</Text></Body> : null}
              {r.approved_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>REVIEWED ON {fmtDay(r.approved_at).toUpperCase()}</Mono> : null}
            </RequestCard>
          ))}
        </>
      )}
      {act && sel ? (
        <ConfirmSheet action={act.action} title="Renewal Request" clientName={personName(sel.client)} busy={update.isPending} onClose={() => setAct(null)}
          detail={<FromTo from={sel.previous_package} to={sel.new_package || 'Renewal'} />}
          onConfirm={(notes) => {
            setErr(null);
            update.mutate({ requestId: sel.id, status: act.action === 'approve' ? 'approved' : 'rejected', adminNotes: notes.trim() || undefined, clientId: sel.client_id, profileId },
              { onSuccess: () => setAct(null), onError: (e: any) => { setAct(null); setErr(e?.message ?? 'Failed'); } });
          }} />
      ) : null}
    </View>
  );
}

function CrossSellTab({ profileId }: { profileId: string | null }) {
  const q = useAdminCrossSellRequests();
  const update = useUpdateCrossSellStatus();
  const [act, setAct] = React.useState<PendingAction>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.request_status === 'pending');
  const processed = rows.filter((r) => r.request_status && r.request_status !== 'pending').slice(0, 10);
  const sel = act ? rows.find((r) => r.id === act.id) : null;
  const meta = (r: (typeof rows)[number]) => (
    <>
      {r.service_name ? <View style={{ alignSelf: 'flex-start' }}><Badge text={r.service_name} color={C.blue} /></View> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Body style={{ fontSize: 10.5, color: C.muted2 }}>Sessions <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{r.sessions_total}</Text></Body>
        <Body style={{ fontSize: 10.5, color: C.muted2 }}>Period <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{fmtDay(r.start_date)} – {fmtDay(r.expiry_date)}</Text></Body>
      </View>
    </>
  );
  return (
    <View style={{ gap: 10 }}>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No cross-sell package requests</Body>
      ) : (
        <>
          {pending.length > 0 ? <SectionHead label="PENDING APPROVAL" /> : null}
          {pending.map((r) => (
            <RequestCard key={r.id} status={r.request_status} clientName={personName(r.client)} requesterName={personName(r.requester)} requestedAt={r.created_at}
              actions={<ApproveRejectRow busy={update.isPending} onApprove={() => setAct({ action: 'approve', id: r.id })} onReject={() => setAct({ action: 'reject', id: r.id })} />}>
              {meta(r)}
            </RequestCard>
          ))}
          {processed.length > 0 ? <SectionHead label="HISTORY" /> : null}
          {processed.map((r) => (
            <RequestCard key={r.id} status={r.request_status} clientName={personName(r.client)} requesterName={null} requestedAt={null}>
              {meta(r)}
              {r.admin_notes ? <Body style={{ fontSize: 11, color: C.muted2 }}>Notes: <Text style={{ color: C.ink2 }}>{r.admin_notes}</Text></Body> : null}
              {r.approved_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>REVIEWED ON {fmtDay(r.approved_at).toUpperCase()}</Mono> : null}
            </RequestCard>
          ))}
        </>
      )}
      {act && sel ? (
        <ConfirmSheet action={act.action} title="Cross-Sell Package" clientName={personName(sel.client)} busy={update.isPending} onClose={() => setAct(null)}
          detail={sel.service_name ? <View style={{ alignSelf: 'flex-start' }}><Badge text={sel.service_name} color={C.blue} /></View> : undefined}
          onConfirm={(notes) => {
            setErr(null);
            update.mutate({ requestId: sel.id, status: act.action === 'approve' ? 'approved' : 'rejected', adminNotes: notes.trim() || undefined, clientId: sel.client_id, profileId },
              { onSuccess: () => setAct(null), onError: (e: any) => { setAct(null); setErr(e?.message ?? 'Failed'); } });
          }} />
      ) : null}
    </View>
  );
}

/* ---------------- Minimal "Convert to Client" sheet (web ClientForm essentials) ---------------- */
function ClientFormSheet({ title, initFirst, initLast, initPhone, busy, onSubmit, onClose }: {
  title: string; initFirst: string; initLast: string; initPhone: string; busy: boolean;
  onSubmit: (f: { firstName: string; lastName: string; email: string; phone: string; goal: string }) => void; onClose: () => void;
}) {
  const [first, setFirst] = React.useState(initFirst);
  const [last, setLast] = React.useState(initLast);
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState(initPhone);
  const [goal, setGoal] = React.useState('');
  const inp = { borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 } as const;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <Serif style={{ flex: 1, fontSize: 18 }}>{title}</Serif>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput value={first} onChangeText={setFirst} placeholder="First name *" placeholderTextColor={C.muted3} style={[inp, { flex: 1 }]} />
              <TextInput value={last} onChangeText={setLast} placeholder="Last name" placeholderTextColor={C.muted3} style={[inp, { flex: 1 }]} />
            </View>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email *" placeholderTextColor={C.muted3} autoCapitalize="none" keyboardType="email-address" style={inp} />
            <TextInput value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor={C.muted3} keyboardType="phone-pad" style={inp} />
            <TextInput value={goal} onChangeText={setGoal} placeholder="Goal (optional)" placeholderTextColor={C.muted3} style={inp} />
            <Pressable disabled={busy || !first.trim() || !email.trim()} onPress={() => onSubmit({ firstName: first, lastName: last, email, phone, goal })}
              style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.green, busy || !first.trim() || !email.trim() ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.green, busy || !first.trim() || !email.trim() ? 0.2 : 0.5) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: busy || !first.trim() || !email.trim() ? C.muted3 : C.green }}>{busy ? 'Creating…' : 'Create client'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
const splitName = (n: string) => { const parts = (n ?? '').trim().split(/\s+/); return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }; };

/* ---------------- Tab: New Leads (default) ---------------- */
function NewLeadsTab({ profileId }: { profileId: string | null }) {
  const q = useAdminNewLeadRows();
  const convert = useConvertLeadToClient();
  const [active, setActive] = React.useState<AdminNewLead | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  return (
    <View style={{ gap: 10 }}>
      <Body style={{ fontSize: 11, color: C.muted2 }}>Leads marked <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>QHP Booked</Text> or <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>Raise Invoice</Text> by Ops that haven't been added as clients.</Body>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No leads awaiting client creation.</Body>
      ) : rows.map((l) => {
        const isInvoice = l.stage === 'Raise invoice';
        const amt = l.invoice_details?.amount;
        return (
          <Card key={l.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(isInvoice ? C.green : C.blue, 0.2)} radius={15} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: isInvoice ? C.green : C.blue }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{l.name}</Body>
              <Badge text={isInvoice ? `Invoice Raised${typeof amt === 'number' ? ` — ₹${amt.toLocaleString('en-IN')}` : ''}` : 'QHP Booked'} color={isInvoice ? C.green : C.blue} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              {l.contact_no ? (
                <Pressable onPress={() => Linking.openURL(`tel:${l.contact_no}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="phone" size={10} color={C.blue} strokeWidth={2.2} />
                  <Body style={{ fontSize: 10.5, color: C.blue }}>{l.contact_no}</Body>
                </Pressable>
              ) : null}
              {l.source ? <Badge text={l.source} color={C.purple} /> : null}
              {l.lead_date ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{fmtDay(l.lead_date).toUpperCase()}</Mono> : null}
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => setActive(l)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}>
                <Icon name="userPlus" size={13} color={C.orange} strokeWidth={2.2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.orange }}>Add as Client</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
      {active ? (
        <ClientFormSheet title="Convert Lead to Client" initFirst={splitName(active.name).first} initLast={splitName(active.name).last} initPhone={active.contact_no ?? ''} busy={convert.isPending} onClose={() => setActive(null)}
          onSubmit={(f) => { setErr(null); convert.mutate({ lead: active, ...f, profileId }, { onSuccess: () => setActive(null), onError: (e: any) => { setActive(null); setErr(e?.message ?? 'Failed'); } }); }} />
      ) : null}
    </View>
  );
}

/* ---------------- Tab: Ref Leads ---------------- */
function RefLeadsTab() {
  const q = useReferredLeads();
  const updateStatus = useUpdateReferredLeadStatus();
  const addClient = useAddReferredClient();
  const [search, setSearch] = React.useState('');
  const [statusOpen, setStatusOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<{ id: string; name: string; phone: string } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const leads = q.data ?? [];
  const counts: Record<string, number> = {};
  leads.forEach((l) => { counts[l.status] = (counts[l.status] ?? 0) + 1; });
  const term = search.toLowerCase();
  const filtered = leads.filter((l) => !term || (l.name ?? '').toLowerCase().includes(term) || (l.phone_no ?? '').includes(search) || (l.coupon ?? '').toLowerCase().includes(term));
  const TILES: [string, string][] = [['total', 'Total'], ['new', 'New'], ['contacted', 'Contacted'], ['qualified', 'Qualified'], ['qhp_scheduled', 'QHP Scheduled'], ['converted', 'Converted'], ['rejected', 'Rejected']];
  const refStatusColor = (s: string) => (s === 'converted' ? C.green : s === 'qhp_scheduled' ? C.blue : s === 'qualified' ? C.purple : s === 'rejected' ? C.red : s === 'contacted' ? C.gold : '#94A3B8');
  return (
    <View style={{ gap: 10 }}>
      <HScroll gap={8}>
        {TILES.map(([key, label]) => (
          <Card key={key} colors={['rgba(56,34,21,0.5)', 'rgba(20,16,15,0.5)']} border={hexA(key === 'total' ? C.orange : refStatusColor(key), 0.2)} radius={13} style={{ paddingVertical: 9, paddingHorizontal: 13, alignItems: 'center', gap: 1, minWidth: 82 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: key === 'total' ? C.orange : refStatusColor(key) }}>{key === 'total' ? leads.length : counts[key] ?? 0}</Text>
            <Mono style={{ fontSize: 7.5, letterSpacing: 0.5, color: C.muted3 }}>{label.toUpperCase()}</Mono>
          </Card>
        ))}
      </HScroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name, phone, coupon…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" size={12} color={C.muted3} strokeWidth={2.3} /></Pressable> : null}
      </View>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : filtered.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No referred leads found.</Body>
      ) : filtered.map((l) => {
        const col = refStatusColor(l.status);
        return (
          <Card key={l.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: col }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{l.name ?? '—'}</Body>
              <Pressable onPress={() => setStatusOpen(statusOpen === l.id ? null : l.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(col, 0.14), borderWidth: 1, borderColor: hexA(col, 0.4) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: col }}>{l.status.replace('_', ' ')}</Text>
                <Icon name={statusOpen === l.id ? 'chevUp' : 'chevDown'} size={9} color={col} strokeWidth={2.4} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              {l.phone_no ? (
                <Pressable onPress={() => Linking.openURL(`tel:${l.phone_no}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="phone" size={10} color={C.blue} strokeWidth={2.2} />
                  <Body style={{ fontSize: 10.5, color: C.blue }}>{l.phone_no}</Body>
                </Pressable>
              ) : null}
              {l.coupon ? <Badge text={l.coupon} color={C.gold} /> : null}
              <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{fmtAt(l.created_at).toUpperCase()}</Mono>
            </View>
            {statusOpen === l.id ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {REF_LEAD_STATUSES.map((s) => (
                  <Pressable key={s} disabled={s === l.status || updateStatus.isPending} onPress={() => { setErr(null); updateStatus.mutate({ id: l.id, status: s }, { onSuccess: () => setStatusOpen(null), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
                    style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: s === l.status ? hexA(refStatusColor(s), 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: s === l.status ? hexA(refStatusColor(s), 0.6) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 10, color: s === l.status ? refStatusColor(s) : C.muted }}>{s.replace('_', ' ')}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => setAdding({ id: l.id, name: l.name ?? '', phone: l.phone_no ?? '' })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 10, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
                <Icon name="userPlus" size={12} color={C.orange} strokeWidth={2.2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.orange }}>Add Client</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
      {adding ? (
        <ClientFormSheet title="Add Referred Client" initFirst={splitName(adding.name).first} initLast={splitName(adding.name).last} initPhone={adding.phone} busy={addClient.isPending} onClose={() => setAdding(null)}
          onSubmit={(f) => { setErr(null); addClient.mutate({ leadId: adding.id, ...f }, { onSuccess: () => setAdding(null), onError: (e: any) => { setAdding(null); setErr(e?.message ?? 'Failed'); } }); }} />
      ) : null}
    </View>
  );
}

/* ---------------- Tab: Renewal Pay ---------------- */
const payStatusColor = (s: string | null) => (s === 'paid' ? C.green : s === 'awaiting_payment' ? C.blue : s === 'failed' || s === 'rejected' || s === 'cancelled' || s === 'expired' ? C.red : C.gold);
const methodLabel = (m: string | null) => (m === 'bank_transfer' ? 'Bank Transfer' : m === 'razorpay' ? 'Razorpay' : m === 'cash' ? 'Cash' : m ?? '—');
function RenewalPayTab({ profileId }: { profileId: string | null }) {
  const q = useRenewalPayRequests();
  const decide = useDecideRenewalPayment();
  const markPaid = useMarkRenewalCashPaid();
  const [act, setAct] = React.useState<{ action: 'approve' | 'reject'; id: string } | null>(null);
  const [payingId, setPayingId] = React.useState<string | null>(null);
  const [utr, setUtr] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.admin_decision === 'pending_admin');
  const history = rows.filter((r) => r.admin_decision !== 'pending_admin').slice(0, 20);
  const sel = act ? rows.find((r) => r.id === act.id) : null;
  const pkgLine = (r: (typeof rows)[number]) => (
    <Body style={{ fontSize: 11, color: C.muted2 }}>
      <Text style={{ color: C.ink2, fontFamily: F.bodySemi }}>→ {r.new_subscription_type ?? '—'}</Text>
      {r.new_sessions_per_cycle ? ` · ${r.new_sessions_per_cycle} sess` : ''}{r.new_cycle_type ? ` · ${r.new_cycle_type}` : ''}{r.new_package_amount ? ` · ₹${r.new_package_amount.toLocaleString('en-IN')}` : ''}
    </Body>
  );
  return (
    <View style={{ gap: 10 }}>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No renewal payment requests</Body>
      ) : (
        <>
          {pending.length > 0 ? <SectionHead label="PENDING APPROVAL" /> : null}
          {pending.map((r) => (
            <RequestCard key={r.id} status="pending" clientName={personName(r.client)} requesterName={personName(r.requester)} requestedAt={r.created_at}
              actions={<ApproveRejectRow busy={decide.isPending} onApprove={() => setAct({ action: 'approve', id: r.id })} onReject={() => setAct({ action: 'reject', id: r.id })} />}>
              {pkgLine(r)}
              <View style={{ flexDirection: 'row', gap: 6 }}><Badge text={methodLabel(r.payment_method)} color={C.blue} />{r.package_duration ? <Badge text={`${r.package_duration} month${r.package_duration === 1 ? '' : 's'}`} color={C.purple} /> : null}</View>
            </RequestCard>
          ))}
          {history.length > 0 ? <SectionHead label="HISTORY" /> : null}
          {history.map((r) => {
            const canMarkCash = (r.payment_method === 'cash' || r.payment_method === 'bank_transfer') && r.admin_decision === 'approved' && r.payment_status === 'awaiting_payment';
            const col = payStatusColor(r.payment_status);
            return (
              <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 7, borderLeftWidth: 3, borderLeftColor: col }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{personName(r.client)}</Body>
                  <Badge text={(r.payment_status ?? '—').replace('_', ' ')} color={col} />
                  <Badge text={methodLabel(r.payment_method)} color={C.blue} />
                </View>
                {pkgLine(r)}
                {r.package_duration ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Duration: <Text style={{ color: C.ink2 }}>{r.package_duration} month{r.package_duration === 1 ? '' : 's'}</Text></Body> : null}
                {r.cash_reference ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2 }}>{r.payment_method === 'bank_transfer' ? 'UTR / ref' : 'Cash ref'}: <Text style={{ color: C.ink2 }}>{r.cash_reference}</Text></Body> : null}
                {r.paid_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>PAID {fmtDay(r.paid_at).toUpperCase()}</Mono> : null}
                {canMarkCash ? (
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable onPress={() => { setPayingId(r.id); setUtr(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                      <Icon name="rupee" size={12} color={C.green} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>Mark Paid</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
      {act && sel ? (
        <ConfirmSheet action={act.action} title="Renewal Payment" clientName={personName(sel.client)} busy={decide.isPending} onClose={() => setAct(null)}
          onConfirm={(notes) => { setErr(null); decide.mutate({ requestId: sel.id, decision: act.action === 'approve' ? 'approved' : 'rejected', adminNotes: notes.trim() || undefined, profileId }, { onSuccess: () => setAct(null), onError: (e: any) => { setAct(null); setErr(e?.message ?? 'Failed'); } }); }} />
      ) : null}
      {payingId ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPayingId(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
              <Serif style={{ fontSize: 18 }}>Mark payment received</Serif>
              <Body style={{ fontSize: 11, color: C.muted2 }}>This marks the request as paid and updates the client's package immediately. This cannot be undone.</Body>
              <TextInput value={utr} onChangeText={setUtr} placeholder="UTR / cash reference (optional)" placeholderTextColor={C.muted3} style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={() => setPayingId(null)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>Cancel</Text>
                </Pressable>
                <Pressable disabled={markPaid.isPending} onPress={() => { setErr(null); markPaid.mutate({ requestId: payingId, cashReference: utr.trim() || null }, { onSuccess: () => setPayingId(null), onError: (e: any) => { setPayingId(null); setErr(e?.message ?? 'Failed'); } }); }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green }}>{markPaid.isPending ? 'Saving…' : 'Mark Paid'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/* ---------------- Tab: Invoice Raised (generate the payment) ---------------- */
function InvoiceRaisedTab({ profileId }: { profileId: string | null }) {
  const pendingQ = useInvoiceRaisedRows();
  const reqQ = useLeadInvoiceRequests();
  const generate = useGenerateLeadPayment();
  const retry = useRetryRazorpayLink();
  const markPaid = useMarkLeadInvoicePaid();
  const [sub, setSub] = React.useState<'pending' | 'processing' | 'done'>('pending');
  const [genLead, setGenLead] = React.useState<InvoiceRaisedLead | null>(null);
  const [method, setMethod] = React.useState<'razorpay' | 'cash' | 'bank_transfer'>('razorpay');
  const [genUrl, setGenUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const pending = pendingQ.data ?? [];
  const processing = (reqQ.data ?? []).filter((i) => ['awaiting_approval', 'awaiting_payment', 'failed'].includes(i.payment_status));
  const done = (reqQ.data ?? []).filter((i) => i.payment_status === 'paid');
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(([['pending', 'Pending', pending.length], ['processing', 'Processing', processing.length], ['done', 'Done', done.length]]) as ['pending' | 'processing' | 'done', string, number][]).map(([id, label, n]) => {
          const active = sub === id;
          return (
            <Pressable key={id} onPress={() => setSub(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{label}</Text>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: active ? C.orange : C.muted3 }}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <Err q={pendingQ} />
      <Err q={reqQ} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {genUrl ? (
        <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.35), gap: 4 }}>
          <Mono style={{ fontSize: 8.5, letterSpacing: 0.7, color: C.green }}>PAYMENT LINK GENERATED</Mono>
          <Text selectable style={{ fontFamily: F.body, fontSize: 11, color: C.ink2 }}>{genUrl}</Text>
        </View>
      ) : null}
      {sub === 'pending' ? (
        pendingQ.isPending ? <Loading /> : pending.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No invoices awaiting payment generation.</Body> :
        pending.map((l) => {
          const inv = l.invoice_details ?? {};
          return (
            <Card key={l.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.purple, 0.2)} radius={15} style={{ padding: 12, gap: 8, borderLeftWidth: 3, borderLeftColor: C.purple }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{l.name}</Body>
                {inv.subscription_type ? <Badge text={inv.subscription_type} color={C.gold} /> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {inv.amount ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Amount <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>₹{Number(inv.amount).toLocaleString('en-IN')}</Text></Body> : null}
                {inv.sessions_in_package ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Sessions <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{inv.sessions_in_package}</Text></Body> : null}
                {inv.complimentary_sessions ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Comp <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>+{inv.complimentary_sessions}</Text></Body> : null}
              </View>
              {inv.notes ? <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted2 }}>Ops notes: <Text style={{ color: C.ink2 }}>{inv.notes}</Text></Body> : null}
              {inv.raised_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>RAISED {fmtAt(inv.raised_at).toUpperCase()}</Mono> : null}
              <View style={{ flexDirection: 'row' }}>
                <Pressable disabled={!l.client_id} onPress={() => { setGenLead(l); setMethod('razorpay'); setGenUrl(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: hexA(C.purple, l.client_id ? 0.14 : 0.05), borderWidth: 1, borderColor: hexA(C.purple, l.client_id ? 0.45 : 0.15) }}>
                  <Icon name="rupee" size={13} color={l.client_id ? C.purple : C.muted3} strokeWidth={2.2} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: l.client_id ? C.purple : C.muted3 }}>Generate Payment</Text>
                </Pressable>
              </View>
            </Card>
          );
        })
      ) : (
        reqQ.isPending ? <Loading /> : (sub === 'processing' ? processing : done).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>Nothing here.</Body> :
        (sub === 'processing' ? processing : done).map((r) => {
          const col = payStatusColor(r.payment_status);
          return (
            <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 7, borderLeftWidth: 3, borderLeftColor: col }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.leadName ?? '—'}</Body>
                <Badge text={r.payment_status.replace('_', ' ')} color={col} />
                <Badge text={methodLabel(r.payment_method)} color={C.blue} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {r.new_subscription_type ? <Badge text={r.new_subscription_type} color={C.gold} /> : null}
                {r.new_package_amount ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>₹{r.new_package_amount.toLocaleString('en-IN')}</Body> : null}
                {r.session_package ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>{r.session_package} sessions</Body> : null}
              </View>
              {r.opsNotes ? <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2 }}>Ops: {r.opsNotes}</Body> : null}
              {r.paid_at ? <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: C.muted3 }}>PAID {fmtDay(r.paid_at).toUpperCase()}</Mono> : null}
              {sub === 'processing' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {r.payment_method === 'razorpay' ? (
                    <Pressable disabled={retry.isPending} onPress={() => { setErr(null); setGenUrl(null); retry.mutate(r.id, { onSuccess: (res) => setGenUrl(res.url), onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
                      <Icon name="swap" size={11} color={C.blue} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.blue }}>{retry.isPending ? 'Working…' : r.payment_status === 'failed' ? 'Retry link' : 'Regenerate link'}</Text>
                    </Pressable>
                  ) : (
                    <Pressable disabled={markPaid.isPending} onPress={() => { setErr(null); markPaid.mutate(r.id, { onError: (e: any) => setErr(e?.message ?? 'Failed') }); }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                      <Icon name="rupee" size={11} color={C.green} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>{markPaid.isPending ? 'Saving…' : 'Mark Cash Received'}</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
      {genLead ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setGenLead(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
              <Serif style={{ fontSize: 18 }}>Generate Payment</Serif>
              <Body style={{ fontSize: 11, color: C.muted2 }}>{genLead.name} · ₹{Number(genLead.invoice_details?.amount ?? 0).toLocaleString('en-IN')} · {genLead.invoice_details?.sessions_in_package} sessions · {genLead.invoice_details?.subscription_type ?? '—'}</Body>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['razorpay', 'cash', 'bank_transfer'] as const).map((m) => (
                  <Pressable key={m} onPress={() => setMethod(m)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11, backgroundColor: method === m ? hexA(C.purple, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: method === m ? hexA(C.purple, 0.5) : 'rgba(255,255,255,0.09)' }}>
                    <Text style={{ fontFamily: method === m ? F.bodyBold : F.bodySemi, fontSize: 10.5, color: method === m ? C.purple : C.muted }}>{methodLabel(m)}</Text>
                  </Pressable>
                ))}
              </View>
              <Body style={{ fontSize: 10, color: C.muted3 }}>{method === 'razorpay' ? 'Creates the payment link via Razorpay — the link is shown here to share with the client.' : 'Records an approved awaiting-payment request; use Mark Paid once money is received.'}</Body>
              <Pressable disabled={generate.isPending} onPress={() => {
                setErr(null);
                generate.mutate({ lead: genLead, method, profileId }, {
                  onSuccess: (res) => { setGenUrl(res.url); setGenLead(null); setSub('processing'); },
                  onError: (e: any) => { setGenLead(null); setErr(e?.message ?? 'Failed'); },
                });
              }} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(C.purple, generate.isPending ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(C.purple, generate.isPending ? 0.2 : 0.5) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: generate.isPending ? C.muted3 : C.purple }}>{generate.isPending ? 'Generating…' : 'Confirm & Generate'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/* ---------------- Tab: Paid Cancel ---------------- */
function PaidCancelTab() {
  const [filter, setFilter] = React.useState<'pending' | 'all'>('pending');
  const q = usePaidCancellations(filter);
  const approve = useApprovePaidCancellation();
  const reject = useRejectPaidCancellation();
  const [confirm, setConfirm] = React.useState<{ action: 'approve' | 'reject'; row: PaidCancellation } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(['pending', 'all'] as const).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, backgroundColor: filter === f ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: filter === f ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: filter === f ? F.bodyBold : F.bodySemi, fontSize: 11, color: filter === f ? C.orange : C.muted }}>{f === 'pending' ? 'Pending' : 'All'}</Text>
          </Pressable>
        ))}
      </View>
      <Err q={q} />
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {q.isPending ? <LoadState q={q} /> : rows.length === 0 ? (
        <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 20 }}>No paid cancellation requests.</Body>
      ) : rows.map((r) => {
        const col = r.admin_approval === 'approved' ? C.green : r.admin_approval === 'rejected' ? C.red : C.gold;
        return (
          <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={15} style={{ padding: 12, gap: 7, borderLeftWidth: 3, borderLeftColor: col }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{r.client_name}</Body>
              <Badge text={statusLabel(r.admin_approval)} color={col} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Body style={{ fontSize: 10.5, color: C.muted2 }}>Trainer <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{r.trainer_name}</Text></Body>
              {r.modality ? <Badge text={r.modality} color={C.blue} /> : null}
              {r.scheduled_datetime ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3 }}>{fmtAt(r.scheduled_datetime).toUpperCase()}</Mono> : null}
            </View>
            {r.cancellation_remark ? <Body numberOfLines={2} style={{ fontSize: 11, color: C.ink2, lineHeight: 15 }}>{r.cancellation_remark}</Body> : null}
            {r.cancellation_attachment_url ? (
              <Pressable onPress={() => Linking.openURL(r.cancellation_attachment_url!)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="file" size={11} color={C.blue} strokeWidth={2.2} />
                <Body style={{ fontSize: 10.5, color: C.blue }}>View attachment</Body>
              </Pressable>
            ) : null}
            {r.admin_approval === 'pending' ? (
              <ApproveRejectRow busy={approve.isPending || reject.isPending}
                onApprove={() => setConfirm({ action: 'approve', row: r })}
                onReject={() => setConfirm({ action: 'reject', row: r })} />
            ) : null}
          </Card>
        );
      })}
      {confirm ? (
        <ConfirmSheet action={confirm.action} title="Paid Cancellation" clientName={confirm.row.client_name} busy={approve.isPending || reject.isPending} onClose={() => setConfirm(null)}
          detail={<Body style={{ fontSize: 11, color: C.muted2 }}>{confirm.action === 'approve' ? 'Logs a cancelled paid session against the package and approves the request.' : 'Marks the request rejected — no session is recorded.'}</Body>}
          onConfirm={() => {
            setErr(null);
            const done = { onSuccess: () => setConfirm(null), onError: (e: any) => { setConfirm(null); setErr(e?.message ?? 'Failed'); } };
            if (confirm.action === 'approve') approve.mutate(confirm.row, done);
            else reject.mutate(confirm.row.id, done);
          }} />
      ) : null}
    </View>
  );
}

/* ---------------- Main page ---------------- */
type TabKey = 'newleads' | 'refleads' | 'renewalpay' | 'invoice' | 'paidcancel' | 'referrals' | 'upgrades' | 'renewals' | 'crosssell';

/* Distinct accent per approval queue — used by the summary chips + proportion bar. */
const QUEUE_COLORS: Record<TabKey, string> = {
  newleads: '#FB8B3A', refleads: '#9A7BEA', renewalpay: '#57C98A', invoice: '#7C8FE8',
  paidcancel: '#E0A53C', referrals: '#F687B3', upgrades: '#4FD1C5', renewals: '#F0883E', crosssell: '#C7CBD6',
};

/* Entrance rise-in + looping bell pulse for the summary hero. */
function SummaryRise({ children }: { children: React.ReactNode }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const a = Animated.timing(v, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
function BellPulse({ color, icon }: { color: string; icon: IconName }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(v, { toValue: 0, duration: 1, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }} />
      <LinearGradient colors={[hexA(color, 0.28), hexA(color, 0.08)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 42, height: 42, borderRadius: 15, borderWidth: 1, borderColor: hexA(color, 0.45), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={19} color={color} strokeWidth={2.1} />
      </LinearGradient>
    </View>
  );
}

const REQUEST_TABS: [TabKey, string, IconName][] = [
  ['newleads', 'New Leads', 'userPlus'],
  ['refleads', 'Ref Leads', 'route'],
  ['renewalpay', 'Renewal Pay', 'rupee'],
  ['invoice', 'Invoice Raised', 'file'],
  ['paidcancel', 'Paid Cancel', 'calendar'],
  ['referrals', 'Referrals', 'gift'],
  ['upgrades', 'Upgrades', 'trend'],
  ['renewals', 'Renewals', 'swap'],
  ['crosssell', 'Cross-Sell', 'layers'],
];

/* Pending counts across every approval queue (react-query dedupes with the tab badges). */
function useRequestCounts() {
  const nlQ = useAdminNewLeadRows();
  const rlQ = useReferredLeads();
  const rpQ = useRenewalPayRequests();
  const invQ = useInvoiceRaisedRows();
  const pcQ = usePaidCancellations('pending');
  const refQ = useAdminReferrals();
  const upQ = useAdminUpgradeRequests();
  const renQ = useAdminRenewalRequests();
  const csQ = useAdminCrossSellRequests();
  const counts: Record<TabKey, number> = {
    newleads: (nlQ.data ?? []).length,
    refleads: (rlQ.data ?? []).filter((l) => l.status === 'new').length,
    renewalpay: (rpQ.data ?? []).filter((r) => r.admin_decision === 'pending_admin').length,
    invoice: (invQ.data ?? []).length,
    paidcancel: (pcQ.data ?? []).length,
    referrals: (refQ.data ?? []).filter((r) => r.status === 'pending').length,
    upgrades: (upQ.data ?? []).filter((r) => r.status === 'pending').length,
    renewals: (renQ.data ?? []).filter((r) => r.request_status === 'pending').length,
    crosssell: (csQ.data ?? []).filter((r) => r.request_status === 'pending').length,
  };
  const totalPending = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
  const activeQueues = (Object.values(counts) as number[]).filter((n) => n > 0).length;
  const countsLoading = [nlQ, rlQ, rpQ, invQ, pcQ, refQ, upQ, renQ, csQ].some((q) => q.isPending);
  return { counts, totalPending, activeQueues, countsLoading };
}

/* Pending-approvals hero — shared by the Requests page and the admin dashboard.
   onOpen(tab?) fires on card / chip press; the host decides how to navigate. */
export function RequestsSummaryCard({ onOpen, activeTab }: { onOpen: (tab?: TabKey) => void; activeTab?: TabKey }) {
  const { counts, totalPending, activeQueues, countsLoading } = useRequestCounts();
  return (
    <SummaryRise>
      <Card onPress={() => onOpen()} colors={totalPending > 0 ? ['rgba(70,40,22,0.55)', 'rgba(20,16,15,0.6)'] : ['rgba(24,44,32,0.5)', 'rgba(18,20,16,0.55)']} border={hexA(totalPending > 0 ? C.orange : C.green, 0.26)} radius={20} style={{ overflow: 'hidden' }}>
        <LinearGradient colors={totalPending > 0 ? ['#E0A53C', '#FB8B3A', '#EE5E16'] : [hexA(C.green, 0.7), hexA(C.green, 0.2)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
        {/* soft corner glow */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -34, right: -34, width: 130, height: 130, borderRadius: 65, backgroundColor: hexA(totalPending > 0 ? C.orange : C.green, 0.07) }} />
        <View style={{ padding: 15, gap: 13 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <BellPulse color={totalPending > 0 ? C.orange : C.green} icon={totalPending > 0 ? 'bell' : 'checks'} />
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1.4, color: hexA(totalPending > 0 ? C.orange : C.green, 0.9) }}>PENDING APPROVALS</Mono>
              <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff', marginTop: 2 }}>
                {countsLoading ? 'Counting requests…' : totalPending > 0 ? `You have ${totalPending} pending request${totalPending === 1 ? '' : 's'}` : 'All caught up'}
              </Body>
              <Body style={{ fontSize: 10.5, color: C.muted3, marginTop: 1 }}>
                {countsLoading ? 'Checking every approval queue' : totalPending > 0 ? `Across ${activeQueues} queue${activeQueues === 1 ? '' : 's'} — tap one to jump in` : 'No approvals waiting in any queue'}
              </Body>
            </View>
            {countsLoading ? <ActivityIndicator color={C.orange} /> : totalPending > 0 ? (
              <View style={{ alignItems: 'center' }}>
                <CountUp value={totalPending} style={{ fontSize: 36, lineHeight: 40, color: C.orange, fontFamily: F.bodyBold }} />
                <Mono style={{ fontSize: 7, letterSpacing: 1, color: C.muted3 }}>PENDING</Mono>
              </View>
            ) : null}
          </View>

          {!countsLoading && totalPending > 0 ? (
            <>
              {/* proportion bar — each queue's share in its own color */}
              <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' }}>
                {REQUEST_TABS.filter(([id]) => counts[id] > 0).map(([id]) => (
                  <View key={id} style={{ flex: counts[id], backgroundColor: hexA(QUEUE_COLORS[id], 0.85), marginRight: 1 }} />
                ))}
              </View>
              {/* colored queue chips with icons */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {REQUEST_TABS.filter(([id]) => counts[id] > 0).map(([id, label, icon]) => {
                  const qc = QUEUE_COLORS[id];
                  const active = activeTab === id;
                  return (
                    <Pressable key={id} onPress={() => onOpen(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6.5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(qc, active ? 0.2 : 0.09), borderWidth: 1, borderColor: hexA(qc, active ? 0.6 : 0.3) }}>
                      <Icon name={icon} size={11.5} color={qc} strokeWidth={2.2} />
                      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? qc : C.muted }}>{label}</Text>
                      <View style={{ minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: qc, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: '#0c0808' }}>{counts[id]}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </View>
      </Card>
    </SummaryRise>
  );
}
export function AdminRequests() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  // Deep-link: dashboard alerts land on a specific queue (web setActiveTab parity).
  const { adminRequestsTab, set } = useStore();
  const VALID_TABS: TabKey[] = ['newleads', 'refleads', 'renewalpay', 'invoice', 'paidcancel', 'referrals', 'upgrades', 'renewals', 'crosssell'];
  const [tab, setTab] = React.useState<TabKey>(
    adminRequestsTab && VALID_TABS.includes(adminRequestsTab as TabKey) ? (adminRequestsTab as TabKey) : 'newleads'
  );
  React.useEffect(() => { if (adminRequestsTab) set({ adminRequestsTab: null }); }, []);

  // Pending counts for the tab badges (shared hook — react-query dedupes with the hero card).
  const { counts } = useRequestCounts();
  const TABS = REQUEST_TABS;

  return (
    <Page gap={13}>
      <TitleBlock title="Requests" sub="Every approval queue in one place" />

      {/* Pending summary — shared hero card; chips switch the local tab */}
      <RequestsSummaryCard activeTab={tab} onOpen={(t) => { if (t) setTab(t); }} />

      <HScroll gap={7}>
        {TABS.map(([id, label, icon]) => {
          const active = tab === id;
          const n = counts[id];
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Icon name={icon} size={12} color={active ? C.orange : C.muted} strokeWidth={2.2} />
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11.5, color: active ? C.orange : C.muted }}>{label}</Text>
              {n > 0 ? (
                <View style={{ minWidth: 18, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 99, backgroundColor: hexA(C.gold, 0.2) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: C.gold }}>{n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </HScroll>

      {tab === 'newleads' ? <NewLeadsTab profileId={profileId} /> :
        tab === 'refleads' ? <RefLeadsTab /> :
        tab === 'renewalpay' ? <RenewalPayTab profileId={profileId} /> :
        tab === 'invoice' ? <InvoiceRaisedTab profileId={profileId} /> :
        tab === 'paidcancel' ? <PaidCancelTab /> :
        tab === 'referrals' ? <ReferralsTab profileId={profileId} /> :
        tab === 'upgrades' ? <UpgradesTab profileId={profileId} /> :
        tab === 'renewals' ? <RenewalsTab profileId={profileId} /> :
        <CrossSellTab profileId={profileId} />}
    </Page>
  );
}
