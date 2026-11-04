// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/nucleus_progress_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Nucleus staff reading progress (4 Nov 2026): the RPC call shape, the final refusals, the clock delta.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/nucleusProgress.ts', 'utf8');
// the pure part only: the file's React / native imports are stubbed
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stubs = { react: { useRef: () => ({ current: null }), useEffect: () => {} }, 'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }, './supabase': { supabase: {} }, './withTimeout': { withTimeout: (p) => p, NET_MS: 1 }, './offline': { enqueueOutbox: async () => {}, getIsOnline: () => true } };
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => stubs[n] ?? require(n));
const P = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. the call shape
eq('read: no position, progress = scroll fraction', P.buildProgressCall({ pieceId: 'p1', medium: 'read', sample: { progress: 0.4567, position: 120, duration: 300 }, secondsDelta: 15, opened: false }),
  { p_resource_id: 'p1', p_medium: 'read', p_position: null, p_duration: null, p_seconds_delta: 15, p_progress: 0.457, p_opened: false });
eq('audio: position / duration', P.buildProgressCall({ pieceId: 'p1', medium: 'audio', sample: { progress: 0, position: 90.4, duration: 180 }, secondsDelta: 0, opened: true }),
  { p_resource_id: 'p1', p_medium: 'audio', p_position: 90, p_duration: 180, p_seconds_delta: 0, p_progress: 0.5, p_opened: true });
eq('video without a known length: the sample progress', P.buildProgressCall({ pieceId: 'p1', medium: 'video', sample: { progress: 0, position: 30, duration: null }, secondsDelta: 15, opened: false }).p_progress, 0);
eq('clamps: progress above 1, negative delta, delta above the cap', [
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 1.4 }, secondsDelta: -3, opened: false }).p_progress,
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 0.2 }, secondsDelta: -3, opened: false }).p_seconds_delta,
  P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: 0.2 }, secondsDelta: 99999, opened: false }).p_seconds_delta,
], [1, 0, 3600]);
eq('NaN progress reads as 0', P.buildProgressCall({ pieceId: 'p', medium: 'read', sample: { progress: NaN }, secondsDelta: NaN, opened: false }), { p_resource_id: 'p', p_medium: 'read', p_position: null, p_duration: null, p_seconds_delta: 0, p_progress: 0, p_opened: false });
eq('audio position past the length caps at 1', P.buildProgressCall({ pieceId: 'p', medium: 'audio', sample: { progress: 0, position: 200, duration: 180 }, secondsDelta: 1, opened: false }).p_progress, 1);

// 2. refusals and network errors
eq('final refusals', ['LIBRARY_NOT_PUBLISHED: x', 'LIBRARY_STAFF_ONLY: y', 'LIBRARY_BAD_MEDIUM', 'LIBRARY_SIGN_IN: z'].map(P.isPermanentLibraryRefusal), [true, true, true, true]);
eq('not final', ['Network request failed', 'took too long', 'something else'].map(P.isPermanentLibraryRefusal), [false, false, false]);
eq('network errors', [new Error('Network request failed'), new Error('Reading progress took too long'), { name: 'AbortError' }, new Error('row violates')].map(P.isNetworkError), [true, true, false, false]);

// 3. the clock
eq('delta: 40 s read = 15 + 15 + 10 on leave', [P.clockDelta(0, 15_400), P.clockDelta(15_400, 30_100), P.clockDelta(30_100, 40_000)], [15, 15, 10]);
eq('delta: no start = 0, backwards = 0, cap', [P.clockDelta(null, 5000), P.clockDelta(9000, 5000), P.clockDelta(0, 10 * 3600 * 1000)], [0, 0, 3600]);
eq('constants', [P.TICK_MS, P.MIN_DELTA_SECONDS, P.MAX_DELTA_SECONDS], [15000, 1, 3600]);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
