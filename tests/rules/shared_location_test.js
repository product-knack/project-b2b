// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/shared_location_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/sharedLocation.ts (copied byte for byte from the web, 2 Nov 2026): reading a client's pin
// out of the text they shared on WhatsApp, and the helpers the QHP Manager cards use.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/sharedLocation.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const L = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. the forms WhatsApp and the maps apps produce
eq('WhatsApp Google link', L.parseSharedLocation('https://maps.google.com/?q=28.530761,77.106838'), { lat: 28.530761, lng: 77.106838, source: 'google_maps_link' });
eq('place link with !3d !4d', L.parseSharedLocation('https://www.google.com/maps/place/Odds/@28.5,77.1,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d28.53!4d77.10'), { lat: 28.53, lng: 77.1, source: 'google_maps_link' });
eq('@lat,lng,zoom link', L.parseSharedLocation('https://www.google.com/maps/@28.53,77.10,17z'), { lat: 28.53, lng: 77.1, source: 'google_maps_link' });
eq('geo uri', L.parseSharedLocation('geo:28.53,77.10'), { lat: 28.53, lng: 77.1, source: 'geo_uri' });
eq('degrees', L.parseSharedLocation('28.5307° N, 77.1068° E'), { lat: 28.5307, lng: 77.1068, source: 'degrees' });
eq('plain pair', L.parseSharedLocation('28.530761, 77.106838'), { lat: 28.530761, lng: 77.106838, source: 'coordinates' });
eq('pair inside a message', L.parseSharedLocation('My location: 28.530761, 77.106838 see you there'), { lat: 28.530761, lng: 77.106838, source: 'coordinates' });
eq('apple maps link', L.parseSharedLocation('https://maps.apple.com/?ll=28.530761,77.106838&q=Home'), { lat: 28.530761, lng: 77.106838, source: 'apple_maps_link' });

// 2. what is refused
eq('short link: no coordinates', L.parseSharedLocation('https://maps.app.goo.gl/abc'), null);
eq('short link: flagged', [L.isShortMapsLink('https://maps.app.goo.gl/abc'), L.isShortMapsLink('https://maps.google.com/?q=28.5,77.1')], [true, false]);
eq('0,0 refused', L.parseSharedLocation('0, 0'), null);
eq('whole numbers in a sentence refused', L.parseSharedLocation('I have 12, 44 sessions left'), null);
eq('empty and null', [L.parseSharedLocation(''), L.parseSharedLocation(null), L.parseSharedLocation(undefined)], [null, null, null]);
eq('out of range refused', L.parseSharedLocation('128.5, 77.1'), null);

// 3. helpers the cards and the sheet use
eq('read stored pin', L.readBrbLocation({ lat: '28.530761', lng: 77.106838, method: 'ops_whatsapp_paste', accuracy: null, updated_at: '2026-11-02T10:40:00.000Z', captured_by: 'abc' }),
  { lat: 28.530761, lng: 77.106838, method: 'ops_whatsapp_paste', accuracy: null, updated_at: '2026-11-02T10:40:00.000Z', captured_by: 'abc' });
eq('read bad pin', [L.readBrbLocation(null), L.readBrbLocation({ lat: 0, lng: 0 }), L.readBrbLocation('x')], [null, null, null]);
eq('maps link', L.mapsLinkFor(28.530761, 77.106838), 'https://www.google.com/maps?q=28.530761,77.106838');
eq('format coord', [L.formatCoord(28.5), L.formatCoord(NaN)], ['28.500000', '']);
eq('method labels', [L.methodLabel('ops_whatsapp_paste'), L.methodLabel('trainer_device_capture'), L.methodLabel('something_else'), L.methodLabel(null)], ['WhatsApp paste (Ops)', 'Trainer device capture', 'something else', 'unknown source']);
eq('method stamps', [L.BRB_METHOD_OPS_PASTE, L.BRB_METHOD_TRAINER_CAPTURE], ['ops_whatsapp_paste', 'trainer_device_capture']);
eq('saved shape', Object.keys(L.buildBrbLocation(28.5, 77.1, 'u1', new Date('2026-11-02T10:40:00.000Z'))), ['lat', 'lng', 'method', 'accuracy', 'updated_at', 'captured_by']);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
