import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';

/* ============ Trainer sub-role capabilities ============
   In the web app "trainer" is one role with boolean capability flags layered on
   top (see docs). What gates each surface:
   - QHP Manager      → can_schedule_assessments_for_others   (the QHP oversight role)
   - Assessor         → can_conduct_assessments
   - All-assessments  → can_view_all_assessments
   - Trainer roster   → can_view_all_trainers
   - Workout Analyst  → workout_analysist  (note the DB column typo)
   We currently have exactly one QHP Manager (Raj Thakur). This hook reads the
   signed-in user's flags so the app can show the QHP Manager pages only to them. */

export type Capabilities = {
  isQhpManager: boolean;
  canConductAssessments: boolean;
  canViewAllAssessments: boolean;
  canViewAllTrainers: boolean;
  workoutAnalyst: boolean;
  /* Workout Plans Analyst (compliance) pages (web: profiles.workout_compliances_analyst) */
  workoutComplianceAnalyst: boolean;
  /* QHP report generator (web: profiles.qhp_report_creator — e.g. Furqan Saifi) */
  qhpReportCreator: boolean;
  /* QHP review first signer — signs "as Senior Researcher" (web: profiles.junior_researcher; naming is the web's) */
  juniorResearcher: boolean;
  /* QHP review final signer (web: role_specialization includes 'hod') */
  isHod: boolean;
  /* Managers Overview / Managers QHP Overview pages (web: profile.managers === true) */
  isManager: boolean;
  /* Trainers Tracker page (web: role_specialization includes 'trainer-manager') */
  isTrainerManager: boolean;
  /* CRM Escalations page (web: role_specialization includes 'crm_manager') */
  isCrmManager: boolean;
};

const EMPTY: Capabilities = {
  isQhpManager: false,
  canConductAssessments: false,
  canViewAllAssessments: false,
  canViewAllTrainers: false,
  workoutAnalyst: false,
  workoutComplianceAnalyst: false,
  qhpReportCreator: false,
  juniorResearcher: false,
  isHod: false,
  isManager: false,
  isTrainerManager: false,
  isCrmManager: false,
};

export function useMyCapabilities(): { data: Capabilities; isLoading: boolean } {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const q = useQuery({
    queryKey: ['my-capabilities', uid],
    enabled: !!uid,
    staleTime: 600_000,
    queryFn: async (): Promise<Capabilities> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('can_schedule_assessments_for_others, can_conduct_assessments, can_view_all_assessments, can_view_all_trainers, workout_analysist, workout_compliances_analyst, qhp_report_creator, junior_researcher, managers, role_specialization')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const spec = (data as any)?.role_specialization;
      return {
        isQhpManager: data?.can_schedule_assessments_for_others === true,
        canConductAssessments: data?.can_conduct_assessments === true,
        canViewAllAssessments: data?.can_view_all_assessments === true,
        canViewAllTrainers: data?.can_view_all_trainers === true,
        workoutAnalyst: data?.workout_analysist === true,
        workoutComplianceAnalyst: (data as any)?.workout_compliances_analyst === true,
        qhpReportCreator: (data as any)?.qhp_report_creator === true,
        juniorResearcher: (data as any)?.junior_researcher === true,
        isHod: Array.isArray(spec) ? spec.includes('hod') : typeof spec === 'string' && spec.includes('hod'),
        isManager: (data as any)?.managers === true,
        isTrainerManager: Array.isArray(spec) ? spec.includes('trainer-manager') : typeof spec === 'string' && spec.includes('trainer-manager'),
        isCrmManager: Array.isArray(spec) ? spec.includes('crm_manager') : typeof spec === 'string' && spec.includes('crm_manager'),
      };
    },
  });
  return { data: q.data ?? EMPTY, isLoading: q.isLoading };
}
