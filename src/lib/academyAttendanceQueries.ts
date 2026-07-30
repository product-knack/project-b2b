import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { attPct } from './academyQueries';

/* ============================================================================
   Academy attendance - teacher / student / approval data layer.

   Approval invariants (mirror these everywhere, never bend them):
   - Teacher writes are ALWAYS approval_status='pending' with
     marked_by_profile_id = auth uid, and a teacher can NEVER overwrite a row
     that is already approved (those rows are dropped before the upsert).
   - Admin approval sets approved_by/approved_at; rejection clears both.
   - Every metric / percentage counts ONLY approval_status='approved' rows
     (present=1, late=0.5, absent/leave=0 via attPct from academyQueries).

   Query key namespaces:
     teacher  -> ['academy-teacher', ...]
     student  -> ['academy-student', ...]
     approval -> ['academy-approval', ...]
   Mutations broad-invalidate all attendance-adjacent prefixes.
   ========================================================================== */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

type MarkStatus = 'present' | 'absent' | 'late' | 'leave';

/* Broad prefixes every attendance mutation must refresh. */
const MUTATION_PREFIXES: string[][] = [
  ['academy-teacher'],
  ['academy-student'],
  ['academy-approval'],
  ['academy-attendance'],
  ['academy-overview'],
  ['academy-att-report'],
];
const invalidateAttendance = (qc: QueryClient) => {
  MUTATION_PREFIXES.forEach((k) => qc.invalidateQueries({ queryKey: k }));
};

/* Supabase caps a request at 1000 rows - page until a short chunk comes back. */
async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> {
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

const batchLabelOf = (b: { course_name?: string | null; batch_name?: string | null } | undefined) => {
  if (!b) return 'Batch';
  const course = (b.course_name ?? '').trim();
  const name = (b.batch_name ?? '').trim();
  return [course, name].filter(Boolean).join(' - ') || 'Batch';
};

/* ---------- Who am I inside the academy? ---------- */
export type AcademyLink = {
  teacherId: string | null;
  teacherName: string | null;
  studentId: string | null;
  studentName: string | null;
};

/* Maps an auth profile to its academy_users identities (a person can be both). */
export function useMyAcademyLink(profileId: string | null) {
  return useQuery({
    queryKey: ['academy-link', profileId],
    enabled: !!profileId,
    staleTime: 60_000,
    queryFn: async (): Promise<AcademyLink> => {
      const { data, error } = await supabase
        .from('academy_users')
        .select('id, name, role')
        .eq('profile_id', profileId!)
        .eq('status', 'active')
        .in('role', ['teacher', 'student']);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      const teacher = rows.find((r) => r.role === 'teacher');
      const student = rows.find((r) => r.role === 'student');
      return {
        teacherId: teacher?.id ?? null,
        teacherName: teacher?.name ?? null,
        studentId: student?.id ?? null,
        studentName: student?.name ?? null,
      };
    },
  });
}

/* ---------- Teacher: my batches ---------- */
export type TeacherBatch = {
  id: string;
  course_name: string;
  batch_name: string;
  schedule: { days?: string[]; time?: string } | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  teachers: { id: string; name: string; isPrimary: boolean }[];
  studentCount: number;
};

export function useTeacherBatches(teacherId: string | null) {
  return useQuery({
    queryKey: ['academy-teacher', 'batches', teacherId],
    enabled: !!teacherId,
    staleTime: 30_000,
    queryFn: async (): Promise<TeacherBatch[]> => {
      const { data: links, error } = await supabase
        .from('academy_batch_teachers')
        .select('batch_id')
        .eq('teacher_id', teacherId!);
      if (error) throw new Error(error.message);
      const myBatchIds = [...new Set(((links ?? []) as any[]).map((r) => r.batch_id))];
      if (!myBatchIds.length) return [];

      const { data: batches, error: bErr } = await supabase
        .from('academy_batches')
        .select('id, course_name, batch_name, teacher_id, start_date, end_date, schedule, status')
        .in('id', myBatchIds)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (bErr) throw new Error(bErr.message);
      const rows = (batches ?? []) as any[];
      if (!rows.length) return [];

      const ids = rows.map((b) => b.id);
      const [jt, enr] = await Promise.all([
        supabase.from('academy_batch_teachers').select('batch_id, teacher_id, is_primary').in('batch_id', ids),
        supabase.from('academy_enrollments').select('batch_id, status').in('batch_id', ids),
      ]);
      const jtRows = (jt.data ?? []) as any[];

      const teacherIds = [
        ...new Set([...jtRows.map((r) => r.teacher_id), ...rows.map((b) => b.teacher_id)].filter(Boolean)),
      ] as string[];
      const nameById = new Map<string, string>();
      if (teacherIds.length) {
        const { data: us } = await supabase.from('academy_users').select('id, name').in('id', teacherIds);
        ((us ?? []) as any[]).forEach((u) => nameById.set(u.id, u.name));
      }

      const byBatch = new Map<string, { id: string; name: string; isPrimary: boolean }[]>();
      jtRows.forEach((r) => {
        if (!byBatch.has(r.batch_id)) byBatch.set(r.batch_id, []);
        byBatch.get(r.batch_id)!.push({
          id: r.teacher_id,
          name: nameById.get(r.teacher_id) ?? 'Teacher',
          isPrimary: !!r.is_primary,
        });
      });
      const enrolled = new Map<string, number>();
      ((enr.data ?? []) as any[]).forEach((r) => {
        if (r.status !== 'active') return;
        enrolled.set(r.batch_id, (enrolled.get(r.batch_id) ?? 0) + 1);
      });

      return rows.map((b) => {
        // Primary first, then alphabetical; legacy teacher_id is only a fallback.
        let list = (byBatch.get(b.id) ?? []).sort(
          (x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.name.localeCompare(y.name)
        );
        if (!list.length && b.teacher_id) {
          list = [{ id: b.teacher_id, name: nameById.get(b.teacher_id) ?? 'Teacher', isPrimary: true }];
        }
        return {
          id: b.id,
          course_name: b.course_name ?? '',
          batch_name: b.batch_name ?? '',
          schedule: b.schedule ?? null,
          status: b.status ?? 'active',
          start_date: b.start_date ?? null,
          end_date: b.end_date ?? null,
          teachers: list,
          studentCount: enrolled.get(b.id) ?? 0,
        };
      });
    },
  });
}

/* ---------- Teacher: week strip (per batch+date marked/pending summary) ---------- */
export type AttCell = { total: number; pending: number; approved: number; rejected: number };

export function useWeekAttendance(batchIds: string[], from: string, to: string) {
  return useQuery({
    queryKey: ['academy-teacher', 'week', [...batchIds].sort().join(','), from, to],
    enabled: !!from && !!to,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, AttCell>> => {
      if (!batchIds.length) return {};
      const rows = await fetchAllRows<any>((lo, hi) =>
        supabase
          .from('academy_attendance')
          .select('batch_id, date, approval_status')
          .in('batch_id', batchIds)
          .gte('date', from)
          .lte('date', to)
          .range(lo, hi)
      );
      const out: Record<string, AttCell> = {};
      rows.forEach((r) => {
        const key = `${r.batch_id}__${r.date}`;
        if (!out[key]) out[key] = { total: 0, pending: 0, approved: 0, rejected: 0 };
        const cell = out[key];
        cell.total += 1;
        if (r.approval_status === 'pending') cell.pending += 1;
        else if (r.approval_status === 'rejected') cell.rejected += 1;
        else cell.approved += 1;
      });
      return out;
    },
  });
}

/* ---------- Teacher: existing marks for one batch+date ---------- */
export type BatchDateMark = {
  studentId: string;
  status: MarkStatus;
  remarks: string | null;
  approval: ApprovalStatus;
};

export function useBatchDateMarks(batchId: string | null, date: string | null) {
  return useQuery({
    queryKey: ['academy-teacher', 'marks', batchId, date],
    enabled: !!batchId && !!date,
    staleTime: 10_000,
    queryFn: async (): Promise<Record<string, BatchDateMark>> => {
      const { data, error } = await supabase
        .from('academy_attendance')
        .select('student_id, status, remarks, approval_status')
        .eq('batch_id', batchId!)
        .eq('date', date!);
      if (error) throw new Error(error.message);
      const out: Record<string, BatchDateMark> = {};
      ((data ?? []) as any[]).forEach((r) => {
        out[r.student_id] = {
          studentId: r.student_id,
          status: r.status,
          remarks: r.remarks ?? null,
          approval: (r.approval_status ?? 'approved') as ApprovalStatus,
        };
      });
      return out;
    },
  });
}

/* ---------- Teacher: submit attendance (always pending) ---------- */
export function useSubmitTeacherAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      batchId: string;
      date: string;
      sessionTime: string | null;
      marks: { studentId: string; status: MarkStatus; remarks?: string | null }[];
      existing: Record<string, BatchDateMark>;
    }) => {
      // Invariant: an approved row is locked for teachers - drop it, never upsert it.
      const editable = input.marks.filter((m) => input.existing[m.studentId]?.approval !== 'approved');
      if (!editable.length) throw new Error('All students on this date are already approved');

      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw new Error(sessErr.message);
      const uid = sess.session?.user?.id;
      if (!uid) throw new Error('You are signed out. Please sign in again.');

      const payload = editable.map((m) => ({
        batch_id: input.batchId,
        student_id: m.studentId,
        date: input.date,
        status: m.status,
        remarks: m.remarks?.trim() || null,
        session_time: input.sessionTime?.trim() || null,
        approval_status: 'pending' as const,
        marked_by_profile_id: uid,
        // A resubmit of a rejected row goes back to a clean pending state.
        approved_by: null,
        approved_at: null,
      }));
      const { error } = await supabase
        .from('academy_attendance')
        .upsert(payload, { onConflict: 'batch_id,student_id,date' });
      if (error) throw new Error(error.message);
      return editable.length;
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}

/* ---------- Student: my batches (with APPROVED-only pct) ---------- */
export type StudentBatch = {
  id: string;
  course_name: string;
  batch_name: string;
  schedule: { days?: string[]; time?: string } | null;
  teacherName: string | null;
  pct: number;
};

export function useStudentBatches(studentId: string | null) {
  return useQuery({
    queryKey: ['academy-student', 'batches', studentId],
    enabled: !!studentId,
    staleTime: 30_000,
    queryFn: async (): Promise<StudentBatch[]> => {
      const { data: enr, error } = await supabase
        .from('academy_enrollments')
        .select('batch_id')
        .eq('student_id', studentId!)
        .eq('status', 'active');
      if (error) throw new Error(error.message);
      const batchIds = [...new Set(((enr ?? []) as any[]).map((r) => r.batch_id))];
      if (!batchIds.length) return [];

      const { data: batches, error: bErr } = await supabase
        .from('academy_batches')
        .select('id, course_name, batch_name, teacher_id, schedule, status')
        .in('id', batchIds)
        .eq('status', 'active');
      if (bErr) throw new Error(bErr.message);
      const rows = (batches ?? []) as any[];
      if (!rows.length) return [];

      const ids = rows.map((b) => b.id);
      const [jt, att] = await Promise.all([
        supabase.from('academy_batch_teachers').select('batch_id, teacher_id, is_primary').in('batch_id', ids),
        fetchAllRows<any>((lo, hi) =>
          supabase
            .from('academy_attendance')
            .select('batch_id, status')
            .eq('student_id', studentId!)
            .eq('approval_status', 'approved')
            .in('batch_id', ids)
            .range(lo, hi)
        ),
      ]);
      const jtRows = (jt.data ?? []) as any[];

      // Primary teacher per batch (fallback: first junction row, then legacy teacher_id).
      const primaryByBatch = new Map<string, string>();
      jtRows.forEach((r) => {
        if (r.is_primary) primaryByBatch.set(r.batch_id, r.teacher_id);
        else if (!primaryByBatch.has(r.batch_id)) primaryByBatch.set(r.batch_id, r.teacher_id);
      });
      rows.forEach((b) => {
        if (!primaryByBatch.has(b.id) && b.teacher_id) primaryByBatch.set(b.id, b.teacher_id);
      });
      const teacherIds = [...new Set([...primaryByBatch.values()])];
      const nameById = new Map<string, string>();
      if (teacherIds.length) {
        const { data: us } = await supabase.from('academy_users').select('id, name').in('id', teacherIds);
        ((us ?? []) as any[]).forEach((u) => nameById.set(u.id, u.name));
      }

      const attByBatch = new Map<string, { status: string }[]>();
      att.forEach((r) => {
        if (!attByBatch.has(r.batch_id)) attByBatch.set(r.batch_id, []);
        attByBatch.get(r.batch_id)!.push({ status: r.status });
      });

      return rows
        .map((b) => {
          const tid = primaryByBatch.get(b.id);
          return {
            id: b.id,
            course_name: b.course_name ?? '',
            batch_name: b.batch_name ?? '',
            schedule: b.schedule ?? null,
            teacherName: tid ? nameById.get(tid) ?? null : null,
            pct: attPct(attByBatch.get(b.id) ?? []),
          };
        })
        .sort((a, b) => batchLabelOf(a).localeCompare(batchLabelOf(b)));
    },
  });
}

/* ---------- Student: my attendance history (APPROVED rows only) ---------- */
export type MyAttRow = {
  id: string;
  batchId: string;
  batchLabel: string;
  date: string;
  status: MarkStatus;
  remarks: string | null;
  sessionTime: string | null;
};

export function useMyAttendance(studentId: string | null) {
  return useQuery({
    queryKey: ['academy-student', 'attendance', studentId],
    enabled: !!studentId,
    staleTime: 30_000,
    queryFn: async (): Promise<MyAttRow[]> => {
      const { data, error } = await supabase
        .from('academy_attendance')
        .select('id, batch_id, date, status, remarks, session_time')
        .eq('student_id', studentId!)
        .eq('approval_status', 'approved')
        .order('date', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const batchIds = [...new Set(rows.map((r) => r.batch_id))];
      const { data: batches } = await supabase
        .from('academy_batches')
        .select('id, course_name, batch_name')
        .in('id', batchIds);
      const labelById = new Map<string, string>(((batches ?? []) as any[]).map((b) => [b.id, batchLabelOf(b)]));
      return rows.map((r) => ({
        id: r.id,
        batchId: r.batch_id,
        batchLabel: labelById.get(r.batch_id) ?? 'Batch',
        date: r.date,
        status: r.status,
        remarks: r.remarks ?? null,
        sessionTime: r.session_time ?? null,
      }));
    },
  });
}

/* ---------- Admin: approval queue ---------- */
export type ApprovalRow = {
  id: string;
  batchId: string;
  batchLabel: string;
  studentId: string;
  studentName: string;
  rollNo: string | null;
  date: string;
  status: MarkStatus;
  remarks: string | null;
  sessionTime: string | null;
};

export function useAttendanceByApproval(status: 'pending' | 'approved') {
  return useQuery({
    queryKey: ['academy-approval', 'list', status],
    staleTime: 15_000,
    queryFn: async (): Promise<ApprovalRow[]> => {
      const { data, error } = await supabase
        .from('academy_attendance')
        .select('id, batch_id, student_id, date, status, remarks, session_time')
        .eq('approval_status', status)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      if (!rows.length) return [];
      const batchIds = [...new Set(rows.map((r) => r.batch_id))];
      const studentIds = [...new Set(rows.map((r) => r.student_id))];
      const [batches, students] = await Promise.all([
        supabase.from('academy_batches').select('id, course_name, batch_name').in('id', batchIds),
        supabase.from('academy_users').select('id, name, roll_no').in('id', studentIds),
      ]);
      const labelById = new Map<string, string>(((batches.data ?? []) as any[]).map((b) => [b.id, batchLabelOf(b)]));
      const studentById = new Map<string, { name: string; roll_no: string | null }>(
        ((students.data ?? []) as any[]).map((s) => [s.id, { name: s.name, roll_no: s.roll_no ?? null }])
      );
      return rows.map((r) => {
        const s = studentById.get(r.student_id);
        return {
          id: r.id,
          batchId: r.batch_id,
          batchLabel: labelById.get(r.batch_id) ?? 'Batch',
          studentId: r.student_id,
          studentName: s?.name ?? 'Student',
          rollNo: s?.roll_no ?? null,
          date: r.date,
          status: r.status,
          remarks: r.remarks ?? null,
          sessionTime: r.session_time ?? null,
        };
      });
    },
  });
}

export function usePendingAttendanceCount() {
  return useQuery({
    queryKey: ['academy-approval', 'pending-count'],
    staleTime: 15_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('academy_attendance')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

/* ---------- Admin: approve / reject + inline edits ---------- */
export function useSetAttendanceApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; to: 'approved' | 'rejected'; adminId: string }) => {
      if (!input.ids.length) return;
      const patch =
        input.to === 'approved'
          ? { approval_status: 'approved', approved_by: input.adminId, approved_at: new Date().toISOString() }
          : { approval_status: 'rejected', approved_by: null, approved_at: null };
      const { error } = await supabase.from('academy_attendance').update(patch).in('id', input.ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}

export function useUpdateAttendanceRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status?: MarkStatus; remarks?: string | null }) => {
      const patch: Record<string, any> = {};
      if (input.status !== undefined) patch.status = input.status;
      if (input.remarks !== undefined) patch.remarks = input.remarks?.trim() || null;
      if (!Object.keys(patch).length) return;
      const { error } = await supabase.from('academy_attendance').update(patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateAttendance(qc),
  });
}
