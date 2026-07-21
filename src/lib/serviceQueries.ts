import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/* ============ CRM Service Requests — mirrors the web CRMServiceRequests:
   service_bookings + clients/services embeds; approve → confirmed,
   reject → cancelled, reschedule → confirmed + new preferred slot. ============ */

export type ServiceBooking = {
  id: string; clientName: string; clientEmail: string | null;
  serviceName: string; category: string | null; durationMin: number | null;
  bookingType: string | null; preferredDate: string | null; preferredTime: string | null;
  status: string; notes: string | null; createdAt: string;
};

const fullName = (p: any) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.replace(/\s+/g, ' ').trim() || 'Client';

export function useServiceBookings() {
  return useQuery({
    queryKey: ['crm-service-bookings'],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ServiceBooking[]> => {
      const { data, error } = await supabase
        .from('service_bookings')
        .select('*, clients!inner(first_name, last_name, email), services!inner(name, category, duration_minutes)')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        clientName: fullName(r.clients),
        clientEmail: r.clients?.email ?? null,
        serviceName: r.services?.name ?? 'Service',
        category: r.services?.category ?? null,
        durationMin: r.services?.duration_minutes ?? null,
        bookingType: r.booking_type ?? null,
        preferredDate: r.preferred_date ?? null,
        preferredTime: r.preferred_time ?? null,
        status: r.status ?? 'pending',
        notes: r.notes ?? null,
        createdAt: r.created_at,
      }));
    },
  });
}

export function useUpdateServiceBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: string; newDate?: string; newTime?: string }) => {
      const patch: any = { status: input.status };
      if (input.newDate && input.newTime) {
        patch.preferred_date = input.newDate;
        patch.preferred_time = input.newTime;
      }
      const { error } = await supabase.from('service_bookings').update(patch).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-service-bookings'] }),
  });
}
