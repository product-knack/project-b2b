/* WhatsApp inbox (Ops) in the app: data hooks (19 Nov 2026). The same reads and the same server function as the web
   page (hub-track src/hooks/useWhatsApp.ts): the view whatsapp_chats, the table whatsapp_messages, the RPC
   mark_whatsapp_chat_seen and the edge function whatsapp-send (actions check / send / templates / send_template).
   No query key here is in App.tsx PERSIST_PREFIXES, so no chat text is ever written to the phone's storage.
   Feature doc: docs/features/android/ops/whatsapp-inbox.md */
import React from 'react';
import { AppState } from 'react-native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from '../auth';
import { withTimeout, invokeWithTimeout, NET_MS } from './withTimeout';
import { invalidateDebounced } from './invalidateDebounced';
import {
  canSeeWhatsAppWith, missingQuoted, WA_MESSAGE_COLUMNS, WA_SEND_FAILED, WA_SEND_UNKNOWN,
  type WaChat, type WaMessage, type WaNumber, type WaSendCheck, type WaTemplate, type WaTemplateValues,
} from './whatsapp';

export const WA_QK = {
  chats: ['whatsapp-chats'] as const,
  unread: ['whatsapp-unread'] as const,
  threads: ['whatsapp-thread'] as const,
  thread: (phoneNumberId: string, contactWaId: string, size: number) => ['whatsapp-thread', phoneNumberId, contactWaId, size] as const,
};

export const WA_PAGE_SIZE = 50;

/** The numbers of ours the signed-in person may read and send from (20 Nov 2026), as the database lists them
    (whatsapp_my_numbers). `null` = the database does not have that function yet: the old role rule holds. Asked
    once per sign-in and kept for five minutes; a person who owns no number gets an empty list. */
export function useMyWhatsAppNumbers() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  return useQuery({
    queryKey: ['whatsapp-my-numbers', uid],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<WaNumber[] | null> => {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('whatsapp_my_numbers')), NET_MS, 'WhatsApp numbers');
      if (error) {
        const code = String((error as { code?: string }).code ?? '');
        if (code === 'PGRST202' || code === '42883') return null; // not on the database yet
        throw error;
      }
      return (data ?? []) as WaNumber[];
    },
  });
}

/** May this signed-in person see WhatsApp chats at all? (The database rule says the same.) While the list of
    numbers is still being asked the answer is no (20 Nov 2026: a number is given per person, no longer by role,
    so answering by role made the menu item flash for an ops or admin person who holds no number). */
export function useCanSeeWhatsApp(): boolean {
  const { dbRole } = useAuth();
  const q = useMyWhatsAppNumbers();
  if (q.data === undefined && !q.isError) return false;
  return canSeeWhatsAppWith(dbRole, q.isError ? null : q.data);
}

/** The chat list: one row per contact, newest first. Refetched every 30 seconds as a fallback to the live updates. */
export function useWhatsAppChats(enabled = true) {
  const allowed = useCanSeeWhatsApp();
  return useQuery({
    queryKey: WA_QK.chats,
    enabled: enabled && allowed,
    staleTime: 10_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WaChat[]> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from('whatsapp_chats').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(1000)),
        NET_MS, 'WhatsApp chats',
      );
      if (error) throw error;
      return (data ?? []) as WaChat[];
    },
  });
}

/** Unread chats for the menu badge: only the chats with something unread, every minute. */
export function useWhatsAppUnreadCount(): number {
  const allowed = useCanSeeWhatsApp();
  const q = useQuery({
    queryKey: WA_QK.unread,
    enabled: allowed,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.from('whatsapp_chats').select('unread_count').gt('unread_count', 0).limit(1000)),
        NET_MS, 'WhatsApp unread',
      );
      if (error) throw error;
      return ((data ?? []) as { unread_count: number }[]).reduce((n, r) => n + (Number(r.unread_count) || 0), 0);
    },
  });
  return allowed ? q.data ?? 0 : 0;
}

export interface WaThreadData {
  /** Bubbles only (no reactions), oldest first. */
  messages: WaMessage[];
  /** Every reaction row of this chat. */
  reactions: WaMessage[];
  /** Quoted messages that are older than the loaded page. */
  quoted: WaMessage[];
  /** True when older messages exist beyond the loaded ones. */
  hasOlder: boolean;
}

/** One chat's messages: the latest `size` bubbles, its reactions, and any quoted message outside the loaded page.
    `size` grows by WA_PAGE_SIZE when "Load older messages" is pressed. */
export function useWhatsAppThread(phoneNumberId: string | null, contactWaId: string | null, size: number) {
  const allowed = useCanSeeWhatsApp();
  return useQuery({
    queryKey: WA_QK.thread(phoneNumberId ?? '', contactWaId ?? '', size),
    enabled: allowed && !!phoneNumberId && !!contactWaId,
    staleTime: 5_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<WaThreadData> => {
      const base = () => supabase.from('whatsapp_messages').select(WA_MESSAGE_COLUMNS).eq('phone_number_id', phoneNumberId).eq('contact_wa_id', contactWaId);
      const { data: rows, error } = await withTimeout(
        Promise.resolve(base().neq('type', 'reaction').order('wa_timestamp', { ascending: false }).order('id', { ascending: false }).limit(size + 1)),
        NET_MS, 'WhatsApp messages',
      );
      if (error) throw error;
      const newestFirst = (rows ?? []) as unknown as WaMessage[];
      const hasOlder = newestFirst.length > size;
      const messages = newestFirst.slice(0, size).reverse();

      const { data: reactionRows, error: reactionError } = await withTimeout(
        Promise.resolve(base().eq('type', 'reaction').order('wa_timestamp', { ascending: false }).limit(1000)),
        NET_MS, 'WhatsApp reactions',
      );
      if (reactionError) throw reactionError;

      let quoted: WaMessage[] = [];
      const missing = missingQuoted(messages);
      if (missing.length) {
        try {
          const { data: quotedRows, error: quotedError } = await withTimeout(
            Promise.resolve(supabase.from('whatsapp_messages').select(WA_MESSAGE_COLUMNS).in('wamid', missing.slice(0, 100))),
            NET_MS, 'WhatsApp quoted messages',
          );
          // A quoted message we cannot read only loses its preview; the thread still shows.
          if (!quotedError) quoted = (quotedRows ?? []) as unknown as WaMessage[];
        } catch { /* same: preview only */ }
      }
      return { messages, reactions: (reactionRows ?? []) as unknown as WaMessage[], quoted, hasOlder };
    },
  });
}

/** Marks every unseen message of a chat as seen (for the whole team), then refreshes the list and the badge. */
export function useMarkWhatsAppChatSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { phoneNumberId: string; contactWaId: string }): Promise<number> => {
      const { data, error } = await withTimeout(
        Promise.resolve(supabase.rpc('mark_whatsapp_chat_seen', { p_phone_number_id: v.phoneNumberId, p_contact_wa_id: v.contactWaId })),
        NET_MS, 'WhatsApp seen',
      );
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WA_QK.chats });
      qc.invalidateQueries({ queryKey: WA_QK.unread });
    },
    // Not worth a message on screen: the chat stays unread and is tried again on the next open.
    onError: () => {},
  });
}

/** Live updates: the list is a view and cannot be listened to, so this listens to whatsapp_messages and refetches
    the list, the badge and the open threads (changes arriving together cause one refetch). Mount once, on the page. */
export function useWhatsAppRealtime(enabled = true) {
  const qc = useQueryClient();
  const suffix = React.useRef(Math.random().toString(36).slice(2));
  React.useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      invalidateDebounced(qc, [...WA_QK.chats], 250);
      invalidateDebounced(qc, [...WA_QK.unread], 250);
      invalidateDebounced(qc, [...WA_QK.threads], 250);
    };
    const channel = supabase
      .channel(`whatsapp-live-${suffix.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, refresh)
      .subscribe();
    // Back from the background: catch up at once (realtime may have slept).
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => {
      sub.remove();
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}

/* ---------------- Replies, templates: the edge function whatsapp-send ---------------- */

/** The answer of a function call, also when the function answered with an error status ({ ok, code, message }). */
async function invokeSend(body: Record<string, unknown>): Promise<Record<string, any> | null> {
  const { data, error } = await invokeWithTimeout('whatsapp-send', { body });
  if (!error) return (data ?? null) as Record<string, any> | null;
  try {
    const res = (error as any)?.context;
    if (res && typeof res.json === 'function') return (await res.json()) as Record<string, any>;
  } catch { /* not JSON */ }
  return null;
}

/** May this chat be written to from the page right now? The test lock lives in a function secret. */
export function useWhatsAppSendCheck(phoneNumberId: string | null, contactWaId: string | null) {
  const allowed = useCanSeeWhatsApp();
  return useQuery({
    queryKey: ['whatsapp-send-check', phoneNumberId ?? '', contactWaId ?? ''],
    enabled: allowed && !!phoneNumberId && !!contactWaId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<WaSendCheck> => {
      const res = await invokeSend({ action: 'check', phone_number_id: phoneNumberId, contact_wa_id: contactWaId });
      if (res?.ok) return { mode: res.mode ?? 'off', allowed: res.allowed === true, message: res.message ?? null };
      return { mode: 'off', allowed: false, message: res?.message ?? WA_SEND_UNKNOWN };
    },
  });
}

/** The approved templates of the WhatsApp account of ONE of our numbers (two numbers can sit in two accounts),
    asked when the picker opens. */
export function useWhatsAppTemplates(enabled: boolean, phoneNumberId?: string | null) {
  const allowed = useCanSeeWhatsApp();
  return useQuery({
    queryKey: ['whatsapp-templates', phoneNumberId ?? ''],
    enabled: allowed && enabled,
    staleTime: 3 * 60_000,
    retry: 1,
    queryFn: async (): Promise<WaTemplate[]> => {
      const res = await invokeSend({ action: 'templates', ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}) });
      if (res?.ok && Array.isArray(res.templates)) return res.templates as WaTemplate[];
      throw new Error(res?.message ?? 'The templates could not be loaded. Check your connection and try again.');
    },
  });
}

export interface WaSendResult {
  ok: boolean;
  /** True when the message is a row of the table now (sent, or failed with its reason on the row). */
  stored: boolean;
  message: string | null;
}

const sendResultOf = (res: Record<string, any> | null): WaSendResult => {
  if (!res) return { ok: false, stored: false, message: WA_SEND_FAILED };
  if (res.ok) return { ok: true, stored: true, message: null };
  // WHATSAPP_REFUSED: the row exists and says failed with the reason. Every other refusal stored nothing.
  return { ok: false, stored: res.code === 'WHATSAPP_REFUSED', message: res.message ?? WA_SEND_FAILED };
};

/** Sends one reply. The same clientRef can be sent again (Try again): the server never sends a message twice. */
export function useSendWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { phoneNumberId: string; contactWaId: string; clientRef: string; text: string }): Promise<WaSendResult> => {
      let res: Record<string, any> | null = null;
      try {
        res = await invokeSend({ action: 'send', phone_number_id: v.phoneNumberId, contact_wa_id: v.contactWaId, client_ref: v.clientRef, text: v.text });
      } catch { res = null; }
      return sendResultOf(res);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WA_QK.chats });
      qc.invalidateQueries({ queryKey: WA_QK.threads });
    },
  });
}

/** Sends one approved template: works outside WhatsApp's 24 hours and to a number that has no chat yet. */
export function useSendWhatsAppTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { phoneNumberId: string; contactWaId: string; clientRef: string; templateName: string; language: string; values: WaTemplateValues }): Promise<WaSendResult> => {
      let res: Record<string, any> | null = null;
      try {
        res = await invokeSend({
          action: 'send_template', phone_number_id: v.phoneNumberId, contact_wa_id: v.contactWaId, client_ref: v.clientRef,
          template_name: v.templateName, language: v.language, params: v.values,
        });
      } catch { res = null; }
      return sendResultOf(res);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: WA_QK.chats });
      qc.invalidateQueries({ queryKey: WA_QK.threads });
    },
  });
}
