// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/listen_resync_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// A spoken summary heard on a weak or missing connection is always marked heard on the server (25 Nov 2026).
// Runs the real src/lib/listenSync.ts and src/lib/listenLocal.ts against a fake phone store, a fake outbox and a
// fake server. Nothing reaches the live project.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const read = (rel) => fs.readFileSync(ROOT + rel, 'utf8');
const compile = (rel) => ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

/* ---- one phone: its storage, its outbox, its connection, and the server it talks to ---- */
function makePhone() {
  const disk = {};
  const server = { calls: [], progress: {}, fail: null }; // fail: (name, args) => Error | null
  let online = true;
  let outbox = [];
  let seq = 0;
  const AsyncStorage = { getItem: async (k) => disk[k] ?? null, setItem: async (k, v) => { disk[k] = v; }, removeItem: async (k) => { delete disk[k]; } };
  const supabase = { rpc: async (name, args) => {
    server.calls.push(name);
    const err = server.fail ? server.fail(name, args) : null;
    if (err === 'hang') return new Promise(() => {});
    if (err === 'stale') return { data: { stale: true }, error: null };
    if (err) return { data: null, error: err };
    if (name === 'log_summary_listen_progress') {
      const key = `${args.p_client_id}|${args.p_which}|${args.p_version}`;
      server.progress[key] = { percent: Math.max(server.progress[key]?.percent ?? 0, args.p_percent), at: args.p_at };
      return { data: { stale: false }, error: null };
    }
    return { data: null, error: null };
  } };
  const offline = {
    getIsOnline: () => online,
    getOutboxMine: () => outbox,
    enqueueOutbox: async (kind, label, payload) => { outbox.push({ id: 'o' + ++seq, kind, label, payload, status: 'pending', attempts: 0 }); },
    updateOutboxItem: async (id, patch) => { outbox = outbox.map((i) => (i.id === id ? { ...i, payload: patch.payload, status: 'pending', error: undefined } : i)); return true; },
  };
  const mods = {};
  const req = (n) => {
    if (n === 'react') return { useRef: (v) => ({ current: v }), useCallback: (f) => f, useReducer: () => [0, () => {}], useEffect: () => {} };
    if (n === 'react-native') return { Platform: { OS: 'android' } };
    if (n === '@react-native-async-storage/async-storage') return { __esModule: true, default: AsyncStorage };
    if (n === './supabase') return { supabase };
    if (n === './withTimeout') return { NET_MS: 30, withTimeout: (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(`${label} took too long. Check your connection and try again.`), { name: 'TimeoutError' })), ms))]) };
    if (n === './offline') return offline;
    if (n === './sessionTeardown') return { registerTeardown: () => {} };
    if (n === './clientHealthSummary' || n === './listenLocal' || n === './listenSync') {
      if (!mods[n]) { const m = { exports: {} }; mods[n] = m.exports; new Function('module', 'exports', 'require', compile(`/src/lib/${n.slice(2)}.ts`))(m, m.exports, req); mods[n] = m.exports; }
      return mods[n];
    }
    throw new Error('unexpected require ' + n);
  };
  const sync = req('./listenSync'), local = req('./listenLocal');
  local.setListenLocalUser('ME');
  // the app's drain, as offline.ts runs it: first the sweep, then every pending item once
  const isTransient = (e) => e?.name === 'TimeoutError' || /network request failed|network error|failed to fetch|fetch failed|timeout|timed out|abort|socket|ENOTFOUND|ECONN/i.test(String(e?.message ?? ''));
  const drain = async () => {
    if (!online) return;
    await sync.queueUnsyncedListens();
    for (const item of outbox.filter((i) => i.status === 'pending')) {
      try { await sync.submitQueuedListen(item.kind, item.payload); outbox = outbox.filter((i) => i.id !== item.id); }
      catch (e) {
        if (isTransient(e)) { outbox = outbox.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1 } : i)); break; }
        outbox = outbox.map((i) => (i.id === item.id ? { ...i, status: 'failed', attempts: i.attempts + 1, error: String(e.message) } : i));
      }
    }
  };
  return { sync, local, server, drain, outbox: () => outbox, setOnline: (v) => { online = v; }, setOutbox: (v) => { outbox = v; }, disk };
}
const ROW = {
  client_id: 'C1', briefing_date: '2026-11-25', listen_history: [], context_dirty: false,
  weekly_summary: { version: 7, generated_at: '2026-11-24T11:10:00Z', script: 'x' }, weekly_generated_at: '2026-11-24T11:10:00Z',
  context_summary: { version: 3, generated_at: '2026-11-20T05:00:00Z', script: 'y' }, context_generated_at: '2026-11-20T05:00:00Z',
};
const heardOnServer = (p, which = 'weekly') => p.server.progress[`C1|${which}|${which === 'weekly' ? 7 : 3}`]?.percent ?? null;
const localRec = (p, which = 'weekly') => { const r = p.local.getLocalListen('C1', which); return r ? [r.percent, r.heard, r.synced] : null; };

(async () => {
  // ---- 1. online and healthy: straight to the server, nothing queued
  let p = makePhone();
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  eq('online: heard goes straight to the server, the phone record is confirmed, nothing queued', [heardOnServer(p), localRec(p), p.outbox().length], [100, [100, true, true], 0]);
  eq('the build the listen belongs to is read from the row', p.local.getLocalListen('C1', 'weekly').generatedAt, '2026-11-24T11:10:00Z');

  // ---- 2. no internet: kept on the phone and queued, sent when the connection is back
  p = makePhone(); p.setOnline(false);
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 60);
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  eq('offline: heard on the phone, ONE queued item with the best percent, server not reached', [localRec(p), p.outbox().map((i) => [i.kind, i.payload.percent]), p.server.calls.length], [[100, true, false], [['summary-listen-progress', 100]], 0]);
  await p.drain();
  eq('offline: a drain without a connection sends nothing', [p.server.calls.length, p.outbox().length], [0, 1]);
  p.setOnline(true); await p.drain();
  eq('back online: the server has it as heard, the phone record is confirmed, the queue is empty', [heardOnServer(p), localRec(p), p.outbox().length], [100, [100, true, true], 0]);
  const heardAt = p.local.getLocalListen('C1', 'weekly').heardAt;
  eq('the server is given the time it was really heard, not the time it was sent', p.server.progress['C1|weekly|7'].at === heardAt && !!heardAt, true);

  // ---- 3. weak internet: the write never answers
  p = makePhone(); p.server.fail = () => 'hang';
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  eq('weak connection (no answer): queued, not lost', [localRec(p), p.outbox().length], [[100, true, false], 1]);
  p.server.fail = null; await p.drain();
  eq('weak connection: sent by the next drain', [heardOnServer(p), localRec(p), p.outbox().length], [100, [100, true, true], 0]);

  // ---- 4. the gap of before 25 Nov 2026: an online write refused for a reason that is not the connection
  p = makePhone(); p.server.fail = () => ({ message: 'JWT expired', code: 'PGRST301' });
  const warn = console.warn; console.warn = () => {};
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  eq('an expired sign-in while writing: the heard mark is queued (before, it was dropped)', [localRec(p), p.outbox().length], [[100, true, false], 1]);
  await p.drain();
  eq('the server still says no: the item waits as failed, the phone still knows it was heard', [p.outbox().map((i) => [i.status, i.attempts]), localRec(p)], [[['failed', 1]], [100, true, false]]);
  p.server.fail = null; await p.drain();
  eq('the next drain offers it again and the server takes it', [heardOnServer(p), localRec(p), p.outbox().length], [100, [100, true, true], 0]);

  // ---- 5. a server that keeps refusing is not asked for ever
  p = makePhone(); p.server.fail = () => ({ message: 'something broke on the server' });
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  for (let i = 0; i < 20; i++) await p.drain();
  eq('offered again a fixed number of times, then left for review', [p.outbox().map((i) => [i.status, i.attempts]), p.sync.LISTEN_RETRY_MAX], [[['failed', 8]], 8]);
  eq('the phone still knows it was heard, so this phone does not ask again', localRec(p), [100, true, false]);
  console.warn = warn;

  // ---- 6. the app was closed while the write was on its way: no queued item, only the phone record
  p = makePhone();
  await p.local.recordLocalListen({ clientId: 'C1', which: 'context', version: 3, generatedAt: ROW.context_generated_at, briefingDate: ROW.briefing_date, percent: 100 });
  eq('heard on the phone only, nothing queued (the app was closed mid-write)', [localRec(p, 'context'), p.outbox().length], [[100, true, false], 0]);
  const queued = await p.sync.queueUnsyncedListens();
  eq('the sweep queues it', [queued, p.outbox().map((i) => [i.kind, i.payload.which, i.payload.percent, i.payload.version])], [1, [['summary-listen-progress', 'context', 100, 3]]]);
  eq('a second sweep adds nothing', [await p.sync.queueUnsyncedListens(), p.outbox().length], [0, 1]);
  const both = await Promise.all([p.sync.queueUnsyncedListens(), p.sync.queueUnsyncedListens()]);
  eq('two sweeps at once are one sweep', [both, p.outbox().length], [[0, 0], 1]);
  await p.drain();
  eq('and the drain sends it', [heardOnServer(p, 'context'), localRec(p, 'context'), p.outbox().length], [100, [100, true, true], 0]);
  eq('nothing more to send afterwards', [await p.sync.queueUnsyncedListens(), p.server.calls.length], [0, 1]);

  // ---- 7. what the sweep leaves alone
  p = makePhone();
  await p.local.recordLocalListen({ clientId: 'C1', which: 'weekly', version: 7, generatedAt: ROW.weekly_generated_at, briefingDate: ROW.briefing_date, percent: 0 });
  eq('a Play with nothing heard yet is not sent as progress', [await p.sync.queueUnsyncedListens(), p.outbox().length], [0, 0]);
  await p.local.recordLocalListen({ clientId: 'C1', which: 'weekly', version: 7, generatedAt: ROW.weekly_generated_at, briefingDate: ROW.briefing_date, percent: 40 });
  p.local.setListenLocalUser('SOMEONE_ELSE');
  eq("another person's record on the same phone is not sent", [await p.sync.queueUnsyncedListens(), p.outbox().length], [0, 0]);
  p.local.setListenLocalUser('ME');
  eq('a part listen (40 percent) is sent too, as 40', [await p.sync.queueUnsyncedListens(), p.outbox().map((i) => i.payload.percent)], [1, [40]]);
  await p.local.recordLocalListen({ clientId: 'C1', which: 'weekly', version: 7, generatedAt: ROW.weekly_generated_at, briefingDate: ROW.briefing_date, percent: 100 });
  eq('heard to the end later: the queued item takes the better percent, still one item', [await p.sync.queueUnsyncedListens(), p.outbox().map((i) => i.payload.percent)], [1, [100]]);

  // ---- 8. the server's final no ends it
  p = makePhone(); p.setOnline(false);
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  p.setOnline(true); p.server.fail = () => ({ message: 'LISTEN_TOO_OLD: This listen is older than 7 days.' });
  await p.drain(); await p.drain();
  eq('a listen older than the server keeps is dropped once and not queued again', [p.outbox().length, localRec(p), p.server.calls.length], [0, [100, true, true], 1]);
  p = makePhone(); p.server.fail = () => ({ message: 'Not allowed to listen' });
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  eq('the same when the server refuses the person at once', [p.outbox().length, localRec(p)], [0, [100, true, true]]);

  // ---- 9. the summary was rebuilt before the listen arrived: the old record is dropped (the new one must be heard)
  p = makePhone(); p.setOnline(false);
  await p.sync.writeListenProgress(ROW, 'C1', 'weekly', 100);
  p.setOnline(true); p.server.fail = () => 'stale';
  await p.drain(); await p.drain();
  eq('the server says the summary changed: the item and the old phone record are gone, nothing is sent again', [p.outbox().length, localRec(p), p.server.calls.length], [0, null, 1]);

  // ---- 10. the wiring
  const offline = read('/src/lib/offline.ts');
  const syncSrc = read('/src/lib/listenSync.ts');
  eq('every drain starts with the sweep, which can never stop the drain', /export async function drainOutbox\(\) \{\s*await load\(\);\s*if \(draining \|\| !online\) return;[\s\S]{0,420}try \{ await require\('\.\/listenSync'\)\.queueUnsyncedListens\(\); \} catch \{/.test(offline), true);
  eq('the drain runs at app start, when the connection is back, and at sign-in', [/if \(next && wasOffline\) drainOutbox\(\);/.test(offline), /if \(online\) drainOutbox\(\);/.test(offline), /if \(uid\) drainOutbox\(\);/.test(offline)], [true, true, true]);
  eq('an online write that fails is no longer dropped with only a note', [/progress not written/.test(syncSrc), /if \(isFinalRefusal\(e\)\) \{ await markLocalListenSynced\(clientId, which, generatedAt\); return; \}/.test(syncSrc)], [false, true]);
  eq('the gate reads the phone record together with the server row', /listenGate\(summaryQ\.data, authSession\?\.user\?\.id \?\? null, Date\.now\(\), listenLocal\)/.test(read('/src/screens/trainer.tsx')), true);

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('ERROR', e); process.exit(1); });
