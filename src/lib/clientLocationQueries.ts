/* Client location pins for the QHP Manager cards (2 Nov 2026, owner: "on the Not Scheduled and Scheduled cards, a
   button with an input box to add the client's location, saved the same way and in the same format as the Leads
   page, so the assessor can navigate"). Server: hub-track migration 20261102140000_client_location_rpc.sql (live).
   The pin is clients.brb_location, the one QHP navigation, the roster distance, the doctor cards and the
   Essentials auction already read. Plain-object query data (persisted cache). Rules in ./sharedLocation.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout, NET_MS } from './withTimeout';
import { friendlyError } from './friendlyError';
import { codedSentence } from './approvalRequests';
import { readBrbLocation } from './sharedLocation';

export type ClientPin = { lat: number; lng: number; method: string; updated_at: string };

/** The saved pins of these clients (QHP managers may read every client: policy of 20261012110000). Clients
    without a pin are simply absent. Kept apart from useQhpManager so its ['qhp-manager', 'v5'] cache shape stays. */
export function useClientPins(clientIds: (string | null | undefined)[], enabled = true) {
  const ids = [...new Set(clientIds.filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ['client-pins', ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, ClientPin>> => {
      const out: Record<string, ClientPin> = {};
      for (let i = 0; i < ids.length; i += 150) {   // the id list travels in the URL: batches keep it short
        const chunk = ids.slice(i, i + 150);
        const { data, error } = await withTimeout(
          Promise.resolve(supabase.from('clients').select('id, brb_location').in('id', chunk).not('brb_location', 'is', null)) as Promise<{ data: any; error: any }>,
          NET_MS, 'Client pins');
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as any[]) {
          const b = readBrbLocation(r.brb_location);
          if (b) out[r.id] = { lat: b.lat, lng: b.lng, method: b.method, updated_at: b.updated_at };
        }
      }
      return out;
    },
  });
}

/** The server's plain sentence for a refused save ("LOCATION_FORBIDDEN: Only ops, CRM, admin or a QHP manager can
    save a client location."): two refusals carry the 42501 code, which friendlyError would turn into its generic
    "not allowed" line, so the server's words come first. */
export const locationErrorText = (e: unknown): string => codedSentence(e) ?? friendlyError(e, 'Could not save the location. Try again.');

/** Saves the pin through the RPC. Never a direct update of clients.brb_location: a QHP manager is usually a
    trainer-role profile, and the clients UPDATE policies would silently change nothing for a client they are not
    assigned to. */
export function useSetClientPin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, lat, lng }: { clientId: string; lat: number; lng: number }): Promise<ClientPin> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('set_client_brb_location', { p_client_id: clientId, p_lat: lat, p_lng: lng })) as Promise<{ data: any; error: any }>,
        NET_MS, 'Save location');
      if (error) throw error;
      const b = readBrbLocation(data);
      return b ? { lat: b.lat, lng: b.lng, method: b.method, updated_at: b.updated_at } : { lat, lng, method: 'ops_whatsapp_paste', updated_at: new Date().toISOString() };
    },
    onSuccess: (_pin, v) => {
      qc.invalidateQueries({ queryKey: ['client-pins'] });
      qc.invalidateQueries({ queryKey: ['qhp-manager'] });
      qc.invalidateQueries({ queryKey: ['qhp-assessments'] });   // the assessor's QHP cards and Start navigation
      qc.invalidateQueries({ queryKey: ['client-detail', v.clientId] });
    },
  });
}
