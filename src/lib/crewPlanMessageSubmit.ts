/* Sends a My Crew plan message that was kept in the offline outbox (kind 'crew-plan-message', 21 Nov 2026).
   See crewPlanMessage.ts for why. It never posts the same message twice: the first try may have reached the
   server although the phone never heard back, so the chat is asked first whether a "Manager added" message for
   this roster row is already there. Called by offline.ts (lazy require). */
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import type { CrewPlanMessageItem } from './crewPlanMessage';

export async function submitCrewPlanMessage(p: CrewPlanMessageItem): Promise<void> {
  const scheduleId = p?.payload?.schedule_id ?? null;
  if (!p?.teamId || !p?.senderId || !scheduleId) throw new Error('This message cannot be sent. Add the session again.');
  const { data: there, error: readErr } = await withTimeout(
    Promise.resolve(supabase.from('manager_team_messages').select('id').eq('team_id', p.teamId).eq('kind', p.kind).eq('payload->>schedule_id', scheduleId).limit(1)),
    NET_MS, 'My Crew message',
  );
  if (readErr) throw new Error(readErr.message);
  if ((there ?? []).length) return; // already in the chat
  const { error } = await withTimeout(
    Promise.resolve(supabase.from('manager_team_messages').insert({ team_id: p.teamId, sender_id: p.senderId, kind: p.kind, payload: p.payload, body: p.body })),
    NET_MS, 'My Crew message',
  );
  if (error) throw new Error(error.message);
}
