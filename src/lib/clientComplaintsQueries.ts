/* Client complaints data (3 Nov 2026): the two lists, the counts and the three writes, all definer RPCs of
   hub-track migration 20261104100000. The server decides the scope (a manager's teams, or every team for the
   physio HOD and admins); the app only filters the rows it got by team or manager chip. Lists are cached under a
   `manager-` key so the page opens offline read-only; the writes need a connection. PGRST202 (migration not run)
   reads as empty lists and zero counts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { useAuth } from '../auth';
import {
  parseInaccurateLog, parseSpecialistReport, parseComplaintCounts,
  type InaccurateLog, type SpecialistReport, type ComplaintCounts, type ComplaintStatusFilter, type ReportStatus,
} from './clientComplaints';

export const COMPLAINTS_KEY = 'manager-client-complaints';
export const COMPLAINT_COUNTS_KEY = ['manager-complaint-counts'] as const;

const missing = (error: any) => error?.code === 'PGRST202' || /could not find the function/i.test(String(error?.message ?? ''));
async function rpc<T>(name: string, args: Record<string, unknown>, label: string): Promise<T> {
  const { data, error } = await withTimeout(Promise.resolve((supabase.rpc as any)(name, args)) as Promise<{ data: any; error: any }>, NET_MS, label);
  if (error) throw Object.assign(new Error(error.message ?? label), { code: error.code });
  return data as T;
}

export function useInaccurateLogs(status: ComplaintStatusFilter, managerId: string | null, enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [COMPLAINTS_KEY, 'logs', uid, status, managerId],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    queryFn: async (): Promise<InaccurateLog[]> => {
      try {
        const d = await rpc<any[]>('get_inaccurate_logs', { p_status: status, p_manager: managerId, p_limit: 200 }, 'Client complaints');
        return (Array.isArray(d) ? d : []).map(parseInaccurateLog).filter(Boolean) as InaccurateLog[];
      } catch (e: any) { if (missing(e)) return []; throw e; }
    },
  });
}

export function useSpecialistReports(status: ComplaintStatusFilter, managerId: string | null, enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [COMPLAINTS_KEY, 'reports', uid, status, managerId],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    queryFn: async (): Promise<SpecialistReport[]> => {
      try {
        const d = await rpc<any[]>('get_specialist_reports', { p_status: status, p_manager: managerId, p_limit: 200 }, 'Client complaints');
        return (Array.isArray(d) ? d : []).map(parseSpecialistReport).filter(Boolean) as SpecialistReport[];
      } catch (e: any) { if (missing(e)) return []; throw e; }
    },
  });
}

/** {viewer, logs_open, reports_open}: the drawer dot, the Managers Overview link and the page header. */
export function useComplaintCounts(enabled = true) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: [...COMPLAINT_COUNTS_KEY, uid],
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnMount: true,
    retry: 1,
    queryFn: async (): Promise<ComplaintCounts> => {
      try { return parseComplaintCounts(await rpc<any>('count_client_complaints', {}, 'Client complaints')); }
      catch (e: any) { if (missing(e)) return { viewer: null, logs_open: 0, reports_open: 0 }; throw e; }
    },
  });
}

const useInvalidateComplaints = () => {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: [COMPLAINTS_KEY] }); qc.invalidateQueries({ queryKey: [...COMPLAINT_COUNTS_KEY] }); };
};

export function useMarkLogHandled() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { sessionId: string; note: string; logFixed: boolean }) =>
      rpc<any>('mark_log_review_handled', { p_session: r.sessionId, p_note: r.note.trim() || null, p_log_fixed: r.logFixed }, 'Mark handled'),
    onSettled: inv,
  });
}
export function useUnmarkLogHandled() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { sessionId: string }) => rpc<any>('unmark_log_review_handled', { p_session: r.sessionId }, 'Reopen'),
    onSettled: inv,
  });
}
export function useSetReportStatus() {
  const inv = useInvalidateComplaints();
  return useMutation({
    mutationFn: async (r: { id: string; status: ReportStatus; note: string }) =>
      rpc<any>('set_specialist_report_status', { p_id: r.id, p_status: r.status, p_note: r.note.trim() || null }, 'Report status'),
    onSettled: inv,
  });
}
