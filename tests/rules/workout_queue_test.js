// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/workout_queue_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/workoutQueue.ts: which roster slots have a workout log waiting on the device.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/workoutQueue.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const Q = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const items = [
  { id: 'a', kind: 'workout-log', status: 'pending', userId: 'u1', payload: { scheduleSessionId: 'slot1', clientId: 'c1', sessionId: 'w1' } },
  { id: 'b', kind: 'workout-log', status: 'failed', error: 'Already logged', userId: 'u1', payload: { scheduleSessionId: 'slot2', clientId: 'c2', sessionId: 'w2' } },
  { id: 'c', kind: 'workout-log', status: 'pending', userId: 'u2', payload: { scheduleSessionId: 'slot3', clientId: 'c3', sessionId: 'w3' } },
  { id: 'd', kind: 'session-voice-note', status: 'pending', userId: 'u1', payload: { scheduleSessionId: 'slot4' } },
  { id: 'e', kind: 'workout-log', status: 'pending', userId: 'u1', payload: { clientId: 'c5', sessionId: 'w5' } },
  { id: 'f', kind: 'workout-log', status: 'syncing', payload: { scheduleSessionId: 'slot6', clientId: 'c6', sessionId: 'w6' } },
  { id: 'g', kind: 'workout-log', status: 'pending', userId: 'u1', payload: { scheduleSessionId: 'slot1', clientId: 'c1', sessionId: 'w7' } },
];
const map = Q.workoutQueueBySlot(items, 'u1');
eq('slots for u1', [...map.keys()].sort(), ['slot1', 'slot2', 'slot6']);
eq('slot1: the oldest item wins', map.get('slot1'), { id: 'a', status: 'pending', error: undefined, clientId: 'c1', sessionId: 'w1' });
eq('slot2: failed carries the error', [map.get('slot2').status, map.get('slot2').error], ['failed', 'Already logged']);
eq('other user skipped', map.has('slot3'), false);
eq('voice note skipped', map.has('slot4'), false);
eq('ad-hoc log (no slot) skipped', [...map.values()].some((q) => q.sessionId === 'w5'), false);
eq('legacy unstamped item counts', map.get('slot6').status, 'syncing');
eq('no uid: every user', [...Q.workoutQueueBySlot(items, null).keys()].sort(), ['slot1', 'slot2', 'slot3', 'slot6']);
eq('empty', Q.workoutQueueBySlot([], 'u1').size, 0);

eq('line pending offline', Q.queuedLine({ status: 'pending' }, false), { text: 'Saved on this device · waiting for network', tone: 'gold' });
eq('line pending online', Q.queuedLine({ status: 'pending' }, true), { text: 'Saved on this device · syncing soon', tone: 'gold' });
eq('line syncing', Q.queuedLine({ status: 'syncing' }, true).tone, 'blue');
eq('line failed', Q.queuedLine({ status: 'failed' }, true), { text: 'Sync failed · review it on Home', tone: 'red' });

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
