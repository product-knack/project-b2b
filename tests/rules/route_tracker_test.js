// node test of src/lib/routeTracker.ts (21 Oct 2026 rules): the live payload, the position
// throttle, start retried until it lands, nothing sent before the row exists, ROUTE_NOT_STARTED
// resends start, ROUTE_FORBIDDEN / ROUTE_NO_QHP stop for good, ROUTE_ENDED stops live events but
// `ended` still lands, `ended` queued in the outbox when offline or dropped, the outbox replay.
// react-native / supabase / withTimeout / offline are stubbed.
const ROOT = require('path').resolve(__dirname, '../..');
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/routeTracker.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

const calls = [];
let answer = () => ({ data: { status: 'on_the_way' }, error: null });
let online = true;
const queued = [];
const fakeSupabase = { rpc: (name, args) => { calls.push({ name, ...args }); return Promise.resolve(answer(args)); } };
const stubRequire = (id) => {
  if (id === 'react-native') return { Platform: { OS: 'android' } };
  if (id === './supabase') return { supabase: fakeSupabase };
  if (id === './withTimeout') return { withTimeout: (p) => p };
  if (id === './offline') return { enqueueOutbox: async (kind, label, payload) => { queued.push({ kind, label, payload }); return { id: 'q1' }; }, getIsOnline: () => online };
  return require(id);
};
global.__DEV__ = false;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, stubRequire);
const R = m.exports;

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const events = () => calls.map((c) => c.p_event);
const reset = () => { calls.length = 0; queued.length = 0; online = true; answer = () => ({ data: { status: 'on_the_way' }, error: null }); };
const ID = '11111111-1111-1111-1111-111111111111';
const live = (t = 1) => ({ lat: 28.5, lng: 77.2, heading: 90, speed_mps: 5, accuracy_m: 8, eta_min: 10, distance_km: 3, fix_at: new Date(t).toISOString() });
const track = { points: [[0, 28.5, 77.2, 8, 5]], polyline: 'abc', distance_km: 3.2, duration_min: 14, avg_kmh: 13.7, arrival_gap_m: 20, ended_by: 'ended' };
const planned = { planned_km: 5, planned_min: 20, planned_polyline: 'xyz' };
const pin = { lat: 28.6, lng: 77.3, captured_at: null, method: 'ops_paste' };

(async () => {
  // liveFromFix
  const fix = { t: Date.UTC(2026, 9, 14, 6, 12, 31), lat: 28.5607, lng: 77.2109, acc: 9, spd: 6.1, heading: 112 };
  const lv = R.liveFromFix(fix, { etaMin: 14, distanceKm: 5.3 }, 110);
  eq('live lat/lng', [lv.lat, lv.lng], [28.5607, 77.2109]);
  eq('live fix_at ISO', lv.fix_at, '2026-10-14T06:12:31.000Z');
  eq('live heading: the screen heading wins', lv.heading, 110);
  eq('live heading falls back to the fix', R.liveFromFix(fix, { etaMin: null, distanceKm: null }, null).heading, 112);
  eq('live eta', [lv.eta_min, lv.distance_km], [14, 5.3]);

  // start lands, positions flow with the throttle
  reset();
  let clock = 1_000_000;
  let pub = new R.RoutePublisher(ID, () => clock, 20);
  eq('start lands', await pub.start(live(), planned, pin, '5.1 (34)'), true);
  eq('start record', calls[0].p_record, { ...planned, pin, source: 'android', app_version: '5.1 (34)' });
  eq('started', pub.isStarted, true);
  eq('position right after start is throttled', pub.position(live()), false);
  clock += 5_001;
  eq('position after 5 s moving', pub.position(live()), true);
  clock += 5_001;
  eq('still: 5 s is not enough', pub.position({ ...live(), speed_mps: 0 }), false);
  clock += 25_000;
  eq('still: 30 s is', pub.position({ ...live(), speed_mps: 0 }), true);
  eq('events so far', events(), ['start', 'position', 'position']);

  // checkpoint carries the planned route; arrived / ended payloads
  reset();
  clock += 1000;
  await pub.checkpoint(live(), track.points, 'poly', planned);
  eq('checkpoint record', calls[0].p_record, { polyline: 'poly', ...planned });
  eq('checkpoint points', calls[0].p_points, track.points);
  reset();
  await pub.arrived(live(), track);
  eq('arrived record', calls[0].p_record, { distance_km_total: 3.2, duration_min: 14, avg_kmh: 13.7, arrival_gap_m: 20, polyline: 'abc' });
  reset();
  eq('ended online lands', await pub.ended(live(), { ...track, ended_by: 'arrived' }), 'sent');
  eq('ended record', calls[0].p_record.ended_by, 'arrived');
  eq('ended queued nothing', queued.length, 0);

  // start fails, retried with the backoff until it lands; nothing else goes out before
  reset();
  let startFails = 2;
  answer = (a) => (a.p_event === 'start' && startFails-- > 0 ? { data: null, error: { message: 'FetchError: network request failed' } } : { data: { status: 'on_the_way' }, error: null });
  pub = new R.RoutePublisher(ID, () => clock, 20);
  eq('first start fails', await pub.start(live(), planned, pin, null), false);
  clock += 10_000;
  eq('position before the row exists sends nothing', pub.position(live()), false);
  eq('only start was tried', events(), ['start']);
  await wait(30);
  eq('second attempt after the backoff', events(), ['start', 'start']);
  await wait(50);
  eq('third attempt lands', [events(), pub.isStarted], [['start', 'start', 'start'], true]);
  eq('attempts counted', pub.attempts, 3);
  eq('the freshest fix went with the retried start', calls[2].p_live.fix_at, live().fix_at);
  clock += 6_000;
  eq('positions flow once started', pub.position(live()), true);

  // ROUTE_NOT_STARTED on a later event: the row is gone, start is sent again
  reset();
  answer = (a) => (a.p_event === 'position' ? { data: null, error: { message: 'ROUTE_NOT_STARTED' } } : { data: { status: 'on_the_way' }, error: null });
  clock += 6_000;
  pub.position(live());
  await wait(10);
  eq('start resent after ROUTE_NOT_STARTED', events(), ['position', 'start']);
  eq('started again', pub.isStarted, true);

  // ROUTE_FORBIDDEN stops for good; ended is dropped
  reset();
  answer = () => ({ data: null, error: { message: 'ROUTE_FORBIDDEN: not the assessor of this QHP' } });
  pub = new R.RoutePublisher(ID, () => clock, 20);
  await pub.start(live(), planned, pin, null);
  eq('forbidden stops', [pub.isStopped, pub.reason], [true, 'forbidden']);
  await wait(40);
  eq('no retry after forbidden', events(), ['start']);
  eq('position after forbidden', pub.position(live()), false);
  eq('ended after forbidden is dropped', await pub.ended(live(), track), 'dropped');
  eq('nothing queued', queued.length, 0);

  // ROUTE_ENDED stops the live events, ended still lands
  reset();
  pub = new R.RoutePublisher(ID, () => clock, 20);
  await pub.start(live(), planned, pin, null);
  answer = (a) => (a.p_event === 'position' ? { data: null, error: { message: 'ROUTE_ENDED' } } : { data: { status: 'ended' }, error: null });
  clock += 6_000;
  pub.position(live());
  await wait(10);
  eq('ROUTE_ENDED stops live events', [pub.isStopped, pub.reason], [true, 'ended']);
  clock += 6_000;
  eq('no more positions', pub.position(live()), false);
  eq('ended still sent', await pub.ended(live(), track), 'sent');
  eq('ended was the last call', events().slice(-1), ['ended']);

  // ended offline: straight to the outbox with the start record for a replay
  reset();
  pub = new R.RoutePublisher(ID, () => clock, 20);
  await pub.start(live(), planned, pin, '5.1 (34)');
  reset();
  online = false;
  eq('ended offline is queued', await pub.ended(live(), track), 'queued');
  eq('no call while offline', calls.length, 0);
  eq('queued kind', queued[0].kind, 'route-ended');
  eq('queued payload carries the start record', queued[0].payload.startRecord, { ...planned, pin, source: 'android', app_version: '5.1 (34)' });
  eq('queued payload record', queued[0].payload.record.ended_by, 'ended');

  // ended online but the call fails: queued, not lost
  reset();
  answer = () => ({ data: null, error: { message: 'network request failed' } });
  eq('ended with a dead connection is queued', await pub.ended(live(), track), 'queued');
  eq('one try only', events(), ['ended']);
  eq('queued once', queued.length, 1);

  // ended when the row never started and start fails too: queued
  reset();
  pub = new R.RoutePublisher(ID, () => clock, 20);
  answer = () => ({ data: null, error: { message: 'network request failed' } });
  await pub.start(live(), planned, pin, null);
  pub.destroy(); // no background retry
  reset();
  answer = () => ({ data: null, error: { message: 'network request failed' } });
  eq('ended without a row tries start once then queues', await pub.ended(live(), track), 'queued');
  eq('start then nothing', events(), ['start']);

  // destroy stops the retry timer
  reset();
  answer = () => ({ data: null, error: { message: 'network request failed' } });
  pub = new R.RoutePublisher(ID, () => clock, 20);
  await pub.start(live(), planned, pin, null);
  pub.destroy();
  await wait(60);
  eq('destroyed publisher retries nothing', events(), ['start']);

  // submitRouteEnded: the outbox replay sends start first when the row never existed
  reset();
  let noRow = true;
  answer = (a) => { if (a.p_event === 'ended' && noRow) return { data: null, error: { message: 'ROUTE_NOT_STARTED' } }; if (a.p_event === 'start') noRow = false; return { data: { status: 'ended' }, error: null }; };
  await R.submitRouteEnded({ assessmentId: ID, live: live(), record: { ended_by: 'ended' }, points: track.points, startRecord: { ...planned, pin, source: 'android', app_version: null } });
  eq('replay: ended, start, ended', events(), ['ended', 'start', 'ended']);
  reset();
  answer = () => ({ data: null, error: { message: 'ROUTE_FORBIDDEN' } });
  let threw = null;
  try { await R.submitRouteEnded({ assessmentId: ID, live: live(), record: {}, points: [], startRecord: null }); } catch (e) { threw = e.message; }
  eq('replay throws a real refusal (the drain marks it failed)', threw, 'ROUTE_FORBIDDEN');

  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
