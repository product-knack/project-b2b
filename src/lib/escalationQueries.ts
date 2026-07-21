import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { C } from '../theme';

/* ============ CRM Escalations — mirrors the web CRMEscalations:
   read-only monitor over the `escalations` table. Rows are created, tier-bumped
   (T1 CRM → T2 Ops → T3 Super Admin) and auto-resolved by DB cron functions —
   the app only watches. ============ */

export const ESCALATIONS_SINCE = '2026-06-01T00:00:00+05:30';

export type EscalationType =
  | 'qhp_scheduled_pending' | 'communication_log_missing' | 'no_recent_session'
  | 'roster_expired_no_session' | 'single_trainer_first_14d'
  | 'multi_trainer_same_modality' | 'package_exhausted_renewal_pending';

export const ESC_META: Record<EscalationType, { label: string; short: string; color: string; icon: string; rule: string; resolves: string }> = {
  qhp_scheduled_pending: {
    label: 'QHP Pending', short: 'QHP', color: C.purple, icon: 'heart',
    rule: 'QHP was scheduled but not completed within 3 hours of its slot.',
    resolves: 'Resolves when the assessment gets data or a report.',
  },
  communication_log_missing: {
    label: 'No Counselling 10d', short: 'Comm Log', color: C.gold, icon: 'phone',
    rule: 'No "Counselling Done" communication logged in the last 10 days.',
    resolves: 'Resolves when a Counselling Done call is logged.',
  },
  no_recent_session: {
    label: 'No Session 7d', short: 'No Session', color: C.red, icon: 'dumbbell',
    rule: 'No completed training session in the last 7 days (and not paused).',
    resolves: 'Resolves after any completed session, or a pause.',
  },
  roster_expired_no_session: {
    label: 'Roster Expired', short: 'Roster', color: C.orange, icon: 'calendar',
    rule: 'No future sessions on the roster and nothing scheduled for tomorrow.',
    resolves: 'Resolves when any future session is scheduled.',
  },
  single_trainer_first_14d: {
    label: 'Single Trainer 14d', short: '1 Trainer', color: C.blue, icon: 'user',
    rule: 'Only one (non-doctor) trainer in the client\'s first 14 days.',
    resolves: 'Resolves when a second trainer takes a session.',
  },
  multi_trainer_same_modality: {
    label: '3+ Trainers · Modality', short: 'Multi Trainer', color: '#4FD1C5', icon: 'users',
    rule: '3 or more assigned trainers confirmed on the same modality.',
    resolves: 'Resolves when the modality drops below 3 trainers.',
  },
  package_exhausted_renewal_pending: {
    label: 'Package Exhausted', short: 'Renewal', color: C.green, icon: 'rupee',
    rule: 'All package sessions used and no approved renewal yet.',
    resolves: 'Resolves when a renewal is approved.',
  },
};
export const ESC_TYPES = Object.keys(ESC_META) as EscalationType[];

export const TIER_META: Record<number, { label: string; color: string }> = {
  1: { label: 'Tier 1 · CRM', color: C.gold },
  2: { label: 'Tier 2 · Ops', color: C.orange },
  3: { label: 'Tier 3 · Super Admin', color: C.red },
};

export type EscalationRow = {
  id: string; type: EscalationType; title: string; status: string;
  level: number; escalatedAt: string; dueAt: string | null;
  mine: boolean; clientName: string | null; details: any;
};

export function useEscalations(crmId: string | null, status: 'open' | 'completed') {
  return useQuery({
    queryKey: ['crm-escalations', crmId, status],
    enabled: !!crmId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<EscalationRow[]> => {
      const { data, error } = await supabase
        .from('escalations')
        .select('id, source_type, title, status, current_level, due_at, escalated_at, level1_user_id, level2_user_id, details')
        .eq('status', status)
        .gte('escalated_at', ESCALATIONS_SINCE)
        .order('current_level', { ascending: false })
        .order('escalated_at', { ascending: true })
        .limit(1000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[])
        .filter((r) => (ESC_TYPES as string[]).includes(r.source_type))
        .map((r) => ({
          id: r.id,
          type: r.source_type as EscalationType,
          title: r.title ?? '',
          status: r.status,
          level: r.current_level ?? 1,
          escalatedAt: r.escalated_at,
          dueAt: r.due_at ?? null,
          mine: r.level1_user_id === crmId || r.level2_user_id === crmId,
          clientName: r.details?.client_name ?? null,
          details: r.details ?? {},
        }));
    },
  });
}
