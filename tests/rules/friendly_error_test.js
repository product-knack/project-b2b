// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/friendly_error_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/friendlyError.ts: raw server, network and library errors become one plain sentence.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/friendlyError.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const F = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const E = (message, code) => Object.assign(new Error(message), code ? { code } : {});

eq('rls by code', F.friendlyError(E('new row violates row-level security policy for table "session_schedule"', '42501')), F.NOT_ALLOWED);
eq('rls by text', F.friendlyError(E('new row violates row-level security policy for table "x"')), F.NOT_ALLOWED);
eq('no rows', F.friendlyError(E('JSON object requested, multiple (or no) rows returned', 'PGRST116')), F.NOT_FOUND);
eq('duplicate', F.friendlyError(E('duplicate key value violates unique constraint "session_schedule_key"', '23505')), F.ALREADY_SAVED);
eq('not null', F.friendlyError(E('null value in column "trainer_id" of relation "x" violates not-null constraint', '23502')), F.MISSING_FIELD);
eq('uuid', F.friendlyError(E('invalid input syntax for type uuid: "abc"', '22P02')), F.BAD_INPUT);
eq('missing function', F.friendlyError(E('Could not find the function public.xyz(p_a) in the schema cache', 'PGRST202')), F.NOT_SET_UP);
eq('statement timeout', F.friendlyError(E('canceling statement due to statement timeout', '57014')), F.SERVER_SLOW);
eq('network', F.friendlyError(E('TypeError: Network request failed')), F.NO_CONNECTION);
eq('failed to fetch', F.friendlyError(E('Failed to fetch')), F.NO_CONNECTION);
eq('abort', F.friendlyError(Object.assign(new Error('Aborted'), { name: 'AbortError' })), F.NO_CONNECTION);
eq('our timeout class', F.friendlyError(Object.assign(new Error('Crew alerts timed out'), { name: 'TimeoutError' })), F.TOOK_TOO_LONG);
eq('timed out text', F.friendlyError(E('Upload timed out, check your connection and try again.')), F.TOOK_TOO_LONG);
eq('edge function', F.friendlyError(E('FunctionsHttpError: Edge Function returned a non-2xx status code')), F.SERVICE_DOWN);
eq('jwt expired', F.friendlyError(E('JWT expired')), F.SIGNED_OUT);
eq('file too large', F.friendlyError(E('Payload too large')), F.FILE_TOO_BIG);
eq('our own plain sentence is kept', F.friendlyError(E('The client cancelled this session.')), 'The client cancelled this session.');
eq('plain sentence gets a full stop', F.friendlyError(E('Sagar Sharma already has a session at 7:00 pm on 27 Oct')), 'Sagar Sharma already has a session at 7:00 pm on 27 Oct.');
eq('code prefix stripped', F.friendlyError(E('PLAN_LIMIT: Plan limit reached: 3 sessions are logged without an approved plan.')), 'Plan limit reached: 3 sessions are logged without an approved plan.');
eq('em dash replaced', F.friendlyError(E('Saved on this device — it will upload later')), 'Saved on this device, it will upload later.');
eq('technical remainder falls back', F.friendlyError(E('Cannot read properties of undefined (reading "id")')), F.FRIENDLY_FALLBACK);
eq('identifier-looking text falls back', F.friendlyError(E('essentials_weeks row missing for client')), F.FRIENDLY_FALLBACK);
eq('custom fallback', F.friendlyError(E('[object Object]'), 'Could not save the note. Try again.'), 'Could not save the note. Try again.');
eq('empty error', [F.friendlyError(null), F.friendlyError(new Error('')), F.friendlyError(undefined, 'Try again.')], [F.FRIENDLY_FALLBACK, F.FRIENDLY_FALLBACK, 'Try again.']);
eq('string input', F.friendlyError('permission denied for table clients'), F.NOT_ALLOWED);
eq('too long falls back', F.friendlyError(E('a '.repeat(150) + 'sentence')), F.FRIENDLY_FALLBACK);
// standing rule: no dashes in any constant
const all = Object.values(F).filter((v) => typeof v === 'string').join(' ');
eq('no dashes in the copy', /[–—]|\s-\s/.test(all), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
