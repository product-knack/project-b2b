// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/team_wallet_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Team Wallet (2 Nov 2026): rupee text, the amount box, the sheet's hints, row copy and chips, grouping, the AI bill lines, the card state.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/teamWallet.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const W = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1. money
eq('rupees 0', W.rupees(0), 'Rs 0');
eq('rupees 500', W.rupees(50000), 'Rs 500');
eq('rupees 2,000', W.rupees(200000), 'Rs 2,000');
eq('rupees 1,00,000', W.rupees(10000000), 'Rs 1,00,000');
eq('rupees 12,34,567', W.rupees(123456700), 'Rs 12,34,567');
eq('rupees rounds paise', W.rupees(250050), 'Rs 2,501');
eq('rupees negative', W.rupees(-4000), '- Rs 40');
eq('signed credit', W.signedRupees(200000), '+ Rs 2,000');
eq('signed debit', W.signedRupees(-4000), '- Rs 40');

// 2. the amount box
eq('parse 2,000', W.parseRupeeInput('2,000'), 200000);
eq('parse 500', W.parseRupeeInput('500'), 50000);
eq('parse Rs 500', W.parseRupeeInput('Rs 500'), 50000);
eq('parse 20.5', W.parseRupeeInput('20.5'), null);
eq('parse empty', W.parseRupeeInput(''), null);
eq('parse abc', W.parseRupeeInput('abc'), null);
eq('parse 0', W.parseRupeeInput('0'), null);

// 3. the sheet's hints
eq('problem: below the minimum', W.topupProblem(40000, 300000), 'The minimum is Rs 500.');
eq('problem: exactly the minimum', W.topupProblem(50000, 300000), null);
eq('problem: over the room', W.topupProblem(350000, 300000), 'You can add Rs 3,000 more today.');
eq('problem: no room at all', W.topupProblem(50000, 0), 'You have added Rs 5,000 today. Try again tomorrow.');
eq('problem: nothing typed', W.topupProblem(null, 300000), null);
eq('room line', W.topupRoomLine(300000), 'You can add Rs 3,000 more today.');

// 4. rows
const t0 = '2026-11-02T09:38:00Z';
const paid = W.parseWalletRow({ id: 'a', seq: 3, kind: 'topup', amount_paise: 200000, status: 'paid', balance_after_paise: 250000, created_at: t0, paid_at: '2026-11-02T09:40:11Z', razorpay: { order_id: 'o', payment_id: 'pay_x', method: 'upi' }, meta: { note: 'Add money' } });
const pendingTop = W.parseWalletRow({ id: 'b', seq: 4, kind: 'topup', amount_paise: 50000, status: 'pending', balance_after_paise: null, created_at: t0, paid_at: null, razorpay: { order_id: 'o2' }, meta: {} });
const bill = W.parseWalletRow({ id: 'c', seq: 5, kind: 'ai_plan', amount_paise: -4000, status: 'pending', balance_after_paise: null, created_at: '2026-12-01T05:00:00Z', paid_at: null, razorpay: null, meta: { client_name: 'Aarav Mehta' } });
const failed = W.parseWalletRow({ id: 'd', seq: 6, kind: 'topup', amount_paise: 50000, status: 'failed', created_at: t0, meta: { failure_reason: 'Bank declined' } });
const discarded = W.parseWalletRow({ id: 'e', seq: 7, kind: 'ai_plan', amount_paise: -3000, status: 'cancelled', created_at: t0, meta: { cancel_reason: 'discarded', client_name: 'Riya' } });
const lapsed = W.parseWalletRow({ id: 'f', seq: 8, kind: 'ai_plan', amount_paise: -3000, status: 'cancelled', created_at: t0, meta: { cancel_reason: 'expired' } });
const refund = W.parseWalletRow({ id: 'g', seq: 9, kind: 'refund', amount_paise: -200000, status: 'paid', balance_after_paise: 50000, created_at: t0, paid_at: t0, razorpay: { refund_id: 'rf' }, meta: {} });
eq('parse: bad kind dropped', W.parseWalletRow({ id: 'z', kind: 'merch', status: 'paid' }), null);
eq('title topup', W.rowTitle(paid), 'Added money');
eq('title AI plan uses the first name', W.rowTitle(bill), 'Odds AI plan, Aarav');
eq('title refund', W.rowTitle(refund), 'Refunded to your bank');
eq('title reversal', W.rowTitle({ ...paid, kind: 'reversal' }), 'Returned');
eq('title adjustment', W.rowTitle({ ...paid, kind: 'adjustment' }), 'Adjustment by Odds');
const now = new Date('2026-11-02T10:00:00Z').getTime();
eq('second line paid', W.rowSecondLine(paid, now), '2 Nov, 3:10 PM · Balance Rs 2,500');
eq('second line pending (22 min)', W.rowStatusLine(pendingTop, now), 'Waiting for payment');
eq('second line pending (31 min)', W.rowStatusLine(pendingTop, now + 9 * 60_000), 'Expired, not charged');
eq('second line bill', W.rowStatusLine(bill, now), 'Bill waiting: deduct or discard');
eq('second line failed', W.rowStatusLine(failed, now), 'Failed: Bank declined');
eq('second line discarded', W.rowStatusLine(discarded, now), 'Discarded');
eq('second line lapsed bill', W.rowStatusLine(lapsed, now), 'Expired, not charged');
eq('chip paid', W.rowChip(paid, now), { text: 'PAID', tone: 'green' });
eq('chip waiting', W.rowChip(pendingTop, now), { text: 'WAITING', tone: 'amber' });
eq('chip expired at 31 min', W.rowChip(pendingTop, now + 9 * 60_000), { text: 'EXPIRED', tone: 'grey' });
eq('chip still waiting at 29 min', W.rowChip(pendingTop, now + 7 * 60_000), { text: 'WAITING', tone: 'amber' });
eq('chip failed', W.rowChip(failed, now), { text: 'FAILED', tone: 'red' });
eq('chip discarded', W.rowChip(discarded, now), { text: 'DISCARDED', tone: 'grey' });
eq('chip lapsed', W.rowChip(lapsed, now), { text: 'EXPIRED', tone: 'grey' });
eq('method labels', [W.methodLabel('upi'), W.methodLabel('card'), W.methodLabel('netbanking'), W.methodLabel(null)], ['UPI', 'Card', 'Net banking', null]);
eq('pending helpers', [W.isPendingTopup(pendingTop), W.isPendingBill(bill), W.isPendingBill(paid)], [true, true, false]);

// 5. grouping (newest first, by IST month)
const groups = W.groupByMonth([paid, pendingTop, bill]);
eq('groups: two months, December first', groups.map((g) => g.header), ['DECEMBER 2026', 'NOVEMBER 2026']);
eq('groups: November rows newest first', groups[1].rows.map((r) => r.id), ['b', 'a']);
eq('month header', W.monthHeader('2026-11-30T20:00:00Z'), 'DECEMBER 2026');   // 1:30 AM IST on 1 Dec

// 6. the read
const read = W.parseWalletRead({ balance_paise: '250000', today_room_paise: 300000, charges_ai: true, pending_bill: { tx_id: 't1', bill_paise: 4000, client_name: 'Aarav', preview: { sections: ['Push', 'Pull'], exercise_count: 18 } }, rows: [paid, { id: 'bad' }] });
eq('read: numbers and rows', [read.balance_paise, read.today_room_paise, read.charges_ai, read.rows.length], [250000, 300000, true, 1]);
eq('read: pending bill', [read.pending_bill.tx_id, read.pending_bill.preview.sections], ['t1', ['Push', 'Pull']]);
eq('read: empty', W.parseWalletRead(null).rows, []);

// 7. the AI bill
eq('bill lines', W.billLines(4000, 200000), { bill: 'Your bill is Rs 40.', after: 'Wallet Rs 2,000, after this Rs 1,960' });
eq('preview line', W.billPreviewLine({ sections: ['Push', 'Pull', 'Legs', 'Conditioning'], exercise_count: 27 }), '4 sections, 27 exercises');
eq('card: not charged', W.walletCardState({ charges: false, balance_paise: 0, floor_paise: 5000, pending_bill: null, ok: true, reason: null }).state, 'free');
eq('card: ok', W.walletCardState({ charges: true, balance_paise: 200000, floor_paise: 5000, pending_bill: null, ok: true, reason: null }), { state: 'ok', line: 'Wallet Rs 2,000', action: null });
eq('card: floor', W.walletCardState({ charges: true, balance_paise: 3000, floor_paise: 5000, pending_bill: null, ok: false, reason: 'WALLET_FLOOR' }), { state: 'floor', line: 'Wallet Rs 30. You need at least Rs 50 in your wallet to make an AI plan.', action: 'wallet' });
eq('card: bill pending', W.walletCardState({ charges: true, balance_paise: 200000, floor_paise: 5000, pending_bill: read.pending_bill, ok: false, reason: 'WALLET_BILL_PENDING' }), { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' });
eq('card: unknown', W.walletCardState(null).state, 'unknown');
eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: 3000, floor_paise: 5000, pending_bill: null, ok: false, reason: 'WALLET_FLOOR' }).reason, 'WALLET_FLOOR');

// 8. errors
eq('coded sentence', W.codedWalletSentence(new Error('WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.')), 'You can add Rs 3000 more today. The limit is Rs 5000 a day.');
eq('coded sentence: other error', W.codedWalletSentence(new Error('Network request failed')), null);
eq('code of', W.walletCodeOf({ message: 'WALLET_INSUFFICIENT: Your wallet has Rs 30.' }), 'WALLET_INSUFFICIENT');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
