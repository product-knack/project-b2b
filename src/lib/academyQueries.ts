import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============================================================================
   Academy Management — staff-only module (profiles.role ∈ {admin, academy}).
   RLS on every academy_* table is gated by has_academy_mgmt_access(auth.uid()),
   so these plain table reads/writes are already scoped server-side.

   Single source of truth for attendance maths (web parity):
     weighted = present*1 + late*0.5      (absent + leave = 0)
     pct      = round(weighted / total * 100)
   Anything under 75% is flagged in reports.
   ========================================================================== */

export const ATT_STATUSES = ['present', 'absent', 'late', 'leave'] as const;
export type AttStatus = (typeof ATT_STATUSES)[number];
export const LOW_ATTENDANCE_PCT = 75;

export const attWeight = (s: string) => (s === 'present' ? 1 : s === 'late' ? 0.5 : 0);
export const attPct = (rows: { status: string }[]) => {
  if (!rows.length) return 0;
  const weighted = rows.reduce((n, r) => n + attWeight(r.status), 0);
  return Math.round((weighted / rows.length) * 100);
};

/* IST day helpers — the academy runs on IST dates (schedule + attendance are date-only). */
export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const istDaysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
export const prettyDate = (ymd: string | null) => {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
};

/* ---------- Users (students / teachers) ---------- */
export type AcademyUser = {
  id: string; name: string; email: string | null; phone: string | null;
  role: 'student' | 'teacher' | 'admin'; roll_no: string | null; status: 'active' | 'inactive';
};
export function useAcademyUsers(role: 'student' | 'teacher', includeInactive = true) {
  return useQuery({
    queryKey: ['academy-users', role],
    staleTime: 60_000,
    queryFn: async (): Promise<AcademyUser[]> => {
      const { data, error } = await supabase
        .from('academy_users')
        .select('id, name, email, phone, role, roll_no, status')
        .eq('role', role)
        .order('name');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as AcademyUser[];
      return includeInactive ? rows : rows.filter((r) => r.status === 'active');
    },
  });
}

export function useSaveAcademyUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AcademyUser> & { role: 'student' | 'teacher' }) => {
      const payload: Record<string, any> = {
        name: (input.name ?? '').trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        role: input.role,
        roll_no: input.roll_no?.trim() || null,
        status: input.status ?? 'active',
      };
      if (!payload.name) throw new Error('Name is required');
      if (input.id) {
        const { error } = await supabase.from('academy_users').update(payload).eq('id', input.id);
        if (error) throw new Error(error.message);
        return input.id;
      }
      const { data, error } = await supabase.from('academy_users').insert(payload).select('id').single();
      if (error) throw new Error(error.message);
      return (data as any).id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academy-users'] }); qc.invalidateQueries({ queryKey: ['academy-overview'] }); },
  });
}

/* Soft delete (web parity): the row is never removed, only deactivated. */
export function useSoftDeleteAcademyUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('academy_users').update({ status: 'inactive' }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academy-users'] }); qc.invalidateQueries({ queryKey: ['academy-overview'] }); },
  });
}

/* ---------- Batches (with teachers + enrolled counts) ---------- */
export type BatchTeacher = { id: string; name: string; isPrimary: boolean };
export type AcademyBatch = {
  id: string; course_name: string; batch_name: string; start_date: string | null; end_date: string | null;
  schedule: { days?: string[]; time?: string } | null; status: string;
  teachers: BatchTeacher[]; enrolled: number;
};
export function useAcademyBatches() {
  return useQuery({
    queryKey: ['academy-batches'],
    staleTime: 60_000,
    queryFn: async (): Promise<AcademyBatch[]> => {
      const { data: batches, error } = await supabase
        .from('academy_batches')
        .select('id, course_name, batch_name, teacher_id, start_date, end_date, schedule, status')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (batches ?? []) as any[];
      if (!rows.length) return [];
      const ids = rows.map((b) => b.id);
      const [jt, enr, teachers] = await Promise.all([
        supabase.from('academy_batch_teachers').select('batch_id, teacher_id, is_primary').in('batch_id', ids),
        supabase.from('academy_enrollments').select('batch_id, status').in('batch_id', ids),
        supabase.from('academy_users').select('id, name').eq('role', 'teacher'),
      ]);
      const nameById = new Map<string, string>(((teachers.data ?? []) as any[]).map((t) => [t.id, t.name]));
      const byBatch = new Map<string, BatchTeacher[]>();
      ((jt.data ?? []) as any[]).forEach((r) => {
        if (!byBatch.has(r.batch_id)) byBatch.set(r.batch_id, []);
        byBatch.get(r.batch_id)!.push({ id: r.teacher_id, name: nameById.get(r.teacher_id) ?? 'Teacher', isPrimary: !!r.is_primary });
      });
      const enrolled = new Map<string, number>();
      ((enr.data ?? []) as any[]).forEach((r) => {
        if (r.status !== 'active') return;
        enrolled.set(r.batch_id, (enrolled.get(r.batch_id) ?? 0) + 1);
      });
      return rows.map((b) => {
        // Primary first, then alphabetical (web ordering). Legacy teacher_id is a
        // trigger-maintained mirror of the primary — used only as a fallback.
        let list = (byBatch.get(b.id) ?? []).sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.name.localeCompare(y.name));
        if (!list.length && b.teacher_id) list = [{ id: b.teacher_id, name: nameById.get(b.teacher_id) ?? 'Teacher', isPrimary: true }];
        return {
          id: b.id, course_name: b.course_name ?? '', batch_name: b.batch_name ?? '',
          start_date: b.start_date, end_date: b.end_date, schedule: b.schedule ?? null,
          status: b.status ?? 'active', teachers: list, enrolled: enrolled.get(b.id) ?? 0,
        };
      });
    },
  });
}

/* Atomic batch upsert + teacher-junction sync (live-verified RPC). */
export function useSaveBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string | null;
      payload: { course_name: string; batch_name: string; start_date: string | null; end_date: string | null; schedule: any; status: string };
      teacherIds: string[]; primaryId: string | null;
    }) => {
      const { data, error } = await supabase.rpc('save_batch_with_teachers', {
        p_batch_id: input.id ?? null,
        p_payload: input.payload,
        p_teacher_ids: input.teacherIds,
        p_primary_id: input.primaryId,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academy-batches'] }); qc.invalidateQueries({ queryKey: ['academy-overview'] }); },
  });
}

export function useSetBatchTeachers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; teacherIds: string[]; primaryId: string | null }) => {
      const { error } = await supabase.rpc('set_batch_teachers', {
        p_batch_id: input.batchId, p_teacher_ids: input.teacherIds, p_primary_id: input.primaryId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['academy-batches'] }),
  });
}

/* Hard delete (web parity) — cascades to enrollments/attendance/assessments. */
export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase.from('academy_batches').delete().eq('id', batchId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academy-batches'] }); qc.invalidateQueries({ queryKey: ['academy-overview'] }); },
  });
}

/* ---------- Enrollments ---------- */
export type EnrolledStudent = { studentId: string; name: string; rollNo: string | null };
export function useBatchStudents(batchId: string | null) {
  return useQuery({
    queryKey: ['academy-batch-students', batchId],
    enabled: !!batchId,
    staleTime: 30_000,
    queryFn: async (): Promise<EnrolledStudent[]> => {
      const { data, error } = await supabase
        .from('academy_enrollments')
        .select('student_id, status')
        .eq('batch_id', batchId!)
        .eq('status', 'active');
      if (error) throw new Error(error.message);
      const ids = [...new Set(((data ?? []) as any[]).map((r) => r.student_id))];
      if (!ids.length) return [];
      const { data: us } = await supabase.from('academy_users').select('id, name, roll_no, status').in('id', ids);
      return ((us ?? []) as any[])
        .filter((u) => u.status === 'active')
        .map((u) => ({ studentId: u.id, name: u.name, rollNo: u.roll_no }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/* Per-student active enrollment counts (Students tab column). */
export function useEnrollmentCounts() {
  return useQuery({
    queryKey: ['academy-enrollment-counts'],
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('academy_enrollments').select('student_id, status');
      if (error) throw new Error(error.message);
      const out: Record<string, number> = {};
      ((data ?? []) as any[]).forEach((r) => { if (r.status === 'active') out[r.student_id] = (out[r.student_id] ?? 0) + 1; });
      return out;
    },
  });
}

/* ---------- Attendance ---------- */
export type AttendanceRow = { studentId: string; status: AttStatus; remarks: string | null };
export function useAttendanceByBatchDate(batchId: string | null, date: string | null) {
  return useQuery({
    queryKey: ['academy-attendance', batchId, date],
    enabled: !!batchId && !!date,
    staleTime: 10_000,
    queryFn: async (): Promise<Record<string, AttendanceRow>> => {
      const { data, error } = await supabase
        .from('academy_attendance')
        .select('student_id, status, remarks')
        .eq('batch_id', batchId!).eq('date', date!);
      if (error) throw new Error(error.message);
      const out: Record<string, AttendanceRow> = {};
      ((data ?? []) as any[]).forEach((r) => { out[r.student_id] = { studentId: r.student_id, status: r.status, remarks: r.remarks ?? null }; });
      return out;
    },
  });
}

export function useUpsertAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; date: string; markedBy: string | null; rows: { studentId: string; status: AttStatus; remarks?: string | null }[] }) => {
      if (!input.rows.length) return;
      // Unique index is (batch_id, student_id, date) — upsert matches it exactly.
      // Admin direct marks are ALWAYS approved (web invariant): they never pass
      // through the teacher pending queue, and stamp who approved them.
      const payload = input.rows.map((r) => ({
        batch_id: input.batchId, student_id: r.studentId, date: input.date,
        status: r.status, remarks: r.remarks?.trim() || null, marked_by: input.markedBy ?? null,
        marked_by_profile_id: input.markedBy ?? null,
        approval_status: 'approved', approved_by: input.markedBy ?? null, approved_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from('academy_attendance').upsert(payload, { onConflict: 'batch_id,student_id,date' });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['academy-attendance', v.batchId, v.date] });
      qc.invalidateQueries({ queryKey: ['academy-overview'] });
      qc.invalidateQueries({ queryKey: ['academy-att-report'] });
    },
  });
}

/* Attendance report rows for a batch + date range (weighted maths applied by the UI). */
export type AttReportRaw = { student_id: string; date: string; status: string };
export function useAttendanceReport(batchId: string | null, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['academy-att-report', batchId, from, to],
    enabled: enabled && !!batchId,
    staleTime: 30_000,
    queryFn: async (): Promise<AttReportRaw[]> => {
      const { data, error } = await supabase
        .from('academy_attendance')
        .select('student_id, date, status')
        .eq('batch_id', batchId!)
        .eq('approval_status', 'approved') // reports count approved rows only (web invariant)
        .gte('date', from).lte('date', to)
        .order('date', { ascending: false })
        .limit(3000);
      if (error) throw new Error(error.message);
      return (data ?? []) as AttReportRaw[];
    },
  });
}

/* ---------- Overview ---------- */
export type AcademyOverview = {
  students: number; teachers: number; activeBatches: number;
  todayPct: number; todayMarked: number;
  last7: { date: string; pct: number; total: number }[];
  recentBatches: AcademyBatch[];
};
export function useAcademyOverview() {
  return useQuery({
    queryKey: ['academy-overview'],
    staleTime: 60_000,
    queryFn: async (): Promise<Omit<AcademyOverview, 'recentBatches'>> => {
      const today = istToday();
      const weekAgo = istDaysAgo(6);
      const [us, batches, att] = await Promise.all([
        supabase.from('academy_users').select('role, status'),
        supabase.from('academy_batches').select('status'),
        supabase.from('academy_attendance').select('date, status').eq('approval_status', 'approved').gte('date', weekAgo).lte('date', today),
      ]);
      const users = (us.data ?? []) as any[];
      const students = users.filter((u) => u.role === 'student' && u.status === 'active').length;
      const teachers = users.filter((u) => u.role === 'teacher' && u.status === 'active').length;
      const activeBatches = ((batches.data ?? []) as any[]).filter((b) => b.status === 'active').length;
      const attRows = (att.data ?? []) as any[];
      const todayRows = attRows.filter((r) => r.date === today);
      const byDate = new Map<string, { status: string }[]>();
      attRows.forEach((r) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date)!.push({ status: r.status }); });
      const last7 = Array.from({ length: 7 }, (_, i) => {
        const d = istDaysAgo(6 - i);
        const rows = byDate.get(d) ?? [];
        return { date: d, pct: attPct(rows), total: rows.length };
      });
      return { students, teachers, activeBatches, todayPct: attPct(todayRows), todayMarked: todayRows.length, last7 };
    },
  });
}

/* ---------- Assessments ---------- */
export type AssessmentRow = {
  id: string; batch_id: string; student_id: string; date: string; title: string;
  max_marks: number; pass_marks: number | null; marks_obtained: number | null; is_absent: boolean; remarks: string | null;
};
export const defaultPassMarks = (max: number) => Math.round(max * 0.4); // web default: 40% of max

export function useAssessments(batchId: string | null, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['academy-assessments', batchId, from, to],
    enabled: enabled && !!batchId,
    staleTime: 30_000,
    queryFn: async (): Promise<AssessmentRow[]> => {
      const { data, error } = await supabase
        .from('academy_assessments')
        .select('id, batch_id, student_id, date, title, max_marks, pass_marks, marks_obtained, is_absent, remarks')
        .eq('batch_id', batchId!)
        .gte('date', from).lte('date', to)
        .order('date', { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as AssessmentRow[];
    },
  });
}

export function useUpsertAssessmentMarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      batchId: string; date: string; title: string; maxMarks: number; passMarks: number; createdBy: string | null;
      rows: { studentId: string; marks: number | null; isAbsent: boolean; remarks?: string | null }[];
    }) => {
      const title = input.title.trim();
      if (!title) throw new Error('Assessment title is required');
      if (!(input.maxMarks > 0)) throw new Error('Max marks must be greater than 0');
      if (input.passMarks < 0 || input.passMarks > input.maxMarks) throw new Error('Pass marks must be between 0 and max marks');
      for (const r of input.rows) {
        if (!r.isAbsent && r.marks != null && (r.marks < 0 || r.marks > input.maxMarks)) {
          throw new Error(`Marks must be between 0 and ${input.maxMarks}`);
        }
      }
      // Natural key (batch_id, date, title, student_id); absent rows clear marks
      // (a DB trigger enforces the same, this keeps the payload honest).
      const payload = input.rows.map((r) => ({
        batch_id: input.batchId, student_id: r.studentId, date: input.date, title,
        max_marks: input.maxMarks, pass_marks: input.passMarks,
        marks_obtained: r.isAbsent ? null : r.marks, is_absent: r.isAbsent,
        remarks: r.remarks?.trim() || null, created_by: input.createdBy ?? null,
      }));
      const { error } = await supabase.from('academy_assessments').upsert(payload, { onConflict: 'batch_id,date,title,student_id' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['academy-assessments'] }),
  });
}

/* Unlock + bulk-patch max/pass across every row of one (batch,date,title) group. */
export function useUpdateAssessmentMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; date: string; title: string; maxMarks: number; passMarks: number }) => {
      if (!(input.maxMarks > 0)) throw new Error('Max marks must be greater than 0');
      if (input.passMarks < 0 || input.passMarks > input.maxMarks) throw new Error('Pass marks must be between 0 and max marks');
      const { error } = await supabase
        .from('academy_assessments')
        .update({ max_marks: input.maxMarks, pass_marks: input.passMarks })
        .eq('batch_id', input.batchId).eq('date', input.date).eq('title', input.title);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['academy-assessments'] }),
  });
}

/* ============================================================================
   QHP Analyser — turnaround between an assessment being COMPLETED and the
   coach's final PDF landing in qhp_details. Read-only; all joining/aggregation
   happens client-side (no RPC), scoped to assessments completed since the
   2026-01-01 cutoff. RLS lets academy/admin read across every coach.
   ========================================================================== */
export const QHP_CUTOFF = '2026-01-01T00:00:00Z';
export const QHP_OVERDUE_MS = 3 * 24 * 60 * 60 * 1000; // 3-day SLA for a pending PDF

export type QhpAnalyserRow = {
  id: string; clientName: string; coachName: string;
  completedAt: string; completedMs: number;
  status: 'done' | 'pending';
  turnaroundMs: number | null;
  isOverdue: boolean;
  pdfStoragePath: string | null;
  reviewStatus: string | null;
};

/* Supabase caps a request at 1000 rows — page until short. */
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

const personLabel = (p: any, fallback: string) => {
  const n = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
  return n || fallback;
};

export function useQhpAnalyser() {
  return useQuery({
    queryKey: ['academy-qhp-analyser'],
    staleTime: 60_000,
    queryFn: async (): Promise<QhpAnalyserRow[]> => {
      const assessments = await fetchAll<any>((from, to) =>
        supabase
          .from('coach_assessment')
          .select('id, completed, client_id, coach_id, clients:client_id (first_name, last_name), profiles:coach_id (first_name, last_name)')
          .gte('completed', QHP_CUTOFF)
          .not('client_id', 'is', null)
          .not('completed', 'is', null)
          .order('completed', { ascending: false })
          .range(from, to)
      );
      if (!assessments.length) return [];
      const ids = assessments.map((a) => a.id);
      // Details are fetched in id-chunks so the IN() list never gets oversized.
      const details: any[] = [];
      for (let i = 0; i < ids.length; i += 300) {
        const slice = ids.slice(i, i + 300);
        const part = await fetchAll<any>((from, to) =>
          supabase
            .from('qhp_details')
            .select('id, coach_assessment_id, updated_at, pdf_storage_path, pdf_filename, review_status')
            .in('coach_assessment_id', slice)
            .range(from, to)
        );
        details.push(...part);
      }
      // One canonical detail per assessment: a row WITH a stored PDF beats a
      // metadata-only row; otherwise the most recently updated wins. (24 of the
      // live assessments carry more than one detail row.)
      const best = new Map<string, any>();
      details.forEach((d) => {
        if (!d.coach_assessment_id) return;
        const cur = best.get(d.coach_assessment_id);
        const better =
          !cur ||
          (!!d.pdf_storage_path && !cur.pdf_storage_path) ||
          (!!d.pdf_storage_path === !!cur.pdf_storage_path &&
            new Date(d.updated_at ?? 0).getTime() > new Date(cur.updated_at ?? 0).getTime());
        if (better) best.set(d.coach_assessment_id, d);
      });
      const now = Date.now();
      return assessments.map((a) => {
        const d = best.get(a.id);
        const completedMs = new Date(a.completed).getTime();
        const done = !!d;
        return {
          id: a.id,
          clientName: personLabel(a.clients, 'Unknown client'),
          coachName: personLabel(a.profiles, 'Unknown coach'),
          completedAt: a.completed,
          completedMs,
          status: done ? 'done' : 'pending',
          turnaroundMs: done ? Math.max(0, new Date(d.updated_at ?? a.completed).getTime() - completedMs) : null,
          isOverdue: !done && now - completedMs > QHP_OVERDUE_MS,
          pdfStoragePath: d?.pdf_storage_path ?? null,
          reviewStatus: d?.review_status ?? null,
        } as QhpAnalyserRow;
      });
    },
  });
}

/* Public URL for a stored QHP PDF (bucket: qhp-images). */
export const qhpPdfUrl = (path: string) => supabase.storage.from('qhp-images').getPublicUrl(path).data.publicUrl;

/* ---------- Dashboard action banners ---------- */
export type QhpBanners = {
  pendingHod: { id: string; clientName: string; coachName: string; at: string | null }[];
  onHold: { id: string; clientName: string; coachName: string; at: string | null }[];
  missing: { id: string; clientName: string; coachName: string; at: string }[];
};
export function useAcademyBanners() {
  return useQuery({
    queryKey: ['academy-banners'],
    staleTime: 60_000,
    queryFn: async (): Promise<QhpBanners> => {
      const assessments = await fetchAll<any>((from, to) =>
        supabase
          .from('coach_assessment')
          .select('id, completed, existing_client_assessment_data, new_client_assessment_data, clients:client_id (first_name, last_name), profiles:coach_id (first_name, last_name)')
          .gte('completed', QHP_CUTOFF)
          .not('client_id', 'is', null)
          .not('completed', 'is', null)
          .order('completed', { ascending: false })
          .range(from, to)
      );
      const details = await fetchAll<any>((from, to) =>
        supabase.from('qhp_details').select('id, coach_assessment_id, review_status, held_at, updated_at').range(from, to)
      );
      const byAssessment = new Map<string, any>();
      details.forEach((d) => { if (d.coach_assessment_id && !byAssessment.has(d.coach_assessment_id)) byAssessment.set(d.coach_assessment_id, d); });
      const aById = new Map(assessments.map((a) => [a.id, a]));
      const label = (a: any) => ({
        clientName: personLabel(a?.clients, 'Unknown client'),
        coachName: personLabel(a?.profiles, 'Unknown coach'),
      });
      const fromDetails = (pred: (d: any) => boolean) =>
        details.filter(pred).map((d) => {
          const a = aById.get(d.coach_assessment_id);
          return { id: d.id, ...label(a), at: d.updated_at ?? null };
        });
      // Live review_status values: pending_senior | pending_hod | fully_signed | on_hold.
      const pendingHod = fromDetails((d) => d.review_status === 'pending_hod');
      const onHold = fromDetails((d) => d.review_status === 'on_hold' || !!d.held_at);
      // Missing: assessment completed WITH captured data but no report row at all.
      const hasData = (r: any) => {
        const ok = (v: any) => v && typeof v === 'object' && Object.keys(v).length > 0;
        return ok(r.existing_client_assessment_data) || ok(r.new_client_assessment_data);
      };
      const missing = assessments
        .filter((a) => !byAssessment.has(a.id) && hasData(a))
        .map((a) => ({ id: a.id, ...label(a), at: a.completed as string }));
      return { pendingHod, onHold, missing };
    },
  });
}
