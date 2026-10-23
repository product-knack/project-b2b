/* Essentials manager and the unsold crew alerts (22 Oct 2026). RPCs from hub-track migration 20261022200100.
   Plain-object query data (persisted cache). Rules in ./essentialsUnsold.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { parseUnsoldLot, parseWindow, parseFreeStaff, type Crew, type FreeStaff, type UnsoldLot, type UnsoldWindow } from './essentialsUnsold';
import { useMyManagerTeam, type ManagerChatMessage } from './managerChatQueries';

export function useUnsoldWindow() {
  return useQuery({
    queryKey: ['essentials-unsold-window'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<UnsoldWindow> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_unsold_window')), NET_MS, 'Auction window');
      if (error) throw new Error(error.message);
      return parseWindow(data);
    },
  });
}

/** The unsold sessions of tomorrow's auction (essential_manager / admin only; others get no rows). */
export function useEssentialsUnsold(enabled = true) {
  return useQuery({
    queryKey: ['essentials-unsold'],
    enabled,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<UnsoldLot[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_unsold')), NET_MS, 'Unsold sessions');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map(parseUnsoldLot);
    },
  });
}

export function useEssentialsCrews(enabled = true) {
  return useQuery({
    queryKey: ['essentials-manager-crews'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Crew[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('essentials_manager_crews')), NET_MS, 'Crews');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        score_id: String(r.score_id), team_name: String(r.team_name ?? 'Team'), manager_id: String(r.manager_id ?? ''),
        manager_name: r.manager_name ?? null, member_count: Number(r.member_count ?? 0) || 0, team_start: String(r.team_start ?? ''), team_end: r.team_end ?? null,
      }));
    },
  });
}

export function usePushUnsoldToCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; slotTime: string; scoreId: string }): Promise<{ memberCount: number; teamName: string }> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('push_essentials_unsold_to_crew', {
        p_client_id: input.clientId, p_slot_time: input.slotTime, p_score_id: input.scoreId,
      })), NET_MS, 'Push to crew');
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return { memberCount: Number(d.member_count ?? 0) || 0, teamName: String(d.team_name ?? 'the crew') };
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['essentials-unsold'] }); qc.invalidateQueries({ queryKey: ['manager-chat'] }); },
  });
}

/* ---------- after the close: assign someone free (22 Oct 2026) ---------- */
export function useEssentialsFreeStaff(clientId: string | null, slotTime: string | null) {
  return useQuery({
    queryKey: ['essentials-free-staff', clientId, slotTime],
    enabled: !!clientId && !!slotTime,
    staleTime: 15_000,
    queryFn: async (): Promise<FreeStaff[]> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_essentials_free_staff', { p_client_id: clientId, p_slot_time: slotTime })), NET_MS, 'Free staff');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map(parseFreeStaff);
    },
  });
}

export function useAssignUnsold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; slotTime: string; trainerId: string }): Promise<{ trainerName: string; clientName: string }> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('assign_essentials_unsold', {
        p_client_id: input.clientId, p_slot_time: input.slotTime, p_trainer_id: input.trainerId,
      })), NET_MS, 'Assign session');
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as any;
      return { trainerName: String(d.trainer_name ?? 'the trainer'), clientName: String(d.client_name ?? 'the client') };
    },
    onSettled: () => { ['essentials-unsold', 'essentials-free-staff', 'essentials-auction', 'manager-chat', 'trainer-roster'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
}

/* ---------- members: the unsold cards pushed into my current crew ---------- */
export type UnsoldCrewAlert = { messageId: string; clientId: string; name: string; time: string; modality: string | null; date: string; pushedByName: string | null; createdAt: string };

/** The auction_unsold cards of my current crew, newest first (the home alert reads these). */
export function useUnsoldCrewAlerts() {
  const teamQ = useMyManagerTeam();
  const scoreId = teamQ.data?.scoreId ?? null;
  return useQuery({
    queryKey: ['unsold-crew-alerts', scoreId],
    enabled: !!scoreId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<UnsoldCrewAlert[]> => {
      const { data, error } = await withTimeout(Promise.resolve(
        supabase.from('manager_team_messages').select('id, payload, created_at').eq('team_id', scoreId as string).eq('kind', 'auction_unsold')
          .order('created_at', { ascending: false }).limit(20)), NET_MS, 'Crew alerts');
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((m) => ({
        messageId: String(m.id), clientId: String(m.payload?.client_id ?? ''), name: String(m.payload?.name ?? 'Client'), time: String(m.payload?.time ?? '').slice(0, 5),
        modality: m.payload?.modality ?? null, date: String(m.payload?.date ?? ''), pushedByName: m.payload?.pushed_by_name ?? null, createdAt: String(m.created_at),
      })).filter((a) => a.clientId);
    },
  });
}

export type { ManagerChatMessage };
