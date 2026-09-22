import React from 'react';
import { AppState } from 'react-native';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { invalidateDebounced } from './invalidateDebounced';

/* ============ Live sync — makes every dashboard render fresh data on its own.
   Three layers (each covers the others' gaps):
   1. Global React Query defaults (App.tsx): poll every 60s + refetch on mount.
   2. App-foreground refetch: focusManager wired to AppState — coming back to
      the app refetches everything stale immediately.
   3. Supabase realtime: one channel over the hot tables; any INSERT/UPDATE/DELETE
      invalidates the matching query-key prefixes so open screens update in
      seconds without waiting for the next poll. Tables not enabled for realtime
      simply never fire — polling still covers them. ============ */

// Wire React Query's focus to the app's foreground state (module-level, once).
let focusWired = false;
export function initFocusRefetch() {
  if (focusWired) return;
  focusWired = true;
  AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
}

/* table → query-key prefixes to invalidate when it changes */
const TABLE_KEYS: Record<string, string[]> = {
  clients: ['crm-client-list', 'crm-client-detail', 'crm-journey-clients', 'crm-metrics', 'crm-inactive-clients', 'coach-clients-overview', 'coach-overview-client'],
  trainer_clients: ['crm-client-list', 'crm-client-detail', 'crm-client-assignments', 'sales-targets', 'crm-journey-clients'],
  // Roster/session keys for trainers, doctors and managers are included so their
  // Sessions pages, Today's Roster and crew cards update live (the global 60 s poll
  // that used to paper over this is gone).
  training_sessions: ['crm-client-sessions', 'crm-package-cycle', 'crm-inactive-clients', 'crm-sessions-breakdown', 'crm-metrics', 'client-sessions', 'trainer-roster', 'trainer-month-sessions-v2', 'doctor-roster', 'doctor-today-roster', 'mgr-plan-outcome-v5', 'crm-month-roster'],
  session_schedule: ['crm-client-roster', 'crm-client-sessions', 'trainer-roster', 'trainer-month-sessions-v2', 'doctor-roster', 'doctor-today-roster', 'mgr-plan-sched', 'crm-month-roster'],
  crm_communications: ['crm-comms-book', 'crm-client-comms', 'crm-stale-comms', 'crm-pending-comms'],
  sales_tracker: ['sales-targets'],
  service_bookings: ['crm-service-bookings'],
  crm_client_distribution: ['crm-client-distribution'],
  crm_tasks: ['crm-tasks', 'crm-my-tasks'],
  all_requests: ['roster-requests', 'crm-roster-requests'],
  client_pause_history: ['crm-client-pause', 'crm-client-list', 'crm-ended-pauses'],
  client_renewals: ['crm-package-cycle', 'crm-client-list', 'crm-inactive-clients'],
  medical_diagnosis: ['crm-client-diagnoses'],
  client_discontinuation_requests: ['crm-client-discontinue'],
  health_reports: ['client-reports'],
  qhp_details: ['client-reports', 'coach-clients-overview', 'coach-overview-client'],
  coach_assessment: ['crm-client-assessments', 'crm-client-heartmath', 'crm-qhp-tracker'],
  workout_plan_exercises: ['coach-programs', 'coach-approved-plans', 'coach-plan-exercises', 'coach-pending-plans-count'],
  client_training_plans: ['coach-programs', 'coach-approved-plans', 'coach-pending-plans-count'],
  escalations: ['crm-escalations'],
};

/** Mount once (Router). Subscribes while signed in; cleans up on sign-out. */
export function LiveSync() {
  const qc = useQueryClient();
  const { session } = useAuth();

  React.useEffect(() => {
    initFocusRefetch();
  }, []);

  React.useEffect(() => {
    if (!session) return;
    // Debounced per query key (shared with every other realtime handler in the
    // app) so a burst of rows — or overlapping subscriptions — invalidates once.
    const kick = (table: string) => (TABLE_KEYS[table] ?? []).forEach((prefix) => invalidateDebounced(qc, [prefix]));
    let channel = supabase.channel('live-sync');
    Object.keys(TABLE_KEYS).forEach((table) => {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => kick(table));
    });
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, qc]);

  return null;
}
