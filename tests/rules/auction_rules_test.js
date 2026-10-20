// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/auction_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of the auction's pure rules (India clock, target day, window, button rule, texts, bids since 10 Oct 2026).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/essentialsAuction.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const A = m.exports;

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const ist = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);
const cfg = A.DEFAULT_AUCTION_CONFIG;

eq('istParts across midnight (23:50 UTC = 05:20 IST next day)', A.istParts(new Date('2026-10-01T23:50:00Z')), { date: '2026-10-02', time: '05:20', minutes: 320, weekday: 'Fri' });
eq('target day is tomorrow IST', A.auctionTargetDate(ist('2026-10-01', '12:00')), '2026-10-02');
eq('target day flips at IST midnight', A.auctionTargetDate(ist('2026-10-01', '23:59')), '2026-10-02');
eq('target day after IST midnight', A.auctionTargetDate(ist('2026-10-02', '00:10')), '2026-10-03');
eq('window 11:00 before', [A.windowState(cfg, ist('2026-10-01', '11:00')).phase, A.windowState(cfg, ist('2026-10-01', '11:00')).minutesLeft], ['before', 120]);
eq('window 12:59 before', A.windowState(cfg, ist('2026-10-01', '12:59')).phase, 'before');
eq('window 13:00 open', [A.windowState(cfg, ist('2026-10-01', '13:00')).phase, A.windowState(cfg, ist('2026-10-01', '13:00')).minutesLeft], ['open', 270]);
eq('window 17:29 open', A.windowState(cfg, ist('2026-10-01', '17:29')).minutesLeft, 1);
eq('window 17:30 after', A.windowState(cfg, ist('2026-10-01', '17:30')).phase, 'after');
eq('window 23:30 after', A.windowState(cfg, ist('2026-10-01', '23:30')).phase, 'after');
eq('window 00:10 before', A.windowState(cfg, ist('2026-10-02', '00:10')).minutesLeft, 770);
eq('opensAt / closesAt text', [A.windowState(cfg, ist('2026-10-01', '12:00')).opensAt, A.windowState(cfg, ist('2026-10-01', '12:00')).closesAt], ['1:00 PM', '5:30 PM']);
eq('formatTime12', [A.formatTime12('07:00'), A.formatTime12('12:00'), A.formatTime12('00:30'), A.formatTime12('18:05')], ['7:00 AM', '12:00 PM', '12:30 AM', '6:05 PM']);
eq('countdown', [A.formatCountdown(0), A.formatCountdown(45), A.formatCountdown(60), A.formatCountdown(115)], ['under a minute', '45m', '1h', '1h 55m']);
eq('lot date', A.formatLotDate('2026-10-02'), 'Fri 2 Oct');
eq('weekdayOf', A.weekdayOf('2026-10-05'), 'Mon');
eq('lotNumber', A.lotNumber(0), 'SESSION 01');
eq('istClock', A.istClock('2026-10-01T06:30:00Z'), '12:00 PM');

const open = A.windowState(cfg, ist('2026-10-01', '14:00'));
const early = A.windowState(cfg, ist('2026-10-01', '13:10'));
const before = A.windowState(cfg, ist('2026-10-01', '10:00'));
const after = A.windowState(cfg, ist('2026-10-01', '18:00'));
const bidFields = { bids_count: 0, question_count: 5, my_points: null, my_submitted_at: null, winner_trainer_id: null, winner_name: null, winner_points: null, round_result: null, evaluated_at: null };
const base = { auction_date: '2026-10-02', client_id: 'c1', client_name: 'Aarav Mehra', modality: 'Strength', slot_time: '07:00', scheduled_for: '2026-10-02T01:30:00Z', status: 'open', trainer_id: null, trainer_name: null, grabbed_at: null, session_id: null, preferred_trainer_id: null, preferred_trainer_name: null, reserved_until: null, ...bidFields };
// ---- the button rule (canGrab, kept name; the bid rule since 10 Oct)
eq('open lot in window', A.canGrab(base, 'me', open), { ok: true, why: null });
eq('open lot before window', A.canGrab(base, 'me', before), { ok: false, why: 'Opens at 1:00 PM' });
eq('open lot after window', A.canGrab(base, 'me', after), { ok: false, why: 'Closed at 5:30 PM' });
eq('grabbed by me', A.canGrab({ ...base, status: 'grabbed', trainer_id: 'me' }, 'me', open).why, 'Yours');
eq('booked elsewhere by other', A.canGrab({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta' }, 'me', open), { ok: false, why: 'Booked by Karan Mehta' });
eq('won by other', A.canGrab({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 5 }, 'me', open), { ok: false, why: 'Won by Karan Mehta' });
eq('already answered', A.canGrab({ ...base, my_points: 4, my_submitted_at: '2026-10-01T08:12:00Z' }, 'me', open), { ok: false, why: 'You answered · 4 of 5 · result at 5:30 PM' });
eq('already answered beats the window text', A.canGrab({ ...base, my_points: 4 }, 'me', after).why, 'You answered · 4 of 5 · result at 5:30 PM');
const reserved = { ...base, status: 'reserved', preferred_trainer_id: 't9', preferred_trainer_name: 'Riya Sen', reserved_until: '2026-10-01T08:00:00Z' };
eq('reserved for another', A.canGrab(reserved, 'me', early), { ok: false, why: 'Reserved for Riya Sen until 1:30 PM' });
eq('reserved for me', A.canGrab(reserved, 't9', early), { ok: true, why: null });
eq('canBid is canGrab', A.canBid === A.canGrab, true);
// ---- bids: ranking, points text, card lines
const bids = [
  { trainer_id: 'a', points: 4, submitted_at: '2026-10-01T08:00:00Z' },
  { trainer_id: 'b', points: 5, submitted_at: '2026-10-01T08:30:00Z' },
  { trainer_id: 'c', points: 5, submitted_at: '2026-10-01T08:10:00Z' },
  { trainer_id: 'd', points: 5, submitted_at: '2026-10-01T08:10:00Z' },
];
eq('rankBids: points desc, then earlier, then usual trainer', A.rankBids(bids, 'd').map((b) => b.trainer_id), ['d', 'c', 'b', 'a']);
eq('rankBids: without a usual trainer the tie keeps input order', A.rankBids(bids, null).map((b) => b.trainer_id), ['c', 'd', 'b', 'a']);
eq('rankBids does not mutate', bids[0].trainer_id, 'a');
eq('pointsText', [A.pointsText(4, 5), A.pointsText(0, 5), A.pointsText(null, 5), A.pointsText(3, 0)], ['4 of 5', '0 of 5', '0 of 5', 'no questions']);
eq('bidsLine', [A.bidsLine({ ...base, bids_count: 2 }), A.bidsLine({ ...base, bids_count: 1, question_count: 0 })], ['2 bids · 5 questions', '1 bid · no questions yet, earliest bid wins']);
eq('lotResultLine won by other, I bid', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 5, my_points: 4 }, 'me'), 'Won by Karan Mehta · 5 of 5 · you 4 of 5');
eq('lotResultLine won by me', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 'me', round_result: 'won', winner_name: 'Me', winner_points: 5, my_points: 5 }, 'me'), 'Won by you · 5 of 5');
eq('lotResultLine booked elsewhere', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta' }, 'me'), 'Booked by Karan Mehta');
eq('lotResultLine won, no questions', A.lotResultLine({ ...base, status: 'grabbed', trainer_id: 't2', trainer_name: 'Karan Mehta', round_result: 'won', winner_name: 'Karan Mehta', winner_points: 0, question_count: 0 }, 'me'), 'Won by Karan Mehta');
// ---- results cards
const res = { round_key: 'c1:2026-10-02', client_id: 'c1', client_name: 'Aarav Mehra', training_date: '2026-10-02', slot_time: '07:00', modality: 'Strength', won: false, result: 'won', my_points: 4, question_count: 5, my_submitted_at: '2026-10-01T08:00:00Z', winner_trainer_id: 't2', winner_name: 'Karan Mehta', winner_points: 5, bids_count: 3, session_id: 's', evaluated_at: '2026-10-01T10:30:00Z' };
eq('headline won', A.resultHeadline({ ...res, won: true }), 'You won Aarav Mehra, Strength on Fri 2 Oct at 7:00 AM');
eq('headline lost', A.resultHeadline(res), "Karan Mehta won Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM");
eq('headline booked elsewhere', A.resultHeadline({ ...res, result: 'booked_elsewhere' }), "Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM was booked outside the auction");
eq('headline no winner', A.resultHeadline({ ...res, result: 'no_winner' }), "No one could be booked for Aarav Mehra's Strength on Fri 2 Oct at 7:00 AM");
eq('detail won', A.resultDetail({ ...res, won: true, my_points: 5 }), '5 of 5 correct · 3 bids · the session is on your roster');
eq('detail won, one bid', A.resultDetail({ ...res, won: true, my_points: 5, bids_count: 1 }), '5 of 5 correct · 1 bid · the session is on your roster');
eq('detail lost on points', A.resultDetail(res), '5 of 5 against your 4 of 5');
eq('detail lost on time', A.resultDetail({ ...res, my_points: 5 }), '5 of 5 each · they answered earlier');
eq('detail other result', A.resultDetail({ ...res, result: 'booked_elsewhere' }), 'Your bid: 4 of 5 correct');
// ---- errors
eq('error prefix stripped', A.describeGrabError({ message: 'ESSENTIALS_DAILY_LIMIT: This client already has a session on 2 Oct.' }), 'This client already has a session on 2 Oct.');
eq('error PGRST202', A.describeGrabError({ code: 'PGRST202', message: 'Could not find the function public.submit_essentials_bid' }).startsWith('The auction is not set up on the server yet'), true);
eq('error network', A.describeGrabError({ message: 'Network request failed' }), 'Network problem. Check your connection and try again.');
eq('error timeout', A.describeGrabError({ message: 'Place my bid timed out' }).startsWith('The bid took too long'), true);
eq('error plain', A.describeGrabError({ message: 'You have already answered for this session. One attempt only.' }), 'You have already answered for this session. One attempt only.');
eq('error missing table', A.describeGrabError({ code: '42P01', message: 'relation "public.essentials_auction_log" does not exist' }).startsWith('The auction is not fully set up'), true);
eq('error lock timeout (code)', A.describeGrabError({ code: '55P03', message: 'canceling statement due to lock timeout' }).startsWith('Another trainer is booking'), true);
eq('error unique index', A.describeGrabError({ code: '23505', message: 'duplicate key value violates unique constraint "uniq_session_schedule_client_datetime_active"' }), 'Someone already booked this training.');
eq('error empty', A.describeGrabError({ message: '' }), 'Could not place this bid.');
eq('isTakenError', [A.isTakenError('Someone already booked this training.'), A.isTakenError('You have already answered for this session. One attempt only.'), A.isTakenError('This auction has been decided.'), A.isTakenError('The client is away on 2 Oct.')], [true, true, true, false]);
// ---- ETA (lot at 09:00 IST on 2 Oct; Hauz Khas vs Pitampura style distances)
const HK = { lat: 28.5494, lng: 77.2001 }, PIT = { lat: 28.7041, lng: 77.1325 }, NEAR = { lat: 28.5520, lng: 77.2050 };
const lotAt = '2026-10-02T03:30:00Z'; // 09:00 IST
const sess = (hhmmIST, loc, name, id) => ({ id, start: `2026-10-02T${hhmmIST}:00+05:30`, name, modality: 'Strength', loc, locText: null });
eq('approxTravel far', A.approxTravel(HK, PIT).min > 40, true);
eq('approxTravel near', A.approxTravel(HK, NEAR).min <= 5, true);
eq('eta: no sessions', A.computeLotEta(lotAt, HK, null, []), { loc: HK, locText: null, prev: null, next: null, tight: false });
let e = A.computeLotEta(lotAt, HK, 'Hauz Khas', [sess('07:00', NEAR, 'Riya', 'a'), sess('10:30', PIT, 'Karan', 'b'), sess('13:00', PIT, 'Far', 'c'), sess('05:30', PIT, 'Early', 'd')]);
eq('eta: prev is the 07:00 (within 3 h), 05:30 excluded', e.prev.session.id, 'a');
eq('eta: prev gap 60 min, near, ok', [e.prev.gapMin, e.prev.tight], [60, false]);
eq('eta: next is 10:30, gap 30 min, far drive, tight', [e.next.session.id, e.next.gapMin, e.next.tight, e.next.etaMin > 30], ['b', 30, true, true]);
eq('eta: tight overall', e.tight, true);
e = A.computeLotEta(lotAt, null, 'Pitampura', [sess('10:30', PIT, 'Karan', 'b')]);
eq('eta: no lot pin -> no drive, not tight, text kept', [e.loc, e.locText, e.next.etaMin, e.next.tight], [null, 'Pitampura', null, false]);
e = A.computeLotEta(lotAt, HK, null, [sess('09:30', NEAR, 'Overlap', 'o')]);
eq('eta: overlap without pins counts as tight', [e.next.gapMin, e.next.tight], [-30, true]);
eq('formatMinutes', [A.formatMinutes(25), A.formatMinutes(60), A.formatMinutes(70)], ['25 min', '1 hr', '1 hr 10 min']);
eq('geoFromBrb', [A.geoFromBrb({ lat: 28.5, lng: 77.2, method: 'x' }), A.geoFromBrb(null), A.geoFromBrb({ lat: 0, lng: 0 })], [{ lat: 28.5, lng: 77.2 }, null, null]);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
