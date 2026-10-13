/* ============ CRM Doctor Consultation (6 Oct 2026) ============
   Port of hub-track pages/crm/CRMDoctorConsultation.tsx + CRMDoctorConsultationClient.tsx
   data: the CRM's clients with their blood / record / remark counts (from the
   DB-maintained crm_clients_medical_history row), consultant slots for those
   clients, the Consultation Tracker derivation (lib/consultationTracker.ts rules),
   the client page's record (AI summary + remarks), the booking / reschedule /
   cancel / approve / follow-up writes (RPC or policy-allowed columns only) and
   the Gemini summary edge function. Slot types and helpers come from
   consultantQueries.ts so the CRM and the consultant read the same rows. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { invokeFn } from './doctorQueries';
import {
  ConsultationSlot, CallRow, SLOT_SELECT, invalidateSlots, isSlotElapsed, parseNextFollowUp, NextFollowUp, ymdLocal,
} from './consultantQueries';

const run = <T,>(p: PromiseLike<T>, label: string) => withTimeout(Promise.resolve(p) as Promise<T>, NET_MS, label);
const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();

/* ---------- consultant doctor rule (web isConsultantDoctor) ---------- */
export type ConsultantDoctor = { id: string; name: string };
export const isConsultantProfile = (p: { role?: string | null; doctor_specialization_tag?: string | null; role_specialization?: unknown; specializations?: string | null }) => {
  if (String(p.role ?? '').toLowerCase() !== 'doctor') return false;
  const tag = String(p.doctor_specialization_tag ?? '').toLowerCase();
  const spec = Array.isArray(p.role_specialization) ? p.role_specialization.map((s) => String(s).toLowerCase()) : [];
  const free = String(p.specializations ?? '').toLowerCase();
  return tag.includes('consultant') || spec.some((s) => s.includes('consultant')) || free.includes('consultant');
};
export function useConsultantDoctors() {
  return useQuery({
    queryKey: ['consultant-doctors'],
    staleTime: 300_000,
    queryFn: async (): Promise<ConsultantDoctor[]> => {
      const { data, error } = await run(supabase.from('profiles').select('id, first_name, last_name, role, doctor_specialization_tag, role_specialization, specializations').eq('role', 'doctor'), 'Doctors');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).filter(isConsultantProfile).map((p) => ({ id: p.id, name: fullName(p) || 'Doctor' })).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------- Clients tab ---------- */
export type ConsultClientRow = {
  id: string; name: string; email: string | null; phone: string | null; status: string | null; subscription: string | null;
  bloodCount: number; recordCount: number; noteCount: number; hasRecordRow: boolean;
};
export function useConsultClients(crmId: string | null) {
  return useQuery({
    queryKey: ['crm-doctor-clients', crmId],
    enabled: !!crmId,
    staleTime: 60_000,
    queryFn: async (): Promise<ConsultClientRow[]> => {
      const { data: tc, error: tErr } = await run(supabase.from('trainer_clients').select('client_id').eq('trainer_id', crmId!).eq('actively_training', true), 'Assignments');
      if (tErr) throw new Error(tErr.message);
      const ids = [...new Set((tc ?? []).map((r: any) => r.client_id).filter(Boolean))] as string[];
      if (!ids.length) return [];
      const [cR, mR] = await Promise.all([
        run(supabase.from('clients').select('id, first_name, last_name, email, phone, status, subscription_type').in('id', ids), 'Clients'),
        run(supabase.from('crm_clients_medical_history').select('client_id, health_reports, client_medical_history, remarks').in('client_id', ids), 'Medical records'),
      ]);
      if (cR.error) throw new Error(cR.error.message);
      const rec = new Map<string, any>(((mR.error ? [] : mR.data) ?? []).map((r: any) => [r.client_id, r]));
      return ((cR.data ?? []) as any[]).map((c) => {
        const r = rec.get(c.id);
        return {
          id: c.id, name: fullName(c) || 'Client', email: c.email ?? null, phone: c.phone ?? null, status: c.status ?? null, subscription: c.subscription_type ?? null,
          bloodCount: Array.isArray(r?.health_reports) ? r.health_reports.length : 0,
          recordCount: Array.isArray(r?.client_medical_history) ? r.client_medical_history.length : 0,
          noteCount: Array.isArray(r?.remarks) ? r.remarks.length : 0,
          hasRecordRow: !!r,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* ---------- Slots ---------- */
export function useConsultSlotsForClients(clientIds: string[]) {
  const ids = [...new Set(clientIds)].sort();
  return useQuery({
    queryKey: ['consultation-slots-for-clients', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ConsultationSlot[]> => {
      const out: ConsultationSlot[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await run(supabase.from('doctor_consultation_details').select(SLOT_SELECT).in('client_id', ids.slice(i, i + 100)).order('consultation_date', { ascending: false }).order('start_time', { ascending: false }), 'Consultations');
        if (error) throw new Error(error.message);
        out.push(...((data ?? []) as unknown as ConsultationSlot[]));
      }
      return out;
    },
  });
}
export function useConsultSlots(clientId: string | null) {
  return useQuery({
    queryKey: ['consultation-slots', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<ConsultationSlot[]> => {
      const { data, error } = await run(supabase.from('doctor_consultation_details').select(SLOT_SELECT).eq('client_id', clientId!).order('consultation_date', { ascending: false }).order('start_time', { ascending: false }), 'Consultations');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ConsultationSlot[];
    },
  });
}
/** One call's record: the heavy columns fetched only when the popup opens. */
export type TranscriptChunk = { speaker?: string | null; role?: string | null; name?: string | null; text?: string | null; content?: string | null; at?: string | null; t?: number | null; start?: number | null };
export type ConsultRecord = CallRow & { transcript: TranscriptChunk[] | null; referral: { speciality?: string | null; reason?: string | null } | null };
export function useConsultRecord(slotId: string | null) {
  return useQuery({
    queryKey: ['consultation-room-slot', slotId],
    enabled: !!slotId,
    staleTime: 30_000,
    queryFn: async (): Promise<ConsultRecord> => {
      const { data, error } = await run(supabase.from('doctor_consultation_details').select(`${SLOT_SELECT}, transcript, ai_notes, meeting_summary, edit_history, referral`).eq('id', slotId!).maybeSingle(), 'Consultation record');
      if (error) throw new Error(error.message);
      if (!data) throw new Error('This booking no longer exists.');
      const d = data as any;
      return { ...d, transcript: Array.isArray(d.transcript) ? d.transcript : null } as ConsultRecord;
    },
  });
}

/* ---------- Client page: the CRM record (AI summary + remarks), reports, journey ---------- */
export type ConsultRemark = { id: string; text: string; by: string | null; by_name: string | null; at: string };
export type AiSummary = { overview?: string; blood_key_points?: string[]; medical_key_points?: string[]; concerns?: string[]; recommendations?: string[]; generated_at?: string; model?: string } | null;
export type CrmMedicalRecord = { client_id: string; crm_id: string | null; remarks: ConsultRemark[]; ai_summary: AiSummary; bloodIds: string[]; recordIds: string[] } | null;
export function useCrmMedicalRecord(clientId: string | null) {
  return useQuery({
    queryKey: ['crm-medical-records', clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<CrmMedicalRecord> => {
      const { data, error } = await run(supabase.from('crm_clients_medical_history').select('client_id, crm_id, remarks, ai_summary, health_reports, client_medical_history').eq('client_id', clientId!).maybeSingle(), 'Medical record');
      if (error) throw new Error(error.message);
      if (!data) return null;
      const d = data as any;
      return {
        client_id: d.client_id, crm_id: d.crm_id ?? null,
        remarks: (Array.isArray(d.remarks) ? d.remarks : []).filter((r: any) => r && typeof r === 'object').map((r: any) => ({ id: String(r.id ?? r.at ?? Math.random()), text: String(r.text ?? ''), by: r.by ?? null, by_name: r.by_name ?? null, at: String(r.at ?? '') })),
        ai_summary: d.ai_summary && typeof d.ai_summary === 'object' ? d.ai_summary : null,
        bloodIds: Array.isArray(d.health_reports) ? d.health_reports : [],
        recordIds: Array.isArray(d.client_medical_history) ? d.client_medical_history : [],
      };
    },
  });
}
export type BloodReport = { id: string; name: string; type: string | null; date: string | null; fileUrl: string | null; metabolic: number | null; longevity: number | null };
export function useClientBloodReports(clientId: string | null) {
  return useQuery({
    queryKey: ['client-reports', clientId, 'consult'],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<BloodReport[]> => {
      const { data, error } = await run(supabase.from('health_reports').select('id, report_name, report_type, test_date, upload_date, file_url, metabolic_score, longevity_score, is_active').eq('client_id', clientId!).order('test_date', { ascending: false }), 'Blood reports');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).filter((h) => h.is_active !== false).map((h) => ({
        id: h.id, name: h.report_name || h.report_type || 'Health report', type: h.report_type ?? null,
        date: (h.test_date || h.upload_date || null) ? String(h.test_date || h.upload_date).slice(0, 10) : null,
        fileUrl: h.file_url ?? null, metabolic: h.metabolic_score ?? null, longevity: h.longevity_score ?? null,
      }));
    },
  });
}

/* ---------- Writes ---------- */
const notifyBooked = async (slotId: string, rescheduled = false) => {
  try { await invokeFn('notify-consultation-booked', rescheduled ? { slotId, rescheduled: true } : { slotId }); } catch { /* push is best effort */ }
};
export type BookSlotInput = { clientId: string; doctorId: string; bookedBy: string; date: string; start: string; end: string; description: string | null };
/** Book: INSERT (policy: booked_by = me, role crm, active assignment) then provision the 100ms room; the booking stands even if the room fails. */
export function useBookConsultSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: BookSlotInput): Promise<{ slotId: string; linkCreated: boolean }> => {
      const { data, error } = await run(supabase.from('doctor_consultation_details').insert({
        client_id: i.clientId, doctor_id: i.doctorId, booked_by: i.bookedBy, consultation_date: i.date, start_time: i.start, end_time: i.end, description: i.description, status: 'scheduled',
      }).select('id').single(), 'Book consultation');
      if (error) throw new Error(error.message);
      const slotId = (data as any).id as string;
      let linkCreated = false;
      try {
        const res = await invokeFn('provision-consultation-room', { slotId });
        linkCreated = !res.error && (res.data as any)?.ok !== false;
      } catch { linkCreated = false; }
      await notifyBooked(slotId);
      return { slotId, linkCreated };
    },
    onSettled: () => invalidateSlots(qc),
  });
}
/** Any CRM may move a scheduled call (RPC reschedule_consultation_slot, 5 Oct 2026). */
export function useRescheduleConsultSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { slotId: string; date: string; start: string; end: string; reason: string | null }) => {
      const { data, error } = await run(supabase.rpc('reschedule_consultation_slot', { p_slot_id: i.slotId, p_date: i.date, p_start: i.start, p_end: i.end, p_reason: i.reason }), 'Reschedule');
      if (error) throw new Error(error.message);
      await notifyBooked(i.slotId, true);
      return data;
    },
    onSettled: () => invalidateSlots(qc),
  });
}
/** The CRM's approval: locks the prescription and shows it to the client. */
export function useApprovePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { slotId: string; note: string | null }) => {
      const { data, error } = await run(supabase.rpc('approve_prescription', { p_slot_id: i.slotId, p_note: i.note }), 'Approve prescription');
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: () => { invalidateSlots(qc); qc.invalidateQueries({ queryKey: ['consultation-room-slot'] }); },
  });
}
/** The mandatory "next follow-up" answer when the CRM leaves a call. */
export function useSetNextFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { slotId: string; date: string | null; notDecided: boolean; note: string | null }) => {
      const { data, error } = await run(supabase.rpc('consultation_set_next_follow_up', { _slot_id: i.slotId, _date: i.date, _not_decided: i.notDecided, _note: i.note }), 'Next follow-up');
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: () => invalidateSlots(qc),
  });
}
/** CRM remark: append to crm_clients_medical_history.remarks (the only column the CRM writes on that row). */
export function useAddConsultRemark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { clientId: string; text: string; by: string; byName: string }) => {
      const { data, error } = await run(supabase.from('crm_clients_medical_history').select('remarks').eq('client_id', i.clientId).maybeSingle(), 'Remarks');
      if (error) throw new Error(error.message);
      const prev = Array.isArray((data as any)?.remarks) ? (data as any).remarks : [];
      const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: i.text.trim(), by: i.by, by_name: i.byName, at: new Date().toISOString() };
      const next = [...prev, entry];
      const { error: uErr } = await run(supabase.from('crm_clients_medical_history').upsert({ client_id: i.clientId, remarks: next, updated_at: new Date().toISOString() }, { onConflict: 'client_id' }), 'Save remark');
      if (uErr) throw new Error(uErr.message);
      return entry;
    },
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['crm-medical-records', v.clientId] }); qc.invalidateQueries({ queryKey: ['crm-doctor-clients'] }); },
  });
}
/** Gemini summary through the edge function; the function caches into ai_summary. */
export function useGenerateAiSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { clientId: string; force: boolean }) => {
      const res = await invokeFn('crm-medical-ai-summary', { clientId: i.clientId, force: i.force });
      if (res.error) {
        const ctx: Response | undefined = (res.error as any)?.context;
        let msg = res.error.message ?? 'Could not generate the summary';
        try { const j = await ctx?.clone().json(); if (j?.error) msg = String(j.error); } catch { /* keep */ }
        if (ctx?.status === 422 || /no reports found/i.test(msg)) throw new Error('No reports found for this client yet.');
        throw new Error(msg);
      }
      return res.data as { summary: AiSummary; cached: boolean };
    },
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: ['crm-medical-records', v.clientId] }),
  });
}

/** The signed-in CRM's display name (stamped on remarks). */
export function useMyName(uid: string | null) {
  return useQuery({
    queryKey: ['my-name', uid],
    enabled: !!uid,
    staleTime: Infinity,
    queryFn: async (): Promise<string> => {
      const { data } = await run(supabase.from('profiles').select('first_name, last_name').eq('id', uid!).maybeSingle(), 'Profile');
      return fullName(data) || 'CRM';
    },
  });
}

/* ---------- Consultation Tracker (port of web lib/consultationTracker.ts rules) ---------- */
export const FOLLOW_UP_DAYS = 30;
export type TrackerStatus = 'overdue' | 'due' | 'on_track' | 'upcoming' | 'not_started';
export type TrackerRow = {
  client: ConsultClientRow;
  first: ConsultationSlot | null;
  last: ConsultationSlot | null;
  held: number;
  next: ConsultationSlot | null;
  dueDate: string | null; // YYYY-MM-DD
  daysOver: number; // > 0 overdue, 0 due today, < 0 days left
  status: TrackerStatus;
  plannedFollowUp: NextFollowUp | null;
};
const slotStartMs = (s: ConsultationSlot) => Date.parse(`${s.consultation_date}T${s.start_time}`);
const addDaysYmd = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return ymdLocal(d); };
const dayDiff = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 864e5);
/** held = completed, or scheduled and elapsed (the doctor never pressed Complete); cancelled never counts. */
export const isHeldSlot = (s: ConsultationSlot, now: number) => s.status === 'completed' || (s.status === 'scheduled' && isSlotElapsed(s, now));
export const isUpcomingSlot = (s: ConsultationSlot, now: number) => s.status === 'scheduled' && !isSlotElapsed(s, now);
export function deriveTrackerRow(client: ConsultClientRow, slots: ConsultationSlot[], now: number = Date.now()): TrackerRow {
  const mine = slots.filter((s) => s.client_id === client.id);
  const held = mine.filter((s) => isHeldSlot(s, now)).sort((a, b) => slotStartMs(a) - slotStartMs(b));
  const upcoming = mine.filter((s) => isUpcomingSlot(s, now)).sort((a, b) => slotStartMs(a) - slotStartMs(b));
  const first = held[0] ?? null;
  const last = held[held.length - 1] ?? null;
  const next = upcoming[0] ?? null;
  const today = ymdLocal(new Date(now));
  const dueDate = last ? addDaysYmd(last.consultation_date, FOLLOW_UP_DAYS) : null;
  const daysOver = dueDate ? dayDiff(today, dueDate) : 0;
  const status: TrackerStatus = next ? 'upcoming' : !last ? 'not_started' : daysOver > 0 ? 'overdue' : daysOver === 0 ? 'due' : 'on_track';
  // The CRM's plan from leaving the last call: the most recent non-cancelled slot with an answer, by start.
  const planned = [...mine].filter((s) => s.status !== 'cancelled').sort((a, b) => slotStartMs(b) - slotStartMs(a)).map((s) => parseNextFollowUp(s.next_follow_up)).find(Boolean) ?? null;
  return { client, first, last, held: held.length, next, dueDate, daysOver, status, plannedFollowUp: planned };
}
const ORDER: Record<TrackerStatus, number> = { overdue: 0, due: 1, on_track: 2, upcoming: 3, not_started: 4 };
export function deriveTracker(clients: ConsultClientRow[], slots: ConsultationSlot[], now: number = Date.now()): TrackerRow[] {
  return clients.map((c) => deriveTrackerRow(c, slots, now)).sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    if (a.status === 'overdue') return b.daysOver - a.daysOver;
    if (a.status === 'on_track') return a.daysOver - b.daysOver; // closest to due first
    if (a.status === 'upcoming') return slotStartMs(a.next!) - slotStartMs(b.next!);
    return a.client.name.localeCompare(b.client.name);
  });
}
export const trackerCounts = (rows: TrackerRow[]) => ({
  clients: rows.length,
  overdue: rows.filter((r) => r.status === 'overdue').length,
  due: rows.filter((r) => r.status === 'due').length,
  upcoming: rows.filter((r) => r.status === 'upcoming').length,
  onTrack: rows.filter((r) => r.status === 'on_track').length,
  notStarted: rows.filter((r) => r.status === 'not_started').length,
});
/** The CRM home banner + drawer count: overdue and due-today rows. */
export function useConsultationFollowUpsDue(crmId: string | null) {
  const clientsQ = useConsultClients(crmId);
  const ids = (clientsQ.data ?? []).map((c) => c.id);
  const slotsQ = useConsultSlotsForClients(ids);
  const rows = clientsQ.data && slotsQ.data ? deriveTracker(clientsQ.data, slotsQ.data).filter((r) => r.status === 'overdue' || r.status === 'due') : [];
  return { rows, loading: clientsQ.isPending || (ids.length > 0 && slotsQ.isPending) };
}
