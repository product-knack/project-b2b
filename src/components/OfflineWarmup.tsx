import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth';
import { getIsOnline } from '../lib/offline';
import { DEV_TRAINER_ID } from '../lib/supabase';
import {
  useMyClients, useClientDetail, useClientSessions, useClientPlans, useClientGoals,
  useClientReports, useClientBioAge, useClientProgression, useClientDailyStats,
} from '../lib/clientQueries';
import { useTodayRoster, useTrainerStats, useTrainerProfile, useTrainerAckSummary, useTrainerLeaderboard } from '../lib/trainerQueries';
import { useClientThreadList } from '../lib/clientThreadQueries';

/* ============ Offline warm-up (render-nothing, TRAINERS) ============
   Makes the app usable offline for pages the trainer HASN'T visited yet.
   The query cache is already persisted to SQLite (App.tsx PersistQueryClient),
   so anything fetched once serves from disk offline. This component simply
   MOUNTS the same hooks the screens use — same query keys, same queryFns,
   zero duplication — so their results land in the persisted cache ahead of time.

   Behavior:
   • trainers only, online only, throttled to once per WARM_INTERVAL_HOURS
   • dashboard-level data first, then each assigned client's detail bundle,
     staggered in batches of BATCH_SIZE every BATCH_DELAY_MS to keep the
     network + battery cost gentle
   • unmounts itself when the sweep is done (observers detach, cache stays) */

const WARM_INTERVAL_HOURS = 3;
const LAST_KEY = 'offline-warmup:lastAt';
const BATCH_SIZE = 4;
const BATCH_DELAY_MS = 4000;
const MAX_CLIENTS = 40;

export function OfflineWarmup() {
  const { session, dbRole } = useAuth();
  const uid = session?.user?.id ?? null;
  const isTestAccount = session?.user?.email?.startsWith('rn-test-trainer');
  const trainerId = !session ? null : isTestAccount ? DEV_TRAINER_ID : session.user.id;
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    if (!uid || dbRole !== 'trainer') { setActive(false); return; }
    (async () => {
      try {
        if (!getIsOnline()) return;
        const last = await AsyncStorage.getItem(LAST_KEY);
        if (last && Date.now() - Number(last) < WARM_INTERVAL_HOURS * 3_600_000) return;
        if (!alive) return;
        setActive(true);
        AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
      } catch { /* never block the app over warm-up */ }
    })();
    return () => { alive = false; };
  }, [uid, dbRole]);

  if (!active || !uid || !trainerId) return null;
  return <TrainerWarm uid={uid} trainerId={trainerId} onDone={() => setActive(false)} />;
}

function TrainerWarm({ uid, trainerId, onDone }: { uid: string; trainerId: string; onDone: () => void }) {
  // Dashboard-level surface — same hooks the screens call.
  useTrainerStats(trainerId);
  useTrainerProfile(trainerId);
  useTrainerAckSummary(trainerId);
  useTrainerLeaderboard();
  useTodayRoster(trainerId, 0);
  useTodayRoster(trainerId, 1);
  useTodayRoster(trainerId, -1);
  useClientThreadList(uid, 'trainer');
  const clientsQ = useMyClients(trainerId);

  const clientIds = React.useMemo(
    () => (clientsQ.data ?? []).map((c) => c.client_id).slice(0, MAX_CLIENTS),
    [clientsQ.data]
  );

  // Stagger client-detail bundles in small batches.
  const [batch, setBatch] = React.useState(1);
  React.useEffect(() => {
    if (!clientIds.length) return;
    const totalBatches = Math.ceil(clientIds.length / BATCH_SIZE);
    if (batch >= totalBatches) {
      // Grace period for the last batch's fetches to settle, then unmount.
      const t = setTimeout(onDone, 15_000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setBatch((b) => b + 1), BATCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [batch, clientIds.length]);

  // If the trainer has no clients, finish once the list settles.
  React.useEffect(() => {
    if (clientsQ.isSuccess && clientIds.length === 0) onDone();
  }, [clientsQ.isSuccess, clientIds.length]);

  return (
    <>
      {clientIds.slice(0, batch * BATCH_SIZE).map((id) => (
        <WarmClient key={id} clientId={id} />
      ))}
    </>
  );
}

/* One client's full detail bundle — mirrors what ClientDetail mounts. */
function WarmClient({ clientId }: { clientId: string }) {
  useClientDetail(clientId);
  useClientSessions(clientId);
  useClientPlans(clientId);
  useClientGoals(clientId);
  useClientReports(clientId);
  useClientBioAge(clientId);
  useClientProgression(clientId);
  useClientDailyStats(clientId);
  return null;
}
