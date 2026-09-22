import { supabase } from './supabase';

/* ============ Bounded waits ============
   Nothing the user waits on may hang forever: every edge-function call, storage
   upload, auth call and GPS fix goes through here so a stalled connection turns
   into an error the UI can show (and a busy flag can clear) instead of a spinner
   that never ends. */
export class TimeoutError extends Error {
  constructor(message = 'The request timed out — check your connection and try again.') {
    super(message);
    this.name = 'TimeoutError';
  }
}
export const isTimeoutError = (e: any) => e?.name === 'TimeoutError';

export const NET_MS = 20_000;     // auth / ordinary edge functions
export const SLOW_FN_MS = 90_000; // AI edge functions (multi-model generation)
export const UPLOAD_MS = 60_000;  // storage uploads (videos up to 50 MB)
export const GPS_MS = 15_000;     // a High-accuracy fix indoors can wait forever otherwise

export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(label ? `${label} timed out — check your connection and try again.` : undefined)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (t) clearTimeout(t); }) as Promise<T>;
}

/* Edge functions that legitimately run long (AI generation). */
const SLOW_FNS = new Set(['compare-qhps', 'analyse-workout-volume', 'coach-ai-workout-plan', 'crm-client-10day-summary']);

/* Drop-in for supabase.functions.invoke: same { data, error } contract, but a
   stalled call resolves with a TimeoutError in `error` after the deadline. */
export async function invokeWithTimeout(name: string, opts?: any, ms?: number): Promise<{ data: any; error: any }> {
  const deadline = ms ?? (SLOW_FNS.has(name) ? SLOW_FN_MS : NET_MS);
  try {
    return await withTimeout(supabase.functions.invoke(name, opts), deadline, name);
  } catch (e: any) {
    return { data: null, error: e };
  }
}

/* Drop-in for supabase.storage.from(bucket).upload(...): same { data, error }. */
export async function uploadWithTimeout(bucket: string, path: string, body: any, opts?: any, ms: number = UPLOAD_MS): Promise<{ data: any; error: any }> {
  try {
    return await withTimeout(supabase.storage.from(bucket).upload(path, body, opts), ms, 'Upload');
  } catch (e: any) {
    return { data: null, error: e };
  }
}
