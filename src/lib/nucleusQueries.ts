/* Odds Nucleus data (16 Oct 2026): the published pieces (one small query, read only) and
   the device-side state (saved pieces, the recent list, resume positions) in AsyncStorage
   keyed by the signed-in user. The app writes NOTHING to the database for this feature:
   longevity_resource_progress is the member app's table and its policy refuses staff. */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';
import { registerTeardown } from './sessionTeardown';
import { useAuth } from '../auth';
import { type NucleusPiece, type NucleusPosition, toPiece, sortPieces, localKeys, pushRecent, CONTINUE_MAX } from './nucleus';

export const NUCLEUS_KEY = ['nucleus', 'pieces'] as const;
const NUCLEUS_MS = 30_000;

/* ---------- the pieces ---------- */
export async function fetchNucleusPieces(): Promise<NucleusPiece[]> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.from('longevity_resources').select('*').eq('published', true).order('sort', { ascending: true }).order('published_at', { ascending: false }).limit(500)),
    NUCLEUS_MS, 'Odds Nucleus',
  );
  if (error) throw new Error(error.message);
  return sortPieces((data ?? []).map(toPiece));
}

/** Key ['nucleus', 'pieces'] (persisted: the list renders offline). The hub passes eager = true so
    the list is refetched every time it opens (an unpublished piece leaves within about 30 minutes
    of use); the home teaser only refetches when the 5 minute staleTime has passed. */
export function useNucleusPieces(eager = false) {
  return useQuery({
    queryKey: NUCLEUS_KEY,
    staleTime: 5 * 60_000,
    refetchOnMount: eager ? 'always' : true,
    queryFn: fetchNucleusPieces,
  });
}

/* ---------- device-side state ----------
   One in-memory copy per signed-in user, shared by every mounted screen through a tiny
   subscription; AsyncStorage behind it. Every storage call is wrapped: a private window
   or a failing disk never breaks the screen. */
type LocalState = { userId: string | null; loaded: boolean; saved: string[]; recent: string[]; positions: Record<string, NucleusPosition> };
let mem: LocalState = { userId: null, loaded: false, saved: [], recent: [], positions: {} };
const listeners = new Set<() => void>();
const emit = () => { for (const l of Array.from(listeners)) l(); };
let loading: Promise<void> | null = null;

registerTeardown(() => { mem = { userId: null, loaded: false, saved: [], recent: [], positions: {} }; loading = null; emit(); });

const parseIds = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const parsePos = (raw: string | null): NucleusPosition | null => {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object') return null;
    const medium = v.medium === 'audio' || v.medium === 'video' || v.medium === 'read' ? v.medium : null;
    const value = Number(v.value);
    if (!medium || !Number.isFinite(value)) return null;
    return { medium, value, at: typeof v.at === 'string' ? v.at : new Date().toISOString() };
  } catch { return null; }
};

async function load(userId: string) {
  if (mem.userId === userId && mem.loaded) return;
  if (mem.userId !== userId) { mem = { userId, loaded: false, saved: [], recent: [], positions: {} }; emit(); }
  if (loading) return loading;
  loading = (async () => {
    const k = localKeys(userId);
    let saved: string[] = [], recent: string[] = [];
    const positions: Record<string, NucleusPosition> = {};
    try {
      const [s, r] = await AsyncStorage.multiGet([k.saved, k.recent]);
      saved = parseIds(s[1]);
      recent = parseIds(r[1]);
      if (recent.length) {
        const rows = await AsyncStorage.multiGet(recent.map((id) => k.pos(id)));
        rows.forEach(([key, raw], i) => { const p = parsePos(raw); if (p) positions[recent[i]] = p; void key; });
      }
    } catch { /* nothing stored, or storage unavailable: start empty */ }
    if (mem.userId !== userId) return;
    mem = { userId, loaded: true, saved, recent, positions };
    emit();
  })().finally(() => { loading = null; });
  return loading;
}

const write = (key: string, value: unknown) => { AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {}); };
const remove = (key: string) => { AsyncStorage.removeItem(key).catch(() => {}); };

export type NucleusLocal = {
  loaded: boolean;
  savedIds: string[];
  recentIds: string[];
  positions: Record<string, NucleusPosition>;
  isSaved: (id: string) => boolean;
  toggleSaved: (id: string) => boolean;
  touchRecent: (id: string) => void;
  getPosition: (id: string) => NucleusPosition | null;
  setPosition: (id: string, pos: NucleusPosition) => void;
  clearPosition: (id: string) => void;
  /** The pieces for the Continue strip: the last few opened, newest first. */
  continueIds: string[];
};

export function useNucleusLocal(): NucleusLocal {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(bump);
    if (userId) load(userId).catch(() => {});
    return () => { listeners.delete(bump); };
  }, [userId]);

  const ensure = () => { if (userId && mem.userId !== userId) mem = { userId, loaded: mem.loaded && mem.userId === userId, saved: [], recent: [], positions: {} }; };
  const api = React.useMemo<NucleusLocal>(() => ({
    loaded: mem.loaded && mem.userId === userId,
    savedIds: mem.userId === userId ? mem.saved : [],
    recentIds: mem.userId === userId ? mem.recent : [],
    positions: mem.userId === userId ? mem.positions : {},
    continueIds: (mem.userId === userId ? mem.recent : []).slice(0, CONTINUE_MAX),
    isSaved: (id) => mem.userId === userId && mem.saved.includes(id),
    toggleSaved: (id) => {
      if (!userId) return false;
      ensure();
      const on = !mem.saved.includes(id);
      mem = { ...mem, saved: on ? [id, ...mem.saved] : mem.saved.filter((x) => x !== id) };
      write(localKeys(userId).saved, mem.saved);
      emit();
      return on;
    },
    touchRecent: (id) => {
      if (!userId) return;
      ensure();
      mem = { ...mem, recent: pushRecent(mem.recent, id) };
      write(localKeys(userId).recent, mem.recent);
      emit();
    },
    getPosition: (id) => (mem.userId === userId ? mem.positions[id] ?? null : null),
    setPosition: (id, pos) => {
      if (!userId) return;
      ensure();
      mem = { ...mem, positions: { ...mem.positions, [id]: pos } };
      write(localKeys(userId).pos(id), pos);
      emit();
    },
    clearPosition: (id) => {
      if (!userId) return;
      ensure();
      const { [id]: _gone, ...rest } = mem.positions;
      mem = { ...mem, positions: rest };
      remove(localKeys(userId).pos(id));
      emit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [userId, mem]);
  return api;
}

/** A piece's stored position even when it is not in the recent list (read on the piece screen). */
export async function readPosition(userId: string, pieceId: string): Promise<NucleusPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(localKeys(userId).pos(pieceId));
    const p = parsePos(raw);
    if (p && mem.userId === userId) { mem = { ...mem, positions: { ...mem.positions, [pieceId]: p } }; emit(); }
    return p;
  } catch { return null; }
}
