// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/qhp_navigation_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/qhpNavigation.ts (pure: geometry, polyline codec, projection, estimates, thinning, track json, stale pin).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/qhpNavigation.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const N = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const near = (name, got, want, tol) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${got} want ${want} within ${tol}`); };
const HK = [28.5494, 77.2001], PIN = [28.6519, 77.1909];
near('haversine HK->pin ~11.4 km', N.haversineM(HK, PIN), 11400, 300);
near('bearing north-ish', N.bearingDeg(HK, PIN), 356, 3);
// polyline round trip (Google's reference example)
const ref = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
const REF_ENC = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
eq('encodePolyline reference', N.encodePolyline(ref), REF_ENC);
eq('decodePolyline reference', N.decodePolyline(REF_ENC), ref);
const route = [HK, [28.5700, 77.1860], [28.6050, 77.1830], [28.6380, 77.1900], PIN];
const rt = N.encodePolyline(route);
eq('route codec round trip', N.decodePolyline(rt).map((p) => p.map((v) => +v.toFixed(5))), route.map((p) => p.map((v) => +v.toFixed(5))));
// projection
const p1 = N.projectOnRoute([28.6050, 77.1835], route); // ~50 m off the 3rd vertex
near('projection: off route small', p1.offM, 50, 20);
near('projection: along ~6.6 km', p1.alongM, 6600, 400);
near('projection: remaining = total - along', p1.remainingM, p1.totalM - p1.alongM, 1);
eq('projection: at the pin remaining 0', Math.round(N.projectOnRoute(PIN, route).remainingM), 0);
eq('projection: null for a short route', N.projectOnRoute(HK, [HK]), null);
eq('isOffRoute 50 m with 10 m accuracy', N.isOffRoute(p1, 10), false);
eq('isOffRoute 300 m', N.isOffRoute({ offM: 300, alongM: 0, remainingM: 0, totalM: 1 }, 10), true);
eq('isOffRoute tolerant of poor accuracy', N.isOffRoute({ offM: 100, alongM: 0, remainingM: 0, totalM: 1 }, 80), false);
// arrival
eq('isArrived 40 m', N.isArrived([28.65190, 77.19130], PIN, 8), true);
eq('isArrived 200 m', N.isArrived([28.6537, 77.1909], PIN, 8), false);
// estimate
const ri = { points: route, distanceKm: 11.4, durationMin: 40, traffic: true, approx: false, fetchedAt: 0, polyline: rt };
const e1 = N.estimateLeft([28.6050, 77.1835], PIN, ri, p1);
eq('estimate with route is not local', e1.local, false);
near('estimate km left ~4.9', e1.km, 4.9, 0.5);
near('estimate min scaled', e1.min, Math.round(40 * (p1.remainingM / p1.totalM)), 1);
const e2 = N.estimateLeft(HK, PIN, null, null);
eq('estimate local flag', e2.local, true);
near('estimate local km = straight x 1.35', e2.km, (N.haversineM(HK, PIN) / 1000) * 1.35, 0.1);
eq('estimate local min = km / 22 kmh', e2.min, Math.max(1, Math.round((e2.km / 22) * 60)));
eq('arrivalClock IST', N.arrivalClock(Date.parse('2026-10-14T09:00:00Z'), 48), '3:18 PM');
eq('agoText', [N.agoText(20_000), N.agoText(61_000), N.agoText(240_000)], ['20 s ago', '1 min ago', '4 min ago']);
// thinning
const start = Date.parse('2026-10-14T09:00:00Z');
const f = (sec, lat, lng, extra = {}) => ({ t: start + sec * 1000, lat, lng, acc: 6, spd: 7.5, ...extra });
eq('shouldKeep first', N.shouldKeep(null, f(0, 28.5, 77.2), start), true);
const kept = N.toPoint(f(0, 28.5, 77.2), start);
eq('toPoint shape', kept, [0, 28.5, 77.2, 6, 7.5]);
eq('shouldKeep 3 m after 2 s: no', N.shouldKeep(kept, f(2, 28.50002, 77.2), start), false);
eq('shouldKeep 12 m: yes', N.shouldKeep(kept, f(2, 28.50011, 77.2), start), true);
eq('shouldKeep 10 s still: yes', N.shouldKeep(kept, f(10, 28.5, 77.2), start), true);
eq('capPoints under cap', N.capPoints([[0, 1, 1, 0, 0], [1, 1, 1, 0, 0]], 10).length, 2);
eq('capPoints over cap halves the older half', N.capPoints(Array.from({ length: 40 }, (_, i) => [i, 1, 1, 0, 0]), 20).length, 30);
// heading + moving
eq('heading from GPS when moving', N.headingFrom(null, f(0, 28.5, 77.2, { heading: 123, spd: 5 }), 0), 123);
near('heading from bearing when GPS heading missing', N.headingFrom(f(0, 28.5, 77.2), f(2, 28.5001, 77.2, { heading: -1, spd: 5 }), 0), 0, 2);
eq('heading keeps last when stationary', N.headingFrom(f(0, 28.5, 77.2), f(2, 28.5, 77.2, { heading: -1, spd: 0 }), 77), 77);
eq('isMoving by speed', N.isMoving(null, f(0, 28.5, 77.2, { spd: 3 })), true);
eq('isMoving still', N.isMoving(f(0, 28.5, 77.2), f(2, 28.5, 77.2, { spd: 0 })), false);
// track json
const pts = [[0, 28.5494, 77.2001, 6, 0], [60, 28.5560, 77.1980, 5, 7.9], [120, 28.5700, 77.1860, 5, 8.2]];
const tr = N.buildTrack({ startMs: start, endMs: start + 120_000, endedBy: 'arrived', points: pts, pin: { lat: 28.5700, lng: 77.1860, captured_at: null, method: 'trainer_device_capture' }, planned: { km: 11.4, min: 40, polyline: rt }, last: [28.5700, 77.1861], source: 'android', appVersion: '5.0 (32)' });
eq('track: started/ended/arrived', [tr.started_at, tr.ended_at, tr.arrived_at, tr.ended_by], ['2026-10-14T09:00:00.000Z', '2026-10-14T09:02:00.000Z', '2026-10-14T09:02:00.000Z', 'arrived']);
near('track: distance ~2.7 km', tr.distance_km, 2.7, 0.15);
eq('track: duration 2 min', tr.duration_min, 2);
near('track: avg kmh = km over 2 min', tr.avg_kmh, tr.distance_km / (2 / 60), 1);
near('track: arrival gap ~10 m', tr.arrival_gap_m, 10, 8);
eq('track: planned carried', [tr.planned_km, tr.planned_min, tr.planned_polyline === rt], [11.4, 40, true]);
eq('track: polyline decodes to the points', N.decodePolyline(tr.polyline).length, 3);
eq('track: ended early has no arrived_at', N.buildTrack({ startMs: start, endMs: start + 1000, endedBy: 'ended', points: pts, pin: { lat: 0, lng: 0, captured_at: null, method: null }, planned: null, last: null, source: 'ios', appVersion: null }).arrived_at, null);
// stale pin
const now = Date.parse('2026-10-14T09:00:00Z');
eq('stale: fresh capture', N.stalePin('2026-10-01T00:00:00Z', 'trainer_device_capture', now).stale, false);
eq('stale: 87 days is still fresh (limit 90)', N.stalePin('2026-07-19T15:26:27Z', 'trainer_device_capture', now).stale, false);
eq('stale: 96 days old', N.stalePin('2026-07-10T15:26:27Z', 'trainer_device_capture', now).stale, true);
eq('stale: 96 days text', N.stalePin('2026-07-10T15:26:27Z', 'trainer_device_capture', now).reason.startsWith('Pin captured 10 Jul 2026, 3 months ago'), true);
eq('stale: ops paste', N.stalePin('2026-10-10T00:00:00Z', 'ops_whatsapp_paste', now).stale, true);
eq('stale: unknown date, device capture', N.stalePin(null, 'trainer_device_capture', now).stale, false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
