import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, Modal } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, Badge, BackLink } from './common';
import { useAuth } from '../auth';
import { supabase } from '../lib/supabase';

/* ============ ADMIN — Churn Requests (web /admin/tools ChurnRequests port) ============ */

const nameOf = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || '—';
const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');

type ChurnRequest = {
  id: string; client_id: string; status: string; reason_category: string | null; reason_details: string | null;
  request_date: string | null; review_notes: string | null; reviewed_at: string | null;
  clients: { first_name: string | null; last_name: string | null; email: string | null } | null;
  requesterName: string; reviewerName: string | null;
};
function useChurnRequests() {
  return useQuery({
    queryKey: ['discontinuation-requests'],
    staleTime: 30_000,
    queryFn: async (): Promise<ChurnRequest[]> => {
      const { data, error } = await supabase.from('client_discontinuation_requests')
        .select('*, clients:client_id (first_name, last_name, email)')
        .order('request_date', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      // Single batched profile lookup (fixes the web's per-row N+1).
      const ids = [...new Set(rows.flatMap((r) => [r.requested_by, r.reviewed_by]).filter(Boolean))];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, first_name, last_name').in('id', ids);
        (ps ?? []).forEach((p: any) => names.set(p.id, nameOf(p)));
      }
      return rows.map((r) => ({ ...r, requesterName: r.requested_by ? names.get(r.requested_by) ?? '—' : '—', reviewerName: r.reviewed_by ? names.get(r.reviewed_by) ?? null : null }));
    },
  });
}
function useDiscontinuedClients() {
  return useQuery({
    queryKey: ['discontinued-clients'],
    staleTime: 30_000,
    queryFn: async () => {
      // clients has no discontinuation columns — reason/details/date come from the
      // latest 'discontinued' entry in client_status_history.
      const { data, error } = await supabase.from('clients')
        .select('id, first_name, last_name, email')
        .eq('status', 'discontinued');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const hist = new Map<string, any>();
      for (let i = 0; i < rows.length; i += 100) {
        const part = rows.slice(i, i + 100).map((c) => c.id);
        const { data: h } = await supabase.from('client_status_history')
          .select('client_id, reason, notes, created_at')
          .eq('new_status', 'discontinued').in('client_id', part)
          .order('created_at', { ascending: false });
        (h ?? []).forEach((r: any) => { if (!hist.has(r.client_id)) hist.set(r.client_id, r); });
      }
      return rows.map((c) => {
        const h = hist.get(c.id);
        return { ...c, discontinuation_reason: h?.reason ?? null, discontinuation_details: h?.notes ?? null, discontinued_date: h?.created_at ?? null };
      }).sort((a, b) => String(b.discontinued_date ?? '').localeCompare(String(a.discontinued_date ?? '')));
    },
  });
}
const invalidateChurn = (qc: ReturnType<typeof useQueryClient>) => {
  ['discontinuation-requests', 'discontinued-clients', 'clients', 'admin-clients', 'admin-clients-tab-counts'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
};
/* Approve/reject (web 3-step flow — no transaction, same as web). */
function useReviewChurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { req: ChurnRequest; approved: boolean; reviewNotes: string; profileId: string | null }) => {
      if (!input.profileId) throw new Error('Not authenticated');
      const { error } = await supabase.from('client_discontinuation_requests')
        .update({ status: input.approved ? 'approved' : 'rejected', reviewed_by: input.profileId, reviewed_at: new Date().toISOString(), review_notes: input.reviewNotes.trim() || null })
        .eq('id', input.req.id);
      if (error) throw new Error(error.message);
      if (input.approved) {
        const { data: cur } = await supabase.from('clients').select('status').eq('id', input.req.client_id).single();
        const { error: cErr } = await supabase.from('clients').update({ status: 'discontinued' }).eq('id', input.req.client_id);
        if (cErr) throw new Error(cErr.message);
        try {
          await supabase.from('client_status_history').insert({
            client_id: input.req.client_id, previous_status: (cur as any)?.status ?? null, new_status: 'discontinued',
            changed_by: input.profileId, reason: input.req.reason_category, discontinuation_request_id: input.req.id, notes: input.req.reason_details,
          } as any);
        } catch { /* best-effort (web logs the same way) */ }
      }
    },
    onSuccess: () => invalidateChurn(qc),
  });
}
function useReactivateChurned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; notes: string; profileId: string | null }) => {
      const { data: cur } = await supabase.from('clients').select('status').eq('id', input.clientId).single();
      const { error } = await supabase.from('clients').update({ status: 'active' }).eq('id', input.clientId);
      if (error) throw new Error(error.message);
      try {
        await supabase.from('client_status_history').insert({
          client_id: input.clientId, previous_status: (cur as any)?.status ?? null, new_status: 'active',
          changed_by: input.profileId, reason: 'Client reactivated', notes: input.notes.trim() || null,
        } as any);
      } catch { /* best-effort */ }
    },
    onSuccess: () => invalidateChurn(qc),
  });
}

function NotesSheet({ title, sub, cta, color, busy, onConfirm, onClose }: { title: string; sub: string; cta: string; color: string; busy: boolean; onConfirm: (notes: string) => void; onClose: () => void }) {
  const [notes, setNotes] = React.useState('');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 18 }}>{title}</Serif>
              <Body numberOfLines={1} style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{sub}</Body>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Notes (optional)…" placeholderTextColor={C.muted3}
            style={{ borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 11, paddingVertical: 10, color: '#fff', fontFamily: F.body, fontSize: 13, minHeight: 64, textAlignVertical: 'top' }} />
          <Pressable disabled={busy} onPress={() => onConfirm(notes)} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: hexA(color, busy ? 0.06 : 0.16), borderWidth: 1, borderColor: hexA(color, busy ? 0.2 : 0.5) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: busy ? C.muted3 : color }}>{busy ? 'Working…' : cta}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function AdminChurn() {
  const { session } = useAuth();
  const profileId = session?.user?.id ?? null;
  const q = useChurnRequests();
  const discQ = useDiscontinuedClients();
  const review = useReviewChurn();
  const reactivate = useReactivateChurned();
  const [tab, setTab] = React.useState<'pending' | 'processed' | 'discontinued'>('pending');
  const [dialog, setDialog] = React.useState<{ kind: 'approve' | 'reject'; req: ChurnRequest } | { kind: 'reactivate'; clientId: string; name: string } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  const processed = rows.filter((r) => r.status !== 'pending');
  const disc = discQ.data ?? [];

  return (
    <Page gap={13}>
      <BackLink label="Tools" />
      <TitleBlock title="Churn Requests" sub="Review discontinuation requests & reactivate clients" />
      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(([['pending', `Pending${pending.length ? ` (${pending.length})` : ''}`], ['processed', 'Processed'], ['discontinued', 'Discontinued']]) as [typeof tab, string][]).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.5) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 11, color: active ? C.orange : C.muted }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {err ? <Body style={{ fontSize: 10.5, color: C.red, textAlign: 'center' }}>{err}</Body> : null}
      {(tab === 'discontinued' ? discQ : q).isPending ? <View style={{ paddingVertical: 26, alignItems: 'center' }}><ActivityIndicator color={C.orange} /></View>
      : (tab === 'discontinued' ? discQ : q).isError ? <Body style={{ fontSize: 11, color: C.red, textAlign: 'center' }}>{((tab === 'discontinued' ? discQ : q).error as Error).message}</Body>
      : tab === 'discontinued' ? (
        disc.length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No discontinued clients.</Body>
        : disc.map((c: any) => (
          <Card key={c.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(C.red, 0.16)} radius={14} style={{ padding: 12, gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{nameOf(c)}</Body>
              {c.discontinued_date ? <Mono style={{ fontSize: 7.5, letterSpacing: 0.4, color: C.muted3 }}>{fmtAt(c.discontinued_date).toUpperCase()}</Mono> : null}
            </View>
            {c.discontinuation_reason ? <View style={{ flexDirection: 'row' }}><Badge text={c.discontinuation_reason} color={C.gold} /></View> : null}
            {c.discontinuation_details ? <Body numberOfLines={2} style={{ fontSize: 10.5, color: C.muted2 }}>{c.discontinuation_details}</Body> : null}
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => setDialog({ kind: 'reactivate', clientId: c.id, name: nameOf(c) })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                <Icon name="swap" size={12} color={C.green} strokeWidth={2.2} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: C.green }}>Reactivate</Text>
              </Pressable>
            </View>
          </Card>
        ))
      ) : (
        (tab === 'pending' ? pending : processed).length === 0 ? <Body style={{ fontSize: 11.5, color: C.muted3, textAlign: 'center', paddingVertical: 18 }}>No {tab} requests.</Body>
        : (tab === 'pending' ? pending : processed).map((r) => {
          const col = r.status === 'approved' ? C.green : r.status === 'rejected' ? C.red : C.gold;
          return (
            <Card key={r.id} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} border={hexA(col, 0.2)} radius={14} style={{ padding: 12, gap: 7, borderLeftWidth: 3, borderLeftColor: col }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Body numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{nameOf(r.clients)}</Body>
                <Badge text={r.status} color={col} />
              </View>
              <Body style={{ fontSize: 10.5, color: C.muted2 }}>Requested by <Text style={{ color: C.ink2, fontFamily: F.bodySemi }}>{r.requesterName}</Text>{r.request_date ? ` · ${fmtAt(r.request_date)}` : ''}</Body>
              {r.reason_category ? <View style={{ flexDirection: 'row' }}><Badge text={r.reason_category} color={C.gold} /></View> : null}
              {r.reason_details ? <Body numberOfLines={3} style={{ fontSize: 11, color: C.ink2, lineHeight: 15 }}>{r.reason_details}</Body> : null}
              {tab === 'processed' ? (
                <>
                  {r.reviewerName ? <Body style={{ fontSize: 10, color: C.muted3 }}>Reviewed by {r.reviewerName}{r.reviewed_at ? ` · ${fmtAt(r.reviewed_at)}` : ''}</Body> : null}
                  {r.review_notes ? <Body style={{ fontSize: 10.5, color: C.muted2 }}>Notes: <Text style={{ color: C.ink2 }}>{r.review_notes}</Text></Body> : null}
                </>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable disabled={review.isPending} onPress={() => setDialog({ kind: 'approve', req: r })} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.green, 0.12), borderWidth: 1, borderColor: hexA(C.green, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.green }}>Approve</Text>
                  </Pressable>
                  <Pressable disabled={review.isPending} onPress={() => setDialog({ kind: 'reject', req: r })} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.red }}>Reject</Text>
                  </Pressable>
                </View>
              )}
            </Card>
          );
        })
      )}
      {dialog?.kind === 'approve' || dialog?.kind === 'reject' ? (
        <NotesSheet title={dialog.kind === 'approve' ? 'Approve discontinuation' : 'Reject request'} sub={nameOf(dialog.req.clients)}
          cta={dialog.kind === 'approve' ? 'Approve & discontinue client' : 'Reject request'} color={dialog.kind === 'approve' ? C.green : C.red} busy={review.isPending} onClose={() => setDialog(null)}
          onConfirm={(notes) => { setErr(null); review.mutate({ req: dialog.req, approved: dialog.kind === 'approve', reviewNotes: notes, profileId }, { onSuccess: () => setDialog(null), onError: (e: any) => { setDialog(null); setErr(e?.message ?? 'Failed'); } }); }} />
      ) : dialog?.kind === 'reactivate' ? (
        <NotesSheet title="Reactivate client" sub={dialog.name} cta="Reactivate" color={C.green} busy={reactivate.isPending} onClose={() => setDialog(null)}
          onConfirm={(notes) => { setErr(null); reactivate.mutate({ clientId: dialog.clientId, notes, profileId }, { onSuccess: () => setDialog(null), onError: (e: any) => { setDialog(null); setErr(e?.message ?? 'Failed'); } }); }} />
      ) : null}
    </Page>
  );
}
