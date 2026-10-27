// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/session_voice_pain_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of the pain / discomfort flag on session voice notes (14 Oct 2026):
// the parser (old elements, true, false, junk), hasPainNote, and the take toggle helper.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (file, req) => {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, req || require);
  return m.exports;
};
const T = load(ROOT + '/src/lib/sessionVoiceTypes.ts');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const base = { id: 'a', path: 'c/s/u-1.m4a', duration_sec: 12, recorded_at: '2026-10-14T06:00:00Z', recorded_by: 'u', recorded_by_name: 'Sagar', source: 'workout_form' };
eq('old element (no key) reads false', T.parseVoiceNotes([base])[0].pain_discomfort, false);
eq('true reads true', T.parseVoiceNotes([{ ...base, pain_discomfort: true }])[0].pain_discomfort, true);
eq('false reads false', T.parseVoiceNotes([{ ...base, pain_discomfort: false }])[0].pain_discomfort, false);
eq('string "true" is not true', T.parseVoiceNotes([{ ...base, pain_discomfort: 'true' }])[0].pain_discomfort, false);
eq('json string column parses', T.parseVoiceNotes(JSON.stringify([{ ...base, pain_discomfort: true }]))[0].pain_discomfort, true);
eq('junk element dropped', T.parseVoiceNotes([{ pain_discomfort: true }, base]).length, 1);
eq('hasPainNote none', T.hasPainNote(T.parseVoiceNotes([base, { ...base, id: 'b' }])), false);
eq('hasPainNote one', T.hasPainNote(T.parseVoiceNotes([base, { ...base, id: 'b', pain_discomfort: true }])), true);
eq('hasPainNote null', T.hasPainNote(null), false);
eq('hasPainNote []', T.hasPainNote([]), false);

// the toggle helper lives in the component file; load it with the native bits stubbed out
const stub = (id) => {
  if (id === 'react' || id === 'react-native' || id === 'react-native-safe-area-context' || id === 'expo-audio' || id === '../theme' || id === '../icons' || id === './primitives' || id === './ReplayShield' || id === './VoiceNote' || id === '../lib/techDesk' || id === '../lib/sessionVoiceQueries' || id === '../lib/audioFocus') {
    return new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : k === 'default' ? {} : (() => null)) });
  }
  if (id === '../lib/sessionVoiceTypes') return T;
  if (id === '../lib/sharedCoachNote') return load(ROOT + '/src/lib/sharedCoachNote.ts', () => ({})); // pure copy module (26 Oct 2026)
  if (id === '../lib/friendlyError') return load(ROOT + '/src/lib/friendlyError.ts', () => ({}));     // pure error mapper (26 Oct 2026)
  return require(id);
};
const V = load(ROOT + '/src/components/SessionVoice.tsx', stub);
const takes = [{ uri: 'file:///a.m4a', durationMs: 1200, recordedAt: 'x' }, { uri: 'file:///b.m4a', durationMs: 900, recordedAt: 'y', painDiscomfort: true }];
eq('toggle: off -> on', V.toggleTakeFlag(takes, 'file:///a.m4a')[0].painDiscomfort, true);
eq('toggle: on -> off', V.toggleTakeFlag(takes, 'file:///b.m4a')[1].painDiscomfort, false);
eq('toggle: other take untouched', V.toggleTakeFlag(takes, 'file:///a.m4a')[1].painDiscomfort, true);
eq('toggle: unknown uri no change', V.toggleTakeFlag(takes, 'file:///z.m4a').map((t) => !!t.painDiscomfort), [false, true]);
eq('latestHasPain', V.latestHasPain({ day: '2026-10-14', sessions: [{ id: 's', scheduled_at: 'x', session_name: null, session_type: null, notes: T.parseVoiceNotes([{ ...base, pain_discomfort: true }]) }] }), true);
eq('latestHasPain none', V.latestHasPain({ day: '2026-10-14', sessions: [{ id: 's', scheduled_at: 'x', session_name: null, session_type: null, notes: T.parseVoiceNotes([base]) }] }), false);
eq('copy: title has no dashes', /[—–-]/.test(V.PAIN_TITLE) || /[—–]/.test(V.PAIN_CHECKBOX), false);
eq('copy: the pain line is the shared coach note line (26 Oct 2026 rename)', V.PAIN_CHECKBOX, 'Choose, then say it in the note so every coach knows.');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
