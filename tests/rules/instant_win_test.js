// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/instant_win_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test: the bid banner / result texts for the instant win (android + web libs) and the taken-error match.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
  return m.exports;
};
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const base = { client_id: 'c', client_name: 'Preeti Ch.', training_date: '2026-10-16', slot_time: '17:00', modality: 'Strength', points: 5, question_count: 5, correct: [true, true, true, true, true], submitted_at: '2026-10-15T11:40:00Z', bids_count: 1, instant_win: false, session_id: null, winner_name: null, instant_blocked: null };
for (const [label, file] of [['android', ROOT + '/src/lib/essentialsAuction.ts'], ['web', process.env.WEB_AUCTION_LIB || '']].filter(([, p]) => p && require('fs').existsSync(p))) { // web half runs only when WEB_AUCTION_LIB points at hub-track's src/lib/essentialsAuction.ts
  const L = load(file);
  eq(`${label} instant win banner`, L.bidBannerText({ ...base, instant_win: true, session_id: 's1', winner_name: 'Aditi' }, '5:30 PM'), "Perfect score! Preeti Ch.'s Strength on Fri 16 Oct at 5:00 PM is yours. It is on your roster.");
  eq(`${label} perfect but blocked`, L.bidBannerText({ ...base, instant_blocked: 'Aditi already has a session at 5:00 pm on 16 Oct.' }, '5:30 PM'), '5 of 5 correct, but the session could not be booked at once (Aditi already has a session at 5:00 pm on 16 Oct.). Decided at 5:30 PM.');
  eq(`${label} ordinary bid`, L.bidBannerText({ ...base, points: 3, correct: [true, true, true, false, false] }, '5:30 PM'), 'Bid placed for Preeti Ch.: 3 of 5 correct. Decided at 5:30 PM.');
  eq(`${label} old server (no flags) = ordinary`, L.bidBannerText({ ...base, instant_win: undefined, instant_blocked: undefined }, '5:30 PM'), 'Bid placed for Preeti Ch.: 5 of 5 correct. Decided at 5:30 PM.');
  if (L.isTakenError) {
    eq(`${label} 'Already won by' is a taken error`, L.isTakenError('Already won by Aditi Odds with a perfect score.'), true);
    eq(`${label} 'already booked' still taken`, L.isTakenError('This session is already booked.'), true);
    eq(`${label} other refusal not taken`, L.isTakenError('Answer all 5 questions.'), false);
  }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
