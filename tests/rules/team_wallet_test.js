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
eq('problem: Rs 1 test top-up passes', W.topupProblem(100, 300000), null);
eq('problem: Rs 2 does not', W.topupProblem(200, 300000), 'The minimum is Rs 500.');
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
const gate = (o) => W.parseWalletGate({ charges: true, balance_paise: 200000, floor_paise: 0, bill_paise: 3300, negative: false, free_total: 3, free_used: 3, free_left: 0, essentials: false, free_this: false, billed: true, pending_bill: null, ok: true, reason: null, ...o });
eq('card: not charged', W.walletCardState(gate({ charges: false, free_this: true, billed: false })).state, 'free');
eq('card: ok (free used up): the exact price and the balance', W.walletCardState(gate({})), { state: 'ok', line: 'Rs 33 from your wallet · balance Rs 2,000', action: null });
eq('card: ok without a bill yet', W.walletCardState(gate({ bill_paise: null })).line, 'Rs 30 to 50 from your wallet · balance Rs 2,000');
eq('card: balance below the price is NOT a block (3 Nov 2026)', W.walletCardState(gate({ balance_paise: 2800 })), { state: 'ok', line: 'Rs 33 from your wallet · balance Rs 28', action: null });
eq('card: 3 free left', W.walletCardState(gate({ free_used: 0, free_left: 3, free_this: true, billed: false })), { state: 'free_left', line: '3 free AI plans left. After that Rs 30 to 50 a plan from your wallet.', action: null });
eq('card: 1 free left (singular)', W.walletCardState(gate({ free_used: 2, free_left: 1, free_this: true, billed: false })).line, '1 free AI plan left. After that Rs 30 to 50 a plan from your wallet.');
eq('card: Essentials client is free even with 0 left', W.walletCardState(gate({ essentials: true, free_this: true, billed: false, balance_paise: 0 })), { state: 'essentials', line: 'Free for Essentials clients.', action: null });
eq('card: negative balance blocks with the owner sentence', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.' })), { state: 'negative', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.', action: 'wallet' });
eq('card: negative without a server line builds it', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE' })).line, 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
eq('card: bill pending', W.walletCardState(gate({ pending_bill: read.pending_bill, ok: false, reason: 'WALLET_BILL_PENDING' })), { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' });
eq('card: unknown', W.walletCardState(null).state, 'unknown');
eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: -3000, floor_paise: 0, pending_bill: null, ok: false, reason: 'WALLET_NEGATIVE' }).reason, 'WALLET_NEGATIVE');
eq('gate parse: negative inferred from the balance', W.parseWalletGate({ charges: true, balance_paise: -100 }).negative, true);
eq('balance text', [W.balanceText(-500), W.balanceText(46700), W.balanceText(0)], ['Rs -5', 'Rs 467', 'Rs 0']);
eq('negative line', W.negativeBalanceLine(-500), 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
eq('option chip: free left', W.aiOptionChip(gate({ free_left: 2, free_this: true, billed: false })), { text: '2 FREE LEFT', tone: 'green' });
eq('option chip: essentials', W.aiOptionChip(gate({ essentials: true, free_this: true, billed: false })), { text: 'FREE FOR ESSENTIALS', tone: 'green' });
eq('option chip: price', W.aiOptionChip(gate({})), { text: 'RS 33', tone: 'amber' });
eq('option chip: negative', W.aiOptionChip(gate({ negative: true, balance_paise: -500 })), { text: 'ADD FUNDS', tone: 'red' });
eq('option chip: not charged', W.aiOptionChip(gate({ charges: false })), null);
eq('after charge: negative is red', W.afterChargeLine(3300, -500), { text: 'Rs 33 deducted. Wallet Rs -5.', tone: 'red' });
eq('after charge: positive is green', W.afterChargeLine(3300, 46700), { text: 'Rs 33 deducted. Wallet Rs 467.', tone: 'green' });
eq('read: negative flag and line', [W.parseWalletRead({ balance_paise: -700 }).negative, W.parseWalletRead({ balance_paise: -700 }).negative_line], [true, 'Your wallet is at Rs -7. Add funds to make the next plan with Odds AI.']);
eq('gate parse: old server answer without free fields is billed', [gate({}).billed, W.parseWalletGate({ charges: true, balance_paise: 3000 }).free_this], [true, false]);
eq('free left line', [W.freeLeftLine(3), W.freeLeftLine(1)], ['3 free AI plans left', '1 free AI plan left']);
const freeRow = W.parseWalletRow({ id: 'h', seq: 10, kind: 'ai_plan', amount_paise: 0, status: 'paid', balance_after_paise: 50000, created_at: t0, paid_at: t0, razorpay: null, meta: { free: true, essentials: false, client_name: 'Riya S' } });
eq('free row: amount, line, chip', [W.rowAmountText(freeRow), W.rowStatusLine(freeRow, now), W.rowChip(freeRow, now), W.rowTitle(freeRow)], ['Free', 'Free plan, not charged', { text: 'FREE', tone: 'green' }, 'Odds AI plan, Riya']);
eq('free Essentials row line', W.rowStatusLine({ ...freeRow, meta: { free: true, essentials: true } }, now), 'Free for Essentials clients');
eq('paid row amount text unchanged', W.rowAmountText(paid), '+ Rs 2,000');

// 8. errors
eq('coded sentence', W.codedWalletSentence(new Error('WALLET_DAILY_CAP: You can add Rs 3000 more today. The limit is Rs 5000 a day.')), 'You can add Rs 3000 more today. The limit is Rs 5000 a day.');
eq('coded sentence: other error', W.codedWalletSentence(new Error('Network request failed')), null);
eq('code of', W.walletCodeOf({ message: 'WALLET_INSUFFICIENT: Your wallet has Rs 30.' }), 'WALLET_INSUFFICIENT');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
